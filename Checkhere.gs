/**
 * Checkhere → Google 시트 출석 기록 웹앱
 *
 * 동작: 이름(name)과 사용자 입력 일자(date)를 받아서, 출석부 탭에서
 *   1) "입력 일자 이후로 가장 가까운 날짜 열"을 찾고 (입력 일자 당일 포함)
 *   2) 그 이름의 행을 찾아
 *   3) 해당 셀에 '참석'(MARK) 을 기록합니다.
 *
 * 덮어쓰기 규칙: 기존 값과 상관없이 항상 덮어씁니다.
 *   ('불참'이든 이미 '참석'이든 그대로 '참석'으로 바뀝니다.
 *    직전 값은 응답의 previous 로 돌려줍니다.)
 *
 * 배포: 확장 프로그램 → Apps Script → 이 코드 붙여넣기 →
 *       배포 → 새 배포 → 유형: 웹 앱 →
 *       실행 계정: 나 / 액세스 권한: 모든 사용자 → 배포 →
 *       생성된 "웹 앱 URL"을 index.html 의 CHECKHERE_ENDPOINT 에 붙여넣기.
 */

// ── 설정 ────────────────────────────────────────────────
var SHEET_ID = '1wNtGsxZAWl9Rx_EhaYCgpToGx6JOGXcOpi7QjrtZWrA';
var SHEET_GID = 127070871;   // 출석부 탭 gid
var MARK = '참석';            // 셀에 기록할 글자
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

    // 1) 날짜 헤더 읽어서 "입력 일자 이후로 가장 가까운 열" 찾기
    var header = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
    var target = params.date ? parseYMD(params.date) : new Date();
    var best = findUpcomingDateCol(header, target);
    if (!best) {
      return { ok: false, noUpcoming: true, error: '아직 남아 있는 출석 일자가 없습니다.' };
    }

    // 2) 이름 행 찾기
    var names = sheet.getRange(HEADER_ROW + 1, NAME_COL, lastRow - HEADER_ROW, 1).getValues();
    var rowIndex = -1;
    for (var i = 0; i < names.length; i++) {
      if (normalize(names[i][0]) === name) { rowIndex = HEADER_ROW + 1 + i; break; }
    }
    if (rowIndex === -1) {
      return { ok: false, notFound: true, error: "'" + name + "' 님을 명단에서 찾을 수 없습니다." };
    }

    // 3) 출석 기록 — 기존 값과 상관없이 항상 덮어쓴다.
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

// 헤더 행에서 "M/D"가 들어 있는 열만 왼쪽부터 차례대로 뽑습니다.
function parseHeaderDates(header) {
  var out = [];
  for (var c = 1; c < header.length; c++) { // 0번은 이름 열
    var m = String(header[c]).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!m) continue;
    out.push({ col: c + 1, mon: parseInt(m[1], 10) - 1, day: parseInt(m[2], 10) }); // 열 번호는 1-based
  }
  return out;
}

// target(사용자 입력 일자) 이후로 가장 가까운 날짜 열을 반환합니다. (당일 포함)
//
// 헤더에는 연도가 없으므로, 열이 날짜 순으로 놓여 있다는 점을 이용해
// 앞 열보다 날짜가 뒤로 가면(12/16 → 1/6) 해가 바뀐 것으로 보고 연도를 채웁니다.
// 기준 연도는 target 연도와 그 전 해를 함께 해석해 보고,
// 그중 target 이후로 가장 빠른 날짜가 나오는 열을 고릅니다.
// (다음 해까지 넓히지 않으므로, 마지막 일자가 지나면 첫 열로 되돌아가지 않고
//  '남은 일자 없음'이 됩니다.)
function findUpcomingDateCol(header, target) {
  var tRef = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  var cells = parseHeaderDates(header);
  if (!cells.length) return null;

  var best = null;
  var offsets = [-1, 0];
  for (var o = 0; o < offsets.length; o++) {
    var year = target.getFullYear() + offsets[o];
    var prev = null;
    for (var i = 0; i < cells.length; i++) {
      var cur = cells[i];
      if (prev && (cur.mon < prev.mon || (cur.mon === prev.mon && cur.day < prev.day))) year++;
      prev = cur;
      var t = new Date(year, cur.mon, cur.day).getTime();
      if (t < tRef) continue;               // 이미 지난 일자는 건너뜀
      if (!best || t < best.time) best = { col: cur.col, time: t };
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
