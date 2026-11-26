/**
 * HR 인사이트 포럼 4조 팀프로젝트 설문 → 응답 이메일 발송
 *
 * 이 파일은 Workshop.gs 와 같은 Apps Script 프로젝트("HAPPS Workshop Survey")에 두 번째 파일(Forum.gs)로 올라갑니다.
 * Workshop.gs 의 doPost 가 form=forum4 요청을 handleForum 으로 넘깁니다.
 * (같은 프로젝트라서 Gmail 발송 권한 승인을 다시 받을 필요가 없고, 웹앱 URL도 같습니다.)
 *
 * 받는 값: name(필수), org(소속, 선택), qs = JSON 배열 [{no, title, answer}, ...]
 * 질문 문구는 index.html 의 FM_QUESTIONS 에서 보내 줍니다. 질문을 추가해도 이 파일은 고칠 필요가 없습니다.
 *
 * 받는 주소: 스크립트 속성 FORUM_TO_EMAIL (없으면 TO_EMAIL). 허니팟·횟수 제한은 Workshop.gs 에서 처리합니다.
 */

var FORUM_MAX_QS = 30;        // 받을 최대 문항 수
var FORUM_MAX_TITLE = 500;    // 질문 문구 최대 글자 수
var FORUM_MAX_ANSWER = 5000;  // 답변 최대 글자 수

function handleForum(params) {
  try {
    var cut = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n); };
    var name = cut(params.name, 100);
    var org = cut(params.org, 200);
    if (!name) return { ok: false, error: '이름이 비어 있습니다.' };

    var qs;
    try { qs = JSON.parse(String(params.qs || '[]')); } catch (e) { qs = null; }
    if (!qs || !qs.length || qs.length > FORUM_MAX_QS) return { ok: false, error: '문항 정보가 올바르지 않습니다.' };
    var toEmail = mailTo('FORUM_TO_EMAIL');
    if (!toEmail) return { ok: false, error: '받는 주소(FORUM_TO_EMAIL)가 설정되어 있지 않습니다.' };
    if (!takeQuota('forum', SURVEY_RATE_LIMITS)) return limitedResult();

    var answered = 0;
    var text = ['[HR 인사이트 포럼 4조] 팀프로젝트 의견 회신', '이름: ' + name + (org ? ' / 소속: ' + org : ''), ''];
    var html = ['<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1f2430;max-width:680px;">',
      '<p style="margin:0 0 12px;"><b>이름</b> ' + escapeHtml(name)
        + (org ? ' &nbsp;·&nbsp; <b>소속</b> ' + escapeHtml(org) : '') + '</p>'];

    for (var i = 0; i < qs.length; i++) {
      var q = qs[i] || {};
      var no = cut(q.no, 20);
      var title = cut(q.title, FORUM_MAX_TITLE);
      var answer = cut(q.answer, FORUM_MAX_ANSWER);
      if (answer) answered++;
      var head = (no ? '[' + no + '] ' : '') + title;
      text.push('■ ' + head);
      text.push('  → ' + (answer ? answer.replace(/\n/g, '\n    ') : '(미작성)'));
      text.push('');
      html.push('<h3 style="font-size:15px;margin:20px 0 8px;padding:6px 10px;background:#fdf0e6;border-radius:6px;">'
        + escapeHtml(head) + '</h3>'
        + '<div style="white-space:pre-wrap;padding:8px 12px;border-left:3px solid #f3c7a3;'
        + (answer ? '' : 'color:#9aa0ab;') + '">' + escapeHtml(answer || '(미작성)') + '</div>');
    }
    html.push('</div>');

    MailApp.sendEmail({
      to: toEmail,
      name: 'HR 인사이트 포럼 4조 설문',
      subject: '[HR 인사이트 포럼 4조] ' + name + (org ? ' (' + org + ')' : '') + ' · ' + answered + '/' + qs.length + ' 작성',
      body: text.join('\n'),
      htmlBody: html.join('')
    });
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: '처리 중 오류가 발생했습니다.' };
  }
}
