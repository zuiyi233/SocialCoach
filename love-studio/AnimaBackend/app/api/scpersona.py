"""`.scpersona` 的导入 / 导出接口（Love Studio 侧；spec-love-persona §2）。

- `POST /api/scpersona/inspect`   multipart 字段 `file` → 解包、校验，回 manifest/persona/worldbook/style/assets。
- `POST /api/scpersona/import`    同入参 → 落成 Studio 的 TavernCard；未知字段写进
  `extensions.studio_scpersona.persona`，导出能原样带回。同名不静默覆盖（沿用建卡策略：总是新建）。
- `GET  /api/scpersona/export/{card_id}?public_only=0|1` → application/zip；以
  `extensions.studio_scpersona.persona` 为底，再用卡上当前字段覆盖；public_only=1 剥 secret。

失败统一 `HTTPException(400, detail={"code": <错误码字符串>, "message": 中文说明})`。
"""

from __future__ import annotations

import re
import time
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app import scpersona
from app.db import get_db
from app.models import TavernCard

router = APIRouter(prefix="/api/scpersona", tags=["scpersona"])

ERROR_MESSAGES = {
    "persona/bad-json": "不是合法的 JSON",
    "persona/bad-shape": "人设数据格式不对",
    "persona/bad-version": "人设 / 包版本不受支持",
    "persona/text-too-long": "人设文本超出上限",
    "persona/too-large": "人设文件过大",
    "persona/asset-too-large": "资产文件过大",
    "persona/asset-budget": "资产超出预算",
    "persona/unsupported": "不支持的文件类型",
    "persona/pack-unreadable": "不是合法的 .scpersona 包",
    "persona/pack-missing": ".scpersona 包缺少必需文件",
    "persona/pack-manifest": ".scpersona 包清单不完整",
    "persona/pack-hash": ".scpersona 包内容校验失败",
    "persona/pack-too-large": ".scpersona 包超出大小上限",
}


def _sc_fail(code: str, message: str) -> HTTPException:
    return HTTPException(400, detail={"code": code, "message": message})


def _pack_fail(result: dict) -> HTTPException:
    code = result["code"]
    message = ERROR_MESSAGES.get(code, "未知错误")
    return _sc_fail(code, message)


def _read_pack(file: UploadFile) -> dict:
    try:
        data = file.file.read() if file.file is not None else b""
    except Exception:
        raise _sc_fail("persona/pack-unreadable", "读不到上传的文件")
    result = scpersona.read_persona_pack(data)
    if not result["ok"]:
        raise _pack_fail(result)
    return result["pack"]


def _single_text(loc: dict | None) -> str:
    if not isinstance(loc, dict):
        return ""
    for lang in ("zh", "en"):
        value = loc.get(lang)
        if isinstance(value, str):
            return value
    return ""


def _localized(value: str) -> dict[str, str]:
    # 单语卡用同一个字符串填 zh / en（§2「不要伪造第二语言」）
    return {"zh": value, "en": value}


def _character_book(worldbook: object) -> dict | None:
    if worldbook is None:
        return None
    if isinstance(worldbook, list):
        return {"entries": worldbook}
    return worldbook


@router.post("/inspect")
def inspect_pack(file: UploadFile = File(...)):
    """解包并校验一个 `.scpersona`，不改库。只做识别与契约校验，回原样内容。"""
    pack = _read_pack(file)
    body = {"manifest": pack["manifest"], "persona": pack["persona"], "notices": []}
    for key in ("worldbook", "style"):
        if key in pack:
            body[key] = pack[key]
    body["assets"] = pack.get("assets") or {}
    return body


@router.post("/import")
def import_pack(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """把一个 `.scpersona` 落成 Studio 的 TavernCard。未知字段原样保留在
    `extensions.studio_scpersona.persona`，导出时能带回来。"""
    pack = _read_pack(file)
    persona = pack["persona"]
    manifest = pack["manifest"]
    worldbook = pack.get("worldbook")
    assets = pack.get("assets") or {}

    extensions: dict = {}
    tavern = persona.get("tavern")
    if isinstance(tavern, dict):
        raw = tavern.get("raw")
        if isinstance(raw, dict) and isinstance(raw.get("extensions"), dict):
            extensions.update(raw["extensions"])

    studio: dict = {
        "id": persona.get("id"),
        "revision": persona.get("revision"),
        "cardHash": manifest.get("cardHash"),
        "source": manifest.get("source"),
        "persona": persona,
    }
    if manifest.get("license"):
        studio["license"] = manifest["license"]
    extensions["studio_scpersona"] = studio

    avatar = None
    portraits = assets.get("portraits") if isinstance(assets, dict) else None
    if isinstance(portraits, dict) and portraits:
        avatar = next(iter(portraits.values()))

    greetings = persona.get("greetings")
    greeting_texts = [g for g in ([_single_text(g) for g in greetings] if isinstance(greetings, list) else []) if g]

    card = TavernCard(
        name=_single_text(persona.get("name")),
        description=_single_text(persona.get("bio")),
        personality=_single_text(persona.get("personality")),
        scenario="",
        first_mes=greeting_texts[0] if greeting_texts else "",
        mes_example=_single_text(persona.get("speechStyle")),
        alternate_greetings=greeting_texts[1:],
        character_book=_character_book(worldbook),
        extensions=extensions,
        avatar=avatar,
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return {"card_id": card.id, "card_name": card.name, "persona": persona, "notices": []}


def _disposition(filename: str, fallback: str) -> str:
    """RFC 6266/5987 安全的 Content-Disposition：中文这类非 ASCII 走 filename*，
    ASCII 兜底 —— 否则 Starlette 用 latin-1 编码 header 会炸。"""
    ascii_name = filename.encode("ascii", "ignore").decode("ascii")
    if not ascii_name.strip(" .-_"):
        ascii_name = fallback
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename, safe="")}'


