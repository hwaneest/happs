/**
 * Contact → 문의 이메일 발송 웹앱
 *
 * 동작: 문의 양식(org, name, phone, email, type, schedule, message)을 받아서
 *   TO_EMAIL 로 문의 메일을 보냅니다. 답장(Reply-To)은 문의한 사람의 이메일로 갑니다.
 *
 * 배포: script.google.com → 새 프로젝트 → 이 코드 붙여넣기 →
 *       배포 → 새 배포 → 유형: 웹 앱 →
 *       실행 계정: 나 / 액세스 권한: 모든 사용자 → 배포 (Gmail 권한 승인) →
 *       생성된 "웹 앱 URL"을 index.html 의 CONTACT_ENDPOINT 에 붙여넣기.
 *       메일은 배포한 Google 계정에서 발송됩니다.
 *
 * 받는 주소는 코드에 두지 않습니다 (저장소가 공개되어 있으므로).
 *   프로젝트 설정 → 스크립트 속성 → TO_EMAIL 에 받을 이메일 주소를 넣어 주세요.
 *
 * 남용 방지:
 *   - 허니팟: 사람에게는 보이지 않는 website 칸이 채워져 오면 봇으로 보고, 성공한 척만 하고 메일은 보내지 않습니다.
 *   - 횟수 제한: CacheService 로 10분·6시간 동안 보낼 수 있는 문의 수를 제한합니다 (RATE_LIMITS).
 */

// ── 설정 ────────────────────────────────────────────────
var MAX_LEN = 5000;   // 한 칸에 받을 최대 글자 수
var FIELDS = [
  ['org', '소속/기관'], ['name', '이름'], ['phone', '연락처'], ['email', '이메일'],
  ['type', '문의 유형'], ['schedule', '희망 일정'], ['message', '내용']
];
// [기간(초), 그 기간에 보낼 수 있는 최대 문의 수] — 전체 방문자 합계 기준
var RATE_LIMITS = [[600, 5], [21600, 20]];

// ── 엔트리 포인트 ────────────────────────────────────────
function doPost(e) {
  return json(handle((e && e.parameter) || {}));
}

function json(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 핵심 로직 ───────────────────────────────────────────
function handle(params) {
  try {
    if (String(params.website || '').trim()) return { ok: true };  // 허니팟에 걸린 봇: 보내지 않음

    var toEmail = PropertiesService.getScriptProperties().getProperty('TO_EMAIL');
    if (!toEmail) return { ok: false, error: '받는 주소(TO_EMAIL)가 설정되어 있지 않습니다.' };

    var data = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var key = FIELDS[i][0];
      data[key] = String(params[key] || '').trim().slice(0, MAX_LEN);
    }

    if (!data.name) return { ok: false, error: '이름이 비어 있습니다.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return { ok: false, error: '이메일 형식이 올바르지 않습니다.' };
    if (!data.message) return { ok: false, error: '내용이 비어 있습니다.' };
    if (!takeQuota('contact', RATE_LIMITS)) {
      return { ok: false, limited: true, error: '잠시 뒤에 다시 보내 주세요. 문의가 너무 많이 들어오고 있습니다.' };
    }

    var lines = [];
    var rows = [];
    for (var j = 0; j < FIELDS.length; j++) {
      var value = data[FIELDS[j][0]] || '-';
      lines.push(FIELDS[j][1] + ': ' + value);
      rows.push('<tr><th align="left" valign="top" style="padding:6px 16px 6px 0;white-space:nowrap;">'
        + FIELDS[j][1] + '</th><td style="padding:6px 0;white-space:pre-wrap;">' + escapeHtml(value) + '</td></tr>');
    }

    MailApp.sendEmail({
      to: toEmail,
      replyTo: data.email,
      name: 'HAPPS Contact',
      subject: '[문의] ' + (data.type || '기타') + ' - ' + data.name,
      body: lines.join('\n'),
      htmlBody: '<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">' + rows.join('') + '</table>'
    });

    return { ok: true };
  } catch (err) {
    console.error(err);  // 실행 로그에만 남기고, 방문자에게는 내부 오류 내용을 보이지 않습니다.
    return { ok: false, error: '처리 중 오류가 발생했습니다.' };
  }
}

// ── 유틸 ────────────────────────────────────────────────

// limits 의 모든 기간에서 남은 횟수가 있으면 1씩 쓰고 true, 하나라도 다 찼으면 false.
function takeQuota(name, limits) {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var now = Math.floor(Date.now() / 1000);
    var keys = limits.map(function (l) { return 'rl:' + name + ':' + l[0] + ':' + Math.floor(now / l[0]); });
    var counts = keys.map(function (k) { return parseInt(cache.get(k), 10) || 0; });
    for (var i = 0; i < limits.length; i++) if (counts[i] >= limits[i][1]) return false;
    for (var j = 0; j < limits.length; j++) cache.put(keys[j], String(counts[j] + 1), limits[j][0]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
