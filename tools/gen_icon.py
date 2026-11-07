# -*- coding: utf-8 -*-
"""Unicode 编码查询 · 应用图标生成器（v0.2.31 起）

概念：Unicode 不是「汉字」，它是给世界上每个字符一个唯一编号（码位）的规则，
是文字进入数字世界的地基。所以图标用一个 4x4 的码位格栅，只点亮其中一格 ——
一个字符，一个地址。没有书法、没有印章、没有文字，缩到 16px 也认得出。

正面：深墨蓝底 + 蓝色高亮格 + 定位框（像内存阵列 / 芯片选址）
翻面：反色底 + 码位读数 U+5B57（「字」的码位，延续旧图标红印章的梗）
      点一下图标从「格子」翻到「编号」，彩蛋逻辑不变。

产出（都从这一份图渲染，保证全平台一致）：
  index.html          三处 data:image/png;base64（favicon 64 / 正面 128 / 翻面 128）
  desktop/icon.ico    16/32/48/64/128/256
  android/res/mipmap-*/ic_launcher.png   48/72/96/144/192
  browser-screenshots/icon-preview.png   各尺寸预览（已 gitignore，仅自查用）

用法：python tools/gen_icon.py
换配色只改下面 6 个常量，重跑一遍即可。
"""
import base64
import io
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"

# ── 配色（Material You 式同色系色调化，深浅两套） ───────────────────────
BG_DARK = "#101B2B"      # 正面底：深墨蓝
CELL_DIM = "#2C4663"     # 未分配 / 其他码位
HL = "#62B4FF"           # 被点亮的那一个码位
BG_LIGHT = "#E9F2FB"     # 翻面底
CELL_LIGHT = "#B7CCE2"   # 翻面的暗格
INK = "#185FA5"          # 翻面的高亮格与码位读数

UNIT = 96.0              # 设计画布（逻辑单位）
SS = 8                   # 超采样倍数，抗锯齿用
S = int(UNIT * SS)
HL_CELL = (56, 40)       # 高亮格位置（正面）
GRID = (24, 40, 56, 72)  # 4x4 格心


def u(v):
    return int(round(v * SS))


def box(d, xy, radius, fill, outline=None, width=0):
    d.rounded_rectangle(
        [u(xy[0]), u(xy[1]), u(xy[2]), u(xy[3])],
        radius=u(radius), fill=fill, outline=outline,
        width=u(width) if width else 1,
    )


def grid(d, centers, normal, hl, hl_pos, frame):
    for cy in centers:
        for cx in GRID:
            if (cx, cy) == hl_pos:
                continue
            box(d, (cx - 4.5, cy - 4.5, cx + 4.5, cy + 4.5), 2, normal)
    hx, hy = hl_pos
    # 定位框：像坐标选中框，也保证小尺寸下高亮格不糊成一团
    box(d, (hx - 10.5, hy - 10.5, hx + 10.5, hy + 10.5), 5,
        None, outline=frame, width=1.2)
    box(d, (hx - 5.5, hy - 5.5, hx + 5.5, hy + 5.5), 2.5, hl)


def render_front(size):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    box(d, (0, 0, UNIT, UNIT), 22, BG_DARK)
    grid(d, GRID, CELL_DIM, HL, HL_CELL, "#3E79B8")
    return im.resize((size, size), Image.LANCZOS)


def mono_font(px_size):
    for p in (r"C:\Windows\Fonts\consolab.ttf",
              r"C:\Windows\Fonts\consola.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, px_size)
    return ImageFont.load_default()


def render_back(size):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    box(d, (0, 0, UNIT, UNIT), 22, BG_LIGHT)
    # 网格上移，给底部码位读数留位置
    shifted = tuple(v - 4 for v in GRID)
    hl_pos = (HL_CELL[0], HL_CELL[1] - 4)
    grid(d, shifted, CELL_LIGHT, INK, hl_pos, "#8FB4D8")

    label = "U+5B57"
    font = mono_font(u(13))
    bb = d.textbbox((0, 0), label, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((S - tw) / 2 - bb[0], u(78) - bb[1]), label, font=font, fill=INK)
    return im.resize((size, size), Image.LANCZOS)


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def b64(im):
    return base64.b64encode(png_bytes(im)).decode("ascii")


def patch_html(fav, front, back):
    # 必须走二进制：Windows 上 write_text 会把整个文件的 LF 改成 CRLF，
    # 造成全文件 diff、还会打断按 \n 抽代码的回归测试。
    s = HTML.read_bytes().decode("utf-8")
    pat = r"data:image/png;base64,([A-Za-z0-9+/=]+)"
    ms = list(re.finditer(pat, s))
    if len(ms) != 3:
        sys.exit("!! index.html 内嵌 PNG 数量不是 3，停止（避免改错地方）")
    vals = (fav, front, back)
    for i in (2, 1, 0):        # 从后往前改，偏移不串位
        m = ms[i]
        s = s[:m.start(1)] + vals[i] + s[m.end(1):]
    HTML.write_bytes(s.encode("utf-8"))
    print("  index.html  三处内嵌图标已替换（favicon / 正面 / 翻面）")


def main():
    print("生成正面 / 翻面图标 …")
    fav = b64(render_front(64))
    front = b64(render_front(128))
    back = b64(render_back(128))
    patch_html(fav, front, back)

    ico = render_front(256)
    ico.save(ROOT / "desktop" / "icon.ico", format="ICO",
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("  desktop/icon.ico  16~256 六档已写入")

    for dpi, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                      ("xxhdpi", 144), ("xxxhdpi", 192)):
        p = ROOT / "android" / "res" / ("mipmap-" + dpi) / "ic_launcher.png"
        render_front(size).save(p, format="PNG", optimize=True)
        print("  %-9s %3d×%3d  %s" % (dpi, size, size, p.name))

    # 自查预览：不同尺寸 + 翻面，确认 16px 下还认得出
    prev = Image.new("RGB", (660, 210), "#F1EFE8")
    dr = ImageDraw.Draw(prev)
    label_font = ImageFont.load_default()
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            label_font = ImageFont.truetype(p, 14)
            break
    x = 24
    for size in (16, 32, 48, 96):
        im = render_front(size)
        prev.paste(im, (x + (96 - size) // 2, 40 + (96 - size) // 2), im)
        dr.text((x, 150), "%dpx" % size, font=label_font, fill="#5F5E5A")
        x += 120
    im = render_back(96)
    prev.paste(im, (x, 40), im)
    dr.text((x, 150), "翻面", font=label_font, fill="#5F5E5A")
    out = ROOT / "browser-screenshots" / "icon-preview.png"
    out.parent.mkdir(exist_ok=True)
    prev.save(out)
    print("  预览：" + str(out))


if __name__ == "__main__":
    main()
