"""把 seed_data/ 下的某一个角色目录种进**现有**数据库。

`seed_default_tavern_data()` 只在库里一张卡都没有时跑；起始角色加了新的之后，老库不会自动
补上。这个模块是给它补种的入口：

    ..\\.venv\\Scripts\\python.exe -m app.seed_one genshin-ganyu
    ..\\.venv\\Scripts\\python.exe -m app.seed_one genshin-ganyu --dry-run

同名卡已存在就跳过（幂等），不会覆盖用户在 Studio 里改过的内容。立绘包与场景包同样按名字查重，
已在的包直接挂回卡上。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import TavernCard
from app.seed import _SEED_DATA, _seed_default_card, _seed_default_sprites, _seed_scene_pack


def _card_name(char_dir: Path) -> str | None:
    card_file = char_dir / "card.json"
    if not card_file.is_file():
        return None
    raw = json.loads(card_file.read_text(encoding="utf-8"))
    d = raw.get("data", raw)
    return (d.get("name") if isinstance(d, dict) else None) or char_dir.name


def _seed_into(db: Session, char_dir: Path, card_name: str, dry_run: bool) -> str:
    existing = db.scalars(select(TavernCard).where(TavernCard.name == card_name)).first()
    if existing is not None:
        return f"跳过 {card_name}：同名卡已存在（id={existing.id[:8]}）"
    if dry_run:
        return f"[dry-run] {card_name}：将新建卡 + 立绘包 + 场景包"
    try:
        card = _seed_default_card(db, char_dir)
        _seed_default_sprites(db, card, char_dir)
        _seed_scene_pack(db, card, char_dir)
        db.commit()
    except Exception as e:  # noqa: BLE001 —— CLI 入口：报清楚比抛栈更有用
        db.rollback()
        return f"失败 {card_name}：{type(e).__name__}: {e}"
    return f"已种入 {card.name}（id={card.id[:8]}）"


def seed_one(char_dir: Path, *, dry_run: bool = False, db: Session | None = None) -> str:
    """种一个角色目录，返回一句给人看的结果说明。db 传了就复用（测试用）。"""
    card_name = _card_name(char_dir)
    if card_name is None:
        return f"跳过 {char_dir.name}：没有 card.json"
    if db is not None:
        return _seed_into(db, char_dir, card_name, dry_run)
    with SessionLocal() as session:
        return _seed_into(session, char_dir, card_name, dry_run)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    dry = "--dry-run" in sys.argv
    if not args:
        dirs = sorted(p.name for p in _SEED_DATA.iterdir() if (p / "card.json").is_file())
        print("用法：python -m app.seed_one <目录名> [--dry-run]")
        print("可用的种子角色：" + ("、".join(dirs) if dirs else "（无）"))
        raise SystemExit(1)
    target = Path(args[0])
    print(seed_one(target if target.is_absolute() else _SEED_DATA / target, dry_run=dry))


if __name__ == "__main__":
    main()
