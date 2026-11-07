// Pages Function：匿名使用统计（没有账号、没有 IP、没有 UA）
//
// GET /api/stats?action=ping&id=<设备随机串>&v=<版本>&p=<平台>
//     每次打开应用打一次；只累加计数，id 只存哈希，不存任何原始信息
// GET /api/stats?action=summary&key=<STATS_KEY>
//     作者自己看的汇总（未配置 STATS_KEY 时直接 403）
//
// GET /api/stats?action=devices&key=<STATS_KEY>
//     列出见过的设备（只给作者，用来认出"哪些是我自己的机器"）
// GET /api/stats?action=exclude&key=<STATS_KEY>[&set=id1,id2]
//     读取 / 全量替换排除名单（名单里的设备不计入统计）
//
// KV 键位：
//   p:<YYYY-MM-DD>        当天打开次数
//   u:<YYYY-MM-DD>:<hash> 当天活跃设备（90 天过期）
//   ud:<YYYY-MM-DD>:<hash> 该设备当天的打开次数（用于剔除自己的设备，90 天过期）
//   i:<hash>              设备首次出现的日期（不过期）
//   ui:<hash>             设备画像 {p:平台, v:版本, first, last, n:累计打开}（不过期）
//   v:<version>           各版本打开次数
//   d:<YYYY-MM-DD>:<f>    当天各安装包下载次数（由 api/dl.js 写入）
//   dw:<version>:<f>      各版本安装包累计下载次数
//   cfg:exclude           排除名单 [{id, note, at}]（自己的设备，不计入报表）

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

