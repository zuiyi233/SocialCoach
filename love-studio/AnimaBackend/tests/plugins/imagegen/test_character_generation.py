"""一句话生成角色：plan（LLM 假）/ 生图（假）/ 落库 / job API。全部离线，不访问网络。

覆盖：
- plan_character 的严格 JSON 解析与安全边界；
- generate_character 的落库 + sprite/scene 绑定、单张失败继续；
- job API 的 running→done 与 error 路径。
"""

import asyncio
import io
import json
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings
from app.db import Base
from app.models import ApiConnection, PackSprite, SceneAsset, ScenePack, SpritePack, TavernCard
from app.plugins.imagegen import character, character_api, openai_images, writer
from app.storage import refs


def png_bytes(color=(200, 120, 160)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 32), color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    yield session
    session.close()
    engine.dispose()


def plan_json(expressions=None, scenes=None, **over):
    default_expressions = [
        {"label": "平静", "prompt": "calm expression, looking at viewer"},
        {"label": "微笑", "prompt": "gentle smile"},
        {"label": "惊讶", "prompt": "surprised expression"},
        {"label": "难过", "prompt": "sad expression"},
    ]
    default_scenes = [
        {"label": "书店门口", "prompt": "bookshop street at dusk"},
        {"label": "店内", "prompt": "warm bookshelves interior, lamp light"},
        {"label": "雨天窗边", "prompt": "rainy window seat, city street"},
    ]
    body = {
        "card": {
            "name": "林晚",
            "description": "老城区书店的店员，粉色长发，琥珀色眼睛。",
            "personality": "温柔、细心，说话轻声细语。",
            "scenario": "黄昏时分的老书店里，你第一次走进来。",
            "first_mes": "欢迎光临。今天想看点什么？",
            "mes_example": "玩家：你好。\n林晚：欢迎光临。今天想看点什么？",
            "alternate_greetings": ["你又来了。", "快到打烊时间了。"],
            "tags": ["书店", "治愈", "日常"],
        },
        "worldbook": [
            {"keys": ["书店"], "content": "老城区转角的一家小书店，木质书架，暖黄色灯光。", "enabled": True, "insertion_order": 100}
        ],
        "appearance": "adult, pink hair, long hair, amber eyes, apron, dress, glasses",
        "expressions": default_expressions if expressions is None else expressions,
        "scenes": default_scenes if scenes is None else scenes,
    }
    body.update(over)
    return body


def make_plan(**over):
    plan = character.CharacterPlan(
        card=character.CardFields(
            name="林晚",
            description="老城区书店的店员，粉色长发，琥珀色眼睛。",
            personality="温柔、细心",
            scenario="黄昏的书店",
            first_mes="欢迎光临。",
            mes_example="玩家：你好。\n林晚：欢迎光临。",
            alternate_greetings=["你又来了。"],
            tags=["书店", "治愈"],
        ),
        worldbook=[character.WorldEntry(keys=["书店"], content="老城区转角的小书店。", enabled=True, insertion_order=100)],
        appearance="adult, pink hair, long hair, amber eyes, apron, dress",
        expressions=[
            character.ExpressionItem(label="平静", prompt="calm expression, looking at viewer"),
            character.ExpressionItem(label="微笑", prompt="gentle smile"),
            character.ExpressionItem(label="惊讶", prompt="surprised expression"),
            character.ExpressionItem(label="难过", prompt="sad expression"),
        ],
        scenes=[
            character.SceneItem(label="书店门口", prompt="bookshop street at dusk"),
            character.SceneItem(label="店内", prompt="warm bookshelves interior"),
            character.SceneItem(label="雨天窗边", prompt="rainy window seat"),
        ],
    )
    plan.__dict__.update(over)
    return plan


def add_active_connection(db):
    db.add(ApiConnection(name="测试连接", api_type="mock", model="mock", is_active=True))
    db.commit()


def set_image_config(db):
    openai_images.save_config(db, base_url="http://fake.local", model="agnes-image-2.5-flash", api_key="k")


async def _stub_plan(db, **kwargs):
    return make_plan()


# ── plan_character ──


