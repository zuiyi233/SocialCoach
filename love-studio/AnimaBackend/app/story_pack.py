"""故事包（`socialcoach.love-story.v1`）的构建与校验（Love Studio 侧）。

主站侧实现在 `app/src/lib/love-story-pack.ts`，两边共用同一份字段契约（spec-love-bridge §3/§5）：

    {v: 1,
     manifest: {version, id, origin, createdAt, source, license?, characterPackId?},
     story:    {id, origin, title{zh,en}, summary{zh,en}, keyChoices[{at, choice{zh,en},
                consequence?, quote?}], endingId?, characterPackIds, parentStoryId?,
                branchId?, branchOf?, canonical, packRef?, createdAt, quoteSource?},
     persona?, character?, assets?}

与 `.scpersona` 不同，故事包是**纯文本 JSON**，不压缩：便于人工审阅与冲突检测。

三条纪律（两边必须一致，否则主站会拒绝或静默丢数据）：

1. **剧透字段**：`hidden` / `secret` / `success` / `failure` / `endingPredicate` /
   `routeState` / `finalDecision` 不得出现在 `story` 与 `character` 里；构建与解析都递归剥掉。
2. **quote 只留给自由输入**：只有 `quoteSource == "free-text"` 的包才保留
   `keyChoices[].quote`；否则解析时丢弃并记 warning。Studio 的玩家输入都是自由输入，
   所以导出时总是打上这个标记。
3. **双语非空**：`title` / `summary` / `choice` 的 `zh` 与 `en` 都必须非空。Studio 的 UGC
   是单语，调用方把同一段原文填进两种语言（显式复用，不是偷偷机翻）。

规范化 JSON / 哈希复用 `app.scpersona.canonical_json`（已按 JS `JSON.stringify` 语义实现），
这样主站的 `storyPackHash` 与这里的哈希在同一份内容上得到同一段字节。
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from app.scpersona import canonical_json

STORY_PACK_VERSION = 1
STORY_PACK_MANIFEST_VERSION = "socialcoach.love-story.v1"
STORY_PACK_MAX_BYTES = 8 * 1024 * 1024

LOC_MAX = 20_000
ID_MAX = 200
SOURCE_MAX = 400
MAX_KEY_CHOICES = 100
MAX_CHARACTER_PACK_IDS = 100
MAX_ASSET_VALUE = 4 * 1024 * 1024

PRIVATE_FIELDS = frozenset(
    {
        "hidden",
        "secret",
        "success",
        "failure",
        "endingPredicate",
        "routeState",
        "finalDecision",
    }
)

ORIGINS = ("studio", "love")


class StoryPackError(Exception):
    """构建/校验失败。`code` 是给前端与主站看的小写字符串。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _fail(code: str, message: str) -> dict:
    return {"ok": False, "code": code, "message": message}


# ── 形状判断 ────────────────────────────────────────────────────


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return _is_int(value) or isinstance(value, float)


def _is_text(value: Any, limit: int = LOC_MAX) -> bool:
    return isinstance(value, str) and 0 < len(value) <= limit


def _loc_text(value: Any) -> bool:
    """`{zh, en}` 两个非空字符串。"""
    return (
        isinstance(value, dict)
        and _is_text(value.get("zh"))
        and _is_text(value.get("en"))
    )


# ── 剧透字段剥离 ────────────────────────────────────────────────


def strip_private_fields(value: Any) -> Any:
    """递归剥掉剧透字段，返回新对象（不改入参），与 TS 侧同规则。"""
    if isinstance(value, list):
        return [strip_private_fields(item) for item in value]
    if isinstance(value, dict):
        return {
            key: strip_private_fields(child)
            for key, child in value.items()
            if key not in PRIVATE_FIELDS
        }
    return value


def _strip_with_warnings(value: Any, path: str, out: list[str]) -> Any:
    if isinstance(value, list):
        return [
            _strip_with_warnings(item, f"{path}[{index}]", out)
            for index, item in enumerate(value)
        ]
    if isinstance(value, dict):
        next_value: dict[str, Any] = {}
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key in PRIVATE_FIELDS:
                out.append(f"private field removed: {child_path}")
                continue
            next_value[key] = _strip_with_warnings(child, child_path, out)
        return next_value
    return value


# ── 校验 ────────────────────────────────────────────────────────


