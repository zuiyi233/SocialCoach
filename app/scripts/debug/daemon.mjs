/**
 * 调试守护进程：CLI 的常驻后端。
 *
 * 为什么需要常驻：CDP 的 Fetch 拦截、控制台事件、页面状态都绑定在一条会话上。
 * 每条命令新起一个进程的话，`model.use` 下一跳就失效，`ui.click` 也拿不到上一页的上下文。
 *
 * 它只监听 127.0.0.1 的随机端口，把端口写进 app/.debug/session.json；CLI 据此通信。
 * 不对外网暴露，也不进版本库。
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DebugEngine, APP_ROOT, findChrome } from "./engine.mjs";

const DEBUG_ROOT = join(APP_ROOT, ".debug");
const SESSION_FILE = join(DEBUG_ROOT, "session.json");
const SERVER_LOG = join(DEBUG_ROOT, "next-dev.log");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const base = (args.base || process.env.SC_DEBUG_BASE || "http://localhost:3000").replace(/\/$/, "");
const serve = args.serve === "true";
const headless = args.headless !== "0";
const chrome = args.chrome || findChrome();
const timeoutMs = Number(args.timeout || 180000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** dev 噪声：无头 Chrome 下 Next HMR 常被代理/端口策略打断，不代表页面有错。 */
const DEV_NOISE = /_next\/hmr|ERR_INVALID_HTTP_RESPONSE/;
const IMPORTANT = (e) =>
  e.kind === "exception" ||
  e.kind === "error" ||
  (e.kind === "console" && e.level === "error") ||
  (e.kind === "log" && e.level === "error") ||
  (e.kind === "fetch" && (e.status >= 400 || e.error)) ||
  String(e.kind).startsWith("model.");

function selectEvents(events, all) {
  const list = all
    ? events
    : events.filter((e) => IMPORTANT(e) && !DEV_NOISE.test(String(e.text ?? "")));
  return list.slice(-20);
}

async function reachable(url, timeout = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.status < 500;
  } catch {
    return false;
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {}
}

let serverProcess = null;
let engine = null;
let rpcServer = null;

async function startNextDev() {
  // 旧 dev server 正在退出时端口还会短暂应答；隔 800ms 再确认一次，避免误判成“已就绪”。
  if (await reachable(base)) {
    await sleep(800);
    if (await reachable(base)) return null;
  }
  mkdirSync(DEBUG_ROOT, { recursive: true });
  const logFd = await import("node:fs").then((fs) => fs.openSync(SERVER_LOG, "a"));
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  serverProcess = spawn(command, ["dev"], {
    cwd: APP_ROOT,
    shell: true,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  serverProcess.unref();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await reachable(base)) return serverProcess.pid;
    if (serverProcess.exitCode !== null) throw new Error(`next dev exited (${serverProcess.exitCode}); see ${SERVER_LOG}`);
    await sleep(500);
  }
  throw new Error(`next dev did not become ready at ${base} within ${timeoutMs}ms; see ${SERVER_LOG}`);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error("request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function shutdown(code = 0) {
  try { await engine?.stop(); } catch {}
  if (serverProcess?.pid) killTree(serverProcess.pid);
  try { rpcServer?.close(); } catch {}
  try { rmSync(SESSION_FILE, { force: true }); } catch {}
  process.exit(code);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

async function main() {
  mkdirSync(DEBUG_ROOT, { recursive: true });
  const serverPid = serve ? await startNextDev() : null;
  engine = new DebugEngine({ base, headless, chrome });
  const info = await engine.start();
  // 预热：别把页面停在 about:blank，否则第一条 state.* 会撞 localStorage SecurityError。
  await engine.navigate("/").catch((error) => console.error(`[debug] warmup navigate failed: ${error.message}`));

  rpcServer = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, {
        ok: true,
        pid: process.pid,
        base,
        chrome: info.chrome,
        serverPid,
        startedAt: Date.now(),
        modelMode: engine.modelMode,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/rpc") {
      let payload = {};
      try {
        payload = JSON.parse(await readBody(req));
      } catch (error) {
        send(res, 400, { ok: false, error: { message: String(error.message) } });
        return;
      }
      const { cmd, args: callArgs = {} } = payload;
      if (cmd === "shutdown") {
        send(res, 200, { ok: true, data: { shuttingDown: true }, console: [] });
        setTimeout(() => void shutdown(0), 50);
        return;
      }
      let data = null;
      let error = null;
      try {
        data = await engine.call(cmd, callArgs);
      } catch (e) {
        error = { message: String(e.message || e), stack: e.stack ? String(e.stack).split("\n").slice(0, 8).join("\n") : undefined };
      }
      const events = selectEvents(engine.drainEvents(), callArgs.console === "all" || callArgs.console === true);
      send(res, 200, error ? { ok: false, error, console: events } : { ok: true, data, console: events });
      return;
    }
    send(res, 404, { ok: false, error: { message: "not found" } });
  });

  await new Promise((resolve) => rpcServer.listen(0, "127.0.0.1", resolve));
  const port = rpcServer.address().port;
  writeFileSync(
    SESSION_FILE,
    `${JSON.stringify({ pid: process.pid, port, base, chrome: info.chrome, serverPid, headless, startedAt: Date.now() }, null, 2)}\n`,
  );
  console.log(`[debug] listening on 127.0.0.1:${port} base=${base}`);
}

main().catch(async (error) => {
  console.error(`[debug] failed: ${error?.stack || error}`);
  if (serverProcess?.pid) killTree(serverProcess.pid);
  try { rmSync(SESSION_FILE, { force: true }); } catch {}
  process.exit(1);
});
