#!/usr/bin/env python3
"""지하철 혼잡도 앱(#subway)이 읽는 data/subway.json 을 만듭니다.

두 가지 공공데이터를 서울 열린데이터광장에서 내려받아 합칩니다.

1. 서울교통공사 지하철 혼잡도 정보 (OA-12928)
   1~8호선(서울교통공사 운영 구간) 역·방향별 30분 단위 평균 혼잡도. 분기마다 새 파일.
   혼잡도 34% = 좌석이 모두 찬 정도, 100% = 정원(한 칸 160명) 탑승.
2. 서울시 지하철 호선별 역별 시간대별 승하차 인원 (OA-12252)
   1~9호선(코레일 구간 포함) 역별 1시간 단위 교통카드 승차·하차 인원. 매월 갱신.
   9호선과 코레일 구간은 혼잡도 자료가 없어 이 값으로 '역 붐빔'을 보여 줍니다.

새 자료가 나오면(분기·월마다) 아래 한 줄로 다시 만들고 커밋하면 됩니다.

    python3 scripts/build-subway-data.py

필요: Python 3.9+, openpyxl (혼잡도 파일이 xlsx일 때)
"""
import calendar
import csv
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'subway.json')
UA = {'User-Agent': 'Mozilla/5.0 (HAPPS data build)'}

CONG_PAGE = 'https://data.seoul.go.kr/dataList/OA-12928/S/1/datasetView.do'
CONG_DOWN = 'https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false'
CARD_PAGE = 'https://data.seoul.go.kr/dataList/OA-12252/S/1/datasetView.do'
CARD_DATA = ('https://data.seoul.go.kr/dataList/dataView.do?onepagerow=1000&srvType=S'
             '&infId=OA-12252&serviceKind=1&pageNo=1&gridTotalCnt=&ssUserId=SAMPLE_VIEW&strWhere='
             '&strOrderby=USE_MM+DESC%2CSBWY_ROUT_LN_NM+ASC%2CSTTN+ASC&filterCol=&txtFilter=')

# 승하차 자료의 노선 이름 → 앱에서 보여 줄 호선. 코레일 구간은 해당 호선에 '코레일 구간'으로 붙입니다.
CARD_LINES = {
    '1호선': '1', '경부선': '1', '경원선': '1', '경인선': '1', '장항선': '1',
    '2호선': '2',
    '3호선': '3', '일산선': '3',
    '4호선': '4', '과천선': '4', '안산선': '4',
    '5호선': '5', '6호선': '6', '7호선': '7', '8호선': '8',
    '9호선': '9', '9호선2~3단계': '9',
}
KORAIL = {'경부선', '경원선', '경인선', '장항선', '일산선', '과천선', '안산선'}
# 승하차 자료의 '경원선'에는 경의중앙선 역도 섞여 있어 1호선에서 뺍니다.
NOT_LINE1 = {'서빙고', '옥수', '응봉', '왕십리', '이촌', '한남'}

# 9호선은 혼잡도 파일에 없어 역 순서를 직접 둡니다 (개화 → 중앙보훈병원).
LINE9 = ['개화', '김포공항', '공항시장', '신방화', '마곡나루', '양천향교', '가양', '증미', '등촌',
         '염창', '신목동', '선유도', '당산', '국회의사당', '여의도', '샛강', '노량진', '노들', '흑석',
         '동작', '구반포', '신반포', '고속터미널', '사평', '신논현', '언주', '선정릉', '삼성중앙',
         '봉은사', '종합운동장', '삼전', '석촌고분', '석촌', '송파나루', '한성백제', '올림픽공원',
         '둔촌오륜', '중앙보훈병원']

DAY_SHEETS = {'평일': 'w', '토요일': 's', '일요일': 'h'}


def fetch(url, data=None, referer=None):
    headers = dict(UA)
    if referer:
        headers['Referer'] = referer
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method='POST' if body else 'GET')
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def norm(name):
    """역 이름 비교용: 괄호 속 부기명과 공백을 뺍니다. '동작(현충원)' → '동작'"""
    return re.sub(r'\(.*?\)|\s', '', str(name))


def latest_congestion_file():
    html = fetch(CONG_PAGE).decode('utf-8', 'replace')
    files = re.findall(r'title="([^"]*지하철혼잡도정보_(\d{8})\.(csv|xlsx))"[^>]*'
                       r'onclick="javascript:downloadFile\(\'(\d+)\'\)', html)
    if not files:
        sys.exit('혼잡도 파일 목록을 찾지 못했습니다. 열린데이터광장 페이지 구조가 바뀌었는지 확인하세요.')
    name, ymd, ext, seq = max(files, key=lambda f: f[1])
    raw = fetch(CONG_DOWN, {'infId': 'OA-12928', 'seqNo': '', 'seq': seq, 'infSeq': '1'}, CONG_PAGE)
    if raw[:5] == b'<html':
        sys.exit('혼잡도 파일을 내려받지 못했습니다: ' + raw[:200].decode('utf-8', 'replace'))
    print(f'혼잡도 파일: {name}')
    return ymd, ext, raw


