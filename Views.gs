/**
 * HAPPS 조회수 웹앱
 *
 * 동작: page(store, counter, ...)를 받아 그 페이지의 누적 조회수를 1 올리고
 *   새 값을 돌려줍니다. all=1 이면 모든 페이지의 조회수(all)도 함께 돌려줍니다.
 *   값은 스크립트 속성(PropertiesService)에 저장됩니다.
 *   (조회수 확인/수정: Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성)
 *
 * 배포: script.google.com → 새 프로젝트 → 이 코드 붙여넣기 →
 *       배포 → 새 배포 → 유형: 웹 앱 →
 *       실행 계정: 나 / 액세스 권한: 모든 사용자 → 배포 →
 *       생성된 "웹 앱 URL"을 index.html 의 VIEWS_ENDPOINT 에 붙여넣기.
 *       (코드 수정 후에는 배포 → 배포 관리 → 수정 → 버전: 새 버전 → 배포.
 *        이렇게 하면 URL이 바뀌지 않습니다.)
 */

// ── 설정 ────────────────────────────────────────────────
// 조회수를 셀 수 있는 페이지 (index.html 의 data-views 값과 같아야 합니다)
var PAGES = ['store', 'counter', 'pomodoro', 'gpa', 'todo', 'dday', 'checkhere', 'contact'];

// ── 엔트리 포인트 (JSONP) ────────────────────────────────
function doGet(e) {
  var params = (e && e.parameter) || {};
  return respond(params.callback, handle(params));
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

// ── 핵심 로직 ───────────────────────────────────────────
function handle(params) {
  var page = String(params.page || '');
  if (PAGES.indexOf(page) === -1) return { ok: false, error: '알 수 없는 페이지입니다.' };

  // 동시에 여러 명이 방문해도 숫자가 빠지지 않도록 잠금을 겁니다.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var props = PropertiesService.getScriptProperties();
    var views = (parseInt(props.getProperty(page), 10) || 0) + 1;
    props.setProperty(page, String(views));
    var result = { ok: true, page: page, views: views };
    if (params.all) result.all = allViews(props);  // 홈 화면 앱 카드용
    return result;
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
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
