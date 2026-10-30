// Unicode 编码查询 —— AI 请求转发（可选，自己部署到自己账号下）
//
// 为什么需要它：有些大模型接口不允许浏览器直连（CORS），填了这个代理地址就能绕开。
// 它做的事只有一件：把请求原样转给你指定的接口地址，然后把回答原样送回来（含流式）。
//
// 它不知道你的 Key：Authorization 头是浏览器直接带上来的，本脚本只是透传，
// 不打印、不落盘、不记录。你自己的 Worker 日志里能看到什么，取决于 Cloudflare，
// 不是本脚本。
//
// 部署（2 分钟）：
//   1. Cloudflare 控制台 → Workers and Pages → Create → 粘贴本文件，Deploy
//   2. Settings → Variables：加一个环境变量 AI_TARGET（可选，见下）
//   3. 把拿到的地址（形如 https://ai-proxy.你的名字.workers.dev）填进
//      应用「设置 → 🤖 AI 助手 → 代理地址」
//
// 环境变量（都可选）：
//   AI_TARGET   默认转发目标，例如 https://api.deepseek.com/v1/chat/completions
//               设置了它，前端就不用带 X-Target-Url
//   ALLOW_HOSTS 允许转发的主机名白名单，逗号分隔，例如 api.deepseek.com,api.openai.com
//               不设则不限制（自己的 Worker 问题不大，公开分享时务必设上）
//   PROXY_TOKEN 设了之后，请求必须带 X-Proxy-Token: <同样的值>，防止别人白嫖你的 Worker

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-Url, X-Proxy-Token',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function hostAllowed(url, env) {
  const allow = (typeof env.ALLOW_HOSTS === 'string' ? env.ALLOW_HOSTS : '').trim();
  if (!allow) return true; // 没设白名单就不限制（自己的 Worker，问题不大）
  return allow.split(',').map((s) => s.trim()).filter(Boolean).indexOf(url.hostname) >= 0;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405);

    const token = typeof env.PROXY_TOKEN === 'string' ? env.PROXY_TOKEN : '';
    if (token && request.headers.get('X-Proxy-Token') !== token) {
      return json({ error: 'token 不对' }, 403);
    }

    const target = request.headers.get('X-Target-Url') || (typeof env.AI_TARGET === 'string' ? env.AI_TARGET : '');
    if (!target) return json({ error: '没给转发目标：要么在环境变量里设 AI_TARGET，要么由请求带 X-Target-Url' }, 400);

    let url;
    try {
      url = new URL(target);
    } catch (e) {
      return json({ error: 'X-Target-Url 不是合法地址' }, 400);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return json({ error: '只支持 http/https' }, 400);
    if (!hostAllowed(url, env)) return json({ error: '这个域名不在白名单里：' + url.hostname }, 403);

    // 原样带过去：Authorization 是浏览器给的真实 Key，这里只透传
    const fwd = new Headers();
    fwd.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    const auth = request.headers.get('Authorization');
    if (auth) fwd.set('Authorization', auth);
    const apiKey = request.headers.get('X-Api-Key');
    if (apiKey) fwd.set('X-Api-Key', apiKey);

    let upstream;
    try {
      upstream = await fetch(url, { method: 'POST', headers: fwd, body: await request.text() });
    } catch (e) {
      return json({ error: '转发失败：' + (e && e.message ? e.message : '网络错误') }, 502);
    }

    // 流式（SSE）直接透传，才能在应用里一个字一个字往外冒
    const out = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-store',
      ...CORS,
    });
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
