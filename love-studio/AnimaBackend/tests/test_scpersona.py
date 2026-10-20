"""`.scpersona` 的跨语言契约测试：与 `app/src/lib/love-persona` 共用同一批 fixtures。

fixtures 路径锚定到仓库根的 `app/tests/fixtures/love-persona/`（Love Studio fork 的测试
就按这个相对路径读），**不改写 fixtures 字节**。验证机：canonical_json 与 TS 逐字节一致、
未知字段原样保留、public-only 剥 secret、未来版本拒收、资产篡改拒收、API 全链路。
"""

import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app import scpersona

FIXTURES = Path(__file__).resolve().parents[3] / "app" / "tests" / "fixtures" / "love-persona"

WITH_UNKNOWN = "with-unknown.scpersona"
FUTURE = "future.scpersona"
# with-unknown.scpersona 的 manifest.cardHash —— TS 侧钉死的契约值，跨语言必须一致
EXPECTED_HASH = "19f9dd381396411bbac46d4d2e08fbf32b39acbde7b6f4006a2c9d027ef768d6"


def _fixture(name: str) -> bytes:
    path = FIXTURES / name
    assert path.is_file(), f"fixture 缺失: {path}"
    return path.read_bytes()


def _read(data: bytes) -> dict:
    result = scpersona.read_persona_pack(data)
    assert result["ok"], result
    return result["pack"]


# ── canonical_json：JS 兼容的数字 / 转义 ─────────────────────────────


def test_canonical_json_matches_js_number_rules():
    cj = scpersona.canonical_json
    # 整数直接 str；整数型 float（|x| < 1e21）去掉 .0
    assert cj(1) == "1"
    assert cj(1.0) == "1"
    assert cj(2.0) == "2"
    assert cj(123456789) == "123456789"
    assert cj(1e20) == "100000000000000000000"
    # 阈值这里进指数形式，JS 风格（1e-7 不是 1e-07）
    assert cj(1e21) == "1e+21"
    assert cj(1e-7) == "1e-7"
    assert cj(1.5e-8) == "1.5e-8"
    assert cj(-1.5e-8) == "-1.5e-8"
    # 1e-6 还在小数形式
    assert cj(0.000001) == "0.000001"
    # 非整数 float 尾数
    assert cj(0.5) == "0.5"
    assert cj(2.5) == "2.5"
    assert cj(-0.5) == "-0.5"
    assert cj(1.2345e17) == "123450000000000000"
    # 超过 2^53 的整数按 double 舍入（JS 所有 number 都是 double）
    assert cj(9007199254740993) == "9007199254740992"
    assert cj(10**21) == "1e+21"
    # 非有限数 → null
    assert cj(float("nan")) == "null"
    assert cj(float("inf")) == "null"


def test_canonical_json_matches_js_string_escaping():
    cj = scpersona.canonical_json
    assert cj("a\"b\\c") == r'"a\"b\\c"'
    assert cj("a\nb\tc\x01\u001f") == r'"a\nb\tc\u0001\u001f"'
    assert cj("\b\f\r") == r'"\b\f\r"'
    # 非 ASCII 原样、/ 不转义
    assert cj("猫") == '"猫"'
    assert cj("a/b") == '"a/b"'
    # null / 数组保序 / 对象键排序 / null 值保留
    assert cj(None) == "null"
    assert cj(True) == "true"
    assert cj(False) == "false"
    assert cj([1, 2, 3]) == "[1,2,3]"
    assert cj({"b": 1, "a": 2}) == '{"a":2,"b":1}'
    assert cj({"a": None, "b": 1}) == '{"a":null,"b":1}'
    assert cj({"a": [3, {"c": None, "b": 2}]}) == '{"a":[3,{"b":2,"c":null}]}'


# ── 契约 fixtures ────────────────────────────────────────────────────


def test_with_unknown_roundtrip_preserves_unknown_fields():
    assert FIXTURES.is_dir(), f"fixtures 目录不存在: {FIXTURES}"
    pack = _read(_fixture(WITH_UNKNOWN))
    persona = pack["persona"]
    manifest = pack["manifest"]

    # cardHash 三处一致，且等于 TS 钉死的契约值
    assert scpersona.compute_card_hash(persona) == manifest["cardHash"]
    assert persona["tavern"]["cardHash"] == manifest["cardHash"]
    assert manifest["cardHash"] == EXPECTED_HASH

    # 未知顶层 / 嵌套字段在
    assert persona["x_custom"] == {"note": "keep me", "n": 7}
    assert persona["personality_extra"] == ["a", "b"]
    assert persona["storyConstraints"]["secret"]["zh"] == "她其实是你妹妹的朋友。"
    assert persona["tavern"]["raw"] == {"description": "raw orig", "extensions": {"unknown_key": "keep"}}
    assert persona["tavern"]["sourceFile"] == "linqian.png"

    # worldbook / style / assets 都在
    assert pack["worldbook"] == [{"keys": ["展"], "content": "她在这家画廊做过志愿。"}]
    assert pack["style"] == {"blocks": ["第一人称、短句"], "temperature": 0.8}
    avatar_url = pack["assets"]["portraits"]["smile"]
    assert avatar_url.startswith("data:image/png;base64,")
    assert pack["manifest"]["assets"]["assets/portraits/smile"]["size"] == 70

    # read → build → read：未知字段不丢、内容一变都不变
    built = scpersona.build_persona_pack(
        persona,
        worldbook=pack.get("worldbook"),
        style=pack.get("style"),
        assets=pack.get("assets"),
        source=manifest.get("source"),
        license=manifest.get("license"),
    )
    again = _read(built["bytes"])
    p2 = again["persona"]
    assert p2["x_custom"] == persona["x_custom"]
    assert p2["personality_extra"] == persona["personality_extra"]
    assert p2["storyConstraints"] == persona["storyConstraints"]
    assert p2["tavern"]["raw"] == persona["tavern"]["raw"]
    assert again["assets"] == pack["assets"]
    # 内容没动 → hash 和原包一致
    assert scpersona.compute_card_hash(p2) == EXPECTED_HASH
    assert built["manifest"]["cardHash"] == EXPECTED_HASH