def test_plan_character_builds_a_plan(db_session, monkeypatch):
    add_active_connection(db_session)
    seen = []

    async def fake_ask(conn, messages, thinking="off"):
        seen.append(messages)
        return json.dumps(plan_json(), ensure_ascii=False), 123

    monkeypatch.setattr(writer, "ask", fake_ask)
    plan = asyncio.run(character.plan_character(db_session, description="一家书店的店员"))
    assert plan.card.name == "林晚" and plan.card.first_mes == "欢迎光临。今天想看点什么？"
    assert [e.label for e in plan.expressions] == ["平静", "微笑", "惊讶", "难过"]
    assert [s.label for s in plan.scenes] == ["书店门口", "店内", "雨天窗边"]
    assert plan.appearance.startswith("adult, pink hair")
    assert plan.worldbook[0].keys == ["书店"]
    # 中文语言时角色文本用中文
    assert "用中文" in seen[0][1].content


def test_plan_character_uses_given_name_and_english(db_session, monkeypatch):
    add_active_connection(db_session)
    seen = []

    async def fake_ask(conn, messages, thinking="off"):
        seen.append(messages)
        return json.dumps(plan_json(), ensure_ascii=False), 5

    monkeypatch.setattr(writer, "ask", fake_ask)
    plan = asyncio.run(
        character.plan_character(db_session, description="一家书店的店员", name="书店小姐", language="en", expression_count=2, scene_count=0)
    )
    assert plan.card.name == "林晚"  # 模型回什么用什么；名字参数只是给模型参考
    assert "书店小姐" in seen[0][1].content and "English" in seen[0][1].content
    assert "expressions 正好给 2 项" in seen[0][1].content


def test_plan_character_needs_active_connection(db_session):
    with pytest.raises(character.CharacterGenerationError, match="聊天连接"):
        asyncio.run(character.plan_character(db_session, description="书店店员"))


def test_plan_character_rejects_missing_card(db_session, monkeypatch):
    add_active_connection(db_session)
    body = plan_json()
    del body["card"]

    async def fake_ask(conn, messages, thinking="off"):
        return json.dumps(body, ensure_ascii=False), 1

    monkeypatch.setattr(writer, "ask", fake_ask)
    with pytest.raises(character.CharacterGenerationError, match="card"):
        asyncio.run(character.plan_character(db_session, description="书店店员"))


def test_plan_character_rejects_missing_appearance(db_session, monkeypatch):
    add_active_connection(db_session)
    body = plan_json()
    del body["appearance"]

    async def fake_ask(conn, messages, thinking="off"):
        return json.dumps(body, ensure_ascii=False), 1

    monkeypatch.setattr(writer, "ask", fake_ask)
    with pytest.raises(character.CharacterGenerationError, match="appearance"):
        asyncio.run(character.plan_character(db_session, description="书店店员"))


def test_plan_character_rejects_missing_expressions(db_session, monkeypatch):
    add_active_connection(db_session)
    body = plan_json(expressions=[])

    async def fake_ask(conn, messages, thinking="off"):
        return json.dumps(body, ensure_ascii=False), 1

    monkeypatch.setattr(writer, "ask", fake_ask)
    with pytest.raises(character.CharacterGenerationError, match="表情"):
        asyncio.run(character.plan_character(db_session, description="书店店员"))


def test_plan_prompt_is_sfw_and_forbids_system_prompt_override(db_session, monkeypatch):
    add_active_connection(db_session)
    seen = []

    async def fake_ask(conn, messages, thinking="off"):
        seen.append(messages)
        return json.dumps(plan_json(), ensure_ascii=False), 1

    monkeypatch.setattr(writer, "ask", fake_ask)
    asyncio.run(character.plan_character(db_session, description="书店店员"))
    system = seen[0][0].content
    assert "SFW" in system and "未成年" in system
    # 输出契约里不允许 system_prompt / post_history_instructions 字段（不写越狱 / 覆盖系统提示词）
    assert '"system_prompt"' not in system and '"post_history_instructions"' not in system


# ── generate_character ──


