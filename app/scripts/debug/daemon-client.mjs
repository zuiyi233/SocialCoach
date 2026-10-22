/**
 * 守护进程客户端：把 debug.mjs 里的 readSession / health / ensureDaemon / rpc / down
 * 原样搬出，供 CLI 与未来 MCP 层共用。
 *
 * 端口与存活信息在 <debugRoot>/session.json（daemon 启动时写入）；本模块不持有状态。
 * spawnFn / sleepFn 只为了测试注入，默认用真的。
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDaemonClient(options = {}) {
  const { appRoot, debugRoot, daemonPath, base = "http://localhost:3000", spawnFn = spawn, sleepFn, timeout = 200000 } = options;
  const sleep = sleepFn ?? defaultSleep;
  const sessionFile = join(debugRoot, "session.json");
  const healthImpl = options.healthFn ?? health;

  /** 读 session.json；没有或损坏返回 null（与旧 readSession 一致）。 */
  function session() {
    try {
      return JSON.parse(readFileSync(sessionFile, "utf8"));
    } catch {
      return null;
    }
  }

  /** GET /health；任何失败返回 null。 */
  async function health(port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /**
   * scripts/debug 下最晚的源码修改时间。守护进程把 engine.mjs 常驻在内存里，
   * 改了引擎不重启，跑出来的还是旧代码——「改完还是红 / 还是绿」都可能是假的。
   */
  function codeMtime() {
    try {
      const dir = dirname(daemonPath);
      return readdirSync(dir)
        .filter((name) => name.endsWith(".mjs"))
        .reduce((max, name) => Math.max(max, statSync(join(dir, name)).mtimeMs), 0);
    } catch {
      return 0;
    }
  }

  /**
   * 已有可用会话就复用，否则 spawn 守护进程并等 session.json + /health 就绪。
   * 超时抛出带 daemon.log 尾部（25 行）的错误；错误文案与旧 ensureDaemon 逐字一致。
   */
  async function ensure({ serve = false, headless = true, timeout: waitMs } = {}) {
    const existing = session();
    if (existing?.port && (await healthImpl(existing.port))) {
      // 源码比会话新 = 守护进程在跑旧代码，先关掉再起，别让人拿旧引擎下结论。
      if (codeMtime() <= Number(existing.startedAt ?? 0)) return existing;
      await stop();
      // 老守护进程退出时会删 session.json。不等它退干净就起新的，那一下 rm 会把
      // 新会话文件删掉，后面所有 rpc 都报 no daemon session（整轮套件全红）。
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && (await healthImpl(existing.port))) await sleep(100);
    }
    if (existing) rmSync(sessionFile, { force: true });

    mkdirSync(debugRoot, { recursive: true });
    const logFd = openSync(join(debugRoot, "daemon.log"), "a");
    const child = spawnFn(
      process.execPath,
      [daemonPath, `--base=${base}`, `--serve=${serve}`, `--headless=${headless}`],
      { cwd: appRoot, detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true },
    );
    child.unref();

    const wait = Number(waitMs ?? timeout);
    const until = Date.now() + wait;
    while (Date.now() < until) {
      const s = session();
      if (s?.port && (await healthImpl(s.port))) return s;
      await sleep(300);
    }
    const log = join(debugRoot, "daemon.log");
    let tail = "";
    try {
      tail = readFileSync(log, "utf8").split("\n").slice(-25).join("\n");
    } catch {}
    throw new Error(`debug daemon did not start within ${wait}ms\n--- ${log} ---\n${tail}`);
  }

  /** POST /rpc；payload.ok === false 时抛 Error 并挂 error.console。 */
  async function rpc(cmd, args = {}) {
    const s = session();
    if (!s?.port) throw new Error("no daemon session; run `pnpm debug up` first");
    const res = await fetch(`http://127.0.0.1:${s.port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd, args }),
      signal: AbortSignal.timeout(240000),
    });
    const payload = await res.json();
    if (!payload.ok) {
      const error = new Error(payload.error?.message ?? "debug command failed");
      error.console = payload.console ?? [];
      throw error;
    }
    return payload;
  }

  /** 通知 daemon 关闭并删 session.json；本就无会话则只返回 down:false。 */
  async function stop() {
    const s = session();
    if (!s?.port) return { down: false };
    try {
      await rpc("shutdown");
    } catch {}
    rmSync(sessionFile, { force: true });
    return { down: true, pid: s.pid };
  }

  return { session, health, ensure, rpc, stop };
}