def test_public_only_strips_secret_and_keeps_rest():
    persona = _read(_fixture(WITH_UNKNOWN))["persona"]

    stripped = scpersona.strip_private_constraints(persona)
    for key in persona:
        if key == "storyConstraints":
            continue
        assert stripped[key] == persona[key]
    # fixture 里 storyConstraints 只有 secret → 整个键删掉
    assert "storyConstraints" not in stripped

    build = scpersona.build_persona_pack(persona, public_only=True, assets=_read(_fixture(WITH_UNKNOWN)).get("assets"))
    reread = _read(build["bytes"])
    exported = reread["persona"]
    assert "secret" not in exported.get("storyConstraints", {})
    assert "storyConstraints" not in exported
    for key in persona:
        if key == "storyConstraints":
            continue
        if key == "tavern":
            # 重建后 tavern.cardHash 是按剥 secret 后的内容重算的（本就不该一样），
            # 其余字段照旧
            tavern_exported = {k: v for k, v in exported["tavern"].items() if k != "cardHash"}
            tavern_original = {k: v for k, v in persona["tavern"].items() if k != "cardHash"}
            assert tavern_exported == tavern_original
            continue
        assert exported[key] == persona[key]


def test_future_pack_is_bad_version():
    result = scpersona.read_persona_pack(_fixture(FUTURE))
    assert not result["ok"]
    assert result["code"] == scpersona.LOVE_PERSONA_ERROR["badVersion"]


def test_tampered_asset_bytes_fail_hash():
    data = _fixture(WITH_UNKNOWN)
    # 重打包：asset 字节改一个，manifest 原样（persona 没动，cardHash 仍过）
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as zin:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
            for name in zin.namelist():
                content = zin.read(name)
                if name == "assets/portraits/smile":
                    content = content + b"\x00"
                zout.writestr(name, content)
    result = scpersona.read_persona_pack(buf.getvalue())
    assert not result["ok"]
    assert result["code"] == scpersona.LOVE_PERSONA_ERROR["packHash"]


# ── API 全链路 ───────────────────────────────────────────────────────


def _post_scpersona(client: TestClient, path: str, data: bytes, name: str = "card.scpersona"):
    return client.post(path, files={"file": (name, data, "application/zip")})