def _manifest_error(manifest: Any) -> str | None:
    if not isinstance(manifest, dict):
        return "story pack is missing a manifest object"
    if manifest.get("version") not in (None, STORY_PACK_MANIFEST_VERSION):
        return f"manifest.version must be {STORY_PACK_MANIFEST_VERSION}"
    if not _is_text(manifest.get("id"), ID_MAX):
        return "manifest.id is required"
    if manifest.get("origin") not in ORIGINS:
        return "manifest.origin must be studio or love"
    if not _is_number(manifest.get("createdAt")):
        return "manifest.createdAt must be a number"
    if not _is_text(manifest.get("source"), SOURCE_MAX):
        return "manifest.source is required"
    if manifest.get("license") is not None and not _is_text(manifest.get("license"), SOURCE_MAX):
        return "manifest.license is too long"
    if manifest.get("characterPackId") is not None and not _is_text(
        manifest.get("characterPackId"), ID_MAX
    ):
        return "manifest.characterPackId is too long"
    return None


def _choice_error(choice: Any) -> str | None:
    if not isinstance(choice, dict):
        return "story.keyChoices entries must be objects"
    if not _is_number(choice.get("at")):
        return "story.keyChoices[].at must be a number"
    if not _loc_text(choice.get("choice")):
        return "story.keyChoices[].choice must be {zh, en}"
    for key in ("consequence", "quote"):
        if choice.get(key) is not None and not _loc_text(choice.get(key)):
            return f"story.keyChoices[].{key} must be {{zh, en}}"
    return None


def _story_error(story: Any) -> str | None:
    if not isinstance(story, dict):
        return "story pack is missing a story object"
    if not _is_text(story.get("id"), ID_MAX):
        return "story.id is required"
    if story.get("origin") not in ORIGINS:
        return "story.origin must be studio or love"
    if not _loc_text(story.get("title")):
        return "story.title must be {zh, en}"
    if not _loc_text(story.get("summary")):
        return "story.summary must be {zh, en}"
    choices = story.get("keyChoices")
    if not isinstance(choices, list) or len(choices) > MAX_KEY_CHOICES:
        return f"story.keyChoices must be a list of at most {MAX_KEY_CHOICES}"
    for choice in choices:
        error = _choice_error(choice)
        if error:
            return error
    ids = story.get("characterPackIds")
    if not isinstance(ids, list) or len(ids) > MAX_CHARACTER_PACK_IDS:
        return f"story.characterPackIds must be a list of at most {MAX_CHARACTER_PACK_IDS}"
    if not all(_is_text(item, ID_MAX) for item in ids):
        return "story.characterPackIds entries must be non-empty strings"
    for key in ("endingId", "parentStoryId", "branchId", "branchOf"):
        if story.get(key) is not None and not _is_text(story.get(key), ID_MAX):
            return f"story.{key} is too long"
    if story.get("packRef") is not None and not _is_text(story.get("packRef"), SOURCE_MAX):
        return "story.packRef is too long"
    if not isinstance(story.get("canonical"), bool):
        return "story.canonical must be a boolean"
    if not _is_number(story.get("createdAt")):
        return "story.createdAt must be a number"
    if story.get("quoteSource") not in (None, "free-text"):
        return 'story.quoteSource must be "free-text" when present'
    return None


def _utf8_len(text: str) -> int:
    return len(text.encode("utf-8", errors="surrogatepass"))


def _check_size(pack: dict) -> None:
    if _utf8_len(story_pack_json(pack)) > STORY_PACK_MAX_BYTES:
        raise StoryPackError("story/too-large", f"故事包超过 {STORY_PACK_MAX_BYTES} 字节上限")


# ── 构建 / 解析 ────────────────────────────────────────────────


def build_story_pack(
    story: dict,
    *,
    origin: str,
    source: str,
    license: str | None = None,
    persona: Any = None,
    character: Any = None,
    assets: dict | None = None,
    character_pack_id: str | None = None,
) -> dict:
    """构建一份故事包：剥剧透字段、补 `quoteSource`、写 manifest 版本串。

    入参不合法时抛 `StoryPackError`（API 层翻成 400 + `{code, message}`）。
    """
    if origin not in ORIGINS:
        raise StoryPackError("story/bad-shape", "origin 必须是 studio 或 love")
    if not _is_text(source, SOURCE_MAX):
        raise StoryPackError("story/bad-shape", "source 不能为空")

    error = _story_error(story)
    if error:
        raise StoryPackError("story/bad-shape", error)

    raw = dict(story)
    # Studio 的玩家输入都是自由输入：导出时打标记，主站才会保留逐字原话。
    has_quote = any(
        isinstance(choice, dict) and choice.get("quote") is not None
        for choice in raw.get("keyChoices") or []
    )
    if has_quote:
        raw["quoteSource"] = "free-text"

    ids = raw.get("characterPackIds") or []
    resolved_pack_id = character_pack_id
    if resolved_pack_id is None and len(ids) == 1:
        resolved_pack_id = ids[0]

    manifest: dict[str, Any] = {
        "version": STORY_PACK_MANIFEST_VERSION,
        "id": raw["id"],
        "origin": origin,
        "createdAt": raw["createdAt"],
        "source": source,
    }
    if license:
        manifest["license"] = license
    if resolved_pack_id:
        manifest["characterPackId"] = resolved_pack_id

    pack: dict[str, Any] = {
        "v": STORY_PACK_VERSION,
        "manifest": manifest,
        "story": strip_private_fields(raw),
    }
    if persona is not None:
        pack["persona"] = persona
    if character is not None:
        pack["character"] = strip_private_fields(character)
    if assets is not None:
        pack["assets"] = assets

    _check_size(pack)
    return pack


