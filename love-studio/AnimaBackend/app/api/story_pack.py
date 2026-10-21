"""故事包（`socialcoach.love-story.v1`）的导出 / 导入接口（Love Studio 侧；spec-love-bridge §5）。

- `POST /api/story/export`       一局对话 → 故事包 JSON（纯文本，可下载后到 `/love/archive` 导入）。
- `POST /api/story/import`       multipart 字段 `file` → 校验并预览（不写库）。
- `POST /api/story/import/apply` 校验后的包 → 建卡（包里带角色快照时）+ 新建一局带「前情」的对话。

失败统一 `HTTPException(400, detail={"code": <错误码>, "message": 中文说明})`，与 `.scpersona` 同口径。
剧透字段、无标记 quote、私有结局谓词都由 `app.story_pack` 统一剥掉；本模块不自己写第二套规则。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import story_pack as sp
from app.db import get_db
from app.models import DebugChat, DebugChatMessage, TavernCard

router = APIRouter(prefix="/api/story", tags=["story-pack"])

ERROR_MESSAGES = {
    "story/bad-json": "故事包不是合法的 JSON",
    "story/bad-shape": "故事包字段不完整或类型不对",
    "story/bad-version": "故事包版本不受支持",
    "story/too-large": "故事包超出大小上限",
    "story/no-chat": "没有可导出的对话",
    "story/no-card": "没有可用的角色卡",
}

RECAP_PREFIX = "【前情】"
MAX_SUMMARY_CHARS = 2000
MAX_CHOICE_CHARS = 400


def _fail(code: str, message: str | None = None) -> HTTPException:
    return HTTPException(
        400,
        detail={"code": code, "message": message or ERROR_MESSAGES.get(code, "未知错误")},
    )


def _pack_fail(result: dict) -> HTTPException:
    return _fail(result["code"], result["message"])


def _loc(text: str) -> dict[str, str]:
    """单语原文同时填进 zh / en：显式复用，不是偷偷机翻（spec-love-bridge §2.4）。"""
    value = text.strip()
    return {"zh": value, "en": value}


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


class StoryExportRequest(BaseModel):
    chat_id: str = Field(min_length=1, max_length=64)
    title: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=4000)
    license: str | None = Field(default=None, max_length=400)
    language: str = "zh"


class StoryImportApplyRequest(BaseModel):
    pack: dict[str, Any]
    card_id: str | None = Field(default=None, max_length=64)
    language: str = "zh"


def _message_text(row: DebugChatMessage) -> str:
    swipes = row.swipes if isinstance(row.swipes, list) else []
    if not swipes:
        return ""
    index = row.swipe_id if isinstance(row.swipe_id, int) else 0
    if index < 0 or index >= len(swipes):
        index = 0
    value = swipes[index]
    return value if isinstance(value, str) else ""


def _chat_messages(chat_id: str, db: Session) -> list[tuple[int, str, str]]:
    rows = db.scalars(
        select(DebugChatMessage)
        .where(DebugChatMessage.chat_id == chat_id)
        .order_by(DebugChatMessage.idx)
    ).all()
    out: list[tuple[int, str, str]] = []
    for row in rows:
        text = _message_text(row).strip()
        if text:
            out.append((row.idx, row.role, text))
    return out


def _character_snapshot(card: TavernCard | None) -> dict[str, Any] | None:
    """角色公开字段快照。主站的导入预览读 `name` / `description`（都必须是字符串）。"""
    if card is None or not (card.name or "").strip():
        return None
    snapshot: dict[str, Any] = {
        "name": card.name.strip(),
        "description": card.description or "",
        "personality": card.personality or "",
        "scenario": card.scenario or "",
        "first_mes": card.first_mes or "",
        "source": "studio",
    }
    if card.creator:
        snapshot["creator"] = card.creator
    if card.tags:
        snapshot["tags"] = list(card.tags)
    return snapshot


def _fallback_summary(messages: list[tuple[int, str, str]], char_name: str, user_name: str) -> str:
    """没给摘要时的确定性兜底：句数 + 最后一句。不调用模型，不编剧情。"""
    last = next((text for _, role, text in reversed(messages) if role == "assistant"), "")
    if not last:
        return f"{user_name} 与 {char_name} 的这段对话共 {len(messages)} 句。"
    return f"{user_name} 与 {char_name} 共 {len(messages)} 句对话，最后停在：{_clip(last, 240)}"


@router.post("/export")
def export_story(req: StoryExportRequest, db: Session = Depends(get_db)):
    chat = db.get(DebugChat, req.chat_id)
    if chat is None:
        raise HTTPException(404, "对话不存在")
    messages = _chat_messages(chat.id, db)
    if not messages:
        raise _fail("story/no-chat", "这一局还没有可导出的内容")

    card = db.get(TavernCard, chat.card_id) if chat.card_id else None
    char_name = (card.name if card else chat.card_name) or "对方"
    user_name = chat.user_name or "User"

    title = _clip(req.title or chat.name or f"{char_name} · {datetime.now(timezone.utc):%Y-%m-%d}", 200)
    summary = _clip(req.summary or _fallback_summary(messages, char_name, user_name), MAX_SUMMARY_CHARS)

    # 玩家的话都是自由输入：choice + quote 都留，导出侧统一打 quoteSource 标记。
    key_choices = [
        {"at": idx, "choice": _loc(_clip(text, MAX_CHOICE_CHARS)), "quote": _loc(_clip(text, MAX_CHOICE_CHARS))}
        for idx, role, text in messages
        if role == "user"
    ]

    story = {
        "id": uuid.uuid4().hex,
        "origin": "studio",
        "title": _loc(title),
        "summary": _loc(summary),
        "keyChoices": key_choices,
        "characterPackIds": [chat.card_id] if chat.card_id else [],
        "branchId": "main",
        "canonical": True,
        "createdAt": sp.now_ms(),
    }

    try:
        pack = sp.build_story_pack(
            story,
            origin="studio",
            source=f"Love Studio · {char_name}",
            license=req.license or "CC-BY-4.0",
            character=_character_snapshot(card),
        )
    except sp.StoryPackError as error:
        raise _fail(error.code, error.message)

    return {
        "pack": pack,
        "json": sp.story_pack_json(pack),
        "file_name": sp.story_pack_file_name(pack),
        "hash": sp.story_pack_hash(pack),
        "warnings": [] if card is not None else ["没有角色卡快照：主站导入后不会新建人物档案"],
    }


@router.post("/import")
def import_story(file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        data = file.file.read() if file.file is not None else b""
    except Exception:
        raise _fail("story/bad-json", "读不到上传的文件")
    if not data:
        raise _fail("story/bad-json", "文件是空的")
    result = sp.parse_story_pack(data)
    if not result["ok"]:
        raise _pack_fail(result)
    pack = result["pack"]
    character = pack.get("character")
    can_create_card = isinstance(character, dict) and bool(str(character.get("name") or "").strip())
    return {
        "pack": pack,
        "warnings": result["warnings"],
        "hash": sp.story_pack_hash(pack),
        "can_create_card": can_create_card,
    }


def _recap_text(pack: dict, language: str) -> str:
    story = pack["story"]
    lang = "en" if language == "en" else "zh"
    lines = [RECAP_PREFIX + story["summary"].get(lang, story["summary"]["zh"])]
    choices = [choice for choice in story.get("keyChoices") or [] if isinstance(choice, dict)]
    if choices:
        lines.append("关键选择 / Key choices:")
        for choice in choices[:20]:
            text = (choice.get("choice") or {}).get(lang) or (choice.get("choice") or {}).get("zh", "")
            if text:
                lines.append(f"- {text}")
    return "\n".join(lines)


@router.post("/import/apply")
def apply_import(req: StoryImportApplyRequest, db: Session = Depends(get_db)):
    """把故事包变成「可续写的一局」：必要时建卡，然后新建一局带前情的对话。

    关系状态不在这里写 —— 关系归主站（spec-love-bridge §2.1）；Studio 只提供故事上下文。
    """
    result = sp.parse_story_pack(req.pack)
    if not result["ok"]:
        raise _pack_fail(result)
    pack = result["pack"]
    story = pack["story"]

    created_card = False
    card: TavernCard | None = None
    if req.card_id:
        card = db.get(TavernCard, req.card_id)
        if card is None:
            raise _fail("story/no-card", "指定的角色卡不存在")
    else:
        character = pack.get("character")
        name = str(character.get("name") or "").strip() if isinstance(character, dict) else ""
        if not name:
            raise _fail("story/no-card", "故事包里没有角色快照，请先选一张角色卡")
        card = TavernCard(
            name=name[:200],
            description=str(character.get("description") or "")[:20000],
            personality=str(character.get("personality") or "")[:20000],
            scenario=str(character.get("scenario") or "")[:20000],
            first_mes=str(character.get("first_mes") or "")[:20000],
            creator=str(character.get("creator") or "SocialCoach 故事包")[:200],
            extensions={
                "studio_story_import": {
                    "storyId": story["id"],
                    "packHash": sp.story_pack_hash(pack),
                    "importedAt": sp.now_ms(),
                }
            },
        )
        db.add(card)
        db.flush()
        created_card = True

    title = story["title"].get("zh") or story["title"]["en"]
    chat = DebugChat(
        name=f"{title} · 续写"[:200],
        card_id=card.id,
        card_name=card.name,
        user_name="User",
        variables={"storyPackId": story["id"], "branchOf": story.get("branchOf") or story["id"]},
    )
    db.add(chat)
    db.flush()

    recap = _recap_text(pack, req.language)
    db.add(
        DebugChatMessage(
            id=str(uuid.uuid4()),
            chat_id=chat.id,
            idx=0,
            role="assistant",
            swipes=[recap],
            swipe_id=0,
            swipe_info=[],
        )
    )
    db.commit()
    return {
        "card_id": card.id,
        "chat_id": chat.id,
        "created_card": created_card,
        "recap": recap,
    }