def congestion_rows(ext, raw):
    """(요일키, 호선, 역번호, 역명, 방향, [30분 값들]), 시간대 머리글 을 돌려줍니다."""
    rows, slots = [], None
    if ext == 'xlsx':
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        for ws in wb.worksheets:
            day = DAY_SHEETS.get(ws.title.strip())
            if not day:
                continue
            it = ws.iter_rows(values_only=True)
            head = next(it)
            slots = slots or [str(h) for h in head[4:]]
            for r in it:
                if r[0]:
                    rows.append((day, r[0], r[1], r[2], r[3], list(r[4:])))
    else:
        text = None
        for enc in ('utf-8-sig', 'cp949'):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                pass
        rd = csv.reader(io.StringIO(text))
        head = next(rd)
        # CSV는 '요일구분, 호선, 역번호, 출발역, 상하구분, 5시30분, ...' 형태
        slots = [h for h in head[5:]]
        for r in rd:
            day = DAY_SHEETS.get(r[0].strip())
            if day:
                rows.append((day, r[1], r[2], r[3], r[4], r[5:]))
    return rows, slots


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def card_rows():
    text = fetch(CARD_DATA, {}, CARD_PAGE).decode('utf-8', 'replace').strip()
    # 응답이 따옴표 없는 키와 꼬리 쉼표가 있는 자바스크립트 객체라서 JSON으로 고칩니다.
    text = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', text)
    text = re.sub(r',\s*([\]}])', r'\1', text)
    rows = json.loads(text)['list']
    month = max(r['USE_MM'] for r in rows)
    rows = [r for r in rows if r['USE_MM'] == month]
    print(f'승하차 자료: {month[:4]}년 {month[4:]}월, {len(rows)}개 역')
    return month, rows


def main():
    ymd, ext, raw = latest_congestion_file()
    crow, slots = congestion_rows(ext, raw)
    month, brow = card_rows()
    days = calendar.monthrange(int(month[:4]), int(month[4:]))[1]

    lines = {str(n): {} for n in range(1, 10)}   # 호선 → 정규화한 역이름 → 역

    for day, line, code, name, d, vals in crow:
        ln = re.sub(r'\D', '', str(line))
        st = lines[ln].setdefault(norm(name), {'n': norm(name), 'no': int(num(code)), 'c': {}})
        st['c'].setdefault(str(d).strip(), {})[day] = [round(num(v)) for v in vals]

    unmatched = []
    for r in brow:
        ln = CARD_LINES.get(r['SBWY_ROUT_LN_NM'])
        if not ln:
            continue
        key = norm(r['STTN'])
        if r['SBWY_ROUT_LN_NM'] == '경원선' and key in NOT_LINE1:
            continue
        st = lines[ln].get(key)
        if st is None:
            st = lines[ln][key] = {'n': key}
            if r['SBWY_ROUT_LN_NM'] in KORAIL:
                st['k'] = 1
            elif ln != '9':
                unmatched.append(f'{ln}호선 {r["STTN"]}')
        on = [round(num(r.get(f'HR_{h}_GET_ON_NOPE')) / days) for h in range(24)]
        off = [round(num(r.get(f'HR_{h}_GET_OFF_NOPE')) / days) for h in range(24)]
        if 'on' in st and r['SBWY_ROUT_LN_NM'] in KORAIL:
            continue   # 서울역·청량리처럼 서울교통공사 구간과 겹치는 코레일 역은 공사 쪽 값만 씁니다.
        st['on'], st['off'] = on, off

    out_lines = {}
    for ln, sts in lines.items():
        # '성수E', '응암S'처럼 승하차 기록이 없는 분기·순환 구분용 가상 역은 뺍니다.
        sts = {k: v for k, v in sts.items() if 'on' in v or not re.search(r'[A-Za-z]$', k)}
        def order(s):
            if ln == '9':
                return (0, LINE9.index(s['n']) if s['n'] in LINE9 else 99, s['n'])
            return (1 if s.get('k') else 0, s.get('no', 9999), s['n'])
        out_lines[ln] = sorted(sts.values(), key=order)

    data = {
        'meta': {
            'congestion': f'{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}',
            'boarding': f'{month[:4]}-{month[4:]}',
            'days': days,
            'slots': [s.split('~')[0] for s in slots],
        },
        'lines': out_lines,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(len(v) for v in out_lines.values())
    print(f'저장: {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024}KB, {total}개 역)')
    if unmatched:
        print('혼잡도 자료와 이름이 맞지 않아 승하차만 있는 역:', ', '.join(unmatched))


if __name__ == '__main__':
    main()
