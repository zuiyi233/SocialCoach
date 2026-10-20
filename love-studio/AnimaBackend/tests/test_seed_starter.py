"""自带起始角色「拾光书栈 · 顾星遥」的种子测试:不经过 HTTP,用临时内存库直接调种子函数。

覆盖:起始角色被种上(名字 / 开场 / 世界书条目 / 硬限制)、场景包被种上并绑定到卡、
重复跑幂等(不产生重复角色 / 场景包 / 资产)、场景资产文件可读且 mime 正确、
某个角色目录坏了不挡其它角色。

不 monkeypatch `_SEED_DATA` 的测试读的是仓库里真实的 starter 目录 —— 这测的就是
交付里那份起始内容的可用性;坏目录那个测试才用临时 seed_data。文件仓库由 conftest
的 blob_store_isolated 换到临时目录。"""

import json
import shutil
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings, seed
from app.db import Base
from app.models import PromptPreset, SceneAsset, ScenePack, TavernCard
from app.storage import refs

STARTER = Path(seed.__file__).resolve().parent / "seed_data" / "starter"
REAL_SEED_DATA = Path(seed.__file__).resolve().parent / "seed_data"
ALLOWED_KINDS = ("bg", "bgm", "cg")


def _mem_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)(), engine


@pytest.fixture
def seeded_db():
    """真实 starter 目录种进一块干净的内存库;种不上就直接让 fixture 失败。"""
    db, engine = _mem_session()
    seed.seed_default_tavern_data(db)
    assert db.scalars(select(TavernCard)).first() is not None
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def _source(path: str):
    return json.loads((STARTER / path).read_text(encoding="utf-8"))


def test_starter_card_is_seeded_with_opening_worldbook_and_hard_limits(seeded_db):
    card = seeded_db.scalars(select(TavernCard)).first()
    raw = _source("card.json")
    d = raw["data"]

    assert card.name == d["name"] == "顾星遥"
    assert card.first_mes == d["first_mes"]
    assert card.first_mes.strip()
    # 硬限制:不覆盖系统提示,也没有「总是同意」「忽略规则」类指令
    assert card.system_prompt == "" and card.post_history_instructions == ""
    entries = card.character_book["entries"]
    assert 2 <= len(entries) <= 4
    for e in entries:
        for key in ("keys", "content", "enabled", "constant", "insertion_order"):
            assert key in e, f"世界书条目缺 {key}"
        assert e["keys"] and e["content"]
        assert e["enabled"] is True
        assert "总是同意" not in e["content"] and "忽略规则" not in e["content"]
    # 默认预设照旧种上
    assert seeded_db.scalars(select(PromptPreset)).first() is not None


def test_starter_scene_pack_is_seeded_and_bound_to_card(seeded_db):
    card = seeded_db.scalars(select(TavernCard)).first()
    packs = list(seeded_db.scalars(select(ScenePack)))
    assert len(packs) == 1
    pack = packs[0]

    source = _source("scene_pack.json")
    assert pack.name == source["name"] == "拾光书栈"
    assert pack.description
    assert bindings.targets(seeded_db, card.id, bindings.SCENE) == [pack.id]
    assert bindings.primary(seeded_db, card.id, bindings.SCENE) == pack.id

    assets = list(seeded_db.scalars(select(SceneAsset).where(SceneAsset.pack_id == pack.id)))
    assert len(assets) == len(source["assets"]) >= 2
    by_label = {a.label: a for a in assets}
    for spec in source["assets"]:
        a = by_label[spec["label"]]
        assert a.kind in ALLOWED_KINDS and a.kind == spec["kind"]
        assert a.aliases == spec["aliases"]
        assert a.enabled is True and a.sort == spec["sort"]


def test_scene_asset_files_are_readable_with_correct_mime(seeded_db):
    pack = seeded_db.scalars(select(ScenePack)).first()
    source = _source("scene_pack.json")
    assets = list(
        seeded_db.scalars(select(SceneAsset).where(SceneAsset.pack_id == pack.id).order_by(SceneAsset.sort))
    )
    assert len(assets) == len(source["assets"])
    for asset, spec in zip(assets, source["assets"]):
        expected = (STARTER / "scenes" / spec["file"]).read_bytes()
        data = refs.read_bytes(refs.SCENE_ASSET, asset, seeded_db)
        assert data == expected
        assert asset.mime == "image/webp"
        assert asset.size == len(expected)
        assert asset.data_sha and asset.data is None  # 和上传一样只进文件仓库


def test_seed_scene_pack_direct_call_is_idempotent(seeded_db):
    card = seeded_db.scalars(select(TavernCard)).first()
    pack = seeded_db.scalars(select(ScenePack)).first()
    asset_ids = set(seeded_db.scalars(select(SceneAsset.id)).all())

    seed._seed_scene_pack(seeded_db, card, STARTER)
    seeded_db.commit()

    assert list(seeded_db.scalars(select(ScenePack))) == [pack]
    assert set(seeded_db.scalars(select(SceneAsset.id)).all()) == asset_ids
    assert bindings.targets(seeded_db, card.id, bindings.SCENE) == [pack.id]


def test_reseed_after_card_delete_reuses_pack_without_duplicating_assets(seeded_db):
    """删了卡重新种(现行种子机制的恢复路径):卡重建,场景包按名复用,资产不多存"""
    card0 = seeded_db.scalars(select(TavernCard)).first()
    pack = seeded_db.scalars(select(ScenePack)).first()
    asset_ids = set(seeded_db.scalars(select(SceneAsset.id)).all())

    # 和删卡接口一样:绑定、角色位、旧表行 + 卡本身
    bindings.delete_card(seeded_db, card0.id)
    seeded_db.delete(card0)
    seeded_db.commit()
    seed.seed_default_tavern_data(seeded_db)

    card1 = seeded_db.scalars(select(TavernCard)).first()
    assert card1 is not None and card1.id != card0.id
    assert [p.id for p in seeded_db.scalars(select(ScenePack))] == [pack.id]
    assert set(seeded_db.scalars(select(SceneAsset.id)).all()) == asset_ids
    assert bindings.targets(seeded_db, card1.id, bindings.SCENE) == [pack.id]
    assert seeded_db.scalars(select(PromptPreset)).first() is not None  # 预设没被重种


def test_broken_character_dir_does_not_block_others(tmp_path, monkeypatch):
    """一个角色目录坏了 json,只跳过它自己,别的角色照常种上(deliverable 1 的回滚要求)"""
    root = tmp_path / "seed_data"
    good, bad = root / "好角色", root / "坏角色"
    good.mkdir(parents=True)
    bad.mkdir(parents=True)
    shutil.copy(REAL_SEED_DATA / "default-preset.json", root / "default-preset.json")
    (good / "card.json").write_text(
        json.dumps({"spec": "chara_card_v2", "data": {"name": "好角色"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    (bad / "card.json").write_text("{ 这不是 JSON", encoding="utf-8")
    monkeypatch.setattr(seed, "_SEED_DATA", root)

    db, engine = _mem_session()
    try:
        seed.seed_default_tavern_data(db)
        assert [c.name for c in db.scalars(select(TavernCard))] == ["好角色"]
    finally:
        db.close()
        engine.dispose()