"""`app.seed_one` 的补种入口测试：老库补一个起始角色、幂等、dry-run、坏目录不炸。

用内存库 + 临时种子目录，不碰仓库里真实的 seed_data（那由 test_seed_starter 覆盖）。
"""

import json

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings
from app.db import Base
from app.models import PackSprite, SpritePack, TavernCard
from app.seed_one import seed_one


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    yield session
    session.close()


def _make_char_dir(tmp_path, name="测试角色", sprites=True):
    d = tmp_path / "demo"
    d.mkdir()
    (d / "card.json").write_text(
        json.dumps({"spec": "chara_card_v2", "data": {"name": name, "first_mes": "开场"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    if sprites:
        (d / "sprites").mkdir()
        rows = []
        for i in (1, 2):
            (d / "sprites" / f"{i:02d}.webp").write_bytes(b"RIFF....WEBP" + bytes([i]))
            rows.append({"file": f"{i:02d}.webp", "label": f"表情{i}"})
        (d / "sprites.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return d


def test_seed_one_creates_card_and_binds_sprites(db, tmp_path):
    char_dir = _make_char_dir(tmp_path)
    result = seed_one(char_dir, db=db)

    assert "已种入" in result
    card = db.scalars(select(TavernCard).where(TavernCard.name == "测试角色")).one()
    pack = db.scalars(select(SpritePack).where(SpritePack.name == "测试角色 · 立绘")).one()
    assert db.scalars(select(PackSprite).where(PackSprite.pack_id == pack.id)).all().__len__() == 2
    # 立绘包要真的挂到卡上，否则进游戏还是没有立绘
    assert bindings.targets(db, card.id, bindings.SPRITE) == [pack.id]


def test_seed_one_is_idempotent(db, tmp_path):
    char_dir = _make_char_dir(tmp_path)
    assert "已种入" in seed_one(char_dir, db=db)
    again = seed_one(char_dir, db=db)
    assert "跳过" in again and "同名卡已存在" in again
    assert len(db.scalars(select(TavernCard)).all()) == 1


def test_seed_one_dry_run_writes_nothing(db, tmp_path):
    char_dir = _make_char_dir(tmp_path)
    result = seed_one(char_dir, db=db, dry_run=True)
    assert result.startswith("[dry-run]")
    assert db.scalars(select(TavernCard)).all() == []


def test_seed_one_without_card_json_is_skipped(db, tmp_path):
    d = tmp_path / "empty"
    d.mkdir()
    assert "没有 card.json" in seed_one(d, db=db)


def test_seed_one_survives_broken_sprites(db, tmp_path):
    """sprites.json 指向不存在的文件：报失败但库不留半张卡（回滚）。"""
    char_dir = _make_char_dir(tmp_path)
    (char_dir / "sprites" / "02.webp").unlink()
    result = seed_one(char_dir, db=db)
    assert result.startswith("失败")
    assert db.scalars(select(TavernCard)).all() == []


def test_scene_only_attaches_scene_pack_to_existing_card(db, tmp_path):
    """卡已经在库里时，--scene-only 只补场景包（新增背景资产走这条路）。"""
    from app import bindings
    from app.models import SceneAsset, ScenePack

    char_dir = _make_char_dir(tmp_path)
    assert "已种入" in seed_one(char_dir, db=db)
    card = db.scalars(select(TavernCard).where(TavernCard.name == "测试角色")).one()

    (char_dir / "scenes").mkdir()
    (char_dir / "scenes" / "a.webp").write_bytes(b"RIFF....WEBP-a")
    (char_dir / "scene_pack.json").write_text(
        json.dumps({"name": "测试场景", "assets": [
            {"file": "a.webp", "kind": "bg", "label": "街角", "aliases": ["街上"], "sort": 0}
        ]}, ensure_ascii=False),
        encoding="utf-8",
    )

    # 不带 --scene-only：同名卡已存在，什么都不做
    assert "跳过" in seed_one(char_dir, db=db)

    result = seed_one(char_dir, db=db, scene_only=True)
    assert "场景包已挂到" in result
    pack = db.scalars(select(ScenePack).where(ScenePack.name == "测试场景")).one()
    assert db.scalars(select(SceneAsset).where(SceneAsset.pack_id == pack.id)).all().__len__() == 1
    assert bindings.targets(db, card.id, bindings.SCENE) == [pack.id]
