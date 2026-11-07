#!/usr/bin/env bash
# Unicode Chaxun - Android build (no Gradle)
# aapt2 compile -> aapt2 link -> javac -> d8 -> zipalign -> apksigner
# usage: bash build.sh
#
# 注意：版本号直接从根目录 index.html 的 APP_VERSION 里读，别在两个地方各写一份。
set -e

cd "$(cd "$(dirname "$0")" && pwd)"

# v0.2.5：扩展区字体包文件名（build.sh 和 index.html 的 EXT_FONT_FILE 保持一致）
# 实际定义在下面 fonts 同步段里（BabelStoneHan.woff2）

SDK="${ANDROID_SDK:-E:/AndroidSDK}"
BT="$SDK/build-tools/34.0.0"
P19="$SDK/platforms/android-19/android.jar"
P34="$SDK/platforms/android-34/android.jar"
JAVA_DIR="${JAVA_HOME:-C:/Java/jdk-26.0.2+10}"
JAVAC="$JAVA_DIR/bin/javac"
KEYTOOL="$JAVA_DIR/bin/keytool"
JAVA="$JAVA_DIR/bin/java"
# build-tools 34.0.0 自带的 R8 8.2.2 会内部 NPE，用 cmdline-tools 里的新版
if [ -f "$SDK/cmdline-tools/latest/lib/r8.jar" ]; then
  D8JAR="$SDK/cmdline-tools/latest/lib/r8.jar"
else
  D8JAR="$BT/lib/d8.jar"
fi
PY="C:/Users/LCJ/.workbuddy/binaries/python/versions/3.13.12/python.exe"

# HTML 里的版本没同步好的话，宁可构建失败也别打出一版号混乱的包
INDEX="../index.html"
if [ ! -f "$INDEX" ]; then echo "!! 找不到 $INDEX，请在项目根目录的仓库里跑"; exit 1; fi
VER=$(grep -o "const APP_VERSION = '[^']*'" "$INDEX" | head -1 | sed "s/.*'\(.*\)'.*/\1/")
if [ -z "$VER" ]; then echo "!! 没从 index.html 读到 APP_VERSION"; exit 1; fi
HTML_BYTES=$(wc -c < "$INDEX")

NAME="UnicodeChaxun"
OUT="build"
KS="keystore/unicode.jks"
KSPASS="unicode2026"
ALIAS="unicode"
MIN_API=21

echo "==> 版本 $VER（index.html $HTML_BYTES 字节）"

# 比内容而不是只比字节数：改文案、换等长版本号（0.2.26 -> 0.2.27）时字节数可能一模一样，
# 只比 wc -c 会静默沿用旧页面——构建照绿、版本号照升，包里却是上一版的 HTML
if [ ! -f assets/index.html ] || ! cmp -s "$INDEX" assets/index.html; then
  echo "==> 同步 index.html -> assets/"
  cp "$INDEX" assets/index.html
fi

# v0.2.2：把 4 个 UCD 数据文件打进 assets，首次打开不用联网就有完整数据
echo "==> 同步 unicode_data -> assets/unicode_data/"
mkdir -p assets/unicode_data
for f in UnicodeData.txt Blocks.txt Scripts.txt LineBreak.txt; do
  if [ ! -f "../unicode_data/$f" ]; then echo "!! 找不到 ../unicode_data/$f"; exit 1; fi
  cp "../unicode_data/$f" "assets/unicode_data/$f"
done
# v0.2.18：汉字字典（拼音/笔画/部首/释义，1.71MB brotli）从 HTML 里搬出来，按需加载
if [ ! -f "../unicode_data/worddict.br" ]; then echo "!! 找不到 ../unicode_data/worddict.br"; exit 1; fi
cp "../unicode_data/worddict.br" "assets/unicode_data/worddict.br"
ls -la assets/unicode_data/