def test_generate_character_persists_card_and_binds_packs(db_session, monkeypatch):
    monkeypatch.setattr(character, "plan_character", _stub_plan)
    set_image_config(db_session)
    calls = []

    async def fake_generate_one(*, base_url, api_key, model, prompt, size):
        calls.append((prompt, size))
        return png_bytes()

    monkeypatch.setattr(openai_images, "generate_one", fake_generate_one)

    result = asyncio.run(character.generate_character(db_session, description="书店店员"))
    assert result.images_ok == 7 and result.images_failed == 0 and result.warnings == []

    card = db_session.get(TavernCard, result.card_id)
    assert card is not None and card.name == "林晚"
    # 安全边界：模型内容只作为卡内容，system 字段必须为空
    assert card.system_prompt == "" and card.post_history_instructions == ""
    ext = card.extensions["studio_generated"]
    assert ext["provider"] == "openai-compatible"
    assert ext["model"] == "agnes-image-2.5-flash"
    assert ext["style"] == ""
    assert ext["source"] == "studio-generated"
    assert ext["license"] == "CC-BY-4.0"
    assert ext["generated_at"]
    assert card.character_book == {
        "entries": [
            {"keys": ["书店"], "content": "老城区转角的小书店。", "enabled": True, "insertion_order": 100}
        ]
    }

    # 立绘包：4 张表情，绑到卡上并设为当前包
    sprite_pack = db_session.get(SpritePack, result.sprite_pack_id)
    sprites = db_session.scalars(
        select(PackSprite).where(PackSprite.pack_id == sprite_pack.id).order_by(PackSprite.sort)
    ).all()
    assert [s.label for s in sprites] == ["平静", "微笑", "惊讶", "难过"]
    assert db_session.get(PackSprite, sprites[0].id) is not None
    assert refs.read_bytes(refs.SPRITE, sprites[0], db_session) == png_bytes()
    assert bindings.targets(db_session, card.id, bindings.SPRITE) == [sprite_pack.id]
    assert bindings.primary(db_session, card.id, bindings.SPRITE) == sprite_pack.id

    # 场景包：3 张背景，绑到卡上
    scene_pack = db_session.get(ScenePack, result.scene_pack_id)
    assets = db_session.scalars(
        select(SceneAsset).where(SceneAsset.pack_id == scene_pack.id).order_by(SceneAsset.sort)
    ).all()
    assert [a.label for a in assets] == ["书店门口", "店内", "雨天窗边"]
    assert all(a.kind == "bg" for a in assets)
    assert bindings.targets(db_session, card.id, bindings.SCENE) == [scene_pack.id]

    # 提示词按契约拼：立绘带外观 + 全身 + 无文字，场景带背景尾巴
    sizes = [size for _, size in calls]
    assert sizes[:4] == ["832x1248"] * 4 and sizes[4:] == ["1280x720"] * 3
    assert "full body, neutral background, no text" in calls[0][0]
    assert "visual novel background, no people, no text" in calls[5][0]


def test_generate_character_single_image_failure_still_succeeds(db_session, monkeypatch):
    monkeypatch.setattr(character, "plan_character", _stub_plan)
    set_image_config(db_session)
    calls = []

    async def fake_generate_one(*, base_url, api_key, model, prompt, size):
        calls.append((prompt, size))
        # 第 2 张立绘、第 1 张场景失败，其余成功
        if len(calls) in (2, 5):
            raise openai_images.OpenAIImageError(502, "模拟生图失败")
        return png_bytes()

    monkeypatch.setattr(openai_images, "generate_one", fake_generate_one)

    result = asyncio.run(character.generate_character(db_session, description="书店店员"))
    assert result.images_ok == 5 and result.images_failed == 2 and result.card_id

    card = db_session.get(TavernCard, result.card_id)
    sprite_pack = db_session.get(SpritePack, result.sprite_pack_id)
    sprites = db_session.scalars(
        select(PackSprite).where(PackSprite.pack_id == sprite_pack.id).order_by(PackSprite.sort)
    ).all()
    assert [s.label for s in sprites] == ["平静", "惊讶", "难过"]  # 失败的那张不进包
    assert bindings.targets(db_session, card.id, bindings.SPRITE) == [sprite_pack.id]

    scene_pack = db_session.get(ScenePack, result.scene_pack_id)
    assets = db_session.scalars(
        select(SceneAsset).where(SceneAsset.pack_id == scene_pack.id).order_by(SceneAsset.sort)
    ).all()
    assert [a.label for a in assets] == ["店内", "雨天窗边"]
    assert bindings.targets(db_session, card.id, bindings.SCENE) == [scene_pack.id]

    assert any("微笑" in w and "失败" in w for w in result.warnings)
    assert any("书店门口" in w and "失败" in w for w in result.warnings)


