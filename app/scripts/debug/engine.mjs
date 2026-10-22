/**
 * AI 调试引擎：持有 Chrome + CDP 连接，对外暴露语义命令。
 *
 * 设计目标（spec-ai-debug-harness.md）：
 * - 不做视觉识别、不模拟人类坐标点击。所有交互走 `data-debug` 选择器或可访问名，
 *   由页面内 `__sc` 帮助函数完成 click / type / wait。
 * - 模型调用可回放：`model.use` 用 CDP Fetch 拦截 `/api/*`，按路由返回夹具，
 *   整条恋爱 / 练习流程可离线、确定性、零花费跑完。
 * - 观测不靠截图：控制台错误、未处理异常、API 往返都进事件缓冲，随每条命令返回。
 *
 * 这个文件不启动守护进程，也不解析命令行；它只负责“在页面里做事”。
 * CLI 见 ../debug.mjs，HTTP 壳见 ./daemon.mjs。
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audioStubSource } from "./audio-stub.mjs";
import { canvasStubSource, summarizeCanvas } from "./canvas-stub.mjs";
import { mergeRecording } from "./recorder.mjs";
import { speechStubSource } from "./speech-stub.mjs";
import { createTabs } from "./tabs.mjs";
import { deepMatch, getPath, describeMismatch } from "./assertions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(HERE, "../..");
const DEBUG_ROOT = join(APP_ROOT, ".debug");
const FIXTURE_ROOT = join(APP_ROOT, "debug", "fixtures");
/** 录制时要把这些 CLI 意图一起写进场景：导航、装夹具、准备状态。 */
const RECORDED_CLI = new Set(["nav", "state.load", "state.set", "model.use", "ui.click", "ui.type"]);

/** apiCalls 环形缓冲上限：assert.api 只回看最近这些请求。 */
const API_CALL_LIMIT = 200;