// 作者接口的统一鉴权：没配 key 一律 403，传错也 403
function authFail(env, url) {
  const need = env.STATS_KEY;
  if (!need) return json({ error: 'not_configured' }, 403);
  if ((url.searchParams.get('key') || '') !== need) return json({ error: 'forbidden' }, 403);
  return null;
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

const EXCLUDE_KEY = 'cfg:exclude';

// 读排除名单：只接受 [{id, note, at}] 形状，坏数据一律当空
async function loadExclude(kv) {
  try {
    const raw = await kv.get(EXCLUDE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => x && typeof x.id === 'string' && /^[a-f0-9]{8,40}$/.test(x.id));
  } catch {
    return [];
  }
}

function excludedSet(list) {
  return new Set(list.map(x => x.id));
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
    // 每台设备当天的打开次数：报表里要按设备剔除"我自己的机器"
    await bump(env.SYNC, 'ud:' + d + ':' + id, 1, DAY_TTL);

    const seen = await env.SYNC.get('i:' + id);
    if (!seen) await env.SYNC.put('i:' + id, d);

    const ver = (url.searchParams.get('v') || '').replace(/[^\d.]/g, '').slice(0, 12);
    if (ver) await bump(env.SYNC, 'v:' + ver);

    // 设备画像，方便认出哪台是自己的
    const plat = (url.searchParams.get('p') || '').replace(/[^a-zA-Z]/g, '').slice(0, 12);
    let prev = {};
    try { prev = JSON.parse((await env.SYNC.get('ui:' + id)) || '{}') || {}; } catch { prev = {}; }
    await env.SYNC.put('ui:' + id, JSON.stringify({
      p: plat || prev.p || '',
      v: ver || prev.v || '',
      first: prev.first || seen || d,
      last: d,
      n: (parseInt(prev.n, 10) || 0) + 1,
    }));

    return json({ ok: true });
  }

  if (action === 'summary') {
    const bad = authFail(env, url);
    if (bad) return bad;

    // 排除名单：自己的电脑 / 手机，报表里直接扣掉
    const exList = await loadExclude(env.SYNC);
    const exSet = excludedSet(exList);

    const days = [];
    for (let i = 0; i < KEEP_DAYS; i++) {
      const d = dayOffset(i);
      const opensRaw = parseInt((await env.SYNC.get('p:' + d)) || '0', 10) || 0;
      const uniqRaw = await countPrefix(env.SYNC, 'u:' + d + ':');

      // 只读排除名单里那几个键，不从 p: 里反推，成本可控
      let exOpens = 0;
      let exDevices = 0;
      for (const h of exSet) {
        const c = parseInt((await env.SYNC.get('ud:' + d + ':' + h)) || '0', 10) || 0;
        if (c > 0) { exOpens += c; exDevices++; }
      }

      days.push({
        date: d,
        opens: Math.max(0, opensRaw - exOpens),
        devices: Math.max(0, uniqRaw - exDevices),
        // 原始值留着，想看"含自己"的总量时用得上
        opensRaw,
        devicesRaw: uniqRaw,
        excludedOpens: exOpens,
      });
    }

    let installs = await countPrefix(env.SYNC, 'i:');
    for (const h of exSet) {
      if (await env.SYNC.get('i:' + h)) installs = Math.max(0, installs - 1);
    }
    const todayStats = days[0];
    const weekOpens = days.slice(0, 7).reduce((s, x) => s + x.opens, 0);

    const versions = {};
    for (const ver of ['0.2.26', '0.2.27', '0.2.28', '0.2.29', '0.2.30']) {
      const c = parseInt((await env.SYNC.get('v:' + ver)) || '0', 10) || 0;
      if (c) versions[ver] = c;
    }

    // 下载量：当天各包 + 各版本累计（由 api/dl.js 写入）
    const dlFiles = ['apk', 'apk_lite', 'exe', 'exe_lite'];
    const dlToday = {};
    for (const f of dlFiles) {
      dlToday[f] = parseInt((await env.SYNC.get('d:' + todayStats.date + ':' + f)) || '0', 10) || 0;
    }
    const dlVersion = {};
    for (const ver of ['0.2.26', '0.2.27', '0.2.28', '0.2.29', '0.2.30']) {
      const row = {};
      let sum = 0;
      for (const f of dlFiles) {
        const c = parseInt((await env.SYNC.get('dw:' + ver + ':' + f)) || '0', 10) || 0;
        if (c) { row[f] = c; sum += c; }
      }
      if (sum) dlVersion[ver] = row;
    }

    return json({
      ok: true,
      today: todayStats,
      last7daysOpens: weekOpens,
      devicesTotal: installs,
      versions,
      downloadsToday: dlToday,
      downloadsByVersion: dlVersion,
      excluded: exList,
      days,
    });
  }

  // 设备清单：认人用（哪台是自己的电脑/手机）
  if (action === 'devices') {
    const bad = authFail(env, url);
    if (bad) return bad;

    const exList2 = await loadExclude(env.SYNC);
    const exMap = new Map(exList2.map(x => [x.id, x.note || '']));
    const list = [];
    let cursor;
    // 扫 i:<hash>（设备首见的日期，不过期）—— 改造前的老设备也能列出来
    for (let i = 0; i < 10; i++) {
      const page = await env.SYNC.list({ prefix: 'i:', limit: 1000, cursor });
      for (const k of page.keys) {
        const h = k.name.slice(2);
        const firstDate = (await env.SYNC.get(k.name)) || '';
        let meta = {};
        try { meta = JSON.parse((await env.SYNC.get('ui:' + h)) || '{}') || {}; } catch { meta = {}; }
        list.push({
          id: h,
          short: h.slice(0, 8),
          platform: meta.p || '',
          version: meta.v || '',
          first: meta.first || firstDate,
          last: meta.last || '',
          opens: parseInt(meta.n, 10) || 0,
          hasProfile: !!meta.p,
          note: exMap.get(h) || '',
          excluded: exMap.has(h),
        });
      }
      if (page.list_complete) break;
      cursor = page.cursor;
    }
    list.sort((a, b) => b.opens - a.opens || (b.last > a.last ? 1 : -1));
    return json({ ok: true, count: list.length, devices: list.slice(0, 300) });
  }

  // 排除名单：GET 读，带 set= 全量写
  if (action === 'exclude') {
    const bad = authFail(env, url);
    if (bad) return bad;

    const set = url.searchParams.get('set');
    if (set === null) return json({ ok: true, excluded: await loadExclude(env.SYNC) });

    // 支持 "id|备注" 写法；不带备注时用整体 note 参数
    const fallbackNote = (url.searchParams.get('note') || '').slice(0, 20);
    const entries = new Map();
    for (const raw of set.split(',')) {
      const s = raw.trim();
      if (!s) continue;
      const cut = s.indexOf('|');
      const id = (cut >= 0 ? s.slice(0, cut) : s).trim();
      const note = (cut >= 0 ? s.slice(cut + 1) : fallbackNote).trim().slice(0, 20);
      if (/^[a-f0-9]{8,40}$/.test(id)) entries.set(id, note);
    }
    const at = today();
    const arr = Array.from(entries.entries()).map(([id, note]) => ({ id, note, at }));
    await env.SYNC.put(EXCLUDE_KEY, JSON.stringify(arr));
    return json({ ok: true, excluded: arr });
  }

  // 清掉某一天的打开数据（作者专用：测试期把噪音抹干净）
  if (action === 'reset') {
    const bad = authFail(env, url);
    if (bad) return bad;

    const d = (url.searchParams.get('date') || today()).replace(/[^\d-]/g, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: 'bad_date' }, 400);

    let deleted = 0;
    const prefixes = ['u:' + d + ':', 'ud:' + d + ':', 'v:'];
    for (const prefix of prefixes) {
      let cursor;
      for (let i = 0; i < 20; i++) {
        const page = await env.SYNC.list({ prefix, limit: 1000, cursor });
        for (const k of page.keys) {
          await env.SYNC.delete(k.name);
          deleted++;
        }
        if (page.list_complete) break;
        cursor = page.cursor;
      }
    }
    await env.SYNC.delete('p:' + d);
    deleted++;

    return json({ ok: true, date: d, deleted });
  }

  return json({ error: 'unknown_action' }, 400);
}
