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
 */

// ── 설정 ────────────────────────────────────────────────
var TO_EMAIL = 'volunteerhwan@gmail.com';
var MAX_LEN = 5000;   // 한 칸에 받을 최대 글자 수
var FIELDS = [
  ['org', '소속/기관'], ['name', '이름'], ['phone', '연락처'], ['email', '이메일'],
  ['type', '문의 유형'], ['schedule', '희망 일정'], ['message', '내용']
];

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
    var data = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var key = FIELDS[i][0];
      data[key] = String(params[key] || '').trim().slice(0, MAX_LEN);
    }

    if (!data.name) return { ok: false, error: '이름이 비어 있습니다.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return { ok: false, error: '이메일 형식이 올바르지 않습니다.' };
    if (!data.message) return { ok: false, error: '내용이 비어 있습니다.' };

    var lines = [];
    var rows = [];
    for (var j = 0; j < FIELDS.length; j++) {
      var value = data[FIELDS[j][0]] || '-';
      lines.push(FIELDS[j][1] + ': ' + value);
      rows.push('<tr><th align="left" valign="top" style="padding:6px 16px 6px 0;white-space:nowrap;">'
        + FIELDS[j][1] + '</th><td style="padding:6px 0;white-space:pre-wrap;">' + escapeHtml(value) + '</td></tr>');
    }

    MailApp.sendEmail({
      to: TO_EMAIL,
      replyTo: data.email,
      name: 'HAPPS Contact',
      subject: '[문의] ' + (data.type || '기타') + ' - ' + data.name,
      body: lines.join('\n'),
      htmlBody: '<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">' + rows.join('') + '</table>'
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── 유틸 ────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