def _apply_card_fields(persona: dict, card: TavernCard) -> dict:
    """用卡上当前字段覆盖 persona 的可编辑字段；空的可选字段直接去掉（不导出空壳）。"""
    next_persona = dict(persona)
    next_persona["name"] = _localized(card.name or "未命名角色")
    for key, text in (
        ("bio", card.description),
        ("personality", card.personality),
        ("speechStyle", card.mes_example),
    ):
        if text:
            next_persona[key] = _localized(text)
        else:
            next_persona.pop(key, None)
    greetings = []
    if card.first_mes:
        greetings.append(_localized(card.first_mes))
    for greeting in card.alternate_greetings or []:
        if isinstance(greeting, str) and greeting:
            greetings.append(_localized(greeting))
    if greetings:
        next_persona["greetings"] = greetings
    else:
        next_persona.pop("greetings", None)
    next_persona["source"] = "studio-generated"
    return next_persona


def _persona_from_card(card: TavernCard) -> dict:
    """Studio 原生卡（没有 .scpersona 源数据）按 Tavern 字段反推一份 Persona，
    让「Studio 创建角色 → 导出 → 恋爱系统导入」这条路成立（spec-love-persona §3 映射）。"""
    now = int(time.time() * 1000)
    extensions = dict(card.extensions or {})
    extensions.pop("studio_scpersona", None)
    raw = {
        "name": card.name,
        "description": card.description,
        "personality": card.personality,
        "scenario": card.scenario,
        "first_mes": card.first_mes,
        "mes_example": card.mes_example,
        "alternate_greetings": list(card.alternate_greetings or []),
        "tags": list(card.tags or []),
        "creator": card.creator,
        "character_version": card.character_version,
        "character_book": card.character_book,
        "extensions": extensions,
    }
    persona = {
        "v": scpersona.LOVE_PERSONA_VERSION,
        "id": f"studio-{card.id}",
        "revision": 1,
        "kind": "npc",
        "name": _localized(card.name or "未命名角色"),
        "source": "studio-generated",
        "createdAt": now,
        "updatedAt": now,
        "tavern": {
            "spec": card.spec if card.spec in scpersona.TAVERN_SPEC else "chara_card_v2",
            "raw": raw,
            "cardHash": "",
        },
    }
    return _apply_card_fields(persona, card)


@router.get("/export/{card_id}")
def export_pack(card_id: str, public_only: int = 0, db: Session = Depends(get_db)):
    """把一张 Studio 卡导回 `.scpersona`。导入过的卡以完整原始 persona 为底（未知字段原样带回），
    原生卡按 Tavern 字段反推；两条路都用卡上当前字段覆盖。"""
    card = db.get(TavernCard, card_id)
    if card is None:
        raise HTTPException(404, "角色卡不存在")

    extensions = card.extensions or {}
    studio = extensions.get("studio_scpersona")
    if isinstance(studio, dict) and isinstance(studio.get("persona"), dict):
        # 以完整原始 persona 为底：未知字段原样保留
        persona = _apply_card_fields(dict(studio["persona"]), card)
        effective_license = studio.get("license")
    else:
        persona = _persona_from_card(card)
        effective_license = None

    if effective_license:
        persona["license"] = effective_license
    else:
        persona.pop("license", None)

    assets: dict[str, dict[str, str]] = {}
    base_assets = persona.get("assets")
    if isinstance(base_assets, dict):
        for group in ("portraits", "refs"):
            group_assets = base_assets.get(group)
            if isinstance(group_assets, dict) and group_assets:
                assets.setdefault(group, {}).update(group_assets)
    if card.avatar:
        assets.setdefault("portraits", {})["avatar"] = card.avatar

    result = scpersona.build_persona_pack(
        persona,
        public_only=public_only == 1,
        worldbook=card.character_book,
        assets=assets or None,
        source="studio-generated",
        license=effective_license,
    )
    if not result["ok"]:
        raise _pack_fail(result)

    safe = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", card.name) or "character"
    filename = f"{card.name or 'character'}.scpersona"
    return Response(
        content=result["bytes"],
        media_type="application/zip",
        headers={"Content-Disposition": _disposition(filename, f"{safe}.scpersona")},
    )
