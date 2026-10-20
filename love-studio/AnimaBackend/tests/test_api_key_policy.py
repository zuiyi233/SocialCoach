"""API 密钥策略(spec-love-studio §7,2026-10-21 拍板):默认「记住密钥」= 存本地 SQLite;
可关,关掉只在当前进程内存,重启后需重填。密钥不回显、不进日志、不提交。"""

import pytest
from fastapi.testclient import TestClient

import app.api_keys as api_keys
from app.db import get_db
from app.llm.registry import provider_for
from app.main import app
from app.models import ApiConnection

REMEMBER_URL = "/api/settings/security.remember_api_keys"


@pytest.fixture(autouse=True)
def api_keys_memory_isolated():
    """每个测试前后清掉进程内存:上一个测试留下的 key、以及「模拟重启」两种情况都干净。"""
    api_keys.reset_memory()
    yield
    api_keys.reset_memory()


def stored_row(connection_id: str) -> ApiConnection:
    """直接看 DB 里的那一行:接口不回明文,要查 key 存哪儿只能开自己的会话。"""
    session = app.dependency_overrides[get_db]()
    db = next(session)
    try:
        row = db.get(ApiConnection, connection_id)
        assert row is not None
        return row
    finally:
        session.close()


def turn_remember(client: TestClient, value: bool):
    response = client.put(REMEMBER_URL, json={"value": value})
    assert response.status_code == 200, response.text
    return response.json()


def test_default_remember_true_stores_key_in_db(client: TestClient, make_connection):
    connection = make_connection(api_key="sk-secret-1")

    assert connection["has_api_key"] is True
    assert stored_row(connection["id"]).api_key == "sk-secret-1"
    assert api_keys.effective_key(stored_row(connection["id"])) == "sk-secret-1"
    # 默认开:开关设置还没写,GET 回 null,前端当 true
    assert client.get(REMEMBER_URL).json()["value"] is None


def test_disabling_remember_moves_stored_keys_to_memory(
    client: TestClient, make_connection
):
    connection = make_connection(api_key="sk-secret-1")

    turn_remember(client, False)

    row = stored_row(connection["id"])
    assert row.api_key is None
    assert api_keys._MEMORY[connection["id"]] == "sk-secret-1"
    assert api_keys.effective_key(row) == "sk-secret-1"
    listed = client.get("/api/connections").json()[0]
    assert listed["has_api_key"] is True


def test_creating_connection_with_remember_off_keeps_key_in_memory_only(
    client: TestClient, make_connection
):
    turn_remember(client, False)

    connection = make_connection(api_key="sk-secret-2")

    assert stored_row(connection["id"]).api_key is None
    assert api_keys._MEMORY[connection["id"]] == "sk-secret-2"
    assert connection["has_api_key"] is True
    assert api_keys.effective_key(stored_row(connection["id"])) == "sk-secret-2"


def test_reenabling_remember_writes_keys_back_to_db_and_clears_memory(
    client: TestClient, make_connection
):
    connection = make_connection(api_key="sk-secret-1")
    turn_remember(client, False)

    turn_remember(client, True)

    assert stored_row(connection["id"]).api_key == "sk-secret-1"
    assert api_keys._MEMORY == {}
    assert api_keys.effective_key(stored_row(connection["id"])) == "sk-secret-1"


def test_clearing_key_with_remember_off_also_clears_memory(
    client: TestClient, make_connection
):
    connection = make_connection(api_key="sk-secret-1")
    turn_remember(client, False)

    updated = client.put(f"/api/connections/{connection['id']}", json={"api_key": ""})

    assert updated.status_code == 200
    assert updated.json()["has_api_key"] is False
    assert api_keys._MEMORY == {}
    assert stored_row(connection["id"]).api_key is None


def test_restart_with_remember_off_loses_memory_keys(client: TestClient, make_connection):
    connection = make_connection(api_key="sk-secret-1")
    turn_remember(client, False)

    # 模拟重启:进程内存里的 key 消失(DB 里也没有)
    api_keys.reset_memory()

    listed = client.get("/api/connections").json()[0]
    assert listed["has_api_key"] is False
    assert stored_row(connection["id"]).api_key is None
    assert api_keys.effective_key(stored_row(connection["id"])) is None


def test_connection_responses_never_contain_the_key_string(
    client: TestClient, make_connection
):
    make_connection(api_key="sk-secret-1")

    response = client.get("/api/connections")

    assert response.status_code == 200
    assert "sk-secret-1" not in response.text
    assert "has_api_key" in response.text


def test_provider_for_uses_memory_key_when_remember_off(
    client: TestClient, make_connection, monkeypatch
):
    connection = make_connection(
        name="OpenAI",
        api_type="openai_compatible",
        base_url="https://example.test/v1",
        model="test-model",
        api_key="sk-memory-key",
    )
    turn_remember(client, False)

    captured: dict[str, str] = {}

    class FakeProvider:
        def __init__(self, api_key, base_url=None, thinking=None):
            captured["api_key"] = api_key

    monkeypatch.setattr("app.llm.registry.OpenAICompatibleProvider", FakeProvider)

    provider_for(stored_row(connection["id"]))

    assert captured["api_key"] == "sk-memory-key"


def test_deleting_connection_clears_its_memory_key(client: TestClient, make_connection):
    connection = make_connection(api_key="sk-secret-1")
    turn_remember(client, False)
    assert connection["id"] in api_keys._MEMORY

    response = client.delete(f"/api/connections/{connection['id']}")

    assert response.status_code == 204
    assert api_keys._MEMORY == {}


def test_remember_setting_rejects_non_bool_values(client: TestClient):
    for bad in ("yes", 1, None, []):
        response = client.put(REMEMBER_URL, json={"value": bad})
        assert response.status_code == 400, bad
    # 被拒的都没写进通用设置表:GET 还是 null(前端继续当 true)
    assert client.get(REMEMBER_URL).json()["value"] is None
