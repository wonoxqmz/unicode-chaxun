// Pages Function：安装包下载计数 + 跳转（这样才数得到「多少人下过」）
//
// GET /api/dl?f=apk|apk_lite|exe|exe_lite&v=0.2.30
//   -> 先记一次数（d:<日期>:<f>、dw:<版本>:<f>），再 302 到 Gitee Release
// Gitee 不给下载次数的 API，链接全部换成这条后才能看到真实下载量。
// 计数失败也必须照常跳转：统计不能挡住下载。

const FILES = {
  apk: { suffix: '', ext: 'apk' },
  apk_lite: { suffix: '-lite', ext: 'apk' },
  exe: { suffix: '', ext: 'exe' },
  exe_lite: { suffix: '-lite', ext: 'exe' },
};

const REPO = 'https://gitee.com/i-dont-want-to-pick-a-name/unicode-chaxun';
const FALLBACK = REPO + '/releases';

function today() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function bump(kv, key, by = 1) {
  const cur = parseInt((await kv.get(key)) || '0', 10) || 0;
  await kv.put(key, String(cur + by));
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const f = url.searchParams.get('f') || '';
  const v = (url.searchParams.get('v') || '').replace(/[^\d.]/g, '');

  const meta = FILES[f];
  if (!meta) return Response.redirect(FALLBACK, 302);
  if (!/^\d+\.\d+\.\d+$/.test(v)) return Response.redirect(FALLBACK, 302);

  if (env.SYNC) {
    try {
      const d = today();
      await bump(env.SYNC, 'd:' + d + ':' + f);
      await bump(env.SYNC, 'dw:' + v + ':' + f);
    } catch (e) {
      // 统计失败不影响下载
    }
  }

  const name = 'unicode-chaxun-v' + v + meta.suffix + '.' + meta.ext;
  return Response.redirect(REPO + '/releases/download/v' + v + '/' + name, 302);
}
