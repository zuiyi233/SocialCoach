"""OpenAI 兼容的生图后端（/v1/images/generations）。

NovelAI 那条路（nai.py）只认 NovelAI 自己的模型名和 zip 响应；这一条走通用的
OpenAI Images 形状，给自带网关 / Agnes / SenseNova 这类模型用：

    POST {base_url}/images/generations
    {"model": "...", "prompt": "...", "n": 1, "size": "1024x1024"}
    → {"data": [{"url": "..."} | {"b64_json": "..."}]}

配置（base_url / model / key）存在 app_settings：`imagegen.openai` 与
`secret.imagegen_openai_key`。key 只写不读，/api/settings 读不到它。
"""

from __future__ import annotations

import asyncio
import base64
import time
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.assets.common import sniff_image_mime
from app.models import AppSetting

CONFIG_SETTING = "imagegen.openai"
KEY_SETTING = "secret.imagegen_openai_key"
# 这台网关实际暴露的模型名；用户清单里的带后缀名字在当前网关没有渠道
MODELS = (
    "agnes-image-2.0-flash",
    "agnes-image-2.1-flash",
    "agnes-image-2.5-flash",
    "sensenova-u1.5-lite",
    "sensenova-u1.5-fast",
)
DEFAULT_MODEL = "agnes-image-2.5-flash"
# 一张图通常 10–60 秒；参考图/大尺寸可能更久
TIMEOUT = 180.0
# 同一进程里排队，避免网关并发限制（Agnes 免费额度尤其容易 429）
_lock = asyncio.Lock()


class OpenAIImageError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Config:
    base_url: str
    model: str


def config(db: Session) -> Config:
    row = db.get(AppSetting, CONFIG_SETTING)
    value = row.value if row is not None and isinstance(row.value, dict) else {}
    base_url = str(value.get("base_url") or "").strip().rstrip("/")
    model = str(value.get("model") or DEFAULT_MODEL).strip()
    return Config(base_url=base_url, model=model if model in MODELS else DEFAULT_MODEL)


def key(db: Session) -> str | None:
    row = db.get(AppSetting, KEY_SETTING)
    value = row.value.strip() if row is not None and isinstance(row.value, str) else ""
    return value or None


def save_config(db: Session, *, base_url: str, model: str, api_key: str | None = None) -> Config:
    base_url = base_url.strip().rstrip("/")
    model = model.strip()
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("base_url 要是 http(s) 地址")
    if model not in MODELS:
        raise ValueError(f"不认识的模型 {model}")
    row = db.get(AppSetting, CONFIG_SETTING)
    value = {"base_url": base_url, "model": model}
    if row is None:
        db.add(AppSetting(key=CONFIG_SETTING, value=value))
    else:
        row.value = value
    if api_key is not None:
        key_row = db.get(AppSetting, KEY_SETTING)
        api_key = api_key.strip()
        if not api_key:
            if key_row is not None:
                db.delete(key_row)
        elif key_row is None:
            db.add(AppSetting(key=KEY_SETTING, value=api_key))
        else:
            key_row.value = api_key
    db.commit()
    return Config(base_url=base_url, model=model)


def _error_message(status: int, body: str) -> str:
    body = body.strip()
    if len(body) > 500:
        body = body[:500] + "…"
    return f"生图服务返回 {status}：{body or '空响应'}"


async def _download(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        response = await client.get(url)
    if response.status_code != 200:
        raise OpenAIImageError(response.status_code, f"下载生成图失败：HTTP {response.status_code}")
    return response.content


async def generate_one(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    size: str = "1024x1024",
) -> bytes:
    """生成一张，返回图片字节。失败抛 OpenAIImageError（带可读中文）。"""
    if not base_url:
        raise OpenAIImageError(400, "还没配置生图服务的 Base URL（设置 → 生图 → OpenAI 兼容）")
    if not api_key:
        raise OpenAIImageError(400, "还没填生图服务的 API Key")
    payload = {"model": model, "prompt": prompt, "n": 1, "size": size}
    async with _lock:
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.post(
                    f"{base_url}/images/generations",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
        except httpx.TimeoutException as e:
            raise OpenAIImageError(504, "生图服务超时（180 秒）") from e
        except httpx.HTTPError as e:
            raise OpenAIImageError(502, f"连不上生图服务：{e}") from e
        if response.status_code != 200:
            raise OpenAIImageError(response.status_code, _error_message(response.status_code, response.text))
        try:
            body = response.json()
        except Exception as e:
            raise OpenAIImageError(502, "生图服务回的不是 JSON") from e
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list) or not data:
            raise OpenAIImageError(502, "生图服务没有返回图片")
        item = data[0] if isinstance(data[0], dict) else {}
        if item.get("b64_json"):
            try:
                raw = base64.b64decode(item["b64_json"])
            except Exception as e:
                raise OpenAIImageError(502, "生图服务返回的 base64 解不开") from e
        elif item.get("url"):
            raw = await _download(str(item["url"]))
        else:
            raise OpenAIImageError(502, "生图服务返回的条目既没有 url 也没有 b64_json")
        if sniff_image_mime(raw) is None:
            raise OpenAIImageError(502, "生图服务返回的不是图片")
        # 免费模型有时几秒就回；慢的留个下限，别让 ms 显示 0
        _ = max(1, int((time.monotonic() - started) * 1000))
        return raw
