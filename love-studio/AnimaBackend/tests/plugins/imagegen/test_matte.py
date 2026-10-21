"""立绘抠图（matte.py）：白底全身体照 → 透明底 PNG。

为什么有这一层：这台网关的 /images/generations 不支持 background=transparent，
透明底只能靠提示词画成纯白底再本地抠。抠不下来必须明确返回 None，让调用方保留原图并
报警告 —— 不能悄悄交出一张边缘发虚的半成品。
"""

import io

from PIL import Image, ImageDraw

from app.plugins.imagegen.matte import cut_out_portrait


def _png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _figure(color=(180, 90, 140), size=(64, 96)) -> Image.Image:
    im = Image.new("RGB", size, (255, 255, 255))
    ImageDraw.Draw(im).rectangle([20, 10, 43, size[1] - 11], fill=color)
    return im


def test_white_background_becomes_transparent():
    cut = cut_out_portrait(_png(_figure()))
    assert cut is not None
    out = Image.open(io.BytesIO(cut.png))
    assert out.mode == "RGBA"
    assert out.getpixel((2, 2))[3] == 0  # 角落是背景
    assert out.getpixel((32, 48))[3] == 255  # 中间是人物
    assert 0.5 < cut.metrics["clear_frac"] < 0.9


def test_busy_background_is_rejected():
    """整幅实景（旧版那种便利店照片）没有可抠的纯色背景，必须返回 None。"""
    im = Image.new("RGB", (64, 96))
    draw = ImageDraw.Draw(im)
    for y in range(96):
        for x in range(64):
            draw.point((x, y), fill=((x * 7) % 256, (y * 11) % 256, (x + y) % 256))
    assert cut_out_portrait(_png(im)) is None


def test_near_white_clothing_is_kept():
    """米白围裙、白衬衫和背景只差一点点，不能被当成背景啃掉。"""
    im = Image.new("RGB", (64, 96), (255, 255, 255))
    ImageDraw.Draw(im).rectangle([20, 10, 43, 85], fill=(240, 240, 240))
    cut = cut_out_portrait(_png(im))
    assert cut is not None
    out = Image.open(io.BytesIO(cut.png))
    assert out.getpixel((32, 48))[3] == 255


def test_enclosed_background_hole_is_removed():
    """两腿之间那种被身体围住的空白和背景同色，也要抠掉。"""
    im = Image.new("RGB", (96, 96), (255, 255, 255))
    draw = ImageDraw.Draw(im)
    draw.ellipse([18, 18, 78, 78], fill=(60, 70, 90))
    draw.ellipse([40, 40, 56, 56], fill=(255, 255, 255))
    cut = cut_out_portrait(_png(im))
    assert cut is not None
    out = Image.open(io.BytesIO(cut.png))
    assert out.getpixel((48, 48))[3] == 0  # 中间的洞是透明的
    assert out.getpixel((24, 48))[3] == 255  # 环形主体还在


def test_too_little_subject_is_rejected():
    """几乎全是白底：说明模型没画人，别硬抠。"""
    im = Image.new("RGB", (64, 96), (255, 255, 255))
    ImageDraw.Draw(im).rectangle([30, 40, 32, 42], fill=(10, 10, 10))
    assert cut_out_portrait(_png(im)) is None


def test_already_transparent_input_passes_through():
    """别家后端认 background=transparent 时，原图直接交回去。"""
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    ImageDraw.Draw(im).rectangle([10, 10, 20, 20], fill=(200, 100, 50, 255))
    cut = cut_out_portrait(_png(im))
    assert cut is not None and cut.metrics["already_transparent"] is True
    assert Image.open(io.BytesIO(cut.png)).mode == "RGBA"
