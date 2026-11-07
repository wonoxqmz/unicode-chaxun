// Pages Function：匿名使用统计（没有账号、没有 IP、没有 UA）
//
// GET /api/stats?action=ping&id=<设备随机串>&v=<版本>&p=<平台>
//     每次打开应用打一次；只累加计数，id 只存哈希，不存任何原始信息
// GET /api/stats?action=summary&key=<STATS_KEY>
//     作者自己看的汇总（未配置 STATS_KEY 时直接 403）
//
// KV 键位：
//   p:<YYYY-MM-DD>        当天打开次数
//   u:<YYYY-MM-DD>:<hash> 当天活跃设备（90 天过期）
//   i:<hash>              设备首次出现的日期（不过期）
//   v:<version>           各版本打开次数
//   d:<YYYY-MM-DD>:<f>    当天各安装包下载次数（由 api/dl.js 写入）
//   dw:<version>:<f>      各版本安装包累计下载次数

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const DAY_TTL = 90 * 86400;
const KEEP_DAYS = 14;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

// 用 UTC+8 切日，和用户眼里的「今天」对齐
function today() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function dayOffset(n) {
  return new Date(Date.now() + 8 * 3600 * 1000 - n * 86400 * 1000).toISOString().slice(0, 10);
}

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

async function bump(kv, key, by = 1, ttl) {
  const cur = parseInt((await kv.get(key)) || '0', 10) || 0;
  const opts = ttl ? { expirationTtl: ttl } : undefined;
  await kv.put(key, String(cur + by), opts);
  return cur + by;
}

// 数前缀下的键数量（分页，单页上限 1000）
async function countPrefix(kv, prefix, cap = 20000) {
  let cursor, total = 0;
  for (let i = 0; i < 40; i++) {
    const page = await kv.list({ prefix, limit: 1000, cursor });
    total += page.keys.length;
    if (page.list_complete || total >= cap) break;
    cursor = page.cursor;
  }
  return total;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'ping';

  if (!env.SYNC) return json({ error: 'kv_not_bound' }, 500);

  if (action === 'ping') {
    const raw = (url.searchParams.get('id') || '').trim();
    // 只接受客户端生成的随机串，长度卡死，挡掉误传的个人信息
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(raw)) return json({ error: 'bad_id' }, 400);
    const d = today();
    const id = await sha1(raw);

    await bump(env.SYNC, 'p:' + d);
    await env.SYNC.put('u:' + d + ':' + id, '1', { expirationTtl: DAY_TTL });

    const seen = await env.SYNC.get('i:' + id);
    if (!seen) await env.SYNC.put('i:' + id, d);

    const ver = (url.searchParams.get('v') || '').replace(/[^\d.]/g, '').slice(0, 12);
    if (ver) await bump(env.SYNC, 'v:' + ver);

    return json({ ok: true });
  }

  if (action === 'summary') {
    const need = env.STATS_KEY;
    const got = url.searchParams.get('key') || '';
    if (!need) return json({ error: 'not_configured' }, 403);
    if (got !== need) return json({ error: 'forbidden' }, 403);

    const days = [];
    for (let i = 0; i < KEEP_DAYS; i++) {
      const d = dayOffset(i);
      const opens = parseInt((await env.SYNC.get('p:' + d)) || '0', 10) || 0;
      const uniq = await countPrefix(env.SYNC, 'u:' + d + ':');
      days.push({ date: d, opens, devices: uniq });
    }

    const installs = await countPrefix(env.SYNC, 'i:');
    const todayStats = days[0];
    const weekOpens = days.slice(0, 7).reduce((s, x) => s + x.opens, 0);

    const versions = {};
    for (const ver of ['0.2.26', '0.2.27', '0.2.28', '0.2.29', '0.2.30']) {
      const c = parseInt((await env.SYNC.get('v:' + ver)) || '0', 10) || 0;
      if (c) versions[ver] = c;
    }

    return json({
      ok: true,
      today: todayStats,
      last7daysOpens: weekOpens,
      devicesTotal: installs,
      versions,
      days,
    });
  }

  return json({ error: 'unknown_action' }, 400);
}
