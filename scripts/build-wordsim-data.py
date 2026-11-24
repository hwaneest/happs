#!/usr/bin/env python3
"""히든 워드 게임(#wordsim)이 읽는 data/wordsim/ 자료를 만듭니다.

유사도는 Facebook AI가 공개한 fastText 한국어 단어 벡터(cc.ko.300)로 계산합니다.
Common Crawl(웹 문서)과 위키백과의 거대한 한국어 텍스트에서 단어가 함께 쓰이는 맥락을 학습한
300차원 벡터라, 뜻이 가깝거나 같은 맥락에 자주 나오는 단어일수록 유사도가 높게 나옵니다.
  https://fasttext.cc/docs/en/crawl-vectors.html  (CC BY-SA 3.0)

만드는 파일
  data/wordsim/vocab.txt     추측할 수 있는 단어 목록 (한 줄에 한 단어, 자주 쓰이는 순)
  data/wordsim/meta.json     첫 문제 날짜, 문제 수
  data/wordsim/p/NNN.bin     문제 NNN번의 정답과 vocab.txt 모든 단어의 유사도
                             (Int16 little-endian, 코사인 유사도 × 10000, vocab.txt 순서)

쓰는 법 (벡터 파일 약 1.2GB를 한 번 내려받아야 합니다)
  curl -O https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.ko.300.vec.gz
  pip install numpy kiwipiepy
  python3 scripts/build-wordsim-data.py cc.ko.300.vec.gz

문제는 START 날짜(한국 시간)부터 하루에 하나씩 HIDDEN 순서를 섞어 냅니다.
문제를 다 쓰면 처음 문제로 돌아가니, 그 전에 HIDDEN 에 단어를 더 넣고 다시 만들어 커밋하세요.
이미 지난 문제의 순서가 바뀌지 않도록 새 단어는 HIDDEN 맨 뒤에 붙입니다(앞쪽 순서는 그대로 유지됨).
"""
import gzip
import json
import os
import random
import re
import sys

import numpy as np
from kiwipiepy import Kiwi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'wordsim')
START = '2026-11-25'
VOCAB_SIZE = 40000      # 추측할 수 있는 단어 수 (자주 쓰이는 순)
MAX_LINES = 300000      # 벡터 파일에서 읽을 최대 줄 수 (파일은 빈도순)
SEED = 20261125
FIRST_BATCH = 135   # 바꾸지 마세요 (처음 섞은 단어 수)

# 정답 후보: 누구나 아는 일반 명사. 새 단어는 맨 뒤에 붙이세요.
HIDDEN = '''
사과 바다 기차 우산 커피 학교 병원 겨울 음악 친구 고양이 강아지 자전거 도서관 냉장고
여름 하늘 구름 바람 무지개 별빛 달력 시계 안경 거울 의자 책상 연필 지우개 가방
신발 모자 장갑 목도리 양말 치마 바지 셔츠 침대 베개 이불 창문 지붕 계단 엘리베이터
공항 비행기 버스 지하철 택시 항구 다리 터널 고속도로 신호등 우체국 은행 시장 식당 빵집
김치 라면 떡볶이 비빔밥 치킨 피자 케이크 초콜릿 아이스크림 우유 녹차 맥주 와인 수박 딸기
포도 바나나 감자 고구마 당근 양파 마늘 소금 설탕 간장 나무 해바라기 정원 등대 폭포
호수 동굴 사막 화산 지진 태풍 눈사람 크리스마스 생일 결혼 졸업 여행 휴가 축제 운동
축구 야구 농구 수영 등산 낚시 요리 그림 사진 영화 소설 노래 발레 피아노 기타
선생님 의사 경찰 소방관 요리사 가수 배우 작가 화가 농부 대통령 할머니 아기 가족 이웃
'''.split()


def load(path):
    kiwi = Kiwi()
    hangul = re.compile(r'^[가-힣]+$')
    words, vecs = [], []
    hidden = set(HIDDEN)
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        f.readline()
        for i, line in enumerate(f):
            if i >= MAX_LINES:
                break
            w, rest = line.split(' ', 1)
            if not hangul.match(w):
                continue
            t = kiwi.tokenize(w)
            # 명사(일반·고유) 한 덩어리이거나, '-다'로 끝나는 동사·형용사 기본형만 받습니다.
            # ('사과를', '먹었다'처럼 조사·어미가 붙은 말은 뺍니다.)
            noun = len(t) == 1 and t[0].tag in ('NNG', 'NNP') and t[0].form == w
            verb = (len(t) == 2 and t[0].tag.split('-')[0] in ('VV', 'VA')
                    and t[1].form == '다' and w.endswith('다'))
            if not (noun or verb or w in hidden):
                continue
            if len(words) >= VOCAB_SIZE and w not in hidden:
                continue
            words.append(w)
            vecs.append(np.array(rest.split(), dtype=np.float32))
            if len(words) >= VOCAB_SIZE and hidden <= set(words):
                break
    m = np.vstack(vecs)
    m /= np.linalg.norm(m, axis=1, keepdims=True)
    return words, m


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    words, m = load(sys.argv[1])
    index = {w: i for i, w in enumerate(words)}
    missing = [w for w in HIDDEN if w not in index]
    if missing:
        sys.exit('벡터 파일에 없는 정답 후보: ' + ' '.join(missing))
    dup = {w for w in HIDDEN if HIDDEN.count(w) > 1}
    if dup:
        sys.exit('HIDDEN 에 중복된 단어: ' + ' '.join(sorted(dup)))

    # 처음 만든 목록(앞 FIRST_BATCH 개)만 한 번 섞고, 뒤에 붙인 단어는 그 순서대로 이어 붙입니다.
    # 그래서 단어를 더해도 이미 나간 문제의 순서는 바뀌지 않습니다.
    order = HIDDEN[:FIRST_BATCH]
    random.Random(SEED).shuffle(order)
    order += HIDDEN[FIRST_BATCH:]

    os.makedirs(os.path.join(OUT, 'p'), exist_ok=True)
    with open(os.path.join(OUT, 'vocab.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(words) + '\n')
    for n, w in enumerate(order):
        sims = m @ m[index[w]]
        q = np.clip(np.rint(sims * 10000), -32767, 32767).astype('<i2')
        q[index[w]] = 10000
        q.tofile(os.path.join(OUT, 'p', f'{n:03d}.bin'))
    with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump({'start': START, 'count': len(order), 'vocab': len(words)}, f)
    print(f'단어 {len(words):,}개, 문제 {len(order)}개 → {OUT}')


if __name__ == '__main__':
    main()
