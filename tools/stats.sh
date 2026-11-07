#!/usr/bin/env bash
# 看匿名使用统计（key 只存本机，不进仓库）
#   bash tools/stats.sh                 最近 14 天报表（已自动扣掉你自己的设备）
#   bash tools/stats.sh today           只看今天一行
#   bash tools/stats.sh devices         列出见过的设备，认人是哪台
#   bash tools/stats.sh exclude <id> [备注]  把设备加入排除名单（可多台：id 备注 id 备注…）
#   bash tools/stats.sh exclude --list  看当前排除名单
#   bash tools/stats.sh exclude --clear 清空排除名单
#   bash tools/stats.sh reset [YYYY-MM-DD]  清掉某天（默认今天）的打开数据
set -e
cd "$(dirname "$0")/.."

KEY_FILE="$HOME/.workbuddy/uchx_stats_key"
[ -f "$KEY_FILE" ] || { echo "!! 缺 $KEY_FILE（STATS_KEY 存在这里）"; exit 1; }
KEY=$(cat "$KEY_FILE")
BASE="https://unchaxun.pages.dev/api/stats"
PY="python"

api() {
  local q="$1" out="$2"
  curl -s --retry 3 --retry-delay 2 -m 150 "$BASE?$q" -o "$out"
  head -c 1 "$out" | grep -q '{' || {
    echo "拿不到统计（网络或接口异常），原始返回："
    head -c 200 "$out"; echo
    rm -f "$out"; exit 1
  }
}

case "$1" in
  today)
    api "action=summary&key=$KEY" _stats.json
    "$PY" -c "
import json
d = json.load(open('_stats.json', encoding='utf-8'))
t = d['today']
print('%s  打开 %d 次 / %d 台设备' % (t['date'], t['opens'], t['devices']))
"
    rm -f _stats.json
    ;;

  devices)
    api "action=devices&key=$KEY" _devs.json
    "$PY" -c "
import json
d = json.load(open('_devs.json', encoding='utf-8'))
rows = d.get('devices') or []
ex = [x for x in rows if x.get('excluded')]
print('见过的设备：%d 台（已排除 %d 台）' % (len(rows), len(ex)))
print('')
if not rows:
    print('  还没有设备上报过（0.2.30 起才开始打点）')
else:
    print('  %-22s %-9s %-7s %5s  %-11s %-12s %s' % ('设备ID', '平台', '版本', '打开', '首见', '备注', '状态'))
    for r in rows:
        st = []
        if r.get('excluded'):
            st.append('已排除')
        if not r.get('hasProfile'):
            st.append('旧版上报')
        print('  %-22s %-9s %-7s %5d  %-11s %-12s %s' % (
            r.get('id', ''),
            r.get('platform') or '-',
            r.get('version') or '-',
            r.get('opens') or 0,
            r.get('first') or '-',
            r.get('note') or '-',
            ' '.join(st)))
print('')
print('排除自己的设备：bash tools/stats.sh exclude <完整设备ID> [备注]')
"
    rm -f _devs.json
    ;;

  exclude)
    shift || true
    case "$1" in
      --clear)
        api "action=exclude&key=$KEY&set=" _ex.json
        echo "已清空排除名单"
        rm -f _ex.json
        exit 0
        ;;
      --list|"")
        api "action=exclude&key=$KEY" _ex.json
        "$PY" -c "
import json
d = json.load(open('_ex.json', encoding='utf-8'))
ex = d.get('excluded') or []
print('排除名单：%d 台' % len(ex))
for x in ex:
    print('  %s  %s  %s' % (x.get('id', '')[:8], x.get('note') or '', x.get('at') or ''))
"
        rm -f _ex.json
        exit 0
        ;;
    esac
    # 追加：20 位以上 hex 当设备ID，紧随其后的文字当备注
    # 注意：URL 里带中文必须由 Python 编码，curl 拼中文会卡死
    "$PY" -c "
import json, os, re, sys, time, urllib.parse, urllib.request
key = open(os.path.expanduser('~/.workbuddy/uchx_stats_key')).read().strip()
base = 'https://unchaxun.pages.dev/api/stats'
def call(p):
    q = urllib.parse.urlencode(p)
    req = urllib.request.Request(base + '?' + q, headers={'User-Agent': 'Mozilla/5.0 uchx-stats/1.0'})
    err = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            err = e
            time.sleep(2)
    raise err
cur = call({'action': 'exclude', 'key': key}).get('excluded') or []
m = {x['id']: (x.get('note') or '') for x in cur}
last = None
for a in sys.argv[1:]:
    a = a.strip()
    if not a:
        continue
    if re.fullmatch(r'[a-f0-9]{8,40}', a):
        m.setdefault(a, '')
        last = a
    elif last:
        m[last] = a[:20]
if not m:
    print('!! 没给设备ID。用法：bash tools/stats.sh exclude <完整设备ID> [备注]')
    sys.exit(1)
s = ','.join(('%s|%s' % (k, v)) if v else k for k, v in m.items())
r = call({'action': 'exclude', 'key': key, 'set': s})
print('已更新排除名单：')
for x in r.get('excluded') or []:
    print('  %-22s %s' % (x['id'], x.get('note') or '-'))
" "$@"
    ;;

  reset)
    shift || true
    D="${1:-}"
    Q="action=reset&key=$KEY"
    [ -n "$D" ] && Q="$Q&date=$D"
    echo "!! 这会清掉当天的打开数据（不可恢复），5 秒内 Ctrl+C 可取消"
    sleep 5
    api "$Q" _rs.json
    cat _rs.json; echo
    rm -f _rs.json
    ;;

  *)
    api "action=summary&key=$KEY" _stats.json
    "$PY" -c "
import json
d = json.load(open('_stats.json', encoding='utf-8'))
t = d['today']
print('今天 %s：打开 %d 次，活跃设备 %d 台' % (t['date'], t['opens'], t['devices']))
print('近 7 天打开合计 %d 次 ｜ 累计出现过的设备 %d 台' % (d['last7daysOpens'], d['devicesTotal']))
ex = d.get('excluded') or []
if ex:
    print('（已排除自己的 %d 台设备：%s）' % (len(ex), ', '.join((x.get('id') or '')[:8] for x in ex)))
print('')
print('版本分布：')
if not (d.get('versions') or {}):
    print('  （空）')
for k in sorted(d.get('versions') or {}):
    print('  %-8s %d 次' % (k, d['versions'][k]))
print('')
print('各版本下载：')
if not (d.get('downloadsByVersion') or {}):
    print('  （空）')
for k in sorted(d.get('downloadsByVersion') or {}):
    row = d['downloadsByVersion'][k]
    print('  %-8s %s' % (k, '  '.join('%s=%d' % (f, c) for f, c in sorted(row.items()))))
print('')
print('最近 14 天：')
for x in d['days']:
    bar = '#' * min(40, x['opens'])
    print('  %s  %3d 次 / %2d 台  %s' % (x['date'], x['opens'], x['devices'], bar))
"
    rm -f _stats.json
    ;;
esac
