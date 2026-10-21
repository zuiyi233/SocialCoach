"""一句话生成角色的任务化接口（Love Studio 角色生成向导，后端部分）。

- `POST /api/character/generate`   起一个后台任务，立即返回 `{job_id}`。
- `GET  /api/character/generate/{job_id}`  查 `{status, step, total, message, result?, error?}`。

生图 + LLM 一次可能跑几分钟，走后台任务避免请求超时。

v1 限制：任务表是进程内的（单进程 uvicorn 下够用）；多 worker / 重启后
job_id 查不到，前端按 404 提示重新生成即可。完成后 1 小时由下一次请求顺手清理。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.plugins.imagegen import character

router = APIRouter(prefix="/api/character", tags=["character"])

# 完成后保留多久（秒），超时的 job 在下次请求时清掉
JOB_TTL = 3600
# v1：任务表在进程内，不落库、不跨进程共享（见模块注释）
_JOBS: dict[str, dict] = {}
# 加锁：POST 起任务和后台任务更新状态都在同一个事件循环，锁只是防将来换线程
_jobs_lock = asyncio.Lock()
_job_seq = 0


class CharacterGenerateIn(BaseModel):
    description: str = Field(..., min_length=1, max_length=2000)
    name: str | None = Field(None, min_length=1, max_length=80)
    language: Literal["zh", "en"] = "zh"
    style: str | None = Field(None, max_length=500)
    expression_count: int = Field(4, ge=2, le=8)
    scene_count: int = Field(3, ge=0, le=6)


def _new_db() -> Session:
    """后台任务用自己的会话（请求的 get_db 已随响应关掉）。测试可替换。"""
    return SessionLocal()


def _purge_old() -> None:
    now = time.time()
    stale = [jid for jid, job in _JOBS.items() if job.get("finished_at") and now - job["finished_at"] > JOB_TTL]
    for jid in stale:
        _JOBS.pop(jid, None)


@router.post("/generate")
async def start_generate(req: CharacterGenerateIn):
    global _job_seq
    _purge_old()
    async with _jobs_lock:
        _job_seq += 1
        job_id = f"cg-{int(time.time())}-{_job_seq}"
        _JOBS[job_id] = {
            "status": "running",
            "step": 0,
            "total": 0,
            "message": "已提交，等待开始",
            "result": None,
            "error": None,
            "created_at": time.time(),
            "finished_at": None,
        }
    # 后台任务：不 await，请求先回 job_id
    asyncio.create_task(_run_job(job_id, req.model_dump()))
    return {"job_id": job_id}


@router.get("/generate/{job_id}")
def get_generate(job_id: str):
    job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在或已过期")
    return {
        "status": job["status"],
        "step": job["step"],
        "total": job["total"],
        "message": job["message"],
        "result": job["result"],
        "error": job["error"],
    }


async def _run_job(job_id: str, payload: dict) -> None:
    """后台执行 plan + 生图 + 落库。所有异常都收进 job，不往外抛。"""
    job = _JOBS[job_id]

    def progress(step: int, total: int, message: str) -> None:
        job["step"] = step
        job["total"] = total
        job["message"] = message

    db = _new_db()
    try:
        result = await character.generate_character(
            db,
            description=payload["description"],
            name=payload.get("name"),
            language=payload.get("language") or "zh",
            style=payload.get("style"),
            expression_count=payload.get("expression_count", 4),
            scene_count=payload.get("scene_count", 3),
            progress=progress,
        )
        job["status"] = "done"
        job["message"] = "完成"
        job["result"] = asdict(result)
    except character.CharacterGenerationError as e:
        job["status"] = "error"
        job["message"] = "失败"
        job["error"] = e.message
    except Exception as e:  # noqa: BLE001 —— 后台任务不许炸到事件循环
        job["status"] = "error"
        job["message"] = "失败"
        job["error"] = f"生成失败：{e}"
    finally:
        job["finished_at"] = time.time()
        db.close()
