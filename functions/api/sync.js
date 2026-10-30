// Pages Function：个人数据同步的「取件柜」
// 只存密文，用 KV 的 TTL 自动过期。前端用取件码派生 AES 密钥，服务端解不开。
//
// POST /api/sync?action=put&code=123456  body: 任意密文字符串
//      -> { code, ttl, bytes }；该 code 已被占用回 409，前端换码重试
// GET  /api/sync?action=get&code=123456  -> 密文字符串（取一次即删）
// GET  /api/sync?action=health           -> { ok, ttl }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const TTL = 600;              // 10 分钟
const MAX_BYTES = 4 * 1024 * 1024;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'health';

  if (action === 'health') {
    return json({ ok: true, service: 'unicode-sync', ttl: TTL, kv: !!env.SYNC });
  }

  if (!env.SYNC) return json({ error: 'kv_not_bound' }, 500);

  if (action === 'put' && request.method === 'POST') {
    const body = await request.text();
    if (body.length < 24) return json({ error: 'empty' }, 400);
    if (body.length > MAX_BYTES) return json({ error: 'too_large' }, 413);

    // 优先用前端自选的取件码：密文是用这个码派生的密钥加密的，
    // 服务端换一个码前端就解不开了，所以码必须由客户端决定。
    // 该码已被占用则回 409，前端换一个重试。
    const want = (url.searchParams.get('code') || '').replace(/\D/g, '');
    if (want) {
      if (want.length !== 6) return json({ error: 'bad_code' }, 400);
      const key = 'c:' + want;
      if (await env.SYNC.get(key)) return json({ error: 'code_taken' }, 409);
      await env.SYNC.put(key, body, { expirationTtl: TTL });
      return json({ code: want, ttl: TTL, bytes: body.length });
    }

    // 没带码就由服务端分配（兼容不带 code 的调用）
    for (let i = 0; i < 10; i++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const key = 'c:' + code;
      if (await env.SYNC.get(key)) continue;
      await env.SYNC.put(key, body, { expirationTtl: TTL });
      return json({ code, ttl: TTL, bytes: body.length });
    }
    return json({ error: 'busy' }, 503);
  }

  if (action === 'get') {
    const raw = url.searchParams.get('code') || '';
    const code = raw.split('').filter((c) => c >= '0' && c <= '9').join('');
    if (code.length !== 6) return json({ error: 'bad_code' }, 400);
    const key = 'c:' + code;
    const val = await env.SYNC.get(key);
    if (!val) return json({ error: 'not_found' }, 404);
    await env.SYNC.delete(key);
    return new Response(val, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
    });
  }

  return json({ error: 'not_found' }, 404);
}
