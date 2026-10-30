# -*- coding: utf-8 -*-
"""
桌面版打包：把 index.html 塞进一个 exe

用法（在项目根目录）：
    python desktop/pack.py            打单文件 exe（默认，方便拷来拷去）
    python desktop/pack.py --onedir   打目录版（启动快十秒左右，但要整个文件夹）
    python desktop/pack.py --clean    先删旧的 dist / 构建缓存再打

产物：dist/Unicode编码查询.exe  或  dist/Unicode编码查询/Unicode编码查询.exe

做的事：把根目录最新的 index.html 复制到 desktop/ → 调 PyInstaller
→ 把生成的 UnicodeChaxun.exe 改名成中文名 → 报告体积。
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESKTOP = os.path.join(ROOT, "desktop")
ONEDIR = "--onedir" in sys.argv
DIST = os.path.join(ROOT, "dist_dir" if ONEDIR else "dist")
BUILD = os.path.join(os.environ.get("TEMP", "/tmp"), "pybuild_uchx_dir" if ONEDIR else "pybuild_uchx")
EXE_ASCII = "UnicodeChaxun.exe"
EXE_FINAL = "Unicode编码查询.exe"
# exe 超过 30MB 说明把没用的东西打进去了，值得看一眼
SIZE_WARN_MB = 30


def run(cmd, **kw):
    print("+", " ".join(cmd))
    r = subprocess.run(cmd, **kw)
    if r.returncode != 0:
        raise SystemExit("命令失败，退出码 %d" % r.returncode)


def main():
    clean = "--clean" in sys.argv

    src = os.path.join(ROOT, "index.html")
    if not os.path.isfile(src):
        raise SystemExit("找不到 %s" % src)
    shutil.copy2(src, os.path.join(DESKTOP, "index.html"))
    print("已同步 index.html → desktop/（%d 字节）" % os.path.getsize(src))

    if clean:
        for p in (DIST, BUILD):
            shutil.rmtree(p, ignore_errors=True)
        print("已清理旧的产物与构建缓存")

    mode = "--onedir" if ONEDIR else "--onefile"
    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", mode, "--noconsole",
        "--name", "UnicodeChaxun",
        # 注意：这里必须写绝对路径。--add-data 的相对路径是按 .spec 所在目录算的，
        # 不是按当前工作目录，写 "index.html;." 会让 PyInstaller 找不到文件
        "--add-data", os.path.join(DESKTOP, "index.html") + os.pathsep + ".",
        # v0.2.2：内置离线数据包，本地服务直接按 /unicode_data/xxx.txt 提供
        "--add-data", os.path.join(ROOT, "unicode_data", "UnicodeData.txt") + os.pathsep + "unicode_data",
        "--add-data", os.path.join(ROOT, "unicode_data", "Blocks.txt") + os.pathsep + "unicode_data",
        "--add-data", os.path.join(ROOT, "unicode_data", "Scripts.txt") + os.pathsep + "unicode_data",
        "--add-data", os.path.join(ROOT, "unicode_data", "LineBreak.txt") + os.pathsep + "unicode_data",
        # v0.2.5：扩展区字体包（Jigmo，扩展 B–I 100% 覆盖），本地服务按 /fonts/xxx 提供
        "--add-data", os.path.join(ROOT, "fonts", "Jigmo2.woff2") + os.pathsep + "fonts",
        "--add-data", os.path.join(ROOT, "fonts", "Jigmo3.woff2") + os.pathsep + "fonts",
        "--distpath", DIST,
        "--workpath", os.path.join(BUILD, "work"),
        "--specpath", BUILD,
        os.path.join(DESKTOP, "app.py"),
    ]
    if ONEDIR:
        # PyInstaller 重建目录版时会删旧目录，本机的安全删除超过 50 个文件就会拦下来，
        # 所以先自己把旧目录挪到临时区
        old = os.path.join(DIST, "UnicodeChaxun")
        if os.path.isdir(old):
            shutil.rmtree(old, ignore_errors=True)
    run(args, cwd=ROOT)

    if ONEDIR:
        built = os.path.join(DIST, "UnicodeChaxun", EXE_ASCII)
        target_dir = os.path.join(DIST, "UnicodeChaxun")
    else:
        built = os.path.join(DIST, EXE_ASCII)
        target_dir = DIST
    if not os.path.isfile(built):
        raise SystemExit("PyInstaller 没产出 %s" % built)

    final = os.path.join(target_dir, EXE_FINAL)
    # 用 replace 而不是先删再改名：本机删文件会走"移到回收站"的钩子，
    # 大文件删除失败会让整个打包报错，replace 是原子覆盖，绕开这一步
    os.replace(built, final)

    total = os.path.getsize(final)
    if ONEDIR:
        for base, _dirs, files in os.walk(target_dir):
            for f in files:
                total += os.path.getsize(os.path.join(base, f))
    mb = total / 1024 / 1024
    print("\n=== 完成 ===")
    print("产物：%s" % final)
    print("体积：%.1f MB%s" % (mb, "（整个文件夹）" if ONEDIR else ""))
    if mb > SIZE_WARN_MB:
        print("提示：超过 %d MB，检查下 --add-data 是不是多带了东西" % SIZE_WARN_MB)


if __name__ == "__main__":
    main()
