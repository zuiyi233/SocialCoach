"""OpenAI 兼容 /audio/speech 适配器。

对面是 `POST {base_url}/audio/speech`(base_url 要填到 `/v1` 那一级),body
`{model, input, voice, response_format, speed}`,有 key 时带 `Authorization: Bearer`。
经 new-api / one-api 这类网关暴露出来的 TTS、以及官方 OpenAI 都走这个形状。

和另外两个引擎的差别:
- 没有服务端权重、也没有参考音频:音色就是请求里的 voice 字符串(alloy、nova,
  或者自建克隆音色的 id)。所以 `reference_audio` 一律报「没有这个接口」。
- 没有「切换权重」这回事,不共用 `ServerState` 的锁:并发请求交给对面,这边不串行。
- 可能走公网、要 key:key 只进请求头,不进 `request_body` / 缓存材料 / 报错文本。

base_url 不做自动补全:有的网关把 speech 挂在 /v1 下、有的自己再加一层,
猜错只会得到更难懂的 404 —— 地址填错就如实报「找不到 /audio/speech」。
"""

from typing import Any

import httpx

from app.tts.base import TTSError, VoiceSpec
from app.tts.http import make_tts_client, transport_error

PING_TIMEOUT = 5.0
SPEECH_TIMEOUT = 60.0
WARMUP_TEXT = "你好。"
DEFAULT_FORMAT = "wav"
# OpenAI 的 speed 只收 0.25–4;超出范围服务端会 400,这里先夹住
SPEED_MIN, SPEED_MAX = 0.25, 4.0
_DETAIL_MAX = 300

FORMAT_MIME: dict[str, str] = {
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "pcm": "audio/pcm",
}


def _speed(raw: float) -> float:
    """声音上的语速 → 请求里的 speed;没设或非正数就是 1.0(用服务默认)。"""
    if not raw or raw <= 0:
        return 1.0
    return round(min(SPEED_MAX, max(SPEED_MIN, raw)), 3)


def speech_body(*, model: str, voice: str, fmt: str, text: str, speed: float) -> dict[str, Any]:
    return {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": fmt,
        "speed": _speed(speed),
    }


def _detail(res: httpx.Response) -> str:
    """OpenAI 形状的报错是 {"error": {"message": ...}};网关们还常用 {"message"} / {"detail"}。"""
    try:
        body = res.json()
    except ValueError:
        body = None
    text = ""
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            text = str(error.get("message") or "")
        elif isinstance(error, str):
            text = error
        text = text or str(body.get("message") or body.get("detail") or "")
    if not text:
        return f"HTTP {res.status_code}"
    return text[:_DETAIL_MAX]


class OpenAIAudioEngine:
    """一个连接一个实例(registry 按连接缓存);model / voice / format / key 变了就换新实例。"""

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str = "",
        model: str = "",
        voice: str = "",
        fmt: str = DEFAULT_FORMAT,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.voice = voice
        self.fmt = fmt if fmt in FORMAT_MIME else DEFAULT_FORMAT

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def request_body(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        # 声音档案可以在 params.voice 里覆盖连接默认音色
        return speech_body(
            model=self.model,
            voice=str(voice.params.get("voice") or self.voice),
            fmt=self.fmt,
            text=text,
            speed=voice.speed,
        )

    def cache_material(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        # 同一句话发到两台不同的服务,声音可能不一样:地址也进缓存键
        return {"engine": "openai_audio", "base_url": self.base_url, "body": self.request_body(text, voice)}

    async def synthesize(self, text: str, voice: VoiceSpec) -> tuple[bytes, str]:
        try:
            async with make_tts_client(self.base_url, SPEECH_TIMEOUT) as client:
                res = await client.post(
                    f"{self.base_url}/audio/speech",
                    json=self.request_body(text, voice),
                    headers=self._headers(),
                )
        except httpx.HTTPError as e:
            raise TTSError(*transport_error(self.base_url, "TTS", e)) from e
        if res.status_code != 200:
            raise self._http_error(res)
        if not res.content:
            raise TTSError(502, "语音服务回了 200,但响应里没有音频")
        mime = res.headers.get("content-type", "").split(";")[0].strip() or FORMAT_MIME[self.fmt]
        return res.content, mime

    async def warmup(self, voice: VoiceSpec, force: bool) -> None:
        # 远端服务没有权重要加载、也没有本地缓存要热:真发一次合成只会白花一次配额,探活就够
        await self.ping()

    async def ping(self) -> None:
        """GET {base_url}/models:只探连不连得上、key 收不收。

        没有 /models 的网关(404 / 405)也算通 —— 能给出这两个码,说明服务是活着的。
        """
        try:
            async with make_tts_client(self.base_url, PING_TIMEOUT) as client:
                res = await client.get(f"{self.base_url}/models", headers=self._headers())
        except httpx.HTTPError as e:
            raise TTSError(*transport_error(self.base_url, "TTS", e)) from e
        if res.status_code in (401, 403):
            raise self._rejected(res)
        if res.status_code in (200, 404, 405):
            return
        raise TTSError(502, f"语音服务返回 HTTP {res.status_code}:{_detail(res)}")

    async def reference_audio(self, path: str) -> tuple[bytes, str]:
        raise TTSError(
            400,
            "OpenAI 兼容端点没有服务端参考音频:音色是 voice id,不是音频文件",
        )

    def _rejected(self, res: httpx.Response) -> TTSError:
        # 401/403 的响应体可能带网关自己的提示,但也可能回显请求头:不带正文,只说状态
        return TTSError(
            401,
            f"语音服务拒绝了 key(HTTP {res.status_code})。检查地址和 key 是否配对",
        )

    def _http_error(self, res: httpx.Response) -> TTSError:
        if res.status_code in (401, 403):
            return self._rejected(res)
        if res.status_code == 400:
            return TTSError(400, f"语音服务不接受这个请求:{_detail(res)}")
        if res.status_code == 404:
            return TTSError(
                404,
                "找不到 /audio/speech:地址要填到 /v1 那一级(比如 https://host/v1)",
            )
        if res.status_code == 429:
            return TTSError(429, f"语音服务限流了:{_detail(res)}")
        return TTSError(502, f"语音服务返回 HTTP {res.status_code}:{_detail(res)}")
