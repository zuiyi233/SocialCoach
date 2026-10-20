"""API 密钥策略:默认存本地 SQLite,可在设置里关掉。

开(默认):key 存进连接的 api_key 列;关:只存进程内存 _MEMORY,重启 Love Studio 后需重填。
约束(spec-love-studio §7,2026-10-21 拍板):密钥不进日志、不回显、不提交;ConnectionOut 只回 has_api_key。

本模块不碰网络;所有函数都只做「DB + 内存」两层存取。进程内存对应当前后端进程,
所以「模拟重启」在测试里就是 reset_memory()。
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApiConnection, AppSetting

REMEMBER_KEY = "security.remember_api_keys"

# 关掉「记住密钥」时 key 的家:connection id → key,只活在当前进程。
_MEMORY: dict[str, str] = {}


def reset_memory() -> None:
    """仅测试用:清空进程内存,等价于后端重启后内存里的 key 全部消失。"""
    _MEMORY.clear()


def remember_enabled(db: Session) -> bool:
    """读「记住密钥」设置;没存过 = 默认开。"""
    row = db.get(AppSetting, REMEMBER_KEY)
    if row is None:
        return True
    return row.value is True


def effective_key(conn: ApiConnection) -> str | None:
    """DB 里有 key 用它,没有退回进程内存。"""
    if conn.api_key:
        return conn.api_key
    return _MEMORY.get(conn.id)


def has_key(conn: ApiConnection) -> bool:
    return effective_key(conn) is not None


def store_key(db: Session, conn: ApiConnection, key: str | None) -> None:
    """存一次 key(创建 / 显式改 key 用)。

    key 非空:记住开着 → 写 DB、清内存;关着 → DB 置空、写内存。
    key 空 / None:两边都清(显式清除)。
    """
    key = (key or "").strip() or None
    if key:
        if remember_enabled(db):
            conn.api_key = key
            _MEMORY.pop(conn.id, None)
        else:
            conn.api_key = None
            _MEMORY[conn.id] = key
    else:
        conn.api_key = None
        _MEMORY.pop(conn.id, None)


def forget_key(conn_id: str) -> None:
    """删除连接时清掉它的内存 key。"""
    _MEMORY.pop(conn_id, None)


def set_remember(db: Session, remember: bool) -> None:
    """切「记住密钥」开关,并把已有 key 搬到该在的地方,然后 commit。

    关:DB 里非空的 key 全部移进内存、DB 置空。
    开:内存里的 key 写回对应连接(连接还在的话),清空内存。
    """
    row = db.get(AppSetting, REMEMBER_KEY)
    if row is None:
        row = AppSetting(key=REMEMBER_KEY, value=remember)
        db.add(row)
    else:
        row.value = remember
    if remember:
        for conn_id, key in list(_MEMORY.items()):
            conn = db.get(ApiConnection, conn_id)
            if conn is not None:
                conn.api_key = key
            _MEMORY.pop(conn_id, None)
    else:
        for conn in db.scalars(select(ApiConnection)).all():
            if conn.api_key:
                _MEMORY[conn.id] = conn.api_key
                conn.api_key = None
    db.commit()
