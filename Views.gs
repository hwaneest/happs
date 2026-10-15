/**
 * HAPPS 조회수 웹앱 + 관리자 통계 API
 *
 * 동작 1 — 조회수 (GET, JSONP):
 *   page(store, counter, ...)를 받아 그 페이지의 누적 조회수를 1 올리고
 *   새 값을 돌려줍니다. all=1 이면 모든 페이지의 조회수(all)도 함께 돌려줍니다.
 *   누적 값은 스크립트 속성(PropertiesService)에 저장되고,
 *   방문 한 건 한 건은 통계 시트의 'events' 탭에 한 줄씩 쌓입니다
 *   (일자별·앱별·시간대·기기·유입경로 통계는 이 기록으로 계산합니다).
 *   nt=1 이면 숫자만 돌려주고 기록하지 않습니다 (관리자 본인 방문 제외용).
 *
 * 동작 2 — 관리자 API (POST, admin.html 에서 호출):
 *   key 가 스크립트 속성 ADMIN_KEY 와 같을 때만 동작합니다.
 *   action=ping     : 비밀번호·연결 확인
 *   action=stats    : 통계 계산용 집계 데이터
 *   action=setViews : 페이지의 누적 조회수 수정 (page, views)
 *
 * 최초 설정:
 *   1) 이 코드를 붙여넣고 저장 → 함수 목록에서 setup 실행 → 권한 승인.
 *      (통계 시트가 내 드라이브에 만들어지고, 실행 로그에 시트 주소가 찍힙니다.)
 *   2) 프로젝트 설정 → 스크립트 속성 → ADMIN_KEY 에 관리자 비밀번호 추가.
 *   3) 배포 → 배포 관리 → 수정 → 버전: 새 버전 → 배포. (URL은 그대로입니다.)
 */

// ── 설정 ────────────────────────────────────────────────
// 조회수를 셀 수 있는 페이지 (index.html 의 data-views 값과 같아야 합니다)
var PAGES = ['store', 'counter', 'pomodoro', 'gpa', 'todo', 'dday', 'checkhere', 'contact'];
var TZ = 'Asia/Seoul';
var SHEET_NAME = 'events';
var HEADERS = ['time', 'date', 'hour', 'page', 'visitor', 'new', 'device', 'browser', 'os', 'referrer', 'lang'];
var STATS_DAYS = 400;   // 관리자 화면으로 보내는 최대 기간 (일)
var RECENT = 200;       // 최근 방문 기록 줄 수

// ── 엔트리 포인트 ────────────────────────────────────────
function doGet(e) {
  var params = (e && e.parameter) || {};
  return respond(params.callback, handle(params));
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  return respond(null, handleAdmin(params));
}

