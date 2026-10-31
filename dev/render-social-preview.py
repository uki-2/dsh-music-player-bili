"""Render the GitHub social preview (1280x640) for dsh-music-player.

Mirrors the plugin artwork: dark glass background, a vinyl record whose white
label carries the same ribbon-bow mark the widget draws (see client.js).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 640
OUT = Path(
    r"C:\Users\ASUS\Documents\deepseek-harness\default-workspace\music-player\dsh-plugin\.github\social-preview.png"
)

FONT_DIR = Path(r"C:\Windows\Fonts")
BG_TOP = (10, 12, 17)
BG_BOTTOM = (23, 28, 38)


def font(*names: str, size: int) -> ImageFont.FreeTypeFont:
    for name in (*names, "msyh.ttc", "segoeui.ttf", "arial.ttf"):
        path = FONT_DIR / name
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    return ImageFont.load_default()


def cubic(p0, p1, p2, p3, steps: int = 20):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return out


def background() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_TOP)
    px = img.load()
    for y in range(H):
        v = y / (H - 1)
        for x in range(W):
            k = v * 0.8 + (1 - x / W) * 0.2
            px[x, y] = (
                int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * k),
                int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * k),
                int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * k),
            )
    return img


def radial_glow(size: int, color, alpha: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    steps = 60
    for i in range(steps, 0, -1):
        r = size / 2 * i / steps
        d.ellipse(
            (size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r),
            fill=int(alpha * (1 - i / steps) ** 2),
        )
    glow = Image.new("RGBA", (size, size), color + (255,))
    glow.putalpha(mask)
    return glow.filter(ImageFilter.GaussianBlur(18))


def draw_record(img: Image.Image, cx: int = 330, cy: int = 320, r: int = 196) -> None:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    for i in range(r, 0, -1):
        t = i / r
        shade = int(24 * (1 - t) + 7 * t)
        d.ellipse((cx - i, cy - i, cx + i, cy + i), fill=(shade, shade + 2, shade + 7, 255))

    for radius in range(56, r - 8, 9):
        d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=(255, 255, 255, 14), width=1)

    d.ellipse((cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1), outline=(255, 255, 255, 56), width=2)

    label_r = 92
    d.ellipse((cx - label_r, cy - label_r, cx + label_r, cy + label_r), fill=(255, 255, 255, 255))

    # ribbon bow, same geometry as client.js: a 50-unit art box covering
    # 23/34 of the white label, exactly like the SVG group transform.
    span = (2 * label_r) * 23.0 / 34.0
    s = span / 50.0
    ox, oy = cx - 25 * s, cy - 25 * s

    def xy(p):
        return (ox + p[0] * s, oy + p[1] * s)

    left = [(25, 25)]
    left += cubic((25, 25), (21, 19), (15, 12.8), (9, 13.4))
    left += cubic((9, 13.4), (6.4, 13.8), (5.4, 36.2), (9, 36.6))
    left += cubic((9, 36.6), (15, 37.2), (21, 31), (25, 25))
    right = [(50 - x, y) for x, y in left]

    ink = (11, 12, 16, 255)
    d.polygon([xy(p) for p in left], fill=ink)
    d.polygon([xy(p) for p in right], fill=ink)
    k0 = xy((22.6, 19.6))
    k1 = xy((27.4, 30.4))
    d.rounded_rectangle((k0[0], k0[1], k1[0], k1[1]), radius=max(2, int(2.4 * s)), fill=ink)

    img.paste(layer, (0, 0), layer)


def main() -> None:
    img = background().convert("RGBA")
    glow = radial_glow(820, (80, 104, 190), 130)
    img.paste(glow, (330 - 410, 320 - 410), glow)

    draw_record(img)

    d = ImageDraw.Draw(img)
    title_font = font("msyhbd.ttc", size=62)
    sub_font = font("msyh.ttc", size=28)
    bullet_font = font("msyh.ttc", size=23)
    tag_font = font("segoeui.ttf", size=20)

    x = 620
    d.text((x, 190), "dsh-music-player", font=title_font, fill=(253, 250, 242))
    d.text((x, 268), "黑胶音乐播放器 · DSH 悬浮播放器插件", font=sub_font, fill=(166, 174, 189))

    y = 332
    for line in (
        "B 站公开收藏夹歌单 · 搜索即播",
        "毛玻璃 UI · 可拖动 · 进度可精确拖动",
        "单曲循环 / 随机播放 · 设置随插件持久化",
    ):
        d.ellipse((x + 2, y + 9, x + 10, y + 17), fill=(122, 150, 255))
        d.text((x + 24, y), line, font=bullet_font, fill=(214, 220, 232))
        y += 42

    pill = "MIT License"
    tw = d.textlength(pill, font=tag_font)
    d.rounded_rectangle(
        (x, y + 16, x + tw + 36, y + 56), radius=20, fill=(255, 255, 255, 16), outline=(255, 255, 255, 60)
    )
    d.text((x + 18, y + 24), pill, font=tag_font, fill=(196, 203, 216))

    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