def test_generate_character_needs_image_key(db_session, monkeypatch):
    monkeypatch.setattr(character, "plan_character", _stub_plan)
    with pytest.raises(character.CharacterGenerationError, match="图片"):
        asyncio.run(character.generate_character(db_session, description="书店店员"))
    assert db_session.scalars(select(TavernCard)).first() is None  # 卡也没建


def test_generate_character_card_never_takes_system_prompt_from_plan(db_session, monkeypatch):
    """模型若在 card 里夹带 system_prompt / post_history_instructions，解析时直接丢弃。"""
    plan = make_plan()
    set_image_config(db_session)

    async def fake_generate_one(*, base_url, api_key, model, prompt, size):
        return png_bytes()

    async def stub_plan_with_extra(db, **kwargs):
        return plan

    monkeypatch.setattr(character, "plan_character", stub_plan_with_extra)
    monkeypatch.setattr(openai_images, "generate_one", fake_generate_one)
    result = asyncio.run(character.generate_character(db_session, description="书店店员"))
    card = db_session.get(TavernCard, result.card_id)
    assert card.system_prompt == "" and card.post_history_instructions == ""
    assert "studio_generated" in card.extensions


# ── job API ──


def wait_job(client: TestClient, job_id: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/character/generate/{job_id}")
        assert r.status_code == 200
        if r.json()["status"] in ("done", "error"):
            return r.json()
        time.sleep(0.05)
    pytest.fail("job did not finish in time")


@pytest.fixture
def job_db(monkeypatch):
    """job 后台任务用的内存会话（不碰真实库）。"""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    MkSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(character_api, "_new_db", MkSession)
    return MkSession


def test_job_api_runs_to_done(client: TestClient, job_db, monkeypatch):
    async def fake_generate(db, **kwargs):
        return character.CharacterJobResult(
            card_id="card1", card_name="林晚", sprite_pack_id="sp", scene_pack_id="scp", images_ok=7, images_failed=0
        )

    monkeypatch.setattr(character, "generate_character", fake_generate)
    r = client.post("/api/character/generate", json={"description": "一家书店的店员"})
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert job_id

    out = wait_job(client, job_id)
    assert out["status"] == "done"
    assert out["result"]["card_name"] == "林晚" and out["result"]["images_ok"] == 7
    assert out["error"] is None


def test_job_api_reports_error(client: TestClient, job_db, monkeypatch):
    async def fake_generate(db, **kwargs):
        raise character.CharacterGenerationError("没有可用的聊天连接：请先在设置里配置并激活一个文本模型连接")

    monkeypatch.setattr(character, "generate_character", fake_generate)
    r = client.post("/api/character/generate", json={"description": "书店店员"})
    assert r.status_code == 200
    out = wait_job(client, r.json()["job_id"])
    assert out["status"] == "error"
    assert "聊天连接" in out["error"] and out["result"] is None


def test_job_api_missing_connection_through_real_pipeline(client: TestClient, job_db):
    """不 mock generate_character：真实 pipeline 在没有连接时报错进 job。"""
    r = client.post("/api/character/generate", json={"description": "书店店员"})
    assert r.status_code == 200
    out = wait_job(client, r.json()["job_id"])
    assert out["status"] == "error"
    assert "聊天连接" in out["error"]


def test_job_api_validates_input(client: TestClient):
    for bad in (
        {"description": ""},
        {"description": "x" * 2001},
        {"description": "x", "expression_count": 1},
        {"description": "x", "expression_count": 9},
        {"description": "x", "scene_count": 7},
        {"description": "x", "language": "jp"},
    ):
        assert client.post("/api/character/generate", json=bad).status_code == 422


def test_job_api_unknown_job_404(client: TestClient):
    assert client.get("/api/character/generate/nope").status_code == 404