/** `[data-debug="love.send"]` → `love.send`；别的选择器原样返回。 */
export function anchorName(target) {
  const text = String(target ?? "");
  const match = text.match(/^\[data-debug=["']?([^"'\]]+)["']?\]$/);
  return match ? match[1] : text;
}

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export function findChrome() {
  return CHROME_CANDIDATES.find((p) => p && existsSync(p)) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Git Bash 会把看起来像路径的参数做 MSYS 转换：`/` → `C:/Program Files/Git`，
 * `/love` → `C:/Program Files/Git/love`。CLI 无法可靠关闭调用方的转换，
 * 所以在入口把这种明显被转过的前缀还原回应用路由。
 */
export function normalizeRoute(path) {
  if (!path || path === "home") return "/";
  // 绝对 URL 原样返回：Studio 在 :5180，主站在 :3000，同一个守护进程要能两处跑。
  if (/^https?:/i.test(String(path))) return String(path);
  const converted = String(path).match(/^[A-Za-z]:[\\/]Program Files[\\/]Git[\\/]?(.*)$/);
  if (converted) return `/${converted[1].replace(/\\/g, "/")}`.replace(/\/+$/, "") || "/";
  return String(path).startsWith("/") ? String(path) : `/${path}`;
}

/** 页面内帮助函数。每次导航都会由 addScriptToEvaluateOnNewDocument 重新注入。 */
const PAGE_HELPERS = String.raw`
${canvasStubSource()}
${audioStubSource()}
(() => {
  if (window.__sc && window.__sc.version === 1) return "already";
  const TRACE_KEY = "__sc_trace_v1";
  const TRACE_LIMIT = 400;
  const readTrace = () => { try { return JSON.parse(sessionStorage.getItem(TRACE_KEY) || "[]"); } catch { return []; } };
  const writeTrace = (list) => { try { sessionStorage.setItem(TRACE_KEY, JSON.stringify(list.slice(-TRACE_LIMIT))); } catch {} };
  const push = (e) => { const list = readTrace(); list.push(Object.assign({ at: Date.now() }, e)); writeTrace(list); };
  const clip = (v) => {
    try {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return s && s.length > 2000 ? s.slice(0, 2000) + "…" : s;
    } catch { return String(v); }
  };

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const method = (init && init.method) || (input && input.method) || "GET";
    const started = performance.now();
    try {
      const res = await origFetch.apply(this, arguments);
      const ms = Math.round(performance.now() - started);
      let body = null;
      if (url.indexOf("/api/") !== -1) { try { body = clip(await res.clone().text()); } catch {} }
      push({ kind: "fetch", url, method, status: res.status, ms, body });
      return res;
    } catch (error) {
      push({ kind: "fetch", url, method, ms: Math.round(performance.now() - started), error: String((error && error.message) || error) });
      throw error;
    }
  };

  const origError = console.error;
  console.error = function () {
    push({ kind: "console.error", text: Array.prototype.map.call(arguments, clip).join(" ") });
    return origError.apply(this, arguments);
  };
  const origWarn = console.warn;
  console.warn = function () {
    push({ kind: "console.warn", text: Array.prototype.map.call(arguments, clip).join(" ") });
    return origWarn.apply(this, arguments);
  };
  addEventListener("error", (e) => push({ kind: "error", text: String(e.message || e.error || "error"), stack: clip((e.error && e.error.stack) || "") }));
  addEventListener("unhandledrejection", (e) => push({ kind: "rejection", text: clip((e.reason && (e.reason.stack || e.reason.message)) || e.reason) }));

  // 存档写入追踪：谁在什么时候写了 localStorage。多窗口 / 夹具 / 页面卸载的写入
  // 互相踩踏时，只看「另一窗口修改了这场练习」根本判不出是谁写的。
  const traceWrite = (op, key, length) => {
    const stack = String(new Error().stack || "").split("\n").slice(2, 5).map((line) => line.trim()).join(" | ");
    push({ kind: "storage", text: op + " " + key + " len=" + length, stack: clip(stack) });
  };
  const origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    const result = origSetItem.call(this, key, value);
    if (String(key).indexOf("socialcoach") === 0) traceWrite("set", key, String(value).length);
    return result;
  };
  const origRemoveItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (key) {
    const result = origRemoveItem.call(this, key);
    if (String(key).indexOf("socialcoach") === 0) traceWrite("remove", key, 0);
    return result;
  };

  // Web Locks 追踪：ifAvailable 拿不到锁时应用会判「另一窗口修改」，
  // 但到底是别人占着、还是自己上一轮没释放，只能看这里。
  const locks = navigator.locks;
  if (locks && typeof locks.request === "function") {
    const origLockRequest = locks.request.bind(locks);
    let lockSeq = 0;
    locks.request = function (name, options, callback) {
      const opts = typeof options === "function" ? {} : (options || {});
      const run = typeof options === "function" ? options : callback;
      const id = ++lockSeq;
      const stack = String(new Error().stack || "").split("\n").slice(2, 5).map((line) => line.trim()).join(" | ");
      push({ kind: "lock", text: name + " #" + id + " request" + (opts.ifAvailable ? " ifAvailable" : ""), stack: clip(stack) });
      return origLockRequest(name, opts, async (lock) => {
        push({ kind: "lock", text: name + " #" + id + (lock ? " acquired" : " NULL") });
        try {
          return await run(lock);
        } finally {
          push({ kind: "lock", text: name + " #" + id + " released" });
        }
      });
    };
  }

  // 录制：把「人点了什么」沉淀成场景步骤。开关和缓冲都放 sessionStorage，
  // 导航后仍然有效；只记可点/可输入的原子动作，不记滚动、悬停这类噪声。
  const REC_ON = "__sc_rec_v1";
  const REC_LOG = "__sc_actions_v1";
  const REC_LIMIT = 400;
  const readActions = () => { try { return JSON.parse(sessionStorage.getItem(REC_LOG) || "[]"); } catch { return []; } };
  const pushAction = (entry) => {
    if (sessionStorage.getItem(REC_ON) !== "1") return;
    const list = readActions();
    list.push({ at: Date.now(), ...entry });
    try { sessionStorage.setItem(REC_LOG, JSON.stringify(list.slice(-REC_LIMIT))); } catch {}
  };
  const anchorOf = (el) => {
    if (!el || !el.closest) return null;
    const holder = el.closest("[data-debug]");
    return holder ? holder.getAttribute("data-debug") : null;
  };
  const labelOf = (el) => {
    if (!el) return "";
    return String(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.type || "").trim().slice(0, 40);
  };
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    const target = anchorOf(el);
    const clickable = el.closest("button,a,[role=button],[role=switch],input[type=submit]");
    if (!target && !clickable) return;
    pushAction({ action: "click", target, label: labelOf(clickable || el) });
  }, true);
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (!el || !("value" in el)) return;
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    pushAction({ action: "type", target: anchorOf(el), text: String(el.value ?? ""), label: labelOf(el) });
  }, true);

  // 语义名（practice.hint）不是合法 CSS 选择器；别名表漏登记时直接查
  // [data-debug="…"] 作为兜底，避免「加了锚点但场景仍说找不到」。
  const anchorSelector = (name) => /^[A-Za-z][\w.-]*$/.test(name) && name.includes(".") ? '[data-debug="' + name + '"]' : null;
  const q = (target, nth) => {
    if (!target) return null;
    let list = null;
    try { list = document.querySelectorAll(target); } catch { list = null; }
    if ((!list || list.length === 0) && anchorSelector(target)) {
      try { list = document.querySelectorAll(anchorSelector(target)); } catch {}
    }
    return list ? list[nth || 0] || null : null;
  };
  const nativeSet = (el, text) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    desc.set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  window.__sc = {
    version: 1,
    q,
    text(target, nth) { const el = q(target, nth); return el ? (el.innerText || el.value || "") : null; },
    value(target, nth) { const el = q(target, nth); return el ? el.value : null; },
    click(target, nth) {
      const el = q(target, nth);
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    },
    async clickReady(target, nth, timeout) {
      const until = Date.now() + (timeout || 15000);
      let last = null;
      while (Date.now() < until) {
        const el = q(target, nth);
        last = el;
        if (el && !el.disabled && visible(el)) {
          el.scrollIntoView({ block: "center", inline: "center" });
          el.click();
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      // 区分「没找到」和「一直是禁用」——两者排查方向完全不同。
      return last ? (last.disabled ? "disabled" : "invisible") : "missing";
    },
    async typeReady(target, text, nth, timeout) {
      const until = Date.now() + (timeout || 15000);
      while (Date.now() < until) {
        const el = q(target, nth);
        if (el && !el.disabled) {
          el.focus();
          nativeSet(el, text);
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    },
    type(target, text, nth) {
      const el = q(target, nth);
      if (!el) return false;
      el.focus();
      nativeSet(el, text);
      return true;
    },
    enter(target, nth) {
      const el = q(target, nth);
      if (!el) return false;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      return true;
    },
    async wait(target, opts) {
      opts = opts || {};
      const timeout = opts.timeout == null ? 15000 : opts.timeout;
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const el = q(target, opts.nth || 0);
        const ok = opts.gone ? !el : !!el && (!opts.visible || visible(el));
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    },
    async waitText(target, needle, opts) {
      opts = opts || {};
      const timeout = opts.timeout == null ? 15000 : opts.timeout;
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const el = q(target, opts.nth || 0);
        if (el && ((el.innerText || "") + (el.value || "")).indexOf(needle) !== -1) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    },
    async waitIdle(timeout) {
      const until = Date.now() + (timeout || 15000);
      while (Date.now() < until) {
        if (document.readyState === "complete" && document.body && document.body.innerText.trim().length > 0) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    },
    findTextAll(text, role) {
      const nodes = Array.from(document.querySelectorAll(role || "button,a,[role=button],[role=switch]"));
      return nodes.filter((el) => ((el.innerText || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "")).indexOf(text) !== -1);
    },
    findText(text, role) {
      const nodes = window.__sc.findTextAll(text, role);
      // 同名按钮可能一个在遮罩后面、一个在当前面板里；优先可见的那个。
      return nodes.find(visible) ?? nodes[0] ?? null;
    },
    clickText(text, role) {
      const el = window.__sc.findText(text, role);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    },
    async clickTextReady(text, role, timeout) {
      const until = Date.now() + (timeout || 15000);
      while (Date.now() < until) {
        const el = window.__sc.findTextAll(text, role).find((node) => !node.disabled && visible(node));
        if (el) {
          el.scrollIntoView({ block: "center" });
          el.click();
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    },
    listText(role) {
      return Array.from(document.querySelectorAll(role || "button,a,[role=button]")).map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim()).filter(Boolean);
    },
    trace(clear) { const list = readTrace(); if (clear) writeTrace([]); return list; },
    tracePush(event) { push(event); return true; },
    clearTrace() { writeTrace([]); return true; },
    snapshot() {
      const out = {};
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          // 前缀不带点：3D 存档是 socialcoach-dinner-v1，只认 socialcoach. 会漏掉它。
          if (k && k.indexOf("socialcoach") === 0) out[k] = localStorage.getItem(k);
        }
      } catch {}
      return out;
    },
    loadSnapshot(map) {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf("socialcoach") === 0) localStorage.removeItem(k);
      }
      for (const k of Object.keys(map)) localStorage.setItem(k, map[k]);
      return true;
    },
    clearSnapshot() { return window.__sc.loadSnapshot({}); },
    recordStart() { sessionStorage.setItem(REC_ON, "1"); sessionStorage.setItem(REC_LOG, "[]"); return true; },
    recordStop() { sessionStorage.removeItem(REC_ON); return readActions(); },
    actions() { return readActions(); },
    url() { return location.href; },
  };
  return "installed";
})()
`;

export class CDP {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url, timeout = 15000) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${url}`)), timeout);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`CDP connect failed: ${url}`)); }, { once: true });
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => this.#onMessage(event.data));
    ws.addEventListener("close", () => {
      for (const { reject } of this.#pending.values()) reject(new Error("CDP socket closed"));
      this.#pending.clear();
    });
  }

  #onMessage(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8")); } catch { return; }
    if (msg.id) {
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message}`));
      else pending.resolve(msg.result);
      return;
    }
    const listeners = this.#listeners.get(msg.method);
    if (!listeners) return;
    for (const fn of listeners) {
      try { fn(msg.params); } catch (error) { console.error("[debug] listener failed", msg.method, error); }
    }
  }

  send(method, params = {}, timeout = 30000) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.#pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    const list = this.#listeners.get(method) ?? [];
    list.push(fn);
    this.#listeners.set(method, list);
  }

  close() {
    try { this.#ws.close(); } catch {}
  }
}

function formatException(details) {
  const description = details?.exception?.description ?? details?.text ?? "page evaluation failed";
  return String(description).split("\n").slice(0, 6).join("\n");
}

export class DebugEngine {
  constructor({ base = "http://localhost:3000", headless = true, chrome = null } = {}) {
    this.base = base.replace(/\/$/, "");
    this.headless = headless;
    this.chrome = chrome ?? findChrome();
    this.cdp = null;
    this.chromeProcess = null;
    this.userDataDir = null;
    this.events = [];
    this.eventsLimit = 600;
    this.fixtures = new Map();
    this.record = null;
    this.modelMode = "off";
    this.strict = false;
    this.startedAt = Date.now();
    this.lastNavigation = null;
    this.recording = null;
    this.speechScriptId = null;
    this.tabs = null;
    this.cdpPort = null;
    /** Fetch 拦到的 /api/* 请求环形缓冲，assert.api / api.calls 读它。 */
    this.apiLog = [];
  }

