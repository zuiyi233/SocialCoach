"""PNG 卡导出(spec-love-user-cards §3)。

app/importer/png_card.py 把 V2 JSON 写回 PNG 的 tEXt `chara` 块(base64),保留原图像素;
没有原图时用纯色 + 角色名占位图。这里锁死两条契约:
1. 往返:write_card_into_png → 现有导入器 parse_card → name/first_mes/description 不变。
2. 主站对齐:keyword 必须是 `chara`,内容是标准 `{"spec":"chara_card_v2","data":{...}}`。
   (主站 love-card.ts 的解析器按这个读,不要改成别的 keyword。)
端点 POST /api/tavern/cards/{id}/export/png 走同一条路,另外验证传头像时像素保留。
"""

import base64
import json
import struct

from app.importer.cards import parse_card, png_text
from app.importer.png_card import write_card_into_png

# 从对拍夹具借 PNG 构造工具:1×1 PNG,能把 tEXt 块(照酒馆写法)塞进 IEND 前面
from tests.fixtures.cards.make_cards import png

V2_DATA = {
    "name": "刻晴",
    "description": "璃月七星之一的玉衡星。",
    "personality": "干练、对自己的理念十分坚持",
    "scenario": "璃月港,夜里。",
    "first_mes": "旅行者,这么晚了还在外面闲逛?",
    "mes_example": "乐……你今天的兴致很高呀。",
    "creator_notes": "",
    "alternate_greetings": ["玉衡星在此。"],
    "tags": ["璃月", "七神"],
    "creator": "测试",
    "character_book": None,
    "extensions": {},
}


def v2(name: str = "刻晴", **overrides) -> str:
    data = {**V2_DATA, "name": name, **overrides}
    return json.dumps({"spec": "chara_card_v2", "spec_version": "2.0", "data": data}, ensure_ascii=False)


# ---------------------------------------------------------------- png_card 模块


def test_roundtrip_keeps_name_first_mes_description():
    payload = v2(name="魈", first_mes="层岩巨渊的暗处,也时有妖邪出没。", description="降魔大圣,守护璃月的夜叉。")
    out = write_card_into_png(None, payload, "魈")
    parsed = parse_card(out)
    assert isinstance(parsed, dict)
    assert parsed["name"] == "魈"
    assert parsed["first_mes"] == "层岩巨渊的暗处,也时有妖邪出没。"
    assert parsed["description"] == "降魔大圣,守护璃月的夜叉。"


def test_roundtrip_keeps_worldbook_and_spec(client):
    payload = json.dumps(
        {
            "spec": "chara_card_v2",
            "spec_version": "2.0",
            "data": {
                **V2_DATA,
                "name": "带世界书",
                "first_mes": "开场",
                "description": "人设",
                "character_book": {
                    "name": "卷",
                    "entries": [
                        {"id": 1, "keys": ["刻晴"], "content": "玉衡星。", "enabled": True, "insertion_order": 100}
                    ],
                },
            },
        },
        ensure_ascii=False,
    )
    parsed = parse_card(write_card_into_png(None, payload, "带世界书"))
    assert parsed["character_book"]["entries"][0]["content"] == "玉衡星。"
    assert parsed["spec"] == "chara_card_v2"


def test_keyword_is_chara_and_content_is_v2_json():
    payload = v2(first_mes="你好", description="人设")
    out = write_card_into_png(None, payload, "刻晴")
    chunks = png_text(out)
    assert "chara" in chunks, chunks
    # 内容 = 标准 base64 → 一解就是上面那份 V2 JSON
    decoded = base64.b64decode(chunks["chara"]).decode("utf-8")
    raw = json.loads(decoded)
    assert raw["spec"] == "chara_card_v2"
    assert set(raw["data"]) >= {"name", "first_mes", "description", "personality", "scenario"}
    assert raw["data"]["name"] == "刻晴"


def test_preserves_original_pixels():
    original = png(("chara", "stale"))
    out = write_card_into_png(original, v2(first_mes="新开场"), "刻晴")
    # IDAT 原样保留 = 图像像素没动;只有 tEXt 变了
    assert idat(original) == idat(out)
    parsed = parse_card(out)
    assert parsed["first_mes"] == "新开场"