# v0.2.5：扩展区字体包（Jigmo，覆盖 CJK 扩展 B–J）打进 assets，离线可装
# v0.2.17：BabelStone Han（CJK 基本区+扩展A）也一起打进 assets，字体对比的第二参照系
# v0.2.18：LITE=1 出精简版——不带任何字库包（约 26MB → 2MB 左右），字库需要时联网下载
if [ -n "$LITE" ]; then
  echo "==> LITE 精简版：跳过字库包（Jigmo / BabelStone Han 需联网安装）"
  rm -rf assets/fonts
else
  echo "==> 同步 fonts -> assets/fonts/"
  mkdir -p assets/fonts
  for FONT in Jigmo2.woff2 Jigmo3.woff2 BabelStoneHan.woff2; do
    if [ ! -f "../fonts/$FONT" ]; then
      echo "!! 找不到扩展区字体包（../fonts/$FONT），见 README「字体包」一节"
      exit 1
    fi
    cp "../fonts/$FONT" "assets/fonts/$FONT"
  done
  ls -la assets/fonts/
fi

echo "==> 0/7 clean"
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

echo "==> 1/7 aapt2 compile (res)"
"$BT/aapt2.exe" compile --dir res -o "$OUT/res.zip"

echo "==> 2/7 aapt2 link (含 assets)"
"$BT/aapt2.exe" link \
  -o "$OUT/base.apk" \
  -I "$P34" \
  --manifest AndroidManifest.xml \
  -R "$OUT/res.zip" \
  -A assets \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_API" \
  --target-sdk-version 34 \
  --version-code "$(echo "$VER" | awk -F. '{printf "%d", $1*10000 + $2*100 + $3}')" \
  --version-name "$VER" \
  --auto-add-overlay

echo "==> 3/7 javac (对 android-19 编译，逼出用了高版本 API 的问题)"
find src -name '*.java' > "$OUT/sources.txt"
"$JAVAC" --release 8 -encoding UTF-8 -Xlint:-options \
  -classpath "$P19" -d "$OUT/classes" "@$OUT/sources.txt"

echo "==> 4/7 d8 (min-api $MIN_API)"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$JAVA" -cp "$D8JAR" com.android.tools.r8.D8 \
  --min-api "$MIN_API" --lib "$P34" --output "$OUT/dex" "@$OUT/classes.txt"

echo "==> 5/7 把 classes.dex 塞进 apk"
"$PY" - "$OUT/base.apk" "$OUT/dex/classes.dex" <<'PY'
import sys, zipfile, shutil, os
apk, dex = sys.argv[1], sys.argv[2]
tmp = apk + ".tmp"
shutil.copyfile(apk, tmp)
with zipfile.ZipFile(tmp, "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex, "classes.dex")
os.replace(tmp, apk)
print("    classes.dex =", os.path.getsize(dex), "bytes")
PY

echo "==> 6/7 zipalign"
"$BT/zipalign.exe" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "==> 7/7 apksigner"
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  "$KEYTOOL" -genkeypair -v -keystore "$KS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 -storetype PKCS12 \
    -storepass "$KSPASS" -keypass "$KSPASS" \
    -dname "CN=Unicode Chaxun,O=LCJ,C=CN" >/dev/null 2>&1
  echo "    已生成签名文件: $KS"
fi
FINAL="$NAME-v$VER.apk"
[ -n "$LITE" ] && FINAL="$NAME-v$VER-lite.apk"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KS" --ks-pass "pass:$KSPASS" --key-pass "pass:$KSPASS" \
  --min-sdk-version "$MIN_API" --v1-signing-enabled true --v2-signing-enabled true \
  --out "$FINAL" "$OUT/aligned.apk"

echo "==> 验证"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --min-sdk-version "$MIN_API" --print-certs "$FINAL" | head -6
"$BT/aapt2.exe" dump badging "$FINAL" | head -5
ls -lh "$FINAL"
echo "==> DONE: $FINAL"
