/**
 * 본부 워크샵 설문 → 응답 이메일 발송 웹앱
 *
 * 동작: [R&D기획운영실 워크샵 4조] 사전 의견 설문 응답
 *   (name, team, topic, q1~q4, q5~q8)을 받아서 TO_EMAIL 로 메일을 보냅니다.
 *   topic 은 '1'(① 연구본부 역할 강화) 또는 '2'(② AI·데이터 미래형 연구 운영)이고,
 *   q5~q8 은 고른 주제의 질문에 대한 답입니다.
 *
 * 배포: script.google.com → 새 프로젝트 → 이 코드 붙여넣기 →
 *       배포 → 새 배포 → 유형: 웹 앱 →
 *       실행 계정: 나 / 액세스 권한: 모든 사용자 → 배포 (Gmail 권한 승인) →
 *       생성된 "웹 앱 URL"을 index.html 의 WORKSHOP_ENDPOINT 에 붙여넣기.
 *       메일은 배포한 Google 계정에서 발송됩니다.
 *
 * 현재 배포: Apps Script 프로젝트 "HAPPS Workshop Survey"
 *   scriptId     19rfXTynkrAbS3q1zoGyFD6Mxj69YCup1WQd6o2i6wekxXMJ86tZoAsZv
 *   deploymentId AKfycbx3OYrwjbZu04zlv30GYRlCY8cgdXilxC1DqRx8OFBme5KsFOhVyjdtCa9grn4kMO5n8g
 *   (clasp 로 코드를 고친 뒤 `clasp create-deployment --deploymentId <위 ID>` 로 올리면 URL이 그대로 유지됩니다.
 *    매니페스트 appsscript.json 에 webapp: executeAs USER_DEPLOYING / access ANYONE_ANONYMOUS 필요)
 */

// ── 설정 ────────────────────────────────────────────────
var TO_EMAIL = 'bronzecircles@gmail.com';
var MAX_LEN = 3000;   // 한 칸에 받을 최대 글자 수
var TEAMS = ['R&D기획팀', 'GCLP팀', 'NCS팀', 'Bio규제관리팀'];

var COMMON = {
  title: '공통주제: One Team 협업 방식',
  questions: [
    'Q1. 다른 팀·실과 일할 때 지연이나 재작업이 생겼던 사례 1~2개',
    'Q2. 그 일을 시작할 때 "이것만 미리 합의했으면 좋았을" 정보나 기준',
    'Q3. 회의·보고·검토 과정에서 줄이거나 바꾸고 싶은 것 1가지',
    'Q4. 연구본부 협업 원칙으로 제안하고 싶은 한 줄'
  ]
};
var TOPICS = {
  '1': {
    title: '실별 주제 ① 연구본부 역할 강화를 위한 업무 개선',
    questions: [
      'Q5. 업무에서 가장 시간과 노력이 많이 드는 영역',
      'Q6. 중복되거나 불필요하다고 느끼는 보고·승인·시스템 절차',
      'Q7. 팀마다 방식이 달라 통합·표준화하면 효과가 클 업무',
      'Q8. 단기간에 바꾸면 연구 현장이 바로 체감할 개선 과제'
    ]
  },
  '2': {
    title: '실별 주제 ② AI·데이터를 활용한 미래형 연구 운영',
    questions: [
      "Q5'. 반복적으로 손으로 하는 업무 중 자동화되면 좋을 업무 (주당 소요 시간)",
      "Q6'. 감이나 경험보다 데이터에 근거한 판단이 더 필요한 운영 업무",
      "Q7'. AI·데이터를 업무에 쓸 때 꼭 지켜야 한다고 생각하는 것",
      "Q8'. 여러 시스템·파일·메일에 흩어져 찾느라 시간이 드는 정보와, 이를 연결할 아이디어"
    ]
  }
};

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
    var get = function (key) { return String(params[key] || '').trim().slice(0, MAX_LEN); };
    var name = get('name');
    var team = get('team');
    var topic = get('topic');

    if (!name) return { ok: false, error: '이름이 비어 있습니다.' };
    if (TEAMS.indexOf(team) === -1) return { ok: false, error: '소속 팀을 골라 주세요.' };
    if (!TOPICS[topic]) return { ok: false, error: '실별 주제를 골라 주세요.' };

    var sections = [
      { title: COMMON.title, questions: COMMON.questions, keys: ['q1', 'q2', 'q3', 'q4'] },
      { title: TOPICS[topic].title, questions: TOPICS[topic].questions, keys: ['q5', 'q6', 'q7', 'q8'] }
    ];

    var answered = 0;
    var text = ['[R&D기획운영실 워크샵 4조] 사전 의견 회신', '이름: ' + name + ' / 소속: ' + team,
      '선택한 실별 주제: ' + TOPICS[topic].title.replace('실별 주제 ', ''), ''];
    var html = ['<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1f2430;max-width:680px;">',
      '<p style="margin:0 0 12px;"><b>이름</b> ' + escapeHtml(name) + ' &nbsp;·&nbsp; <b>소속</b> ' + escapeHtml(team) + '</p>'];

    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      text.push('■ ' + sec.title);
      html.push('<h3 style="font-size:15px;margin:20px 0 8px;padding:6px 10px;background:#eef1fe;border-radius:6px;">'
        + escapeHtml(sec.title) + '</h3>');
      for (var i = 0; i < sec.keys.length; i++) {
        var value = get(sec.keys[i]);
        if (value) answered++;
        text.push(sec.questions[i]);
        text.push('  → ' + (value ? value.replace(/\n/g, '\n    ') : '(미작성)'));
        html.push('<p style="margin:12px 0 4px;font-weight:700;">' + escapeHtml(sec.questions[i]) + '</p>'
          + '<div style="white-space:pre-wrap;padding:8px 12px;border-left:3px solid #c9d2fb;'
          + (value ? '' : 'color:#9aa0ab;') + '">' + escapeHtml(value || '(미작성)') + '</div>');
      }
      text.push('');
    }
    html.push('</div>');

    MailApp.sendEmail({
      to: TO_EMAIL,
      name: '본부 워크샵 설문',
      subject: '[4조 사전의견] ' + name + ' (' + team + ') · 주제 ' + (topic === '1' ? '①' : '②')
        + ' · ' + answered + '/8 작성',
      body: text.join('\n'),
      htmlBody: html.join('')
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 편집기에서 한 번 실행하면 메일 발송 권한(Gmail) 승인 창이 뜹니다. 메일은 보내지 않습니다.
function authorize() {
  Logger.log('오늘 남은 메일 발송 한도: ' + MailApp.getRemainingDailyQuota());
}

// ── 유틸 ────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
