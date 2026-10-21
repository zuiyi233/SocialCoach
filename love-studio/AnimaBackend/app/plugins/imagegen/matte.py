"""立绘抠图：把生图模型画的「白底全身体照」变成透明底立绘。

为什么要这一步：OpenAI 形状的 /images/generations 在这台网关**不支持**
`background=transparent`（实测 400 `background is not supported by text image queue`），
模型只能画出不透明的整幅照片。直接当立绘摆上去，观众看到的是一个浮在背景上的矩形照片
（2026-10-21 用户反馈）。所以提示词先把它画成纯白无缝背景、人物单独站立，再在这里抠掉白底。

失败时明确返回 None（带原因），调用方保留原图并记一条警告——不静默降级成半成品。
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

# 背景色估计：取边框这一圈的中位色。白底出图实测 253–255
BORDER_BAND = 6
# 判定「属于背景」的通道差上限。衣服如果是纯白（围裙、衬衫），放宽会啃进衣服里
DEFAULT_TOLERANCE = 10
# 背景必须够白；另外边框里要有足够多的像素贴着这个中位色。
# 不能用整体方差：人物肩膀/头发压到画框边上时方差会大，但背景仍然是纯白的
MIN_BG_LUMA = 235
MIN_BORDER_SHARE = 0.5
# 抠图结果的门槛，参照 app/public/love-portraits 那批透明立绘的比例
MIN_CLEAR_FRAC = 0.10
MAX_CLEAR_FRAC = 0.90
MIN_OPAQUE_FRAC = 0.08
# 边缘羽化（像素）；再用已知背景色做反预乘，去掉白边
FEATHER_SIGMA = 0.8
# 「已经是透明底」的判定门槛：按**成片**的透明面积算，不能只看最小值。
# 教训（2026-10-21）：Qwen-Image 2.1 出的是 RGBA，边缘抗锯齿有万分之几的像素 alpha<250，
# 用 `min < 250` 判定会把整张白底当成「已经抠过了」直接放行，白底就这么进了舞台。
MIN_TRANSPARENT_SHARE = 0.05


@dataclass(frozen=True)
class Cutout:
    png: bytes
    metrics: dict[str, float | int | bool]


def _border_pixels(arr: np.ndarray) -> np.ndarray:
    band = min(BORDER_BAND, max(1, min(arr.shape[:2]) // 8))
    rows = [arr[:band].reshape(-1, 3), arr[-band:].reshape(-1, 3)]
    cols = [arr[band:-band, :band].reshape(-1, 3), arr[band:-band, -band:].reshape(-1, 3)]
    return np.concatenate([*rows, *cols], axis=0)


def _background_stats(arr: np.ndarray) -> tuple[np.ndarray, float]:
    """边框的中位色 + 贴着这个颜色的边框像素占比。"""
    border = _border_pixels(arr).astype(np.float32)
    bg = np.median(border, axis=0)
    near = np.abs(border - bg.reshape(1, 3)).max(axis=1) <= DEFAULT_TOLERANCE * 2
    return bg, float(near.mean())


def _background_mask(diff: np.ndarray, tolerance: int) -> np.ndarray:
    """与背景色足够接近、并且和外框连通的区域才算背景（人物身上的白衣服不连通）。

    腿之间那种被身体围起来的空隙跟背景一模一样，但不和外框连通，单独再捡一遍：
    只认「和背景色几乎无差」的封闭块，免得把米白围裙、白袜子啃出洞。
    """
    near = (diff <= tolerance).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(near, connectivity=8)
    if count <= 1:
        return np.zeros(near.shape, dtype=bool)
    border_labels = set(np.unique(np.concatenate([
        labels[0], labels[-1], labels[:, 0], labels[:, -1],
    ])).tolist())
    border_labels.discard(0)
    if not border_labels:
        return np.zeros(near.shape, dtype=bool)
    mask = np.isin(labels, list(border_labels))

    enclosed_limit = max(1.0, tolerance / 2.0)
    max_enclosed_area = 0.25 * diff.size
    for label in range(1, count):
        if label in border_labels or stats[label, cv2.CC_STAT_AREA] > max_enclosed_area:
            continue
        blob = labels == label
        if float(diff[blob].mean()) <= enclosed_limit:
            mask |= blob
    return mask


def _largest_component_share(mask: np.ndarray) -> float:
    """最大连通块占前景的比例。主体被啃掉一块时这个数会掉下来。"""
    count, _labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if count <= 1:
        return 0.0
    areas = stats[1:, cv2.CC_STAT_AREA]
    total = float(areas.sum())
    return float(areas.max()) / total if total else 0.0


def _unpremultiply(rgb: np.ndarray, alpha: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """观测像素 = 前景*alpha + 背景*(1-alpha)，已知背景是纯白，反解前景色，去掉白边。"""
    a = np.clip(alpha, 1e-3, 1.0)[..., None]
    fg = (rgb.astype(np.float32) - bg.reshape(1, 1, 3) * (1.0 - a)) / a
    return np.clip(fg, 0, 255)


def cut_out_portrait(raw: bytes, *, tolerance: int = DEFAULT_TOLERANCE) -> Cutout | None:
    """白底全身体照 → 透明底 PNG。不是白底、或抠完比例不对时返回 None。"""
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception:
        return None
    if im.mode in ("RGBA", "LA"):
        alpha = np.asarray(im.getchannel("A"))
        if float((alpha < 250).mean()) >= MIN_TRANSPARENT_SHARE:
            # 已经是透明底（别家后端认 background=transparent 时），原样交回去。
            # 只看透明面积占比：边缘抗锯齿造成的零星半透明不算。
            out = io.BytesIO()
            im.convert("RGBA").save(out, format="PNG")
            return Cutout(png=out.getvalue(), metrics={"already_transparent": True})

    rgb = np.asarray(im.convert("RGB"))
    bg, border_share = _background_stats(rgb)
    if float(bg.min()) < MIN_BG_LUMA or border_share < MIN_BORDER_SHARE:
        return None

    diff = np.abs(rgb.astype(np.float32) - bg.reshape(1, 1, 3)).max(axis=2)
    bgmask = _background_mask(diff, tolerance)
    clear_frac = float(bgmask.mean())
    if not (MIN_CLEAR_FRAC <= clear_frac <= MAX_CLEAR_FRAC):
        return None

    fg = (~bgmask).astype(np.float32)
    opaque_frac = float(fg.mean())
    if opaque_frac < MIN_OPAQUE_FRAC:
        return None
    if _largest_component_share(~bgmask) < 0.85:
        # 主体碎成好几块：多半是把浅色衣服当背景啃掉了
        return None

    alpha = cv2.GaussianBlur(fg, (0, 0), FEATHER_SIGMA)
    alpha = np.clip(alpha, 0.0, 1.0)
    out_rgb = _unpremultiply(rgb, alpha, bg)
    rgba = np.dstack([out_rgb, alpha * 255.0]).astype(np.uint8)
    png = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(png, format="PNG", optimize=True)
    return Cutout(
        png=png.getvalue(),
        metrics={
            "bg": [round(float(v), 1) for v in bg],
            "border_share": round(border_share, 3),
            "clear_frac": round(clear_frac, 4),
            "opaque_frac": round(opaque_frac, 4),
        },
    )
