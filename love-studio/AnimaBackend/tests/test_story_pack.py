"""故事包（`socialcoach.love-story.v1`）的契约测试。

主站侧解析器在 `app/src/lib/love-story-pack.ts`，这里锁住 Studio 侧必须满足的形状：
双语非空、quote 只留给自由输入、剧透字段剥掉、未知键保留、导出→导入往返不丢关键选择。
跨语言哈希复用 `app.scpersona.canonical_json`（已有独立契约测试）。
"""

import json

from fastapi.testclient import TestClient

from app import story_pack as sp


def _story(**overrides) -> dict:
    story = {
        "id": "story-1",
        "origin": "studio",
        "title": {"zh": "雨夜告白", "en": "A confession in the rain"},
        "summary": {"zh": "你们在便利店门口停下。", "en": "You stop outside the convenience store."},
        "keyChoices": [
            {"at": 1, "choice": {"zh": "先问她想要什么", "en": "Ask what she wants"}, "quote": {"zh": "先问她想要什么", "en": "Ask what she wants"}},
        ],
        "characterPackIds": ["card-1"],
        "branchId": "main",
        "canonical": True,
        "createdAt": 1_760_000_000_000,
    }
    story.update(overrides)
    return story


def _pack(**overrides) -> dict:
    return sp.build_story_pack(
        _story(**overrides),
        origin="studio",
        source="Love Studio · 测试",
        license="CC-BY-4.0",
        character={"name": "顾星遥", "description": "旧书店店主", "hidden": "她其实要走"},
    )


# ── 构建 ────────────────────────────────────────────────────────


def test_build_marks_quote_source_when_quote_present():
    pack = _pack()
    assert pack["story"]["quoteSource"] == "free-text"
    assert pack["manifest"]["version"] == sp.STORY_PACK_MANIFEST_VERSION
    assert pack["manifest"]["characterPackId"] == "card-1"
    assert pack["manifest"]["license"] == "CC-BY-4.0"


def test_build_strips_private_fields_from_character_and_story():
    pack = _pack(hidden="不该出现", endingPredicate={"trust": 3})
    assert "hidden" not in pack["story"]
    assert "endingPredicate" not in pack["story"]
    assert "hidden" not in pack["character"]
    assert pack["character"]["name"] == "顾星遥"


def test_build_rejects_single_language_title():
    try:
        sp.build_story_pack(
            _story(title={"zh": "只有中文"}),
            origin="studio",
            source="Love Studio",
        )
    except sp.StoryPackError as error:
        assert error.code == "story/bad-shape"
        assert "title" in error.message
    else:  # pragma: no cover - 失败才有意义
        raise AssertionError("单语 title 必须被拒")


# ── 解析 ────────────────────────────────────────────────────────


def test_parse_keeps_unknown_keys_round_trip():
    pack = _pack()
    pack["story"]["studioExtra"] = {"mood": "rain"}
    pack["manifest"]["studioNote"] = "keep me"
    result = sp.parse_story_pack(json.dumps(pack))
    assert result["ok"], result
    assert result["pack"]["story"]["studioExtra"] == {"mood": "rain"}
    assert result["pack"]["manifest"]["studioNote"] == "keep me"


def test_parse_drops_unmarked_quote_with_warning():
    pack = _pack()
    pack["story"].pop("quoteSource")
    result = sp.parse_story_pack(pack)
    assert result["ok"], result
    assert "quote" not in result["pack"]["story"]["keyChoices"][0]
    assert any("quote dropped" in warning for warning in result["warnings"])


def test_parse_strips_private_fields_with_warning():
    pack = _pack()
    pack["story"]["secret"] = "作者秘密"
    pack["character"]["finalDecision"] = "她留下"
    result = sp.parse_story_pack(pack)
    assert result["ok"], result
    assert "secret" not in result["pack"]["story"]
    assert "finalDecision" not in result["pack"]["character"]
    assert any("private field removed: story.secret" in warning for warning in result["warnings"])


def test_parse_rejects_future_version():
    result = sp.parse_story_pack({"v": 2, "manifest": {}, "story": {}})
    assert not result["ok"]
    assert result["code"] == "story/bad-version"


def test_parse_rejects_missing_english_summary():
    pack = _pack()
    pack["story"]["summary"] = {"zh": "只有中文"}
    result = sp.parse_story_pack(pack)
    assert not result["ok"]
    assert result["code"] == "story/bad-shape"


def test_hash_is_stable_and_file_name_is_slugged():
    pack = _pack()
    assert sp.story_pack_hash(pack) == sp.story_pack_hash(json.loads(sp.story_pack_json(pack)))
    name = sp.story_pack_file_name(pack)
    assert name.startswith("socialcoach-story-")
    assert name.endswith(".json")
    assert sp.story_pack_hash(pack)[:8] in name


