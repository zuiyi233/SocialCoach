"""按连接取引擎实例。实例要跨请求保留:锁、当前加载的权重、是否预热过都记在它身上。

地址、采样步数或情绪强度改了就换一个新实例(旧实例记住的状态对新配置没有意义)。
锁、加载着的权重、热没热是那台服务自己的状态,按地址共用(base.ServerState;素材架构设计 5.10 P21):
两个连接指向同一台服务时,一次只合成一句,也不会把对方刚换上的权重当成自己的。
"""

import hashlib

from app.models import TtsConnection
from app.tts.base import ServerState, TTSEngine, TTSError
from app.tts.gpt_sovits import GptSovitsEngine
from app.tts.indextts import IndexTtsEngine
from app.tts.openai_audio import DEFAULT_FORMAT, OpenAIAudioEngine

# 用户试听(2026-09-25):情绪强度高的好。服务端会先把向量归一化(合计压到 0.8 以内),
# 所以 1.0 并不会太过头
DEFAULT_EMO_ALPHA = 1.0

_engines: dict[str, tuple[tuple, TTSEngine]] = {}
_servers: dict[tuple[str, str], ServerState] = {}


def server_state(api_type: str, base_url: str) -> ServerState:
    key = (api_type, (base_url or "").rstrip("/").lower())
    state = _servers.get(key)
    if state is None:
        state = _servers[key] = ServerState()
    return state


def emo_alpha_of(conn: TtsConnection) -> float:
    """IndexTTS 的情绪强度,存在连接的 options 里;老数据没有就用默认值。"""
    v = (conn.options or {}).get("emo_alpha")
    return float(v) if isinstance(v, (int, float)) else DEFAULT_EMO_ALPHA


def openai_options(conn: TtsConnection) -> tuple[str, str, str, str]:
    """OpenAI 兼容端点的 (api_key, model, voice, format),都存在连接的 options 里。"""
    opts = conn.options or {}
    return (
        str(opts.get("api_key") or ""),
        str(opts.get("model") or ""),
        str(opts.get("voice") or ""),
        str(opts.get("format") or DEFAULT_FORMAT),
    )


def engine_for(conn: TtsConnection) -> TTSEngine:
    key, model, voice, fmt = openai_options(conn)
    # key 换成摘要进签名:改了 key 要换新实例(旧实例还记着老 key),但签名不该带着明文到处走
    digest = hashlib.sha256(key.encode()).hexdigest()[:12] if key else ""
    sig = (conn.api_type, conn.base_url, conn.sample_steps, emo_alpha_of(conn), model, voice, fmt, digest)
    hit = _engines.get(conn.id)
    if hit is not None and hit[0] == sig:
        return hit[1]
    state = server_state(conn.api_type, conn.base_url)
    if conn.api_type == "gpt_sovits":
        engine: TTSEngine = GptSovitsEngine(conn.base_url, conn.sample_steps, state)
    elif conn.api_type == "indextts":
        engine = IndexTtsEngine(conn.base_url, emo_alpha_of(conn), state)
    elif conn.api_type == "openai_audio":
        engine = OpenAIAudioEngine(conn.base_url, api_key=key, model=model, voice=voice, fmt=fmt)
    else:
        raise TTSError(400, f"不支持的语音引擎:{conn.api_type}")
    _engines[conn.id] = (sig, engine)
    return engine


def forget_engine(conn_id: str) -> None:
    _engines.pop(conn_id, None)


def reset_engines() -> None:
    """测试用:每个测试从干净的状态开始。"""
    _engines.clear()
    _servers.clear()
