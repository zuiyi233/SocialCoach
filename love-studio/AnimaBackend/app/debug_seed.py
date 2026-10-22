"""调试用状态夹具：把 Studio 的库准备成「一张卡 + 一条对话 + mock 模型」。

Studio 的状态不在 localStorage，而在 SQLite（`AnimaBackend/data/animabackend.db`），
所以主站的 `state.load` 夹具对它无效。这个脚本是 Studio 侧的 `state.load`：

    ..\\.venv\\Scripts\\python.exe -m app.debug_seed [card_dir] [--reset]

- 幂等：卡 / 预设 / mock 连接 / 对话都按名字查重；
- `--reset` 会删掉旧的「调试对话」，保证从空对话开始；
- 最后一行输出 JSON，供 `node scripts/debug.mjs studio.seed` 解析。

卡目录默认 `genshin-ganyu`（`app/seed_data/` 下的目录名）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import select, update

from app.db import Base, SessionLocal, engine
from app.models import ApiConnection, DebugChat, PromptPreset, TavernCard
from app.seed import _SEED_DATA, seed_default_tavern_data
from app.seed_one import seed_one

DEBUG_CHAT_NAME = "调试对话"
MOCK_NAME = "调试 Mock"


def _card_name(char_dir: Path) -> str:
    raw = json.loads((char_dir / "card.json").read_text(encoding="utf-8"))
    data = raw.get("data", raw)
    return (data.get("name") if isinstance(data, dict) else None) or char_dir.name


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    char_key = args[0] if args else "genshin-ganyu"
    reset = "--reset" in sys.argv
    char_dir = _SEED_DATA / char_key
    if not (char_dir / "card.json").is_file():
        raise SystemExit(f"没有这个种子角色：{char_key}（目录 {char_dir}）")

    Base.metadata.create_all(engine)

    with SessionLocal() as db:
        seed_default_tavern_data(db)
        db.commit()

    seeded = seed_one(char_dir)

    with SessionLocal() as db:
        card = db.scalars(select(TavernCard).where(TavernCard.name == _card_name(char_dir))).first()
        if card is None:
            raise SystemExit(f"种入后仍找不到角色卡：{_card_name(char_dir)}")
        preset = db.scalars(select(PromptPreset).order_by(PromptPreset.created_at)).first()
        if preset is None:
            raise SystemExit("库里没有预设；seed_default_tavern_data 应该会建一份默认预设")

        conn = db.scalars(select(ApiConnection).where(ApiConnection.api_type == "mock")).first()
        if conn is None:
            conn = ApiConnection(name=MOCK_NAME, api_type="mock", model="mock", is_active=True, stream=True)
            db.add(conn)
            db.flush()
        conn.name = MOCK_NAME
        conn.model = "mock"
        conn.is_active = True
        # 只留 mock 一个启用连接：否则前端可能选中真实连接，调试就会走网络。
        db.execute(update(ApiConnection).where(ApiConnection.id != conn.id).values(is_active=False))

        chat = db.scalars(
            select(DebugChat).where(DebugChat.card_id == card.id, DebugChat.name == DEBUG_CHAT_NAME)
        ).first()
        if chat is not None and reset:
            db.delete(chat)
            db.flush()
            chat = None
        if chat is None:
            chat = DebugChat(
                name=DEBUG_CHAT_NAME,
                card_id=card.id,
                card_name=card.name,
                preset_id=preset.id,
                preset_name=preset.name,
                user_name="调试者",
            )
            db.add(chat)
            db.flush()
        else:
            chat.preset_id = preset.id
            chat.preset_name = preset.name
        # 让前端打开这张卡时直接落到这条对话，而不是最近更新的另一条。
        card.last_chat_id = chat.id
        db.commit()

        print(
            json.dumps(
                {
                    "ok": True,
                    "seed": seeded,
                    "card": {"id": card.id, "name": card.name},
                    "chat": {"id": chat.id, "name": chat.name, "messages": 0},
                    "preset": {"id": preset.id, "name": preset.name},
                    "connection": {"id": conn.id, "name": conn.name, "api_type": conn.api_type, "model": conn.model},
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