# ── API ─────────────────────────────────────────────────────────


def _seed_chat(client: TestClient, make_card, make_debug_chat, put_debug_message) -> tuple[str, str]:
    card = make_card()
    chat = make_debug_chat(card_id=card["id"], name="雨夜")
    put_debug_message(chat["id"], "m1", idx=0, role="assistant", swipes=["雨下大了。"], swipe_info=[{}])
    put_debug_message(chat["id"], "m2", idx=1, role="user", swipes=["先问她想要什么"], swipe_info=[{}])
    put_debug_message(chat["id"], "m3", idx=2, role="assistant", swipes=["她想了想，说想先走一段。"], swipe_info=[{}])
    return card["id"], chat["id"]


def test_export_builds_pack_from_chat(client, make_card, make_debug_chat, put_debug_message):
    card_id, chat_id = _seed_chat(client, make_card, make_debug_chat, put_debug_message)
    response = client.post("/api/story/export", json={"chat_id": chat_id})
    assert response.status_code == 200, response.text
    body = response.json()
    pack = body["pack"]

    assert pack["manifest"]["origin"] == "studio"
    assert pack["manifest"]["characterPackId"] == card_id
    assert pack["story"]["title"] == {"zh": "雨夜", "en": "雨夜"}
    assert pack["story"]["title"]["zh"]
    assert pack["story"]["summary"]["en"]
    assert pack["story"]["quoteSource"] == "free-text"
    # 只有玩家的话进关键选择；选项点击不算，自由输入才留 quote
    assert [choice["at"] for choice in pack["story"]["keyChoices"]] == [1]
    assert pack["story"]["keyChoices"][0]["quote"]["zh"] == "先问她想要什么"
    # 主站的导入预览读 character.name（必须是字符串，不是 {zh,en}）
    assert pack["character"]["name"] == "Anima"
    assert body["warnings"] == []
    assert json.loads(body["json"])["story"]["id"] == pack["story"]["id"]


def test_export_rejects_empty_chat(client, make_debug_chat):
    chat = make_debug_chat()
    response = client.post("/api/story/export", json={"chat_id": chat["id"]})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "story/no-chat"


def test_export_missing_chat_is_404(client):
    response = client.post("/api/story/export", json={"chat_id": "nope"})
    assert response.status_code == 404


def test_import_preview_accepts_exported_pack(client, make_card, make_debug_chat, put_debug_message):
    _, chat_id = _seed_chat(client, make_card, make_debug_chat, put_debug_message)
    exported = client.post("/api/story/export", json={"chat_id": chat_id}).json()
    response = client.post(
        "/api/story/import",
        files={"file": ("story.json", exported["json"].encode("utf-8"), "application/json")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["can_create_card"] is True
    assert body["hash"] == exported["hash"]
    assert body["warnings"] == []


def test_import_preview_rejects_garbage(client):
    response = client.post(
        "/api/story/import",
        files={"file": ("story.json", b"not json", "application/json")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "story/bad-json"


def test_apply_import_creates_card_and_recap_chat(client, make_card, make_debug_chat, put_debug_message):
    _, chat_id = _seed_chat(client, make_card, make_debug_chat, put_debug_message)
    pack = client.post("/api/story/export", json={"chat_id": chat_id}).json()["pack"]

    response = client.post("/api/story/import/apply", json={"pack": pack})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_card"] is True
    assert body["recap"].startswith("【前情】")
    assert "- 先问她想要什么" in body["recap"]

    detail = client.get(f"/api/debug/chats/{body['chat_id']}").json()
    assert detail["card_id"] == body["card_id"]
    assert detail["card_name"] == "Anima"
    assert detail["message_count"] == 1
    assert detail["messages"][0]["role"] == "assistant"
    assert detail["messages"][0]["swipes"][0] == body["recap"]
    assert detail["variables"]["storyPackId"] == pack["story"]["id"]


def test_apply_import_can_reuse_existing_card(client, make_card, make_debug_chat, put_debug_message):
    card_id, chat_id = _seed_chat(client, make_card, make_debug_chat, put_debug_message)
    pack = client.post("/api/story/export", json={"chat_id": chat_id}).json()["pack"]

    response = client.post("/api/story/import/apply", json={"pack": pack, "card_id": card_id})
    assert response.status_code == 200, response.text
    assert response.json()["created_card"] is False
    assert response.json()["card_id"] == card_id


def test_apply_import_without_character_or_card_is_rejected(client):
    pack = _pack()
    pack.pop("character")
    response = client.post("/api/story/import/apply", json={"pack": pack})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "story/no-card"
