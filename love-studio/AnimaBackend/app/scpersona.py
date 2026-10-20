"""`.scpersona` 打包格式与共享人设 schema 的 Python 侧契约（spec-love-persona §2、§4.2）。

与 `app/src/lib/love-persona.ts` / `love-persona-pack.ts` 保持逐字节一致：
cardHash、规范化 JSON、错误码字符串、上限、zip 成员布局全部对齐，跨系统可比对。

本模块只做纯逻辑，不碰数据库；API 层在 `app/api/scpersona.py`。

关键约定：
- `canonical_json` 递归按键名排序、数组保序、`null` 原样输出（不要丢掉）、字符串按
  JS `JSON.stringify` 规则转义、数字按 JS `String()` 规则格式化（`1e-7` 不是 `1e-07`）。
- `persona_card_for_hash` 剥掉 `revision` / `createdAt` / `updatedAt` 与顶层
  `tavern.cardHash`；cardHash = sha256(utf8(canonical_json(...))).hexdigest()。
- 未知字段原样保留：只校验已知必填字段与类型，绝不用 dataclass 归一化。
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import urllib.parse
import zipfile
from typing import Any

# ── 与 TS 对齐的常量 ──────────────────────────────────────────────

LOVE_PERSONA_VERSION = 1
"""单个本地化字符串的上限（§3「卡文本上限」）。超限拒绝而不是裁剪。"""
LOVE_PERSONA_TEXT_MAX = 20_000
LOVE_PERSONA_GREETINGS_MAX = 20
LOVE_PERSONA_ALIASES_MAX = 20
LOVE_PERSONA_STYLE_BLOCKS_MAX = 20
"""序列化后一份 Persona 的字节上限。"""
LOVE_PERSONA_SERIALIZED_MAX_BYTES = 4 * 1024 * 1024
"""单个 `.scpersona` 的字节上限。"""
LOVE_PERSONA_PACK_MAX_BYTES = 32 * 1024 * 1024
"""单个资产（解压后）的字节上限。"""
LOVE_PERSONA_ASSET_MAX_BYTES = 8 * 1024 * 1024

PACK_VERSION = LOVE_PERSONA_VERSION
MANIFEST = "manifest.json"
PERSONA_JSON = "persona.json"
WORLDBOOK = "worldbook.json"
STYLE = "style.json"
PORTRAITS_PREFIX = "assets/portraits/"
REFS_PREFIX = "assets/refs/"

PACK_MANIFEST_SOURCE = ("builtin", "tavern-import", "studio-generated", "love-created")
PERSONA_KIND = ("player", "npc")
PERSONA_LANGUAGE = ("zh", "en", "ja", "other")
PERSONA_VOICE_PROVIDER = ("device", "studio", "external")
TAVERN_SPEC = ("chara_card_v2", "chara_card_v3", "v1")

# 错误码集合：必须与 TS `LOVE_PERSONA_ERROR` 完全相同的字符串集合（§4.2「单一契约」）。
LOVE_PERSONA_ERROR = {
    "badJson": "persona/bad-json",
    "badShape": "persona/bad-shape",
    "badVersion": "persona/bad-version",
    "textTooLong": "persona/text-too-long",
    "tooLarge": "persona/too-large",
    "assetTooLarge": "persona/asset-too-large",
    "assetBudget": "persona/asset-budget",
    "unsupported": "persona/unsupported",
    "packUnreadable": "persona/pack-unreadable",
    "packMissing": "persona/pack-missing",
    "packManifest": "persona/pack-manifest",
    "packHash": "persona/pack-hash",
    "packTooLarge": "persona/pack-too-large",
}

_ZIP_MAGIC = (0x50, 0x4B)
_ZIP_LOCAL_OR_EMPTY = (0x03, 0x05, 0x07)

# ── 规范化 JSON（cardHash 的确定性来源，与 TS canonicalJson 逐字节一致）──


def _json_string(value: str) -> str:
    """JS `JSON.stringify` 对单个字符串的转义规则：非 ASCII 原样、控制字符短转义、
    `"` / `\\` 转义、`/` 不转义；孤立代理按 `\\uXXXX` 输出（合法代理对原样保留）。"""
    out = ['"']
    i = 0
    n = len(value)
    while i < n:
        ch = value[i]
        o = ord(ch)
        if 0xD800 <= o <= 0xDBFF and i + 1 < n:
            o2 = ord(value[i + 1])
            if 0xDC00 <= o2 <= 0xDFFF:
                cp = 0x10000 + ((o - 0xD800) << 10) + (o2 - 0xDC00)
                out.append(chr(cp))
                i += 2
                continue
            out.append("\\u%04x" % o)
            i += 1
            continue
        if 0xDC00 <= o <= 0xDFFF:
            out.append("\\u%04x" % o)
            i += 1
            continue
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\r":
            out.append("\\r")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
        i += 1
    out.append('"')
    return "".join(out)


def _format_float(value: float) -> str:
    """按 ECMA-262 ToString 规则格式化一个有限 float（阈值 1e21 / 1e-6，`1e-7` 不带前导零）。"""
    neg = False
    digits_str = repr(value)
    if digits_str.startswith("-"):
        neg = True
        digits_str = digits_str[1:]
    mantissa, _, exp_part = digits_str.partition("e")
    int_part, _, frac_part = mantissa.partition(".")
    digits = (int_part + frac_part).lstrip("0") or "0"
    if digits == "0":
        return "-0.0" if neg else "0"
    k = len(digits)
    exp = int(exp_part) if exp_part else 0
    # ECMA ToString 表示：value = s × 10^(n-k)，n 是「第一位在小数点前的位数」
    n = exp - len(frac_part) + k
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        body = "0." + "0" * (-n) + digits
    else:
        sci_exp = n - 1
        coeff = digits if k == 1 else digits[0] + "." + digits[1:]
        sign = "+" if sci_exp >= 0 else "-"
        body = "%se%s%d" % (coeff, sign, abs(sci_exp))
    return "-" + body if neg else body


def _number_string(value: float | int) -> str:
    """JS `String(number)` 的格式。int 在 2^53 以内直接 str；超过的按 double 舍入
    （JS 所有 number 都是 double），float 走 ECMA-262 ToString。"""
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            # canonicalJson 对非有限数输出 null（TS: Number.isFinite ? String : "null"）
            return "null"
        # JS String(-0) === "0"
        if value == 0:
            return "0"
        if value.is_integer() and abs(value) < 1e21:
            return str(int(value))
        return _format_float(value)
    if abs(value) < 2**53:
        return str(value)
    try:
        rounded = float(value)
    except OverflowError:
        return "null"
    if rounded in (float("inf"), float("-inf")):
        return "null"
    return _number_string(rounded)


def canonical_json(value: Any) -> str:
    """规范化 JSON：递归按键名排序、数组保序、`null`/`undefined` 输出 `null`。
    Python 里缺失键本来就不存在（不要把 JSON null 当 undefined 丢掉）。"""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _number_string(value)
    if isinstance(value, str):
        return _json_string(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        return "{" + ",".join(_json_string(k) + ":" + canonical_json(value[k]) for k in keys) + "}"
    return "null"


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def persona_card_for_hash(persona: dict) -> dict:
    """参与 cardHash 的「卡」：剥掉易变的元数据（`revision`、时间戳和派生的
    `tavern.cardHash`）。卡内容不变 → hash 不变。"""
    clone = dict(persona)
    for key in ("revision", "createdAt", "updatedAt"):
        clone.pop(key, None)
    tavern = clone.get("tavern")
    if isinstance(tavern, dict):
        t = dict(tavern)
        t.pop("cardHash", None)
        clone["tavern"] = t
    return clone


def compute_card_hash(persona: dict) -> str:
    """规范化 JSON → sha256 hex。确定性、可跨系统比对（§2.1 manifest.cardHash）。"""
    return _sha256_hex(canonical_json(persona_card_for_hash(persona)).encode("utf-8"))


def strip_private_constraints(persona: dict) -> dict:
    """剥掉私有约束，只留可公开导出的字段。只剥明确私有的 `secret`；
    剥完 `storyConstraints` 为空就把整个键删掉。"""
    sc = persona.get("storyConstraints")
    if not isinstance(sc, dict) or "secret" not in sc:
        return persona
    remaining = {k: v for k, v in sc.items() if k != "secret"}
    next_persona = dict(persona)
    if remaining:
        next_persona["storyConstraints"] = remaining
    else:
        next_persona.pop("storyConstraints", None)
    return next_persona


# ── Persona 形状校验（保留原始 dict，未知字段原样穿过；只查必填与类型）──

_LOCALE_FIELDS = ("name", "bio", "personality", "goals", "boundaries", "preferences", "speechStyle", "role")


def _check_loc_text(value: Any) -> str | None:
    """本地化字符串 `{zh, en}`：缺字段 / 类型错 → badShape；超长 → textTooLong。"""
    if not isinstance(value, dict) or not isinstance(value.get("zh"), str) or not isinstance(value.get("en"), str):
        return "persona/bad-shape"
    for lang in ("zh", "en"):
        if len(value[lang]) > LOVE_PERSONA_TEXT_MAX:
            return "persona/text-too-long"
    return None


def _check_long_text_list(value: Any, max_items: int, max_len: int) -> str | None:
    """TL 字符串数组：类型错 → badShape；超条数 / 单条超长 → textTooLong。"""
    if not isinstance(value, list):
        return "persona/bad-shape"
    if len(value) > max_items:
        return "persona/text-too-long"
    for item in value:
        if not isinstance(item, str):
            return "persona/bad-shape"
        if len(item) > max_len:
            return "persona/text-too-long"
    return None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_persona(value: Any) -> dict | None:
    """校验一份 Persona 的必填字段与类型。ok → None；出错 → `{ok: False, code, detail}`。
    未知字段不校验、不丢弃。"""
    if not isinstance(value, dict):
        return _err(LOVE_PERSONA_ERROR["badShape"], "not an object")

    v = value.get("v")
    if not _is_number(v):
        return _err(LOVE_PERSONA_ERROR["badShape"], "missing or bad v")
    if v != LOVE_PERSONA_VERSION:
        # 未来版本是「不是坏数据」，不和形状错误混为一谈（§5 版本兼容）
        return _err(LOVE_PERSONA_ERROR["badVersion"], "v=%s" % v)

    def bad(detail: str) -> dict:
        return _err(LOVE_PERSONA_ERROR["badShape"], detail)

    # 必填：id / revision / kind / name / source / createdAt / updatedAt
    if not isinstance(value.get("id"), str) or not (1 <= len(value["id"]) <= 100):
        return bad("id")
    if not _is_number(value.get("revision")) or not float(value["revision"]).is_integer() or value["revision"] < 0:
        return bad("revision")
    if value.get("kind") not in PERSONA_KIND:
        return bad("kind")
    loc = _check_loc_text(value.get("name"))
    if loc is not None:
        return _err(loc, "name")
    if value.get("source") not in PACK_MANIFEST_SOURCE:
        return bad("source")
    if not _is_number(value.get("createdAt")) or not _is_number(value.get("updatedAt")):
        return bad("createdAt/updatedAt")

    # 可选：类型粒度校验
    if "characterPackId" in value and not (isinstance(value["characterPackId"], str) and len(value["characterPackId"]) <= 100):
        return bad("characterPackId")
    if "aliases" in value:
        r = _check_long_text_list(value["aliases"], LOVE_PERSONA_ALIASES_MAX, 120)
        if r is not None:
            return _err(r, "aliases")
    if "language" in value and value["language"] not in PERSONA_LANGUAGE:
        return bad("language")
    for field in _LOCALE_FIELDS:
        if field in value:
            r = _check_loc_text(value[field])
            if r is not None:
                return _err(r, field)
    if "greetings" in value:
        items = value["greetings"]
        if not isinstance(items, list) or len(items) > LOVE_PERSONA_GREETINGS_MAX:
            return _err(LOVE_PERSONA_ERROR["textTooLong"] if isinstance(items, list) else LOVE_PERSONA_ERROR["badShape"], "greetings")
        for g in items:
            r = _check_loc_text(g)
            if r is not None:
                return _err(r, "greetings")
    if "characterKey" in value and not (isinstance(value["characterKey"], str) and len(value["characterKey"]) <= 200):
        return bad("characterKey")
    if "license" in value and not (isinstance(value["license"], str) and len(value["license"]) <= 400):
        return bad("license")
    if "appearance" in value and not isinstance(value["appearance"], dict):
        return bad("appearance")
    if "voice" in value and not isinstance(value["voice"], dict):
        return bad("voice")
    if "storyConstraints" in value and not isinstance(value["storyConstraints"], dict):
        return bad("storyConstraints")
    if "tavern" in value and not isinstance(value["tavern"], dict):
        return bad("tavern")
    if "assets" in value and not isinstance(value["assets"], dict):
        return bad("assets")

    # 序列化上限（§3「文件大小上限」）
    if _utf8_len(json.dumps(value, ensure_ascii=False)) > LOVE_PERSONA_SERIALIZED_MAX_BYTES:
        return _err(LOVE_PERSONA_ERROR["tooLarge"])
    return None


def _utf8_len(text: str) -> int:
    return len(text.encode("utf-8", errors="surrogatepass"))


# ── 资产解码 ─────────────────────────────────────────────────────


def _try_b64(encoded: str) -> bytes | None:
    """近似 `atob`：空串合法；长度对不上 4 的倍数或带非法字符就不认。"""
    if not encoded:
        return b""
    if len(encoded) % 4 != 0:
        return None
    if not re.match(r"[A-Za-z0-9+/]*={0,2}\Z", encoded):
        return None
    try:
        return base64.b64decode(encoded)
    except Exception:
        return None


def _decode_asset(value: Any) -> dict:
    """`data:<mime>[;base64],<payload>`（或裸 base64）→ `{bytes, mime}`。
    解不开就退回 UTF-8 文本；非 base64 的 data URL 走 percent-解码。"""
    if isinstance(value, str) and value.startswith("data:") and "," in value:
        meta, payload = value[5:].split(",", 1)
        mime = meta.split(";", 1)[0] or "application/octet-stream"
        if ";base64" in meta:
            decoded = _try_b64(payload)
            if decoded is not None:
                return {"bytes": decoded, "mime": mime}
            # 坏 base64：和 TS 一样落到整体按文本处理
        else:
            try:
                return {"bytes": urllib.parse.unquote_to_bytes(payload), "mime": mime}
            except Exception:
                pass
    if isinstance(value, str):
        decoded = _try_b64(value)
        if decoded is not None:
            return {"bytes": decoded, "mime": "application/octet-stream"}
        return {"bytes": value.encode("utf-8"), "mime": "application/octet-stream"}
    return {"bytes": str(value).encode("utf-8"), "mime": "application/octet-stream"}


def _sanitize_asset_id(asset_id: Any) -> str | None:
    if not isinstance(asset_id, str) or not asset_id:
        return None
    if "/" in asset_id or "\\" in asset_id or ".." in asset_id:
        return None
    return asset_id


# ── 结果形状 ─────────────────────────────────────────────────────


def _err(code: str, detail: str = "") -> dict:
    return {"ok": False, "code": code, "detail": detail}


def is_persona_pack_bytes(data: bytes) -> bool:
    return len(data) >= 4 and data[0] == _ZIP_MAGIC[0] and data[1] == _ZIP_MAGIC[1] and data[2] in _ZIP_LOCAL_OR_EMPTY


# ── 读 / 写 ──────────────────────────────────────────────────────


def read_persona_pack(data: bytes) -> dict:
    """读 `.scpersona`：校验 schema、版本、cardHash 与资产哈希；未知字段靠 loose 语义保留。
    返回 `{"ok": True, "pack": {...}}` 或 `{"ok": False, "code": ..., "detail": ...}`。"""
    if not is_persona_pack_bytes(data):
        return _err(LOVE_PERSONA_ERROR["packUnreadable"], "not a zip")
    if len(data) > LOVE_PERSONA_PACK_MAX_BYTES:
        return _err(LOVE_PERSONA_ERROR["packTooLarge"])

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except Exception:
        return _err(LOVE_PERSONA_ERROR["packUnreadable"])

    with zf:
        try:
            infos = zf.infolist()
        except Exception:
            return _err(LOVE_PERSONA_ERROR["packUnreadable"])
        # 防 zip 炸弹：解压前的成员大小就超上限的按包过大算
        for info in infos:
            if info.file_size > LOVE_PERSONA_PACK_MAX_BYTES:
                return _err(LOVE_PERSONA_ERROR["packTooLarge"])

        def read_json(name: str) -> Any | None:
            try:
                return json.loads(zf.read(name).decode("utf-8"))
            except Exception:
                return None

        manifest_raw = read_json(MANIFEST)
        if manifest_raw is None:
            return _err(LOVE_PERSONA_ERROR["packMissing"], MANIFEST)
        manifest = manifest_raw
        if not isinstance(manifest, dict) or not isinstance(manifest.get("id"), str) or not _is_number(manifest.get("revision")):
            return _err(LOVE_PERSONA_ERROR["packManifest"])
        if not isinstance(manifest.get("cardHash"), str) or manifest.get("source") not in PACK_MANIFEST_SOURCE or not _is_number(manifest.get("version")):
            return _err(LOVE_PERSONA_ERROR["packManifest"])
        if manifest["version"] != PACK_VERSION:
            # 未来版本单独报 bad-version：和「打包坏了」不是一回事（§5 版本兼容）
            return _err(LOVE_PERSONA_ERROR["badVersion"], "pack v%s" % manifest["version"])

        persona_raw = read_json(PERSONA_JSON)
        if persona_raw is None:
            return _err(LOVE_PERSONA_ERROR["packMissing"], PERSONA_JSON)
        shape_error = _validate_persona(persona_raw)
        if shape_error is not None:
            return shape_error
        persona = persona_raw

        if compute_card_hash(persona) != manifest["cardHash"]:
            return _err(LOVE_PERSONA_ERROR["packHash"], "card hash")

        assets: dict[str, dict[str, str]] = {}
        for ref in (manifest.get("assets") or {}).values():
            if (
                not isinstance(ref, dict)
                or not isinstance(ref.get("path"), str)
                or not isinstance(ref.get("hash"), str)
                or not _is_number(ref.get("size"))
            ):
                return _err(LOVE_PERSONA_ERROR["packManifest"], "asset ref")
            try:
                asset_bytes = zf.read(ref["path"])
            except KeyError:
                return _err(LOVE_PERSONA_ERROR["packMissing"], ref["path"])
            if _sha256_hex(asset_bytes) != ref["hash"] or len(asset_bytes) != ref["size"]:
                return _err(LOVE_PERSONA_ERROR["packHash"], ref["path"])
            mime = ref.get("mime") or "application/octet-stream"
            data_url = "data:%s;base64,%s" % (mime, base64.b64encode(asset_bytes).decode("ascii"))
            if ref["path"].startswith(PORTRAITS_PREFIX):
                assets.setdefault("portraits", {})[ref["path"][len(PORTRAITS_PREFIX):]] = data_url
            elif ref["path"].startswith(REFS_PREFIX):
                assets.setdefault("refs", {})[ref["path"][len(REFS_PREFIX):]] = data_url

        pack: dict[str, Any] = {"manifest": manifest, "persona": persona}
        worldbook = read_json(WORLDBOOK)
        if worldbook is not None:
            pack["worldbook"] = worldbook
        style = read_json(STYLE)
        if style is not None:
            pack["style"] = style
        if assets:
            pack["assets"] = assets
        return {"ok": True, "pack": pack}


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def build_persona_pack(
    persona: dict,
    public_only: bool = False,
    worldbook: Any = None,
    style: Any = None,
    assets: dict | None = None,
    source: str | None = None,
    license: str | None = None,
) -> dict:
    """打包一份 Persona。cardHash 由规范化 JSON 决定：先置 `tavern.cardHash=""` 再算，
    算完写回。资产 data URL 解码成二进制入 zip。zip 用 deflate；超限报对应错误码。"""
    base = strip_private_constraints(persona) if public_only else persona
    card = dict(base)
    if isinstance(card.get("tavern"), dict):
        card["tavern"] = {**card["tavern"], "cardHash": ""}
    card_hash = compute_card_hash(card)
    if isinstance(card.get("tavern"), dict):
        card["tavern"] = {**card["tavern"], "cardHash": card_hash}

    shape_error = _validate_persona(card)
    if shape_error is not None:
        return shape_error
    out = card

    manifest: dict[str, Any] = {
        "version": PACK_VERSION,
        "id": out["id"],
        "revision": out["revision"],
        "cardHash": card_hash,
        "source": source or out.get("source"),
    }
    effective_license = license or out.get("license")
    if effective_license:
        manifest["license"] = effective_license

    entries: dict[str, bytes] = {PERSONA_JSON: _json_bytes(out)}
    if worldbook is not None:
        entries[WORLDBOOK] = _json_bytes(worldbook)
    if style is not None:
        entries[STYLE] = _json_bytes(style)

    refs: dict[str, dict[str, Any]] = {}
    for group, prefix in (("portraits", PORTRAITS_PREFIX), ("refs", REFS_PREFIX)):
        group_assets = (assets or {}).get(group)
        if not isinstance(group_assets, dict):
            continue
        for asset_id, value in group_assets.items():
            safe = _sanitize_asset_id(asset_id)
            if safe is None:
                return _err(LOVE_PERSONA_ERROR["badShape"], "bad asset id: %s" % asset_id)
            decoded = _decode_asset(value)
            if len(decoded["bytes"]) > LOVE_PERSONA_ASSET_MAX_BYTES:
                return _err(LOVE_PERSONA_ERROR["assetTooLarge"], asset_id)
            path = prefix + safe
            entries[path] = decoded["bytes"]
            refs[path] = {
                "path": path,
                "hash": _sha256_hex(decoded["bytes"]),
                "size": len(decoded["bytes"]),
                "mime": decoded["mime"],
            }
    if refs:
        manifest["assets"] = refs

    entries[MANIFEST] = _json_bytes(manifest)

    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, content in entries.items():
                zf.writestr(name, content)
    except Exception:
        return _err(LOVE_PERSONA_ERROR["packUnreadable"])
    bytes_out = buf.getvalue()
    if len(bytes_out) > LOVE_PERSONA_PACK_MAX_BYTES:
        return _err(LOVE_PERSONA_ERROR["packTooLarge"])
    return {"ok": True, "bytes": bytes_out, "manifest": manifest}