  log(line) {
    try {
      mkdirSync(DEBUG_ROOT, { recursive: true });
      appendFileSync(join(DEBUG_ROOT, "engine.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {}
  }

  #pushEvent(event) {
    this.events.push({ at: Date.now(), ...event });
    if (this.events.length > this.eventsLimit) this.events.shift();
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  async start() {
    if (!this.chrome) throw new Error("Chrome/Edge not found. Set CHROME=/path/to/chrome.");
    mkdirSync(DEBUG_ROOT, { recursive: true });
    this.userDataDir = mkdtempSync(join(tmpdir(), "sc-debug-"));
    const portFile = join(this.userDataDir, "DevToolsActivePort");
    const args = [
      this.headless ? "--headless=new" : "--start-maximized",
      "--remote-debugging-port=0",
      `--user-data-dir=${this.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      // BackForwardCache 会把上一页留在内存里，3D 的 Web Lock 不释放，下一局被判成「另一窗口修改」。
      "--disable-features=Translate,MediaRouter,OptimizationHints,BackForwardCache",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      // 语音链路在无头环境里没有设备：假麦克风让 getUserMedia / 权限路径可跑，
      // 真正的转写文本由 speech-stub 注入的假 SpeechRecognition 提供。
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--hide-scrollbars",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1280,900",
      "about:blank",
    ];
    this.chromeProcess = spawn(this.chrome, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    this.chromeProcess.stderr?.on("data", (chunk) => this.log(`chrome: ${String(chunk).trim()}`));
    this.chromeProcess.on("exit", (code) => this.log(`chrome exited ${code}`));

    let port = 0;
    for (let i = 0; i < 150; i++) {
      if (existsSync(portFile)) {
        const [first] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
        port = Number(first);
        if (port) break;
      }
      if (this.chromeProcess.exitCode !== null) throw new Error(`Chrome exited early (code ${this.chromeProcess.exitCode})`);
      await sleep(100);
    }
    if (!port) throw new Error("Chrome did not expose a DevTools port");
    // 多标签页要用浏览器级的 HTTP 端点（/json/list、/json/new），必须留下端口。
    this.cdpPort = port;

    let target = null;
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ?? null;
        if (target) break;
      } catch {}
      await sleep(100);
    }
    if (!target) throw new Error("Chrome exposed no page target");

    this.cdp = await CDP.connect(target.webSocketDebuggerUrl);
    this.cdp.on("Runtime.consoleAPICalled", (params) => {
      const text = (params.args ?? [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type))
        .join(" ");
      this.#pushEvent({ kind: "console", level: params.type, text });
    });
    this.cdp.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails;
      this.#pushEvent({ kind: "exception", text: formatException(details), url: details?.url });
    });
    this.cdp.on("Log.entryAdded", (params) => {
      const entry = params.entry ?? {};
      if (entry.level === "error" || entry.level === "warning") {
        this.#pushEvent({ kind: "log", level: entry.level, text: entry.text, url: entry.url });
      }
    });
    this.cdp.on("Fetch.requestPaused", (params) => { void this.#onRequestPaused(params); });

    await this.cdp.send("Page.enable");
    await this.cdp.send("Runtime.enable");
    await this.cdp.send("Log.enable");
    await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_HELPERS });
    await this.evaluate(PAGE_HELPERS);
    this.log(`started base=${this.base} chrome=${this.chrome}`);
    return { base: this.base, chrome: this.chrome, port };
  }

  async stop() {
    try { if (this.modelMode !== "off") await this.cdp?.send("Fetch.disable"); } catch {}
    this.cdp?.close();
    if (this.chromeProcess?.pid) {
      try {
        if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(this.chromeProcess.pid), "/T", "/F"], { stdio: "ignore" });
        else this.chromeProcess.kill("SIGKILL");
      } catch {}
    }
    if (this.userDataDir) {
      try { rmSync(this.userDataDir, { recursive: true, force: true }); } catch {}
    }
    this.log("stopped");
  }

  async evaluate(expression, { awaitPromise = true, timeout = 30000 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.cdp.send(
          "Runtime.evaluate",
          { expression, awaitPromise, returnByValue: true, userGesture: true },
          timeout,
        );
        if (result.exceptionDetails) throw new Error(formatException(result.exceptionDetails));
        return result.result?.value;
      } catch (error) {
        lastError = error;
        if (!/context|destroyed|navigat|collected/i.test(String(error.message))) break;
        await sleep(150);
      }
    }
    throw lastError;
  }

  /** 等待页面可用；Next dev 首次编译可能很慢，所以默认 30s。 */
  async waitIdle(timeout = 30000) {
    const ok = await this.evaluate(`window.__sc ? __sc.waitIdle(${Number(timeout)}) : (document.readyState === "complete")`, { timeout: timeout + 5000 });
    if (!ok) throw new Error("page did not become ready");
    await sleep(120);
  }

  async navigate(path, { wait = null, timeout = 30000 } = {}) {
    const route = normalizeRoute(path);
    const url = /^https?:/i.test(route) ? route : `${this.base}${route}`;
    const result = await this.cdp.send("Page.navigate", { url });
    if (result.errorText) throw new Error(`navigate failed: ${result.errorText}`);
    this.lastNavigation = url;
    await this.waitIdle(timeout);
    if (wait) {
      const found = await this.evaluate(`__sc.wait(${JSON.stringify(wait)}, { timeout: ${Number(timeout)} })`, { timeout: timeout + 5000 });
      if (!found) throw new Error(`selector not found after navigate: ${wait}`);
    }
    return { url, title: await this.evaluate("document.title") };
  }

  async reload({ wait = null, timeout = 30000 } = {}) {
    await this.cdp.send("Page.reload", { ignoreCache: false });
    await sleep(200);
    await this.waitIdle(timeout);
    if (wait) {
      const found = await this.evaluate(`__sc.wait(${JSON.stringify(wait)}, { timeout: ${Number(timeout)} })`, { timeout: timeout + 5000 });
      if (!found) throw new Error(`selector not found after reload: ${wait}`);
    }
    return { url: await this.evaluate("location.href") };
  }

  // ── state ────────────────────────────────────────────────────────────────

  #fixturePath(name, kind) {
    if (name.includes("/") || name.includes("\\") || name.endsWith(".json")) {
      return resolve(APP_ROOT, name);
    }
    return join(FIXTURE_ROOT, kind, `${name}.json`);
  }

  /**
   * 新会话的页面停在 about:blank，那里访问 localStorage 会抛 SecurityError。
   * 任何读写设备状态的命令都先落到应用源上，避免「第一条命令必失败」。
   */
  async ensureAppOrigin() {
    const href = await this.evaluate("location.href");
    if (!href.startsWith(this.base)) await this.navigate("/");
  }

  async stateDump({ save = null } = {}) {
    await this.ensureAppOrigin();
    const raw = await this.evaluate("__sc.snapshot()");
    const archiveRaw = raw["socialcoach.v1"];
    let archive = null;
    if (archiveRaw) {
      try {
        const parsed = JSON.parse(archiveRaw);
        archive = parsed.state ?? parsed;
      } catch { archive = null; }
    }
    const keys = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "socialcoach.v1") continue;
      try { keys[key] = JSON.parse(value); } catch { keys[key] = value; }
    }
    const fixture = { archive, keys };
    if (save) {
      const path = this.#fixturePath(save, "states");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
      return { saved: path, archive: archive !== null, keys: Object.keys(keys) };
    }
    return fixture;
  }

  async stateLoad({ fixture, reload = true } = {}) {
    if (!fixture) throw new Error("state.load needs a fixture name");
    await this.ensureAppOrigin();
    const path = this.#fixturePath(fixture, "states");
    if (!existsSync(path)) throw new Error(`fixture not found: ${path}`);
    const data = JSON.parse(readFileSync(path, "utf8"));
    const archive = data.archive ?? data.state ?? (data.profile ? data : null);
    const keys = data.keys ?? {};
    const map = {};
    if (archive) map["socialcoach.v1"] = JSON.stringify({ version: 0, state: archive });
    for (const [key, value] of Object.entries(keys)) {
      map[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    await this.evaluate(`__sc.loadSnapshot(${JSON.stringify(map)})`);
    if (reload) await this.reload();
    return { fixture: path, archive: Boolean(archive), keys: Object.keys(keys), url: await this.evaluate("location.href") };
  }

  async stateSet({ key, value }) {
    if (!key) throw new Error("state.set needs a key");
    await this.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(typeof value === "string" ? value : JSON.stringify(value))})`);
    return { key };
  }

  async stateClear({ reload = true } = {}) {
    await this.ensureAppOrigin();
    await this.evaluate("__sc.clearSnapshot()");
    if (reload) await this.reload();
    return { cleared: true };
  }

  // ── ui ───────────────────────────────────────────────────────────────────

  async uiClick({ target, nth = 0, text = null, role = null, timeout = 15000 }) {
    const ok = text
      ? await this.evaluate(`__sc.clickTextReady(${JSON.stringify(text)}, ${JSON.stringify(role)}, ${Number(timeout)})`, { timeout: Number(timeout) + 5000 })
      : await this.evaluate(`__sc.clickReady(${JSON.stringify(target)}, ${Number(nth)}, ${Number(timeout)})`, { timeout: Number(timeout) + 5000 });
    if (ok !== true) throw new Error(text ? `no clickable element contains: ${text}` : `${target}: ${ok === "missing" ? "not found" : `still ${ok}`}`);
    await sleep(120);
    return { clicked: text ? `text:${text}` : target, nth };
  }

  async uiType({ target, text, nth = 0, enter = false, submit = null, timeout = 15000 }) {
    const ok = await this.evaluate(`__sc.typeReady(${JSON.stringify(target)}, ${JSON.stringify(text)}, ${Number(nth)}, ${Number(timeout)})`, { timeout: Number(timeout) + 5000 });
    if (!ok) throw new Error(`selector not found or still disabled: ${target}`);
    // 输入事件先让 React 完成一次渲染，再触发 Enter / 提交，否则闭包里的 state 还是旧值。
    await sleep(80);
    if (enter) {
      const entered = await this.evaluate(`__sc.enter(${JSON.stringify(target)}, ${Number(nth)})`);
      if (!entered) throw new Error(`selector not found for enter: ${target}`);
    }
    if (submit) {
      const clicked = await this.evaluate(`__sc.click(${JSON.stringify(submit)}, 0)`);
      if (!clicked) throw new Error(`submit selector not found: ${submit}`);
    }
    await sleep(120);
    return { typed: text.length, enter, submit };
  }

  async uiWait({ target, timeout = 15000, gone = false, visible = false, nth = 0 }) {
    const ok = await this.evaluate(
      `__sc.wait(${JSON.stringify(target)}, { timeout: ${Number(timeout)}, gone: ${Boolean(gone)}, visible: ${Boolean(visible)}, nth: ${Number(nth)} })`,
      { timeout: timeout + 5000 },
    );
    if (!ok) throw new Error(`${gone ? "still present" : "not found"}: ${target} (${timeout}ms)`);
    return { target, gone, visible, waited: true };
  }

  async uiText({ target, nth = 0, contains = null, timeout = 0 }) {
    if (contains) {
      const ok = await this.evaluate(
        `__sc.waitText(${JSON.stringify(target)}, ${JSON.stringify(contains)}, { timeout: ${Number(timeout || 15000)} })`,
        { timeout: Number(timeout || 15000) + 5000 },
      );
      if (!ok) throw new Error(`text not found in ${target}: ${contains}`);
    }
    const text = await this.evaluate(`__sc.text(${JSON.stringify(target)}, ${Number(nth)})`);
    if (text === null) throw new Error(`selector not found: ${target}`);
    return { text };
  }

  async uiValue({ target, nth = 0 }) {
    const value = await this.evaluate(`__sc.value(${JSON.stringify(target)}, ${Number(nth)})`);
    if (value === null) throw new Error(`selector not found: ${target}`);
    return { value };
  }

  async uiExists({ target, nth = 0 }) {
    return { exists: await this.evaluate(`!!__sc.q(${JSON.stringify(target)}, ${Number(nth)})`) };
  }

  async uiCount({ target }) {
    return { count: await this.evaluate(`document.querySelectorAll(${JSON.stringify(target)}).length`) };
  }

  async uiList({ role = null }) {
    return { items: await this.evaluate(`__sc.listText(${JSON.stringify(role)})`) };
  }

  // ── model fixtures ───────────────────────────────────────────────────────

  #loadFixtureFile(name) {
    const path = this.#fixturePath(name, "models");
    if (!existsSync(path)) throw new Error(`model fixture not found: ${path}`);
    const data = JSON.parse(readFileSync(path, "utf8"));
    const routes = data.routes ?? (data.route ? { [data.route]: data.responses ?? data.response } : null);
    if (!routes) throw new Error(`model fixture has no route(s): ${path}`);
    return { path, name: data.name ?? name, routes, probes: data.probes ?? null };
  }

  async modelUse({ fixtures = [], strict = false } = {}) {
    if (!Array.isArray(fixtures) || fixtures.length === 0) throw new Error("model.use needs at least one fixture name");
    this.fixtures.clear();
    this.strict = Boolean(strict);
    const loaded = [];
    for (const name of fixtures) {
      const { path, routes } = this.#loadFixtureFile(name);
      for (const [route, value] of Object.entries(routes)) {
        // 两种写法：
        //   "love-play": [resp0, resp1]                      → 按调用顺序（最后一次重复）
        //   "love-play": {"by":"learnerTurns","responses":[…]} → 按请求里的学习者回合数
        // 后者对 StrictMode 双调用 / 网络重试免疫，恋爱流程优先用它。
        const list = Array.isArray(value) ? value : (value.responses ?? [value.response ?? value]);
        const by = Array.isArray(value) ? "counter" : (value.by ?? "counter");
        this.fixtures.set(route.replace(/^\/?api\//, ""), { responses: list, index: 0, by });
      }
      loaded.push(path);
    }
    await this.#enableReplay();
    return { mode: "replay", fixtures: loaded, routes: [...this.fixtures.keys()] };
  }

  /**
   * 夹具自检：装上夹具，按文件里的 `probes` 逐条真发一次请求。
   * 只证明「请求被拦到 + 响应形状对」，不证明 UI 接线（UI 要靠场景）。
   * 没有 probes 的夹具直接报错——「文件存在」不等于「回放可用」。
   */
  async fixtureProbe({ fixtures = [], url = null, timeout = 30000 } = {}) {
    if (!Array.isArray(fixtures) || fixtures.length === 0) throw new Error("fixture.probe needs at least one fixture name");
    const loaded = [];
    const probes = {};
    for (const name of fixtures) {
      const { path, probes: own } = this.#loadFixtureFile(name);
      loaded.push(path);
      for (const [route, probe] of Object.entries(own ?? {})) probes[route] = probe;
    }
    const probed = Object.keys(probes);
    if (!probed.length) throw new Error(`no "probes" block in fixture(s): ${fixtures.join(", ")}`);
    const used = await this.modelUse({ fixtures });
    if (url) {
      await this.navigate(url, { wait: "body", timeout });
      await this.waitIdle(timeout);
    }
    const spec = JSON.stringify(probes);
    const rows = await this.evaluate(
      `(async () => {
        const spec = ${spec};
        const out = [];
        for (const [route, probe] of Object.entries(spec)) {
          const method = String(probe.method || "POST").toUpperCase();
          let path = "/api/" + route;
          const init = { method, headers: {} };
          if (probe.query && typeof probe.query === "object") {
            const qs = new URLSearchParams(probe.query).toString();
            if (qs) path += "?" + qs;
          }
          if (method !== "GET" && method !== "HEAD" && probe.body !== undefined) {
            init.headers["content-type"] = "application/json";
            init.body = JSON.stringify(probe.body);
          }
          const started = performance.now();
          try {
            const res = await fetch(path, init);
            const text = await res.text();
            out.push({
              route, method, path,
              status: res.status,
              contentType: res.headers.get("content-type"),
              length: text.length,
              ms: Math.round(performance.now() - started),
              preview: text.slice(0, 160),
            });
          } catch (error) {
            out.push({ route, method, path, error: String((error && error.message) || error) });
          }
        }
        return out;
      })()`,
      { timeout },
    );
    const result = { fixtures: loaded, fixtureRoutes: used.routes, probed, rows };
    const failed = rows.filter((row) => row.error || !(row.status >= 200 && row.status < 300));
    if (failed.length) {
      const detail = failed.map((row) => `${row.route} ${row.error ?? "HTTP " + row.status}`).join("; ");
      throw Object.assign(new Error(`fixture probe failed: ${detail}`), { result });
    }
    return result;
  }

  async #enableReplay() {
    if (this.modelMode === "replay") return;
    try { await this.cdp.send("Fetch.disable"); } catch {}
    await this.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    this.modelMode = "replay";
  }

  async modelRecord({ name } = {}) {
    if (!name) throw new Error("model.record needs a fixture name");
    try { await this.cdp.send("Fetch.disable"); } catch {}
    await this.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Response" }] });
    this.modelMode = "record";
    this.record = { name, routes: {} };
    return { mode: "record", name, file: this.#fixturePath(name, "models") };
  }

  async modelStopRecord() {
    if (this.modelMode !== "record") return { mode: this.modelMode, saved: null };
    const { name, routes } = this.record ?? { name: null, routes: {} };
    this.modelMode = "off";
    this.strict = false;
    this.record = null;
    try { await this.cdp.send("Fetch.disable"); } catch {}
    if (!name) return { mode: "off", saved: null };
    const path = this.#fixturePath(name, "models");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ name, routes }, null, 2)}\n`);
    return { mode: "off", saved: path, routes: Object.keys(routes) };
  }

  async modelOff() {
    if (this.modelMode === "record") return this.modelStopRecord();
    this.modelMode = "off";
    this.strict = false;
    this.fixtures.clear();
    try { await this.cdp.send("Fetch.disable"); } catch {}
    return { mode: "off" };
  }

  // ── 录制：把一次人工操作沉淀成场景 JSON ─────────────────────────────────

  async recordStart({ name = "recorded" } = {}) {
    this.recording = { name, startedAt: Date.now(), cli: [] };
    await this.evaluate("__sc.recordStart()");
    return { recording: true, name, startedAt: this.recording.startedAt };
  }

  async recordStop() {
    const page = (await this.evaluate("__sc.recordStop()")) ?? [];
    const cli = this.recording?.cli ?? [];
    const name = this.recording?.name ?? "recorded";
    this.recording = null;
    const merged = mergeRecording({ cli, page, meta: { name } });
    // 录制期真实发生的请求是断言草稿的证据；随场景一起交回命令层。
    return { ...merged, cliActions: cli.length, pageActions: page.length, apiCalls: this.apiLog.slice(-200) };
  }

  /** 录制期间记下 CLI 自己发出的意图（导航、装夹具、state.load…）。 */
  #noteCliCommand(cmd, args) {
    if (!this.recording || !RECORDED_CLI.has(cmd)) return;
    const entry = { ...args };
    // CLI 传进来的是解析后的选择器，页面侧记的是 data-debug 锚点名。
    // 两边统一成锚点名，否则同一个动作会录成两步。
    if (entry.target) entry.target = anchorName(entry.target);
    this.recording.cli.push({ at: Date.now(), cmd, args: entry });
  }

  // ── 语音：假 SpeechRecognition，让转写文本可控 ──────────────────────────

  async speechStub({ transcript = "", lang = "zh-CN", interim = false } = {}) {
    const source = speechStubSource({ lang, interim });
    if (this.speechScriptId) {
      try { await this.cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.speechScriptId }); } catch {}
    }
    const added = await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
    this.speechScriptId = added?.identifier ?? null;
    await this.evaluate(source);
    if (transcript) await this.evaluate(`__scSpeech.say(${JSON.stringify(transcript)})`);
    return { stubbed: true, queued: Boolean(transcript), lang, interim };
  }

  async speechSay({ text = "", delay = 0, final = true } = {}) {
    const log = await this.evaluate(`(() => {
      if (!window.__scSpeech) return null;
      window.__scSpeech.say(${JSON.stringify(String(text))}, { delay: ${Number(delay) || 0}, final: ${final ? "true" : "false"} });
      return window.__scSpeech.log();
    })()`);
    if (!log) throw new Error("speech stub is not installed; run speech.stub first");
    return log;
  }

  async speechLog() {
    const log = await this.evaluate("window.__scSpeech ? window.__scSpeech.log() : null");
    if (!log) throw new Error("speech stub is not installed; run speech.stub first");
    return log;
  }

  async speechOff() {
    if (this.speechScriptId) {
      try { await this.cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.speechScriptId }); } catch {}
      this.speechScriptId = null;
    }
    await this.evaluate("(() => { delete window.__scSpeech; delete window.SpeechRecognition; delete window.webkitSpeechRecognition; return true; })()");
    return { stubbed: false };
  }

  // ── 音频观测：TTS / 环境音 / 视频的播放入口是否真的被调用 ────────────────

  /**
   * 读页面侧 window.__scAudio 的累计统计（PAGE_HELPERS 内注入，生产代码
   * 没有调试入口）：媒体元素 play/pause 与 src、new Audio() 构造、WebAudio
   * （decodeAudioData / createBuffer / AudioBufferSourceNode.start）。
   */
  async audioLog() {
    const log = await this.evaluate("window.__scAudio ? window.__scAudio.log() : null");
    if (!log) throw new Error("audio instrumentation missing (window.__scAudio); reload so PAGE_HELPERS re-injects");
    return log;
  }

  /** 清空统计：断言窗口内只统计本次触发的播放活动。 */
  async audioClear() {
    const ok = await this.evaluate("window.__scAudio ? window.__scAudio.clear() : false");
    if (!ok) throw new Error("audio instrumentation missing (window.__scAudio); reload so PAGE_HELPERS re-injects");
    return { cleared: true };
  }

  // ── 多标签页：验证「另一个窗口也在写」这类真实冲突 ──────────────────────

  #tabManager() {
    if (!this.cdpPort) throw new Error("CDP port unknown; restart the daemon so Chrome exposes it");
    this.tabs = this.tabs ?? createTabs({ port: this.cdpPort, connect: (url) => CDP.connect(url) });
    return this.tabs;
  }

  async tabOpen({ url }) {
    if (!url) throw new Error("tab.open needs a URL");
    const tab = await this.#tabManager().open(url);
    // 场景 JSON 是静态的，拿不到动态 id；记下最近打开的那个，供 id:"last" 引用。
    this.lastTabId = tab.id;
    return tab;
  }

  async tabList() {
    return this.#tabManager().list();
  }

  async tabClose({ id }) {
    if (!id) throw new Error("tab.close needs an id");
    const tabId = id === "last" ? this.lastTabId : id;
    if (!tabId) throw new Error('no tab to close (pass an id, or open one first and use "last")');
    const result = await this.#tabManager().close(tabId);
    if (tabId === this.lastTabId) this.lastTabId = null;
    return result;
  }

  async tabActivate({ id }) {
    if (!id) throw new Error("tab.use needs an id");
    return this.#tabManager().activate(id === "last" ? this.lastTabId : id);
  }

  async tabEval({ id, expression }) {
    if (!id || !expression) throw new Error("tab.eval needs an id and an expression");
    const tabId = id === "last" ? this.lastTabId : id;
    if (!tabId) throw new Error('no tab to evaluate (pass an id, or open one first and use "last")');
    return this.#tabManager().evalIn(tabId, expression);
  }

  /**
   * 选择这一请求该用哪条夹具。
   * `learnerTurns` 从请求体数学习者消息：首回合 0、点完第一个选项 1……
   * 同一回合的重复请求（StrictMode 双调用、网络重试）拿到同一条，不会把队列顶歪。
   */
  #fixtureIndex(fixture, request) {
    if (fixture.by === "learnerTurns") {
      try {
        const raw = request?.postData ?? "";
        const body = raw ? JSON.parse(raw) : null;
        const turns = Array.isArray(body?.messages) ? body.messages.filter((m) => m?.role === "learner").length : 0;
        return Math.min(Math.max(0, turns), fixture.responses.length - 1);
      } catch {
        return 0;
      }
    }
    const index = Math.min(fixture.index, fixture.responses.length - 1);
    fixture.index += 1;
    return index;
  }

  /**
   * 把 Fetch 拦到的 /api/* 请求存进 this.apiLog（环形缓冲，上限 API_CALL_LIMIT）。
   * postData 在 GET 下不存在；带 body 时可能在 request.postData（原文）或在
   * postDataEntries[0].bytes（base64，multipart 用）。body 截断到 4000 字符，
   * 能 JSON.parse 的放 bodyJson；replay 由夹具命中分支补 true。
   */
  #recordApiCall(params, url, route) {
    const request = params?.request ?? {};
    let postData = request.postData ?? null;
    const entries = params?.postDataEntries;
    if (!postData && Array.isArray(entries) && entries.length > 0) {
      const bytes = entries[0]?.bytes;
      if (typeof bytes === "string" && bytes.length > 0) {
        try {
          const decoded = Buffer.from(bytes, "base64").toString("utf8");
          // base64 解出来应是可读文本；含 NUL 说明它不是 base64，退回原串。
          postData = decoded.includes("\u0000") ? bytes : decoded;
        } catch {
          postData = bytes;
        }
      }
    }
    const body = String(postData ?? "").slice(0, 4000);
    let bodyJson = null;
    if (body) {
      try { bodyJson = JSON.parse(body); } catch {}
    }
    const record = {
      route,
      method: String(request.method ?? "GET").toUpperCase(),
      url,
      body,
      bodyJson,
      replay: false,
      at: Date.now(),
    };
    this.apiLog.push(record);
    if (this.apiLog.length > API_CALL_LIMIT) {
      this.apiLog.splice(0, this.apiLog.length - API_CALL_LIMIT);
    }
    return record;
  }

  async #onRequestPaused(params) {
    const requestId = params.requestId;
    const url = params.request?.url ?? "";
    let route = "";
    try { route = new URL(url).pathname.replace(/^\/api\//, ""); } catch {}
    const recorded = this.#recordApiCall(params, url, route);

    if (this.modelMode === "record") {
      try {
        if (params.responseStatusCode) {
          const body = await this.cdp.send("Fetch.getResponseBody", { requestId });
          const text = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
          const headers = params.responseHeaders ?? [];
          const contentType = headers.find((h) => String(h.name).toLowerCase() === "content-type")?.value ?? "";
          let payload;
          if (/json/i.test(contentType)) {
            try { payload = JSON.parse(text); } catch { payload = { __raw: text, __contentType: contentType }; }
          } else {
            // 流式任务：原样存，回放时按 text/plain 发回去。
            payload = { __raw: text, __contentType: contentType || "text/plain; charset=utf-8" };
          }
          const bucket = this.record.routes[route] ?? (this.record.routes[route] = {
            // 流式任务的回合语义比调用序号稳定；JSON 任务仍按顺序。
            by: ["roleplay", "assess", "reflect"].includes(route) ? "learnerTurns" : "counter",
            responses: [],
          });
          bucket.responses.push(payload);
          this.#pushEvent({ kind: "model.record", route, status: params.responseStatusCode, streaming: !/json/i.test(contentType) });
        }
        await this.cdp.send("Fetch.continueRequest", { requestId });
      } catch (error) {
        this.#pushEvent({ kind: "model.record.error", route, text: String(error.message) });
        try { await this.cdp.send("Fetch.continueRequest", { requestId }); } catch {}
      }
      return;
    }

    const fixture = this.fixtures.get(route);
    if (!fixture) {
      if (this.strict && route) {
        // 严格离线：缺夹具就立刻失败，而不是悄悄打真实网络。
        this.#pushEvent({ kind: "model.missing", route });
        try {
          await this.cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 503,
            responseHeaders: [{ name: "content-type", value: "application/json; charset=utf-8" }],
            body: Buffer.from(JSON.stringify({
              error: `No debug fixture for /api/${route}`,
              code: "debug-fixture-missing",
              route,
            })).toString("base64"),
          });
        } catch (error) {
          this.#pushEvent({ kind: "model.missing.error", route, text: String(error.message) });
        }
        return;
      }
      try { await this.cdp.send("Fetch.continueRequest", { requestId }); } catch {}
      return;
    }
    const index = this.#fixtureIndex(fixture, params.request);
    const payload = fixture.responses[index];
    recorded.replay = true;
    this.#pushEvent({ kind: "model.replay", route, index, by: fixture.by });
    // 同时写进页面内的 trace，`assert.trace` / 事后排查都能看到「这一回合用的是夹具」。
    void this.evaluate(`__sc.tracePush(${JSON.stringify({ kind: "model.replay", route, index, by: fixture.by })})`).catch(() => {});
    // 流式任务（roleplay / dinner / assess）回的是纯文本 + `@@final`，不能用 JSON.stringify 包。
    // 夹具写 {"__raw": "...", "__contentType": "text/plain; charset=utf-8"} 原样回放。
    const raw = payload && typeof payload === "object" && typeof payload.__raw === "string";
    const body = raw ? payload.__raw : JSON.stringify(payload);
    const contentType = raw ? (payload.__contentType ?? "text/plain; charset=utf-8") : "application/json; charset=utf-8";
    try {
      await this.cdp.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "content-type", value: contentType },
          { name: "cache-control", value: "no-store" },
        ],
        body: Buffer.from(body).toString("base64"),
      });
    } catch (error) {
      this.#pushEvent({ kind: "model.replay.error", route, text: String(error.message) });
    }
  }

  // ── observation ──────────────────────────────────────────────────────────

  /**
   * 一页快照：AI 不必先截图再猜，这一次调用就能知道
   * 当前 URL、可见文字、可交互控件（含 data-debug / aria 名 / disabled）、
   * 以及设备状态的键与大小。排查「现在是什么状态」先看它。
   */
  async snapshot({ textLimit = 4000 } = {}) {
    return this.evaluate(`(() => {
      const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      const text = document.body ? document.body.innerText.split("\\n\\n\\n").join("\\n\\n").slice(0, ${Number(textLimit)}) : "";
      const nodes = Array.from(document.querySelectorAll("[data-debug],button,a,input,textarea,[role=button],[role=switch]")).filter(visible).slice(0, 80);
      const interactive = nodes.map((el) => ({
        debug: el.getAttribute("data-debug") || null,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || null,
        label: (el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText || "")).trim().slice(0, 80),
        disabled: !!el.disabled,
        value: el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? String(el.value || "").slice(0, 80) : undefined,
      }));
      const state = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("socialcoach") === 0) state[k] = String(localStorage.getItem(k) || "").length;
        }
      } catch {}
      return { url: location.href, title: document.title, ready: document.readyState, text, interactive, state };
    })()`);
  }

  async trace({ clear = false } = {}) {
    // 场景之间不串味：clear 时连请求缓冲一起清空，否则上一轮的 /api/* 请求
    // 会被这一轮的 assert.api 抓到（F22 的教训）。
    if (clear) this.apiLog = [];
    return { events: await this.evaluate(`__sc.trace(${Boolean(clear)})`) };
  }

  async clearTrace() {
    this.apiLog = [];
    await this.evaluate("__sc.clearTrace()");
    return { cleared: true };
  }

  async screenshot({ path = null, full = false } = {}) {
    const shot = await this.cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: Boolean(full) });
    const target = path
      ? resolve(APP_ROOT, path)
      : join(DEBUG_ROOT, "shots", `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(shot.data, "base64"));
    return { path: target };
  }

  async viewport({ width = 1280, height = 900 } = {}) {
    await this.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: Number(width),
      height: Number(height),
      deviceScaleFactor: 1,
      mobile: false,
    });
    return { width: Number(width), height: Number(height) };
  }

  async eval({ expression }) {
    if (!expression) throw new Error("eval needs an expression");
    const value = await this.evaluate(`(async () => (${expression}))()`);
    return { value };
  }

  // ── canvas 观测：证明 3D 场景真的在渲染 ─────────────────────────────────

  /**
   * 采样窗口内的 canvas 统计：先取基线，等 ms，再取一次，返回窗口内的
   * 帧数与 WebGL 绘制调用数（含每秒换算）以及 canvas 登记表。
   * 计数由注入页面脚本前的 window.__scCanvas 提供（PAGE_HELPERS 内），
   * 生产代码没有调试入口。
   */
  async canvasStats({ ms = 1000 } = {}) {
    const span = Math.max(0, Number(ms) || 0);
    const before = await this.evaluate("window.__scCanvas ? window.__scCanvas.stats() : null");
    if (!before) throw new Error("canvas instrumentation missing (window.__scCanvas); reload so PAGE_HELPERS re-injects");
    if (span > 0) await sleep(span);
    const after = await this.evaluate("window.__scCanvas ? window.__scCanvas.stats() : null");
    if (!after) throw new Error("canvas instrumentation disappeared during sampling");
    return summarizeCanvas(before, after, span);
  }

  /**
   * 场景断言：至少一个带尺寸的 webgl/webgl2 canvas，且窗口内帧数与绘制
   * 调用数达标。失败抛错并带上实际数字，供场景 JSON 直接引用。
   */
  async assertCanvas({ minDraws = 1, minFrames = 1, ms = 1000 } = {}) {
    const stats = await this.canvasStats({ ms });
    const webgl = stats.canvases.filter((c) => /^webgl/i.test(String(c.type)));
    const sized = webgl.filter((c) => Number(c.w) > 0 && Number(c.h) > 0);
    const problems = [];
    if (webgl.length === 0) problems.push(`no webgl canvas (${stats.canvases.length} canvas(es) total)`);
    else if (sized.length === 0) problems.push(`webgl canvas(es) have no size: ${JSON.stringify(webgl)}`);
    if (!(stats.draws.count >= Number(minDraws))) problems.push(`draws ${stats.draws.count} < ${Number(minDraws)}`);
    if (!(stats.frames.count >= Number(minFrames))) problems.push(`frames ${stats.frames.count} < ${Number(minFrames)}`);
    if (problems.length) throw new Error(`canvas assert failed: ${problems.join("; ")} (window ${stats.deltas.ms}ms)`);
    return stats;
  }

  // ── 断言原语：请求 / 状态 / 元素数量 ──────────────────────────────────────

  /** 轮询直到 check 返回 ok（条件满足）或 definitive（结果已定，无论成败），或超时。 */
  async #pollUntil(check, timeout) {
    const until = Date.now() + Math.max(0, Number(timeout) || 0);
    for (;;) {
      const outcome = await check();
      if (outcome.ok || outcome.definitive) return outcome;
      if (Date.now() >= until) return outcome;
      await sleep(120);
    }
  }

  /**
   * 断言应用真正发出的请求：按 route（+可选 method）过滤 apiCalls，
   * count 精确次数 / min 最少次数（都不给 = 至少 1 次）；body 用 deepMatch
   * 部分匹配最后一条匹配请求的 bodyJson（请求体不是 JSON 时退回字符串包含）。
   * 请求是点击后异步发出的，带 timeout 轮询；超时抛错附实际条数、路由列表与
   * 最后一条请求体预览。只有 Fetch 拦截开启（model.use / model.record）时
   * 才有记录，modelMode=off 下断言会因查无记录而失败。
   */
  async assertApi({ route, method = null, body = null, count = null, min = null, timeout = 5000 } = {}) {
    if (!route) throw new Error("assert.api needs route");
    const wantRoute = String(route).replace(/^\/+/, "").replace(/^api\//, "");
    const wantMethod = method ? String(method).toUpperCase() : null;
    const outcome = await this.#pollUntil(async () => {
      const matches = this.apiLog.filter((c) => c.route === wantRoute && (!wantMethod || c.method === wantMethod));
      const n = matches.length;
      const exact = count !== null && count !== undefined;
      const required = exact ? Number(count) : min !== null && min !== undefined ? Number(min) : 1;
      const countOk = exact ? n === required : n >= required;
      let bodyOk = true;
      let bodyMismatch = null;
      let bodyNote = null;
      if (body !== null && body !== undefined) {
        if (n === 0) {
          bodyOk = false;
        } else {
          const last = matches[n - 1];
          if (last.bodyJson !== null && last.bodyJson !== undefined) {
            const check = deepMatch(last.bodyJson, body);
            bodyOk = check.ok;
            bodyMismatch = check.ok ? null : check;
          } else {
            const needle = typeof body === "string" ? body : JSON.stringify(body);
            bodyOk = String(last.body ?? "").includes(needle);
            bodyNote = "string-contains (no bodyJson)";
          }
        }
      }
      // count=0 不提前定局：等满窗口让在途请求落袋，再核对确实是零。
      const definitive = exact && required > 0 && n > required ? true : (countOk && bodyOk);
      return { ok: countOk && bodyOk, definitive, n, matches, bodyMismatch, bodyNote };
    }, timeout);
    if (!outcome.ok) {
      const expected = count !== null && count !== undefined
        ? `exactly ${count}`
        : min !== null && min !== undefined ? `at least ${min}` : "at least 1";
      const seen = [...new Set(this.apiLog.map((c) => c.route))].filter(Boolean).join(", ") || "(none)";
      const lastBody = String(outcome.matches?.[outcome.n - 1]?.body ?? "");
      const lines = [
        `assert.api failed: route=${route}${wantMethod ? ` method=${wantMethod}` : ""} expected ${expected}, got ${outcome.n}`,
        `routes seen: ${seen}`,
      ];
      if (outcome.bodyMismatch) {
        lines.push(`body mismatch: ${describeMismatch(outcome.bodyMismatch)}`);
        lines.push(`last body: ${lastBody.slice(0, 200)}${lastBody.length > 200 ? "…" : ""}`);
      }
      // 最常见的原因：拦截根本没开（modelMode=off），请求一条都没被记录。
      if (this.modelMode !== "replay" && outcome.n === 0) {
        lines.push("hint: Fetch 拦截没开（modelMode=off），assert.api 看不到任何请求；先 model.use <fixture> 或 model.record");
      }
      throw new Error(lines.join("\n"));
    }
    return {
      matched: outcome.n,
      total: this.apiLog.length,
      body: outcome.bodyNote ?? (body !== null && body !== undefined ? "json" : null),
    };
  }

  /**
   * 断言 localStorage 状态：key（默认 socialcoach.v1）读出来后能 parse 就 parse，
   * path 用 getPath 取路径值；exists（默认 true）要求存在、equals 用 deepMatch
   * 部分匹配、contains 要求字符串包含。带 timeout 轮询，失败信息含实际值预览。
   */
  async assertState({ key = "socialcoach.v1", path = null, equals = null, contains = null, exists = true, timeout = 5000 } = {}) {
    const outcome = await this.#pollUntil(async () => {
      const raw = await this.evaluate(`(() => { try { return localStorage.getItem(${JSON.stringify(key)}); } catch { return null; } })()`);
      let parsed = null;
      let parseable = false;
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw); parseable = true; } catch {}
      }
      const base = parseable ? parsed : raw;
      let value = base;
      let found = raw !== null && raw !== undefined;
      if (path) {
        const step = getPath(base, path);
        found = found && step.found;
        value = step.found ? step.value : null;
      }
      const where = `${key}${path ? `.${path}` : ""}`;
      let ok;
      let problem = null;
      if (exists === false) {
        ok = !found;
        problem = ok ? null : `expected ${where} to be absent`;
      } else if (equals !== null && equals !== undefined) {
        const check = found ? deepMatch(value, equals) : null;
        ok = Boolean(check?.ok);
        problem = ok ? null : check ? `equals mismatch: ${describeMismatch(check)}` : `value at ${where} is missing`;
      } else if (contains !== null && contains !== undefined) {
        ok = found && String(value ?? "").includes(String(contains));
        problem = ok ? null : `expected ${where} to contain ${JSON.stringify(String(contains))}`;
      } else {
        ok = found;
        problem = ok ? null : `expected ${where} to exist`;
      }
      return { ok, definitive: ok, found, problem, raw };
    }, timeout);
    if (!outcome.ok) {
      const actual = String(outcome.raw ?? "");
      throw new Error(`assert.state failed: ${outcome.problem} (actual: ${actual.slice(0, 120)}${actual.length > 120 ? "…" : ""})`);
    }
    return { key, found: outcome.found, path: path ?? null, value: outcome.value };
  }

  /**
   * 断言页面上选择器命中的元素数量：equals 精确 / min 至少 / max 至多，
   * 都不给 = 至少 1 个。元素可能是点击后异步渲染的，带 timeout 轮询。
   */
  async assertCount({ target, equals = null, min = null, max = null, timeout = 5000 } = {}) {
    if (!target) throw new Error("assert.count needs target");
    // 传进来的可能是锚点名（practice.message），也可能是 CSS 选择器（body / .bubble-me）。
    // 锚点名按选择器查会数到 0，所以 0 命中且目标形如 a.b 时回退到 [data-debug="…"]。
    // 规则与页面侧 q() 保持一致：带点但不含其它 CSS 元字符 = 锚点名。
    const anchorFallback = /^[A-Za-z][\w.-]*$/.test(target) && target.includes(".") ? `[data-debug="${target}"]` : null;
    const outcome = await this.#pollUntil(async () => {
      let used = target;
      let n = 0;
      try { n = Number(await this.evaluate(`document.querySelectorAll(${JSON.stringify(target)}).length`)); } catch { n = 0; }
      if (n === 0 && anchorFallback) {
        const viaAnchor = Number(await this.evaluate(`document.querySelectorAll(${JSON.stringify(anchorFallback)}).length`));
        if (viaAnchor > 0) { n = viaAnchor; used = anchorFallback; }
      }
      let ok = true;
      if (equals !== null && equals !== undefined) {
        ok = n === Number(equals);
      } else {
        if (min !== null && min !== undefined) ok = ok && n >= Number(min);
        if (max !== null && max !== undefined) ok = ok && n <= Number(max);
        if (min === null && max === null) ok = n >= 1;
      }
      return { ok, definitive: ok, n, used };
    }, timeout);
    if (!outcome.ok) {
      const expected = equals !== null && equals !== undefined
        ? `exactly ${equals}`
        : [min !== null && min !== undefined ? `min ${min}` : null, max !== null && max !== undefined ? `max ${max}` : null]
            .filter(Boolean)
            .join(" and ") || "at least 1";
      throw new Error(`assert.count failed: target=${target} expected ${expected}, got ${outcome.n}`);
    }
    return { count: outcome.n, target: outcome.used ?? target };
  }

  /** 最近 N 条被拦到的 /api/* 请求（默认 20）；limit=0 返回空列表。 */
  async apiCalls({ limit = 20 } = {}) {
    const n = Math.max(0, Number(limit) || 0);
    return { total: this.apiLog.length, calls: n ? this.apiLog.slice(-n) : [] };
  }

  /** 清空请求缓冲：让 assert.api 只统计清空后发出的请求。 */
  async apiClear() {
    const cleared = this.apiLog.length;
    this.apiLog = [];
    return { cleared };
  }

  // ── smoke ────────────────────────────────────────────────────────────────

  async smoke({ routes = null, timeout = 45000 } = {}) {
    const list = routes ?? [
      "/",
      "/onboarding",
      "/learn",
      "/progress",
      "/settings",
      "/love",
      "/love/archive",
      "/love/cards",
      "/love/endings",
      "/love/persona",
      "/love/studio",
      "/3d",
      "/arena",
      "/rehearse",
    ];
    const results = [];
    for (const route of list) {
      this.drainEvents();
      const row = { route, ok: false, ms: 0, title: null, errors: [], textLength: 0 };
      const started = Date.now();
      try {
        await this.navigate(route, { timeout });
        const info = await this.evaluate(`(() => ({
          title: document.title,
          text: document.body ? document.body.innerText.trim() : "",
          error: /Application error|Unhandled Runtime Error|This page could not be found/i.test(document.body ? document.body.innerText : ""),
        }))()`);
        row.title = info.title;
        row.textLength = info.text.length;
        const events = this.drainEvents().filter(
          (e) =>
            (e.kind === "exception" || e.kind === "error" || (e.kind === "console" && e.level === "error") || (e.kind === "log" && e.level === "error")) &&
            !/_next\/hmr|ERR_INVALID_HTTP_RESPONSE/.test(String(e.text ?? "")),
        );
        row.errors = events.map((e) => e.text).slice(0, 5);
        row.ok = !info.error && info.text.length > 0 && row.errors.length === 0;
      } catch (error) {
        row.errors = [String(error.message)];
      }
      row.ms = Date.now() - started;
      results.push(row);
    }
    return { ok: results.every((r) => r.ok), results };
  }

  async doctor() {
    let server = null;
    try {
      const res = await fetch(this.base, { signal: AbortSignal.timeout(3000) });
      server = { status: res.status, ok: res.ok };
    } catch (error) {
      server = { ok: false, error: String(error.message) };
    }
    return {
      node: process.version,
      chrome: this.chrome,
      chromeExists: Boolean(this.chrome && existsSync(this.chrome)),
      base: this.base,
      server,
      modelMode: this.modelMode,
      fixtures: [...this.fixtures.keys()],
    };
  }

  async call(cmd, args = {}) {
    this.#noteCliCommand(cmd, args);
    switch (cmd) {
      case "doctor": return this.doctor();
      case "nav": return this.navigate(args.path, args);
      case "reload": return this.reload(args);
      case "eval": return this.eval(args);
      case "canvas.stats": return this.canvasStats(args);
      case "assert.canvas": return this.assertCanvas(args);
      case "assert.api": return this.assertApi(args);
      case "assert.state": return this.assertState(args);
      case "assert.count": return this.assertCount(args);
      case "api.calls": return this.apiCalls(args);
      case "api.clear": return this.apiClear();
      case "audio.log": return this.audioLog();
      case "audio.clear": return this.audioClear();
      case "state.dump": return this.stateDump(args);
      case "state.load": return this.stateLoad(args);
      case "state.set": return this.stateSet(args);
      case "state.clear": return this.stateClear(args);
      case "ui.click": return this.uiClick(args);
      case "ui.type": return this.uiType(args);
      case "ui.wait": return this.uiWait(args);
      case "ui.text": return this.uiText(args);
      case "ui.value": return this.uiValue(args);
      case "ui.exists": return this.uiExists(args);
      case "ui.count": return this.uiCount(args);
      case "ui.list": return this.uiList(args);
      case "model.use": return this.modelUse(args);
      case "fixture.probe": return this.fixtureProbe(args);
      case "model.record": return this.modelRecord(args);
      case "model.stop": return this.modelStopRecord();
      case "model.off": return this.modelOff();
      case "snapshot":
      case "inspect": return this.snapshot(args);
      case "record.start": return this.recordStart(args);
      case "record.stop": return this.recordStop();
      case "speech.stub": return this.speechStub(args);
      case "speech.say": return this.speechSay(args);
      case "speech.log": return this.speechLog();
      case "speech.off": return this.speechOff();
      case "tab.open": return this.tabOpen(args);
      case "tab.list": return this.tabList();
      case "tab.close": return this.tabClose(args);
      case "tab.use": return this.tabActivate(args);
      case "tab.eval": return this.tabEval(args);
      case "trace": return this.trace(args);
      case "trace.clear": return this.clearTrace();
      case "shot": return this.screenshot(args);
      case "viewport": return this.viewport(args);
      case "smoke": return this.smoke(args);
      default: throw new Error(`unknown command: ${cmd}`);
    }
  }
}
