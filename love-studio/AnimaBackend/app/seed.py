import base64
import json
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings
from app.api.scenes import sniff_audio_mime
from app.assets.common import sniff_image_mime
from app.config import settings
from app.models import (
    ApiConnection,
    PackSprite,
    Persona,
    PromptPreset,
    SceneAsset,
    ScenePack,
    SpritePack,
    TavernCard,
)
from app.storage import refs

log = logging.getLogger("app")

_SEED_DATA = Path(__file__).resolve().parent / "seed_data"

# ── 自带起始角色的注册处 ────────────────────────────────────────────────
# 规则:seed_data/ 下**每个含 card.json 的子目录**都是一个种子角色,首启时会自动种上
# (卡 + 可选的 avatar.webp 卡面 + 可选的 sprites.json + sprites/ 立绘包 +
# 可选的 scene_pack.json + scenes/ 场景包)。
# 起始角色的作者只要把整个目录丢进 seed_data/ 就行,不用改这里的代码;素材授权写在
# 目录里的 CREDITS.txt。场景包契约见 _seed_scene_pack 的注释。
_STARTER_CHARACTER_DIR = _SEED_DATA / "starter"


def _character_dirs() -> list[Path]:
    """seed_data/ 下所有含 card.json 的子目录,按名字排序。目录不存在/没卡片就是空。"""
    if not _SEED_DATA.is_dir():
        return []
    return sorted(p for p in _SEED_DATA.iterdir() if p.is_dir() and (p / "card.json").is_file())


def seed_default_persona(db: Session) -> None:
    """First run only: a default player persona so {{user}} has a name."""
    if db.scalars(select(Persona)).first() is not None:
        return
    db.add(
        Persona(
            name="旅行者",
            description="一位远道而来的旅行者,对这片土地上的新鲜事物充满好奇。",
            is_active=True,
        )
    )
    db.commit()


def seed_default_connections(db: Session) -> None:
    """First run only: a mock connection, plus real ones for any keys in .env."""
    if db.scalars(select(ApiConnection)).first() is not None:
        return
    conns = [ApiConnection(name="Mock（本地测试）", api_type="mock", model="mock")]
    if settings.anthropic_api_key:
        conns.append(
            ApiConnection(
                name="Anthropic（来自 .env）",
                api_type="anthropic",
                api_key=settings.anthropic_api_key,
                model="claude-sonnet-5",
            )
        )
    if settings.openai_api_key:
        conns.append(
            ApiConnection(
                name="OpenAI（来自 .env）",
                api_type="openai_compatible",
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url,
                model="gpt-4o",
            )
        )
    # prefer a real connection as the active one; mock only if that's all there is
    conns[-1].is_active = True
    db.add_all(conns)
    db.commit()


def _seed_default_card(db: Session, char_dir: Path) -> TavernCard:
    raw = json.loads((char_dir / "card.json").read_text(encoding="utf-8"))
    # V2/V3 keep the real fields under `data`; V1 is flat
    d = raw.get("data", raw)
    avatar_file = char_dir / "avatar.webp"
    avatar = (
        f"data:image/webp;base64,{base64.b64encode(avatar_file.read_bytes()).decode('ascii')}"
        if avatar_file.is_file()
        else None
    )
    card = TavernCard(
        name=d.get("name", char_dir.name),
        description=d.get("description", ""),
        personality=d.get("personality", ""),
        scenario=d.get("scenario", ""),
        first_mes=d.get("first_mes", ""),
        mes_example=d.get("mes_example", ""),
        system_prompt=d.get("system_prompt", ""),
        post_history_instructions=d.get("post_history_instructions", ""),
        creator_notes=d.get("creator_notes", ""),
        alternate_greetings=d.get("alternate_greetings", []),
        tags=d.get("tags", []),
        creator=d.get("creator", ""),
        character_version=d.get("character_version", ""),
        character_book=d.get("character_book"),
        extensions=d.get("extensions", {}),
        spec=raw.get("spec", "chara_card_v2"),
        avatar=avatar,
    )
    db.add(card)
    db.flush()
    return card


def _seed_default_sprites(db: Session, card: TavernCard, char_dir: Path) -> None:
    """自带角色的立绘包。删了卡又重新种的时候,同名的包还在就直接挂回去,不再建一个。
    脸的位置是导出时就算好的(sprites.json 的 face_scan),首启不用再跑一遍找脸。
    目录里没有 sprites.json / sprites 目录(起始角色只给了卡)时安静跳过 —— 只是个没立绘的卡。"""
    sprites_file = char_dir / "sprites.json"
    if not sprites_file.is_file():
        return
    pack_name = f"{card.name} · 立绘" if card.name else f"{char_dir.name} · 立绘"
    pack = db.scalars(select(SpritePack).where(SpritePack.name == pack_name)).first()
    if pack is None:
        pack = SpritePack(name=pack_name, description=f"SocialCoach · Love Studio 自带角色「{card.name}」的立绘")
        db.add(pack)
        db.flush()
        rows = json.loads(sprites_file.read_text(encoding="utf-8"))
        for i, row in enumerate(rows):
            sprite = PackSprite(
                pack_id=pack.id,
                label=row["label"],
                aliases=row.get("aliases", []),
                description=row.get("description", ""),
                mime="image/webp",
                sort=i,
                face_scan=row.get("face_scan"),
                effect=row.get("effect"),
            )
            # 和上传的立绘一样走 refs.save:文件仓库开着时只进仓库,库里不存原件
            refs.save(refs.SPRITE, sprite, (char_dir / "sprites" / row["file"]).read_bytes(), "image/webp", db)
            db.add(sprite)
    db.flush()
    bindings.replace(db, card.id, bindings.SPRITE, [pack.id], pack.id)