def test_stale_card_chunks_are_replaced_not_shadowed():
    """原图里 ccv3 和 chara 都有旧卡数据:导出后两个旧块都不在,导入器读到的是新的。"""
    original = png(("ccv3", "b3BkYXRl"), ("chara", "b2xk"))
    out = write_card_into_png(original, v2(first_mes="V2 新开场"), "刻晴")
    chunks = png_text(out)
    assert "ccv3" not in chunks
    parsed = parse_card(out)
    assert parsed["first_mes"] == "V2 新开场"


def test_placeholder_is_a_valid_png_the_importer_can_read_back():
    out = write_card_into_png(None, v2(), "刻晴")
    assert out.startswith(b"\x89PNG\r\n\x1a\n")
    parsed = parse_card(out)
    assert parsed["name"] == "刻晴"
    # 占位图也能被主站当头像读
    assert parsed["avatar"].startswith("data:image/png;base64,")


# ---------------------------------------------------------------- 导出端点


def _make_v2(name: str = "端点测试", **overrides):
    return json.dumps(
        {"spec": "chara_card_v2", "spec_version": "2.0", "data": {**V2_DATA, "name": name, **overrides}},
        ensure_ascii=False,
    )


def test_export_png_endpoint_roundtrip(client, make_card):
    card = make_card(name="端点测试", first_mes="开场白", description="人设")
    res = client.post(f"/api/tavern/cards/{card['id']}/export/png", json={"card_json": _make_v2("端点测试", first_mes="开场白", description="人设")})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "image/png"
    parsed = parse_card(res.content)
    assert parsed["name"] == "端点测试"
    assert parsed["first_mes"] == "开场白"
    assert parsed["description"] == "人设"


def test_export_png_endpoint_uses_stored_avatar_pixels(client, make_card):
    """卡上存了头像(原图)时,导出的 PNG 保留原图像素(IDAT 一致),并且卡数据是新写的。"""
    original = png(("chara", "old"))
    card = make_card(name="带图")
    data_url = "data:image/png;base64," + base64.b64encode(original).decode("ascii")
    updated = client.put(f"/api/tavern/cards/{card['id']}", json={"avatar": data_url})
    assert updated.status_code == 200, updated.text
    res = client.post(f"/api/tavern/cards/{card['id']}/export/png", json={"card_json": _make_v2("带图", first_mes="新")})
    assert res.status_code == 200, res.text
    assert idat(original) == idat(res.content)
    assert parse_card(res.content)["first_mes"] == "新"


def test_export_png_endpoint_filename_is_safe(client, make_card):
    card = make_card(name="测试 角色!·")
    res = client.post(f"/api/tavern/cards/{card['id']}/export/png", json={"card_json": _make_v2("端点测试", first_mes="开场白", description="人设")})
    assert res.status_code == 200
    assert "attachment; filename=" in res.headers["content-disposition"]


def test_export_png_endpoint_rejects_bad_json(client, make_card):
    card = make_card()
    for bad in ("", "not json", '"str"', '{"spec":"chara_card_v2"}'):
        res = client.post(f"/api/tavern/cards/{card['id']}/export/png", json={"card_json": bad})
        assert res.status_code == 400, (bad, res.text)


def test_export_png_endpoint_404_without_card(client):
    res = client.post("/api/tavern/cards/nope/export/png", json={"card_json": _make_v2("端点测试", first_mes="开场白", description="人设")})
    assert res.status_code == 404


def idat(png: bytes) -> bytes:
    """抽第一个 IDAT 的正文,用来比图像数据有没有变。"""
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    pos = 8
    while pos < len(png):
        length, kind = struct.unpack(">I4s", png[pos : pos + 8])
        body = png[pos + 8 : pos + 8 + length]
        if kind == b"IDAT":
            return body
        if kind == b"IEND":
            break
        pos += 8 + length + 4
    raise AssertionError("没有 IDAT")