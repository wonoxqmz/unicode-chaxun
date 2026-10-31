#!/usr/bin/env bash
# Cloudflare Pages 直传部署（GitHub 源被封后的正式发布方式）
#
# 用法：bash tools/deploy_pages.sh
# 依赖：~/.workbuddy/cf_token（Cloudflare API Token，权限 Account→Cloudflare Pages→Edit）
# 说明：functions/ 目录会被 wrangler 打包成 Worker 一起上传，KV 绑定 SYNC 在项目设置里，不受影响。
set -e
cd "$(dirname "$0")/.."

TOKEN_FILE="$HOME/.workbuddy/cf_token"
ACCOUNT="e9df23d8fba7db9d88b1d3ee1d0b5d95"
PROJECT="unchaxun"

[ -f "$TOKEN_FILE" ] || { echo "!! 缺少 $TOKEN_FILE（Cloudflare API Token）"; exit 1; }
VER=$(grep -o "const APP_VERSION = '[^']*'" index.html | head -1 | sed "s/.*'\(.*\)'.*/\1/")
[ -n "$VER" ] || { echo "!! 读不到 APP_VERSION"; exit 1; }
echo "==> 部署 v$VER"

# 组装干净的上传目录：只放网站需要的东西（不要把 promo-video / dist 那堆带上去）
rm -rf _deploy
mkdir -p _deploy/download
cp index.html _headers version.json _deploy/
cp -r fonts unicode_data _deploy/
# v0.2.17：BabelStoneHan.woff2 重新上架（字体对比功能要用，按需下载不影响首屏）

# APK 顺带挂一份到 /download/，当 Gitee 之外的备用下载源
# 网络差时可 SKIP_APK=1 跳过；v0.2.17 起 APK 带 BabelStone 超过 Pages 25MiB 上限，超限自动跳过镜像
APK="dist/Unicode编码查询-v${VER}.apk"
if [ -f "$APK" ] && [ -z "$SKIP_APK" ]; then
  APK_SIZE=$(stat -c%s "$APK")
  if [ "$APK_SIZE" -le $((25*1024*1024)) ]; then
    cp "$APK" "_deploy/download/unicode-chaxun-v${VER}.apk"
    echo "==> 附带 APK：unicode-chaxun-v${VER}.apk"
  else
    echo "==> APK $(($APK_SIZE/1024/1024))MiB 超过 Pages 25MiB 上限，跳过镜像（下载走 Gitee 直链）"
  fi
fi

du -sh _deploy
CLOUDFLARE_API_TOKEN=$(cat "$TOKEN_FILE") CLOUDFLARE_ACCOUNT_ID="$ACCOUNT" \
  npx -y wrangler@4 pages deploy _deploy --project-name "$PROJECT" --branch main \
  --commit-dirty=true --commit-message "v$VER"

echo "==> 完成。验证："
echo "    https://unchaxun.pages.dev/version.json"
echo "    https://unchaxun.pages.dev/api/sync?action=health"
