#!/usr/bin/env bash
# 看匿名使用统计的汇总（key 只存本机，不进仓库）
#   bash tools/stats.sh            # 最近 14 天
#   bash tools/stats.sh today      # 只看今天一行
set -e
cd "$(dirname "$0")/.."

KEY_FILE="$HOME/.workbuddy/uchx_stats_key"
[ -f "$KEY_FILE" ] || { echo "!! 缺 $KEY_FILE（STATS_KEY 存在这里）"; exit 1; }
KEY=$(cat "$KEY_FILE")
BASE="https://unchaxun.pages.dev/api/stats"

fetch() {
  curl -s --retry 3 --retry-delay 2 -m 150 "$BASE?action=summary&key=$KEY" -o _stats.json
  head -c 1 _stats.json | grep -q '{' || {
    echo "拿不到统计数据（网络或接口异常），原始返回："
    head -c 200 _stats.json
    echo
    rm -f _stats.json
    exit 1
  }
}

if [ "$1" = "today" ]; then
  fetch
  python -c "
import json
d = json.load(open('_stats.json', encoding='utf-8'))
t = d['today']
print('%s  打开 %d 次 / %d 台设备' % (t['date'], t['opens'], t['devices']))
"
  rm -f _stats.json
  exit 0
fi

fetch
python -c "
import json
d = json.load(open('_stats.json', encoding='utf-8'))
t = d['today']
print('今天 %s：打开 %d 次，活跃设备 %d 台' % (t['date'], t['opens'], t['devices']))
print('近 7 天打开合计 %d 次 ｜ 累计出现过的设备 %d 台' % (d['last7daysOpens'], d['devicesTotal']))
print('')
print('版本分布：')
for k in sorted(d.get('versions') or {}):
    print('  %-8s %d 次' % (k, d['versions'][k]))
print('')
print('各版本下载：')
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