def parse_story_pack(raw: Any) -> dict:
    """校验一份故事包（接受 dict 或 JSON 字符串）。

    成功：`{ok: True, pack, warnings}`；失败：`{ok: False, code, message}`。
    未知键原样保留（round-trip 不丢）；剧透字段与无标记 quote 被剥掉并记 warning。
    """
    import json

    value = raw
    if isinstance(raw, (bytes, bytearray)):
        try:
            value = json.loads(raw.decode("utf-8"))
        except Exception:
            return _fail("story/bad-json", "故事包不是合法的 JSON")
    elif isinstance(raw, str):
        try:
            value = json.loads(raw)
        except Exception:
            return _fail("story/bad-json", "故事包不是合法的 JSON")

    if not isinstance(value, dict):
        return _fail("story/bad-shape", "故事包必须是一个对象")
    if value.get("v") != STORY_PACK_VERSION:
        return _fail("story/bad-version", f"故事包版本必须是 {STORY_PACK_VERSION}")

    warnings: list[str] = []
    story_raw = value.get("story")
    if not isinstance(story_raw, dict):
        return _fail("story/bad-shape", "故事包缺少 story 对象")

    # quote 过滤先于校验：quote 不是必填，去掉后按同一套规则验。
    story_copy = dict(story_raw)
    if story_copy.get("quoteSource") != "free-text":
        choices = story_copy.get("keyChoices")
        if isinstance(choices, list):
            next_choices = []
            for index, choice in enumerate(choices):
                if isinstance(choice, dict) and "quote" in choice:
                    copy = dict(choice)
                    copy.pop("quote", None)
                    next_choices.append(copy)
                    warnings.append(
                        f"story.keyChoices[{index}].quote dropped "
                        "(not marked quoteSource:free-text)"
                    )
                else:
                    next_choices.append(choice)
            story_copy["keyChoices"] = next_choices
        story_copy.pop("quoteSource", None)

    manifest_error = _manifest_error(value.get("manifest"))
    if manifest_error:
        return _fail("story/bad-shape", manifest_error)
    story_error = _story_error(story_copy)
    if story_error:
        return _fail("story/bad-shape", story_error)

    pack = dict(value)
    pack["story"] = _strip_with_warnings(story_copy, "story", warnings)
    if pack.get("character") is not None:
        pack["character"] = _strip_with_warnings(pack["character"], "character", warnings)
    assets = pack.get("assets")
    if assets is not None:
        if not isinstance(assets, dict):
            return _fail("story/bad-shape", "assets 必须是对象")
        for key, item in assets.items():
            if not _is_text(key, ID_MAX) or not isinstance(item, str):
                return _fail("story/bad-shape", "assets 的键与值都必须是字符串")
            if len(item) > MAX_ASSET_VALUE:
                return _fail("story/too-large", "assets 单个资产超出上限")

    if _utf8_len(story_pack_json(pack)) > STORY_PACK_MAX_BYTES:
        return _fail("story/too-large", f"故事包超过 {STORY_PACK_MAX_BYTES} 字节上限")
    return {"ok": True, "pack": pack, "warnings": warnings}


def story_pack_json(pack: dict) -> str:
    """稳定 JSON：递归键排序，同一内容总是同一段字节。"""
    return canonical_json(pack)


def story_pack_hash(pack: dict) -> str:
    return hashlib.sha256(story_pack_json(pack).encode("utf-8", errors="surrogatepass")).hexdigest()


def story_pack_file_name(pack: dict) -> str:
    """`socialcoach-story-{slug}-{hash前8}.json`，与主站同规则。"""
    story = pack.get("story") if isinstance(pack.get("story"), dict) else {}
    title = story.get("title") if isinstance(story.get("title"), dict) else {}
    text = (title.get("zh") or title.get("en") or story.get("id") or "story")
    base = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", str(text).lower()).strip("-")[:48]
    return f"socialcoach-story-{base or 'story'}-{story_pack_hash(pack)[:8]}.json"


def now_ms() -> int:
    import time

    return int(time.time() * 1000)
