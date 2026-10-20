"""「拾光书栈」场景包的背景生成脚本(原创示意背景 v1)。

这三张 1280×720 WebP 是程序化生成的原创抽象/极简背景(渐变 + 剪影 + 几何构图),
不是美术成品,任何时候都可以被正式美术替换。运行本脚本会重建 scenes/ 下同名文件:

    python make_scenes.py

不依赖 numpy / ffmpeg,只用 Pillow。生成方式与授权说明见同目录 CREDITS.txt。
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent / "scenes"
W, H = 1280, 720


def _lerp(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def _vgrad(stops: list[tuple[float, tuple]]) -> Image.Image:
    """纵向渐变:stops 是 [(0..1 位置, RGB)]。返回 1×H 再拉伸到画布。"""
    img = Image.new("RGB", (1, H))
    d = ImageDraw.Draw(img)
    stops = sorted(stops)
    for y in range(H):
        t = y / (H - 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                color = _lerp(c0, c1, (t - p0) / (p1 - p0))
                break
        else:
            color = stops[-1][1] if t > stops[-1][0] else stops[0][1]
        d.line([(0, y), (0, y)], fill=color)
    return img.resize((W, H))


def _glow(base: Image.Image, center: tuple, radius: int, color: tuple, blur: float | None = None) -> None:
    """在 base 上叠加一个柔光斑(画实心圆再高斯模糊),就地改。"""
    layer = Image.new("RGB", base.size, (0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = center
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(blur if blur is not None else radius / 2))
    base.paste(ImageChops.add(base, layer), (0, 0))


def _silhouette(d: ImageDraw.ImageDraw, points: list, color: tuple) -> None:
    d.polygon(points, fill=color)


# ── 1. 书店门口(夜) ──────────────────────────────────────────────────
def bookshop_street() -> Image.Image:
    img = _vgrad([(0.0, (10, 15, 36)), (0.55, (22, 24, 58)), (0.78, (42, 38, 82)), (1.0, (58, 50, 96))])
    d = ImageDraw.Draw(img)
    # 月亮与星点
    d.ellipse([1020, 90, 1060, 130], fill=(226, 232, 245))
    for sx, sy in [(120, 120), (300, 70), (700, 180), (880, 60), (1150, 210)]:
        d.ellipse([sx, sy, sx + 3, sy + 3], fill=(200, 208, 230))
    # 远处楼房剪影
    sky = (16, 18, 40)
    d.rectangle([0, 430, 1280, 500], fill=sky)
    for rx, rw in [(0, 260), (280, 340), (640, 300), (960, 320)]:
        d.rectangle([rx, 380, rx + rw, 440], fill=sky)
        d.rectangle([rx + 30, 400, rx + 60, 415], fill=(24, 26, 52))  # 亮着的窗
    # 街道
    d.rectangle([0, 500, 1280, 720], fill=(13, 14, 30))
    for gy in range(520, 700, 46):
        for gx in range(0, 1280, 90):
            d.ellipse([gx + 10, gy + 8, gx + 34, gy + 30], fill=(20, 21, 42))
    # 路灯
    d.rectangle([330, 300, 334, 505], fill=(20, 20, 36))
    d.ellipse([316, 282, 350, 316], fill=(150, 150, 168))
    _glow(img, (333, 300), 130, (255, 214, 140), blur=60)
    # 书店:雨棚 + 门面 + 亮着的橱窗
    d.rectangle([620, 470, 1040, 505], fill=(30, 34, 66))
    d.rectangle([620, 505, 1040, 720], fill=(26, 29, 58))
    d.rectangle([680, 540, 980, 690], fill=(255, 190, 110))  # 橱窗暖光
    _glow(img, (830, 600), 200, (255, 196, 120), blur=90)
    for sx2 in range(700, 980, 56):  # 窗棂
        d.rectangle([sx2, 540, sx2 + 4, 690], fill=(40, 44, 84))
    d.rectangle([980, 540, 988, 690], fill=(40, 44, 84))
    # 门
    d.rectangle([600, 600, 660, 720], fill=(18, 20, 40))
    d.rectangle([620, 640, 644, 664], fill=(255, 214, 140))
    # 招牌板
    d.rectangle([790, 440, 872, 468], fill=(46, 50, 96))
    d.rectangle([800, 450, 862, 458], fill=(214, 170, 96))
    return img


# ── 2. 书店内景(暖黄夜灯) ────────────────────────────────────────────
def bookshop_interior() -> Image.Image:
    img = _vgrad([(0.0, (72, 42, 20)), (0.5, (54, 31, 16)), (1.0, (34, 19, 11))])
    d = ImageDraw.Draw(img)
    # 地板
    d.rectangle([0, 640, 1280, 720], fill=(30, 17, 10))
    for gx in range(0, 1280, 160):
        d.rectangle([gx, 640, gx + 4, 720], fill=(38, 22, 13))
    # 中央大窗(月光)
    d.rectangle([430, 120, 850, 640], fill=(52, 62, 92))
    d.rectangle([470, 160, 810, 600], fill=(140, 158, 190))
    for gx in range(490, 810, 64):
        d.rectangle([gx, 160, gx + 6, 600], fill=(60, 72, 106))
    for gy in range(200, 600, 64):
        d.rectangle([470, gy, 810, gy + 6], fill=(60, 72, 106))
    d.rectangle([424, 114, 432, 646], fill=(24, 26, 44))
    d.rectangle([848, 114, 856, 646], fill=(24, 26, 44))
    # 左右书架
    shelf = (24, 14, 8)
    for left in (True, False):
        x0 = 0 if left else 856
        d.rectangle([x0, 90, x0 + 380 if left else 1280, 648], fill=shelf)
        for sy in range(180, 640, 60):
            d.rectangle([x0 if left else 900, sy, x0 + 372 if left else 1272, sy + 6], fill=(44, 26, 15))
            # 书脊色块
            for bx in range((x0 + 14 if left else 912), (x0 + 366 if left else 1266), 26):
                d.rectangle([bx, sy + 8, bx + 14, sy + 56], fill=((150, 60, 40), (60, 90, 120), (120, 110, 60))[bx % 3])
    # 吊灯
    d.rectangle([610, 0, 616, 60], fill=(20, 16, 12))
    d.ellipse([556, 46, 674, 96], fill=(70, 48, 26))
    _glow(img, (615, 100), 240, (255, 200, 120), blur=110)
    # 柜台剪影(前景)
    d.rectangle([80, 560, 420, 648], fill=(16, 10, 7))
    d.rectangle([150, 520, 350, 560], fill=(16, 10, 7))
    d.rectangle([170, 540, 185, 552], fill=(230, 200, 150))  # 桌上摊开的书
    return img


# ── 3. 天台黄昏 ──────────────────────────────────────────────────────
def rooftop_dusk() -> Image.Image:
    img = _vgrad([(0.0, (56, 42, 94)), (0.45, (128, 86, 106)), (0.72, (206, 132, 100)), (1.0, (240, 166, 112))])
    d = ImageDraw.Draw(img)
    # 星点(高处)
    for sx, sy in [(90, 60), (260, 120), (420, 40), (1100, 90), (700, 150)]:
        d.ellipse([sx, sy, sx + 3, sy + 3], fill=(230, 226, 240))
    # 落日与云
    _glow(img, (900, 470), 150, (255, 214, 150), blur=70)
    d.ellipse([870, 430, 930, 490], fill=(255, 224, 172))
    d.ellipse([300, 360, 560, 390], fill=(150, 108, 120))
    d.ellipse([660, 330, 820, 356], fill=(140, 100, 116))
    # 城市剪影
    city = (42, 32, 64)
    d.rectangle([0, 500, 1280, 560], fill=city)
    for bx, bw, bh in [(40, 90, 120), (170, 60, 200), (260, 110, 150), (420, 70, 110), (520, 90, 230),
                       (700, 110, 130), (1000, 80, 170), (1130, 120, 100)]:
        d.rectangle([bx, 560 - bh, bx + bw, 560], fill=city)
    for wx, wy in [(90, 500), (300, 470), (760, 490)]:  # 亮窗
        d.rectangle([wx, wy, wx + 8, wy + 12], fill=(255, 214, 150))
    # 天台:女儿墙 + 栏杆
    d.rectangle([0, 560, 1280, 720], fill=(26, 20, 40))
    d.rectangle([0, 560, 1280, 590], fill=(34, 26, 50))
    for px in range(20, 1280, 60):
        d.rectangle([px, 590, px + 6, 700], fill=(30, 23, 46))
        d.rectangle([px, 612, px + 60, 616], fill=(30, 23, 46))
        d.rectangle([px, 662, px + 60, 666], fill=(30, 23, 46))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, maker in [
        ("bookshop_street.webp", bookshop_street),
        ("bookshop_interior.webp", bookshop_interior),
        ("rooftop_dusk.webp", rooftop_dusk),
    ]:
        img = maker()
        img.save(OUT / name, "WEBP", quality=82, method=6)
        print(f"{name}: {img.size}, {(OUT / name).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
