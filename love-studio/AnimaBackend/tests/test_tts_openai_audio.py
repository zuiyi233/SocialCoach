"""OpenAI 兼容 /audio/speech 适配器:请求形状、key 的回显纪律、报错、缓存键。"""

import asyncio
import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.tts.base import TTSError, VoiceSpec
from app.tts.openai_audio import DEFAULT_FORMAT, OpenAIAudioEngine, speech_body

URL = "https://tts.test/v1"
KEY = "sk-openai-secret-123"

SPEC = VoiceSpec(
    gpt_weights="",
    sovits_weights="",
    ref_path="",
    prompt_text="",
    text_lang="zh",
    speed=1.0,
)


def run(coro):
    return asyncio.run(coro)


class FakeOpenAI:
    """假装是 OpenAI 兼容的 TTS 网关(/audio/speech、/models)。"""

    def __init__(self):
        self.calls: list[tuple[str, dict[str, Any], dict[str, str]]] = []
        self.speech_reply: httpx.Response | Exception | None = None
        self.models_reply: httpx.Response | Exception | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        self.calls.append((str(request.url), body, dict(request.headers)))
        if request.url.path.endswith("/audio/speech"):
            ok = httpx.Response(200, headers={"content-type": "audio/wav"}, content=b"RIFF" + body["input"].encode())
            return _reply(self.speech_reply, ok)
        if request.url.path.endswith("/models"):
            ok = httpx.Response(200, json={"data": []})
            return _reply(self.models_reply, ok)
        return httpx.Response(404, json={"error": {"message": "not found"}})


def _reply(configured: httpx.Response | Exception | None, ok: httpx.Response) -> httpx.Response:
    if configured is None:
        return ok
    if isinstance(configured, Exception):
        raise configured
    return configured


@pytest.fixture
def fake(monkeypatch) -> FakeOpenAI:
    from app.tts.registry import reset_engines

    fake = FakeOpenAI()

    def make(base_url: str, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))

    monkeypatch.setattr("app.tts.openai_audio.make_tts_client", make)
    reset_engines()
    yield fake
    reset_engines()


def test_request_body_and_auth(monkeypatch, fake):
    engine = OpenAIAudioEngine(URL + "/", api_key=KEY, model="tts-1", voice="alloy", fmt="mp3")
    audio, mime = run(engine.synthesize("晚上好。", SPEC))

    assert audio == b"RIFF" + "晚上好。".encode()
    assert mime == "audio/wav"  # 服务端给的 content-type 优先
    url, body, headers = fake.calls[-1]
    assert url == f"{URL}/audio/speech"
    assert body == {
        "model": "tts-1",
        "input": "晚上好。",
        "voice": "alloy",
        "response_format": "mp3",
        "speed": 1.0,
    }
    assert headers["authorization"] == f"Bearer {KEY}"
    # 排查用的请求体不能带 key
    assert KEY not in json.dumps(engine.request_body("晚上好。", SPEC))


def test_no_key_means_no_auth_header(fake):
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    run(engine.synthesize("嗯。", SPEC))
    assert "authorization" not in fake.calls[-1][2]


def test_voice_override_and_speed_clamp(fake):
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    voiced = VoiceSpec(
        gpt_weights="", sovits_weights="", ref_path="", prompt_text="",
        text_lang="zh", speed=9.0, params={"voice": "nova"},
    )
    run(engine.synthesize("你好。", voiced))
    body = fake.calls[-1][1]
    assert body["voice"] == "nova"
    # OpenAI 的 speed 上限是 4,超了先夹住
    assert body["speed"] == 4.0


def test_speed_defaults_when_zero(fake):
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    zero = VoiceSpec(
        gpt_weights="", sovits_weights="", ref_path="", prompt_text="", text_lang="zh", speed=0.0
    )
    run(engine.synthesize("你好。", zero))
    assert fake.calls[-1][1]["speed"] == 1.0


def test_401_is_readable_and_never_echoes_body(fake):
    fake.speech_reply = httpx.Response(
        401, json={"error": {"message": f"Incorrect API key provided: {KEY}"}}
    )
    engine = OpenAIAudioEngine(URL, api_key=KEY, model="tts-1", voice="alloy")
    with pytest.raises(TTSError) as err:
        run(engine.synthesize("你好。", SPEC))
    assert err.value.status == 401
    # 401/403 的正文可能是网关回显:只说状态,不带正文
    assert KEY not in err.value.message


def test_404_hints_the_v1_suffix(fake):
    fake.speech_reply = httpx.Response(404, json={"error": {"message": "Not Found"}})
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    with pytest.raises(TTSError) as err:
        run(engine.synthesize("你好。", SPEC))
    assert err.value.status == 404
    assert "/v1" in err.value.message


def test_400_shows_upstream_reason(fake):
    fake.speech_reply = httpx.Response(400, json={"error": {"message": "model not found"}})
    engine = OpenAIAudioEngine(URL, model="nope", voice="alloy")
    with pytest.raises(TTSError) as err:
        run(engine.synthesize("你好。", SPEC))
    assert err.value.status == 400
    assert "model not found" in err.value.message


def test_network_error_is_503(fake):
    fake.speech_reply = httpx.ConnectError("refused")
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    with pytest.raises(TTSError) as err:
        run(engine.synthesize("你好。", SPEC))
    assert err.value.status == 503


def test_empty_audio_is_502(fake):
    fake.speech_reply = httpx.Response(200, headers={"content-type": "audio/wav"}, content=b"")
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    with pytest.raises(TTSError) as err:
        run(engine.synthesize("你好。", SPEC))
    assert err.value.status == 502