function respond(cb, result) {
  if (cb && /^[A-Za-z0-9_]+$/.test(cb)) {
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 편집기에서 한 번 실행: 통계 시트를 만들고 주소를 로그에 남깁니다.
function setup() {
  var sheet = getSheet();
  Logger.log('통계 시트: ' + sheet.getParent().getUrl());
  if (!PropertiesService.getScriptProperties().getProperty('ADMIN_KEY')) {
    Logger.log('스크립트 속성에 ADMIN_KEY(관리자 비밀번호)를 추가해 주세요.');
  }
}

// ── 조회수 ──────────────────────────────────────────────
function handle(params) {
  var page = String(params.page || '');
  if (PAGES.indexOf(page) === -1) return { ok: false, error: '알 수 없는 페이지입니다.' };
  var track = !params.nt;

  // 동시에 여러 명이 방문해도 숫자가 빠지지 않도록 잠금을 겁니다.
  var lock = LockService.getScriptLock();
  var result;
  try {
    lock.waitLock(5000);
    var props = PropertiesService.getScriptProperties();
    var views = parseInt(props.getProperty(page), 10) || 0;
    if (track) {
      views++;
      props.setProperty(page, String(views));
    }
    result = { ok: true, page: page, views: views };
    if (params.all) result.all = allViews(props);  // 홈 화면 앱 카드용
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }

  // 시트 기록이 실패해도 조회수 응답은 그대로 돌려줍니다.
  if (track) {
    try { logEvent(page, params); } catch (err) { result.logError = String(err); }
  }
  return result;
}

function logEvent(page, params) {
  var now = new Date();
  getSheet().appendRow([
    now,
    Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    parseInt(Utilities.formatDate(now, TZ, 'H'), 10),
    page,
    clean(params.vid, 40),
    params.nv ? 1 : 0,
    clean(params.dev, 10),
    clean(params.br, 20),
    clean(params.os, 20),
    clean(params.ref, 80),
    clean(params.lang, 10)
  ]);
}

// ── 관리자 API ──────────────────────────────────────────
function handleAdmin(params) {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key) return { ok: false, error: '스크립트 속성에 ADMIN_KEY가 설정되어 있지 않습니다.' };
  if (String(params.key || '') !== key) return { ok: false, auth: false, error: '비밀번호가 올바르지 않습니다.' };

  try {
    if (params.action === 'ping') return { ok: true };
    if (params.action === 'stats') return stats();
    if (params.action === 'setViews') return setViews(params.page, params.views);
    return { ok: false, error: '알 수 없는 요청입니다.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function setViews(page, value) {
  page = String(page || '');
  var n = parseInt(value, 10);
  if (PAGES.indexOf(page) === -1) return { ok: false, error: '알 수 없는 페이지입니다.' };
  if (!(n >= 0)) return { ok: false, error: '0 이상의 숫자를 입력해 주세요.' };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var props = PropertiesService.getScriptProperties();
    props.setProperty(page, String(n));
    return { ok: true, cumulative: allViews(props) };
  } finally {
    lock.releaseLock();
  }
}

// events 탭을 (날짜, 페이지) 단위로 묶어서 돌려줍니다.
// 방문자 수는 기간·앱을 바꿔 가며 중복 없이 셀 수 있도록
// 방문자 번호(visitors 배열의 인덱스) 목록으로 보냅니다.
function stats() {
  var sheet = getSheet();
  var props = PropertiesService.getScriptProperties();
  var last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];

  var since = Utilities.formatDate(new Date(Date.now() - STATS_DAYS * 864e5), TZ, 'yyyy-MM-dd');
  var buckets = {};
  var vidIndex = {};
  var nextVid = 0;
  var firstDate = null;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var date = r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'yyyy-MM-dd') : String(r[1]);
    if (!firstDate || date < firstDate) firstDate = date;
    if (date < since) continue;

    var id = date + '|' + r[3];
    var b = buckets[id] || (buckets[id] = { d: date, p: r[3], v: 0, n: 0, h: {}, dev: {}, br: {}, os: {}, ref: {}, lang: {}, vs: {} });
    b.v++;
    if (r[5] == 1) b.n++;
    bump(b.h, r[2]);
    bump(b.dev, r[6] || 'unknown');
    bump(b.br, r[7] || 'unknown');
    bump(b.os, r[8] || 'unknown');
    bump(b.ref, r[9] || '(direct)');
    bump(b.lang, r[10] || 'unknown');
    var vid = String(r[4] || ('row' + i));
    if (!(vid in vidIndex)) vidIndex[vid] = nextVid++;
    b.vs[vidIndex[vid]] = 1;
  }

  var list = [];
  for (var k in buckets) {
    var bk = buckets[k];
    bk.vs = Object.keys(bk.vs).map(Number);
    list.push(bk);
  }

  var recent = rows.slice(-RECENT).reverse().map(function (r) {
    return {
      t: r[0] instanceof Date ? r[0].getTime() : String(r[0]),
      p: r[3], vid: String(r[4] || '').slice(0, 8), n: r[5] == 1,
      dev: r[6], br: r[7], os: r[8], ref: r[9], lang: r[10]
    };
  });

  return {
    ok: true,
    pages: PAGES,
    today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    firstDate: firstDate,
    totalEvents: rows.length,
    cumulative: allViews(props),
    buckets: list,
    recent: recent,
    sheetUrl: sheet.getParent().getUrl()
  };
}

// ── 유틸 ────────────────────────────────────────────────

// 모든 페이지의 누적 조회수를 { page: views } 로 돌려줍니다.
function allViews(props) {
  var all = {};
  for (var i = 0; i < PAGES.length; i++) {
    all[PAGES[i]] = parseInt(props.getProperty(PAGES[i]), 10) || 0;
  }
  return all;
}

// 통계 시트를 열고, 없으면 내 드라이브에 새로 만듭니다.
function getSheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('STATS_SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create('HAPPS 통계');
    ss.setSpreadsheetTimeZone(TZ);
    props.setProperty('STATS_SHEET_ID', ss.getId());
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('@');  // 날짜가 시간대에 따라 바뀌지 않도록 글자로 저장
  }
  return sheet;
}

function bump(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

// 사용자 입력을 시트에 넣기 전에 다듬습니다 (수식으로 해석되지 않도록 = + - @ 시작 제거).
function clean(v, max) {
  return String(v || '').replace(/^[=+\-@]+/, '').slice(0, max);
}
