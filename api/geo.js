// 방문자의 대략적인 지역(국가·지역·도시)을 돌려주는 Vercel 서버 함수.
// Vercel이 방문자 IP로 판별해 붙여 주는 x-vercel-ip-* 헤더만 읽습니다.
// IP 주소 자체는 읽거나 돌려주거나 저장하지 않습니다.
module.exports = (req, res) => {
  const h = (name, max) => {
    let v = req.headers[name] || '';
    try { v = decodeURIComponent(v); } catch (e) {}
    return String(v).replace(/[^\p{L}\p{N} .'\-]/gu, '').trim().slice(0, max);
  };
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    country: h('x-vercel-ip-country', 2).toUpperCase(),
    region: h('x-vercel-ip-country-region', 10),
    city: h('x-vercel-ip-city', 40)
  }));
};