def test_ping_accepts_missing_models_route(fake):
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    fake.models_reply = httpx.Response(404)
    run(engine.ping())  # 404 = 服务活着,只是没有 /models
    fake.models_reply = httpx.Response(401)
    with pytest.raises(TTSError) as err:
        run(engine.ping())
    assert err.value.status == 401


def test_reference_audio_is_not_supported():
    engine = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    with pytest.raises(TTSError) as err:
        run(engine.reference_audio("D:/refs/a.wav"))
    assert err.value.status == 400


def test_cache_material_tracks_voice_and_engine():
    a = OpenAIAudioEngine(URL, model="tts-1", voice="alloy")
    b = OpenAIAudioEngine(URL, model="tts-1", voice="nova")
    c = OpenAIAudioEngine("https://other.test/v1", model="tts-1", voice="alloy")
    assert a.cache_material("你好。", SPEC) != b.cache_material("你好。", SPEC)
    assert a.cache_material("你好。", SPEC) != c.cache_material("你好。", SPEC)
    # 换格式也是另一种声音
    d = OpenAIAudioEngine(URL, model="tts-1", voice="alloy", fmt="mp3")
    assert a.cache_material("你好。", SPEC) != d.cache_material("你好。", SPEC)


def test_speech_body_defaults_format():
    body = speech_body(model="tts-1", voice="alloy", fmt=DEFAULT_FORMAT, text="嗨", speed=1.0)
    assert body["response_format"] == "wav"


# ── API 层:连接的建/改/读,以及 key 不回显 ──────────────────


def make_openai(client: TestClient, **overrides) -> dict:
    payload = {
        "name": "远端 TTS",
        "api_type": "openai_audio",
        "base_url": URL,
        "model": "tts-1",
        "voice": "alloy",
        "api_key": KEY,
    }
    payload.update(overrides)
    r = client.post("/api/tts/connections", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_connection_requires_model_and_voice(client: TestClient):
    missing = client.post(
        "/api/tts/connections",
        json={"name": "x", "api_type": "openai_audio", "base_url": URL, "model": "", "voice": "alloy"},
    )
    assert missing.status_code == 400
    assert "model" in missing.json()["detail"]

    blank = client.post(
        "/api/tts/connections",
        json={"name": "x", "api_type": "openai_audio", "base_url": URL, "model": "tts-1", "voice": "  "},
    )
    assert blank.status_code == 400
    assert "voice" in blank.json()["detail"]


def test_key_is_write_only(client: TestClient):
    conn = make_openai(client)
    assert conn["has_key"] is True
    assert conn["model"] == "tts-1"
    assert conn["voice"] == "alloy"
    listed = client.get("/api/tts/connections")
    assert KEY not in listed.text
    assert "api_key" not in listed.text
    assert listed.json()[0]["has_key"] is True


def test_key_can_be_cleared(client: TestClient):
    conn = make_openai(client)
    kept = client.put(f"/api/tts/connections/{conn['id']}", json={"voice": "nova"})
    assert kept.json()["has_key"] is True
    assert kept.json()["voice"] == "nova"

    cleared = client.put(f"/api/tts/connections/{conn['id']}", json={"api_key": ""})
    assert cleared.status_code == 200
    assert cleared.json()["has_key"] is False


def test_update_rejects_blank_model_for_openai(client: TestClient):
    conn = make_openai(client)
    r = client.put(f"/api/tts/connections/{conn['id']}", json={"model": ""})
    assert r.status_code == 400


def test_openai_connection_test_uses_models(client: TestClient, fake):
    conn = make_openai(client)
    ok = client.post(f"/api/tts/connections/{conn['id']}/test")
    assert ok.status_code == 200
    assert fake.calls[-1][0].endswith("/models")

    fake.models_reply = httpx.Response(403)
    bad = client.post(f"/api/tts/connections/{conn['id']}/test")
    assert bad.status_code == 401
    assert KEY not in bad.text


def test_speak_needs_no_reference_audio(client: TestClient, fake):
    """OpenAI 兼容端点没有参考音频:声音只填名字和连接就能念。"""
    conn = make_openai(client)
    voice = client.post("/api/voices", json={"name": "林晚", "connection_id": conn["id"]})
    assert voice.status_code == 200, voice.text
    profile = voice.json()

    r = client.post("/api/tts/speak", json={"profile_id": profile["id"], "text": "要什么，我去拿。"})
    assert r.status_code == 200, r.text
    assert r.content == b"RIFF" + "要什么，我去拿。".encode()
    url, body, headers = fake.calls[-1]
    assert url == f"{URL}/audio/speech"
    assert body["voice"] == "alloy"  # 连接默认音色
    assert headers["authorization"] == f"Bearer {KEY}"

    # 同一个声音再念一次:命中缓存,不再发请求
    before = len(fake.calls)
    again = client.post("/api/tts/speak", json={"profile_id": profile["id"], "text": "要什么，我去拿。"})
    assert again.status_code == 200
    assert again.headers["x-tts-cache"] == "hit"
    assert len(fake.calls) == before


def test_profile_voice_overrides_connection_default(client: TestClient, fake):
    conn = make_openai(client)
    profile = client.post(
        "/api/voices",
        json={"name": "沈念", "connection_id": conn["id"], "params": {"voice": "shimmer"}},
    ).json()
    r = client.post("/api/tts/speak", json={"profile_id": profile["id"], "text": "嗯。"})
    assert r.status_code == 200, r.text
    assert fake.calls[-1][1]["voice"] == "shimmer"


def test_refs_import_is_rejected_for_openai(client: TestClient):
    conn = make_openai(client)
    r = client.post(
        "/api/voices/import",
        json={"connection_id": conn["id"], "refs": {"character": "林晚", "refs": [{"file": "D:/a.wav", "text": "嗨"}]}},
    )
    assert r.status_code == 400
    assert "参考音频" in r.json()["detail"]
