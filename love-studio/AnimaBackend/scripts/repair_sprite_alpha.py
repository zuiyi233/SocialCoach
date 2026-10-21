"""把库里「白底没抠掉」的立绘重新抠一遍（透明底 WebP 覆盖原文件）。

为什么需要：2026-10-21 之前 matte 用 `alpha.min() < 250` 判断「已经是透明底」，
Qwen-Image 2.1 出的 RGBA 边缘有万分之几的半透明像素，会被误判成已抠过 —— 白底就这样
进了舞台。matte 已修（按透明面积占比判断），这个脚本把已经进库的坏图补回来。

    ..\\.venv\\Scripts\\python.exe scripts\\repair_sprite_alpha.py            # 只看，不改
    ..\\.venv\\Scripts\\python.exe scripts\\repair_sprite_alpha.py --apply    # 真的写回

抠不动的（背景不是纯白、人物和背景粘连）会列在最后：那些需要重新生成，不是脚本能修的。
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from PIL import Image

from app.db import SessionLocal
from app.models import PackSprite, SpritePack
from app.plugins.imagegen.matte import MIN_TRANSPARENT_SHARE, cut_out_portrait
from app.storage import refs

MAX_WIDTH = 1280
QUALITY = 92


def _transparent_share(data: bytes) -> float:
    im = Image.open(io.BytesIO(data))
    if im.mode not in ("RGBA", "LA"):
        return 0.0
    return float((np.asarray(im.getchannel("A")) < 250).mean())


def _to_webp(png: bytes) -> bytes:
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    if img.width > MAX_WIDTH:
        h = round(img.height * MAX_WIDTH / img.width)
        img = img.resize((MAX_WIDTH, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(description="重新抠掉立绘的白底")
    ap.add_argument("--apply", action="store_true", help="写回库（默认只报告）")
    args = ap.parse_args()

    fixed, skipped, failed = 0, 0, []
    with SessionLocal() as db:
        rows = list(
            db.query(PackSprite, SpritePack.name)
            .join(SpritePack, SpritePack.id == PackSprite.pack_id)
            .order_by(SpritePack.name, PackSprite.sort)
        )
        for sprite, pack_name in rows:
            data = refs.read_bytes(refs.SPRITE, sprite, db) if sprite.mime else None
            if data is None:
                continue
            tag = f"{pack_name} / {sprite.label}"
            if _transparent_share(data) >= MIN_TRANSPARENT_SHARE:
                skipped += 1
                continue
            cut = cut_out_portrait(data)
            if cut is None:
                failed.append(tag)
                continue
            webp = _to_webp(cut.png)
            print(f"  {'写回' if args.apply else '可修'} {tag}：{len(data) // 1024} KB → {len(webp) // 1024} KB")
            if args.apply:
                # refs.save 只写指纹，不写类型列；文件按 mime 决定扩展名，类型不改就会 404
                sprite.mime = "image/webp"
                refs.save(refs.SPRITE, sprite, webp, "image/webp", db)
                db.commit()
            fixed += 1

    print(f"\n已透明（跳过）{skipped} 张；{'已修' if args.apply else '可修'} {fixed} 张；抠不动 {len(failed)} 张")
    for tag in failed:
        print(f"  抠不动（需要重新生成）：{tag}")


if __name__ == "__main__":
    main()
