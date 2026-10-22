/**
 * 多标签页管理：主标签页之外再开 / 关 / 切换标签页，并对指定标签页求值。
 *
 * 独立成模块而不是塞进 engine.mjs：daemon.mjs 会同时加载 engine 与这里的命令，
 * 本模块再 import engine.mjs 会形成循环依赖——`connect` 由调用方注入
 * （生产传 engine 的 CDP.connect，测试传假实现），client 只需 send / close。
 *
 * 只接受带协议的绝对 URL，不做 http:// 补全，是否补全由调用方负责。
 */

const HTTP_TIMEOUT = 3000; // 所有 /json/* HTTP 请求的超时
const DEFAULT_LOAD_TIMEOUT = 3000; // open 后等加载事件 / readyState 的时间上限
const POLL_INTERVAL = 200;
const METHOD_NOT_ALLOWED = 405;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET/PUT /json/<path>；非 2xx 抛带状态码与 URL 的错误，error.status 供 405 判断。 */
async function httpJson(port, method, path) {
  const url = `http://127.0.0.1:${port}/json${path}`;
  let res;
  try {
    res = await fetch(url, { method, signal: AbortSignal.timeout(HTTP_TIMEOUT) });
  } catch (error) {
    throw new Error(`CDP HTTP ${method} ${url} failed: ${error.message}`);
  }
  if (!res.ok) {
    const error = new Error(`CDP HTTP ${res.status} ${method} ${url}`);
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/** 新版 Chrome 的 /json/new 只接受 PUT；老版本只认 GET，收到 405 回退。 */
async function createTarget(port, url) {
  const path = `/new?${encodeURIComponent(url)}`;
  try {
    return await httpJson(port, "PUT", path);
  } catch (error) {
    if (error.status !== METHOD_NOT_ALLOWED) throw error;
    return await httpJson(port, "GET", path);
  }
}

/** 单次事件等待；client 没有 `on` 时直接返回 false。没有 `off` 时残留的 listener 是空操作。 */
function onceEvent(client, method, timeoutMs) {
  if (typeof client.on !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const onEvent = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off?.(method, onEvent);
      resolve(true);
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.off?.(method, onEvent);
      resolve(false);
    }, timeoutMs);
    client.on(method, onEvent);
  });
}

/**
 * 轮询 location.href + readyState 兜底：loadEventFired 可能在挂上 listener 之前
 * 就已触发（复用连接时必现），此时靠“URL 一致且 readyState=complete”判定加载完成。
 */
async function pollReady(client, url, timeoutMs, result) {
  const until = Date.now() + timeoutMs;
  const norm = (s) => String(s).replace(/\/+$/, "").split("#")[0];
  const expression = `JSON.stringify(location.href) + "::" + document.readyState`;
  while (!result.loaded && Date.now() < until) {
    try {
      const { result: evalResult } = await client.send("Runtime.evaluate", { expression, returnByValue: true });
      const [hrefJson, ready] = String(evalResult?.value ?? "").split("::");
      if (ready === "complete") {
        let href = hrefJson;
        try { href = JSON.parse(hrefJson); } catch {} // 表达式里 href 是 JSON.stringify 的
        if (norm(href) === norm(url)) {
          result.loaded = true;
          return true;
        }
      }
    } catch {
      // 导航期间执行上下文会被销毁，忽略这一次，继续等
    }
    await sleep(POLL_INTERVAL);
  }
  return false;
}

/** 事件与轮询谁先确认加载完成都算数；超时不算失败。 */
async function waitForLoad(client, url, timeoutMs) {
  const result = { loaded: false };
  const canWaitEvent = typeof client.on === "function";
  const byEvent = (canWaitEvent ? onceEvent(client, "Page.loadEventFired", timeoutMs) : Promise.resolve(false)).then((hit) => {
    if (hit) result.loaded = true;
  });
  const byReady = pollReady(client, url, timeoutMs, result);
  if (canWaitEvent) await Promise.race([byEvent, byReady]);
  else await byReady;
  return result.loaded;
}

function formatEvalError(details) {
  const description = details?.exception?.description ?? details?.text ?? "page evaluation failed";
  return String(description).split("\n").slice(0, 6).join("\n");
}

export function createTabs({ port, connect, loadTimeout = DEFAULT_LOAD_TIMEOUT }) {
  const clients = new Map(); // id → { client }：同一 id 的连接缓存复用，close() 时才移除

  async function getClient(id, wsUrl) {
    const cached = clients.get(id);
    if (cached) return cached.client;
    const client = await connect(wsUrl);
    clients.set(id, { client });
    return client;
  }

  /** evalIn 的目标不在缓存里时，先从 /json/list 找到它的 ws 地址再连。 */
  async function getClientForEval(id) {
    const cached = clients.get(id);
    if (cached) return cached.client;
    const targets = await httpJson(port, "GET", "/list");
    const target = (Array.isArray(targets) ? targets : []).find((t) => t?.id === id && t?.type === "page");
    if (!target?.webSocketDebuggerUrl) throw new Error(`no page target with id: ${id}`);
    return getClient(id, target.webSocketDebuggerUrl);
  }

  async function list() {
    const targets = await httpJson(port, "GET", "/list");
    return (Array.isArray(targets) ? targets : [])
      .filter((target) => target?.type === "page")
      .map((target) => ({ id: target.id, url: target.url ?? "", title: target.title ?? "" }));
  }

  async function open(url) {
    const target = await createTarget(port, url);
    if (!target?.webSocketDebuggerUrl) throw new Error(`/json/new returned no webSocketDebuggerUrl for ${url}`);
    const client = await getClient(target.id, target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    const loaded = await waitForLoad(client, url, loadTimeout);
    return { id: target.id, url, loaded };
  }

  async function close(id) {
    const cached = clients.get(id);
    if (cached) {
      clients.delete(id);
      try { cached.client.close(); } catch {}
    }
    try {
      await httpJson(port, "GET", `/close/${id}`);
      return { closed: true };
    } catch {
      // Chrome 可能早已关掉这个 target（404 等）：close 尽力而为，不抛错
      return { closed: false };
    }
  }

  async function activate(id) {
    const result = await httpJson(port, "GET", `/activate/${id}`);
    return { activated: result === true || result === "true" };
  }

  /** 对指定标签页求值；exceptionDetails 存在时抛带异常文本的错误。 */
  async function evalIn(id, expression) {
    const client = await getClientForEval(id);
    const response = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(formatEvalError(response.exceptionDetails));
    return response.result?.value;
  }

  return { list, open, close, activate, evalIn };
}