def test_api_inspect_import_export_roundtrip(client: TestClient):
    data = _fixture(WITH_UNKNOWN)

    # inspect：cardHash 正确、未知字段在、notices 空
    r = _post_scpersona(client, "/api/scpersona/inspect", data)
    assert r.status_code == 200
    body = r.json()
    assert body["manifest"]["cardHash"] == EXPECTED_HASH
    assert body["persona"]["x_custom"]["note"] == "keep me"
    assert body["persona"]["personality_extra"] == ["a", "b"]
    assert body["persona"]["tavern"]["raw"]["extensions"]["unknown_key"] == "keep"
    assert body["notices"] == []
    assert body["assets"]["portraits"]["smile"].startswith("data:image/png;base64,")

    # import：建卡、字段映射、未知字段落到 extensions.studio_scpersona.persona
    r = _post_scpersona(client, "/api/scpersona/import", data)
    assert r.status_code == 200
    imported = r.json()
    card_id = imported["card_id"]
    card = client.get(f"/api/tavern/cards/{card_id}").json()
    assert card["name"] == "林浅"
    assert card["description"] == "喜欢猫的插画师。"
    assert card["personality"] == "慢热，但一旦信任就很直接。"
    assert card["first_mes"] == "……你也来看这场展？"
    assert card["alternate_greetings"] == []
    # worldbook list → {"entries": [...]}
    assert card["character_book"] == {"entries": [{"keys": ["展"], "content": "她在这家画廊做过志愿。"}]}
    # 头像 = portraits 里第一个
    assert card["has_avatar"] is True
    avatar = client.get(f"/api/tavern/cards/{card_id}/avatar").text
    assert avatar == body["assets"]["portraits"]["smile"]
    studio = card["extensions"]["studio_scpersona"]
    assert studio["id"] == "persona-unknown-1"
    assert studio["cardHash"] == EXPECTED_HASH
    assert studio["license"] == "CC-BY-4.0"
    # tavern.raw.extensions 平铺合并 + 未知字段保留
    assert card["extensions"]["unknown_key"] == "keep"
    assert studio["persona"]["x_custom"] == {"note": "keep me", "n": 7}
    assert studio["persona"]["tavern"]["raw"]["extensions"]["unknown_key"] == "keep"

    # 同名不静默覆盖：再导一次是另一张卡
    r = _post_scpersona(client, "/api/scpersona/import", data)
    assert r.status_code == 200
    assert r.json()["card_id"] != card_id
    names = [c["name"] for c in client.get("/api/tavern/cards").json()]
    assert names.count("林浅") == 2

    # export → 再 inspect：仍是合法包、hash 自洽、未知字段带回、卡上字段覆盖
    r = client.get(f"/api/scpersona/export/{card_id}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/zip")
    assert "scpersona" in r.headers["content-disposition"]
    ebody = _post_scpersona(client, "/api/scpersona/inspect", r.content).json()
    assert scpersona.compute_card_hash(ebody["persona"]) == ebody["manifest"]["cardHash"]
    assert ebody["persona"]["tavern"]["cardHash"] == ebody["manifest"]["cardHash"]
    assert ebody["persona"]["x_custom"]["note"] == "keep me"
    assert ebody["persona"]["personality_extra"] == ["a", "b"]
    assert ebody["persona"]["source"] == "studio-generated"
    assert ebody["manifest"]["source"] == "studio-generated"
    assert ebody["persona"]["license"] == "CC-BY-4.0"
    assert ebody["persona"]["name"]["zh"] == "林浅"
    assert ebody["persona"]["greetings"][0]["zh"] == "……你也来看这场展？"
    # worldbook 从 character_book 原样带回（dict 原样）
    assert ebody["worldbook"] == {"entries": [{"keys": ["展"], "content": "她在这家画廊做过志愿。"}]}
    # 头像仍在（assets/portraits/avatar）
    assert ebody["assets"]["portraits"]["avatar"] == avatar
    # 完整导出带 secret
    assert ebody["persona"]["storyConstraints"]["secret"]["zh"] == "她其实是你妹妹的朋友。"

    # public_only=1：没有 secret，其余不变
    r = client.get(f"/api/scpersona/export/{card_id}?public_only=1")
    pbody = _post_scpersona(client, "/api/scpersona/inspect", r.content).json()
    assert "secret" not in pbody["persona"].get("storyConstraints", {})
    assert "storyConstraints" not in pbody["persona"]
    assert scpersona.compute_card_hash(pbody["persona"]) == pbody["manifest"]["cardHash"]
    assert pbody["persona"]["x_custom"]["note"] == "keep me"


def test_api_errors_are_structured(client: TestClient):
    # 坏 zip → 400 + {"code", "message"}
    r = client.post("/api/scpersona/inspect", files={"file": ("bad.scpersona", b"not a zip", "application/zip")})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail["code"] == scpersona.LOVE_PERSONA_ERROR["packUnreadable"]
    assert isinstance(detail["message"], str) and detail["message"]

    # 原生卡（没有 studio_scpersona）也能导出：按 Tavern 字段反推 Persona
    made = client.post(
        "/api/tavern/cards",
        json={"name": "普通卡", "description": "普通简介", "personality": "安静", "extensions": {}},
    )
    assert made.status_code == 200
    r = client.get(f"/api/scpersona/export/{made.json()['id']}")
    assert r.status_code == 200
    native = _post_scpersona(client, "/api/scpersona/inspect", r.content).json()
    assert native["persona"]["name"]["zh"] == "普通卡"
    assert native["persona"]["bio"]["zh"] == "普通简介"
    assert native["persona"]["source"] == "studio-generated"
    assert scpersona.compute_card_hash(native["persona"]) == native["manifest"]["cardHash"]

    # 导出不存在的卡 → 404
    r = client.get("/api/scpersona/export/no-such-card")
    assert r.status_code == 404


def test_canonical_json_stable_across_key_order():
    # 同一份数据不同键序 ⇒ 同一段规范化字节 ⇒ 同一个 hash（与 TS 同口径）
    a = {"v": 1, "name": {"zh": "甲", "en": "甲"}, "revision": 1, "createdAt": 5, "updatedAt": 6, "x": {"b": 1, "a": 2}}
    b = {"x": {"a": 2, "b": 1}, "updatedAt": 6, "createdAt": 5, "revision": 1, "name": {"en": "甲", "zh": "甲"}, "v": 1}
    assert scpersona.canonical_json(a) == scpersona.canonical_json(b)
    assert scpersona.compute_card_hash(a) == scpersona.compute_card_hash(b)