_EXT_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
}


def _scene_mime(data: bytes, path: Path) -> str | None:
    """场景文件的类型:先按文件头嗅探(和上传用的同一套),认不出按扩展名兜底"""
    return sniff_image_mime(data) or sniff_audio_mime(data) or _EXT_MIME.get(path.suffix.lower())


def _seed_scene_asset(db: Session, pack: ScenePack, spec: dict, char_dir: Path, i: int) -> SceneAsset:
    """scene_pack.json 里的一条素材。kind 只收 bg / bgm / cg;文件在 char_dir/scenes/ 下,
    和上传的场景素材一样走 refs.save 进文件仓库(库里不存原件)。"""
    kind = spec.get("kind")
    if kind not in ("bg", "bgm", "cg"):
        raise ValueError(f"场景素材 kind 只能是 bg/bgm/cg,拿到 {kind!r}")
    file = spec.get("file")
    label = (spec.get("label") or "").strip()
    if not file or not label:
        raise ValueError("场景素材要写 file 和 label")
    path = char_dir / "scenes" / file
    if not path.is_file():
        raise ValueError(f"场景文件不存在:scenes/{file}")
    data = path.read_bytes()
    mime = _scene_mime(data, path)
    if mime is None:
        raise ValueError(f"场景文件认不出格式:scenes/{file}")
    aliases = [a for a in (spec.get("aliases") or []) if isinstance(a, str)]
    focus_x = min(max(int(spec.get("focus_x", 50)), 0), 100)
    asset = SceneAsset(
        pack_id=pack.id,
        kind=kind,
        label=label,
        aliases=aliases,
        description=(spec.get("description") or "").strip(),
        mime=mime,
        size=len(data),
        sort=int(spec.get("sort", i)),
        focus_x=focus_x,
        enabled=True,
    )
    refs.save(refs.SCENE_ASSET, asset, data, mime, db)
    return asset


def _seed_scene_pack(db: Session, card: TavernCard, char_dir: Path) -> None:
    """自带角色的场景包(可选):char_dir/scene_pack.json + scenes/ 目录。

    scene_pack.json 形状:{name, description, assets: [{file, kind, label, aliases?,
    description?, focus_x?, sort?}]},文件都在 scenes/ 下。没有 scene_pack.json 时安静跳过。

    幂等:按包名找,同名包已经在(上次种过、或删了卡重种时立绘包那一套)就复用,不再建第二遍、
    也不再重复存文件;不管新旧都重新绑到这张卡上。素材 mime 先嗅探后按扩展名兜底。
    不提交:整个角色种完由 seed_default_tavern_data 一起提交,坏了整角色回滚。"""
    manifest = char_dir / "scene_pack.json"
    if not manifest.is_file():
        return
    raw = json.loads(manifest.read_text(encoding="utf-8"))
    name = (raw.get("name") or "").strip()
    if not name:
        raise ValueError("scene_pack.json 里没写 name")
    pack = db.scalars(select(ScenePack).where(ScenePack.name == name)).first()
    if pack is None:
        pack = ScenePack(name=name, description=(raw.get("description") or "").strip())
        db.add(pack)
        db.flush()
        for i, spec in enumerate(raw.get("assets") or []):
            db.add(_seed_scene_asset(db, pack, spec, char_dir, i))
        db.flush()
    bindings.replace(db, card.id, bindings.SCENE, [pack.id], pack.id)


def seed_default_tavern_data(db: Session) -> None:
    """First run only: every bundled card under seed_data/ (with its sprite pack and
    scene pack, if any) + default Chat Completion preset, so a fresh install has
    someone to talk to before any import.

    没有自带角色(这一版的默认状态)时这里什么都不种,安静跳过,不挡启动 ——
    上游自带角色被移除后,库是空的也有空的处理法(用户自己导入卡)。"""
    if db.scalars(select(TavernCard)).first() is None:
        for char_dir in _character_dirs():
            try:
                card = _seed_default_card(db, char_dir)
                _seed_default_sprites(db, card, char_dir)
                _seed_scene_pack(db, card, char_dir)
                # 一个角色一提交:某个坏了要回滚时,别把它前面已经种好的角色一起回掉
                db.commit()
            except Exception:
                # 某个种子角色目录坏了(缺文件、json 写错)不该拖垮整个启动:记一条,种下一个
                db.rollback()
                log.warning("种子角色 %s 载入失败,跳过", char_dir.name, exc_info=True)

    if db.scalars(select(PromptPreset)).first() is None:
        raw = json.loads((_SEED_DATA / "default-preset.json").read_text(encoding="utf-8"))
        db.add(
            PromptPreset(
                name="默认预设",
                prompts=raw.get("prompts", []),
                prompt_order=raw.get("prompt_order", []),
                formats={
                    k: raw[k]
                    for k in (
                        "wi_format",
                        "scenario_format",
                        "personality_format",
                        "group_nudge_prompt",
                        "new_chat_prompt",
                        "new_example_chat_prompt",
                    )
                    if k in raw
                },
                params={
                    k: raw[k]
                    for k in ("temperature", "top_p", "openai_max_context", "openai_max_tokens")
                    if k in raw
                },
                squash_system_messages=raw.get("squash_system_messages", False),
            )
        )

    db.commit()
