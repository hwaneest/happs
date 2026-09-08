/**
 * Checkhere → Google 시트 출석 기록 웹앱
 *
 * 동작: 이름(name)을 받아서, 출석부 탭에서
 *   1) "오늘 날짜와 가장 가까운 날짜 열"을 찾고
 *   2) 그 이름의 행을 찾아
 *   3) 해당 셀에 '출석'(MARK) 을 기록합니다.
 *
 * 배포: 확장 프로그램 → Apps Script → 이 코드 붙여넣기 →
 *       배포 → 새 배포 → 유형: 웹 앱 →
 *       실행 계정: 나 / 액세스 권한: 모든 사용자 → 배포 →
 *       생성된 "웹 앱 URL"을 index.html 의 CHECKHERE_ENDPOINT 에 붙여넣기.
 */

// ── 설정 ────────────────────────────────────────────────
var SHEET_ID = '1wNtGsxZAWl9Rx_EhaYCgpToGx6JOGXcOpi7QjrtZWrA';
var SHEET_GID = 127070871;   // 출석부 탭 gid
var MARK = '출석';            // 기록할 글자. 시트 관례에 맞추려면 '참석' 으로 변경
var NAME_COL = 1;            // 이름이 들어 있는 열 (A=1)
var HEADER_ROW = 1;          // 날짜 헤더가 있는 행

// ── 엔트리 포인트 (JSONP + 일반 JSON 모두 지원) ─────────────
function doGet(e) {
  return respond(e, handle(e.parameter || {}));
}
function doPost(e) {
  var params = (e && e.parameter) || {};
  return respond(e, handle(params));
}

function respond(e, result) {
  var cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 핵심 로직 ───────────────────────────────────────────
function handle(params) {
  try {
    var name = normalize(params.name);
    if (!name) return { ok: false, error: '이름이 비어 있습니다.' };

    var sheet = getSheetByGid(SHEET_ID, SHEET_GID);
    if (!sheet) return { ok: false, error: '출석부 탭을 찾을 수 없습니다.' };

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < HEADER_ROW + 1 || lastCol < 2) {
      return { ok: false, error: '시트에 데이터가 없습니다.' };
    }

    // 1) 날짜 헤더 읽어서 가장 가까운 열 찾기
    var header = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
    var target = params.date ? parseYMD(params.date) : new Date();
    var best = findNearestDateCol(header, target);
    if (!best) return { ok: false, error: '날짜 열을 찾지 못했습니다.' };

    // 2) 이름 행 찾기
    var names = sheet.getRange(HEADER_ROW + 1, NAME_COL, lastRow - HEADER_ROW, 1).getValues();
    var rowIndex = -1;
    for (var i = 0; i < names.length; i++) {
      if (normalize(names[i][0]) === name) { rowIndex = HEADER_ROW + 1 + i; break; }
    }
    if (rowIndex === -1) {
      return { ok: false, notFound: true, error: "'" + name + "' 님을 명단에서 찾을 수 없습니다." };
    }

    // 3) 출석 기록
    var cell = sheet.getRange(rowIndex, best.col);
    var prev = cell.getValue();
    cell.setValue(MARK);

    return {
      ok: true,
      matchedName: normalize(names[rowIndex - HEADER_ROW - 1][0]),
      column: String(header[best.col - 1]).trim(),
      mark: MARK,
      previous: prev === '' ? null : prev
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── 유틸 ────────────────────────────────────────────────

// 공백/제로폭문자 제거 후 소문자 비교용 정규화
function normalize(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/​/g, '')      // 제로폭 공백 (시트에 섞여 있음)
    .replace(/\s+/g, '')          // 모든 공백 제거
    .replace(/\(조장\)/g, '')     // '(조장)' 같은 접미 표기 무시
    .trim();
}

function getSheetByGid(id, gid) {
  var ss = SpreadsheetApp.openById(id);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  return null;
}

// 헤더에서 "M/D" 패턴을 뽑아, target 날짜와 가장 가까운 열을 반환
function findNearestDateCol(header, target) {
  var tRef = new Date(2000, target.getMonth(), target.getDate()); // 연도 무시, 월/일만 비교
  var best = null;
  for (var c = 1; c < header.length; c++) { // 0번은 이름 열
    var text = String(header[c]);
    var m = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!m) continue;
    var mon = parseInt(m[1], 10) - 1;
    var day = parseInt(m[2], 10);
    var d = new Date(2000, mon, day);
    var diff = Math.abs(d.getTime() - tRef.getTime());
    if (!best || diff < best.diff) {
      best = { col: c + 1, diff: diff }; // 열 번호는 1-based
    }
  }
  return best;
}

// 'YYYY-MM-DD' → Date
function parseYMD(s) {
  var m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return new Date();
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}
