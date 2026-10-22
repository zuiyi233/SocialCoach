import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createTabs } from "../../scripts/debug/tabs.mjs";

function sendJson(res, value) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

/** 假 CDP page client：记录 send 调用，可按表达式定制返回，能手动 emit 事件。 */
function makePage({ url, wsUrl }) {
  const client = {
    url,
    wsUrl,
    calls: [], // { method, params }
    closed: false,
    readyState: "complete",
    onEvaluate: null, // (params) => CDP 响应；默认把表达式原样回显
  };
  client.send = async (method, params = {}) => {
    client.calls.push({ method, params });
    if (method === "Runtime.evaluate" && String(params.expression).includes("readyState")) {
      // tabs 内部轮询加载状态的表达式：回“当前 href + readyState”
      return { result: { value: `${JSON.stringify(client.url)}::${client.readyState}` } };
    }
    if (typeof client.onEvaluate === "function") return client.onEvaluate(params);
    return { result: { value: params.expression } };
  };
  client.listeners = {};
  client.on = (method, fn) => {
    (client.listeners[method] ??= []).push(fn);
  };
  client.off = (method, fn) => {
    if (!client.listeners[method]) return;
    client.listeners[method] = client.listeners[method].filter((f) => f !== fn);
  };
  client.emit = (method, params = {}) => {
    for (const fn of client.listeners[method] ?? []) fn(params);
  };
  client.close = () => {
    client.closed = true;
  };
  return client;
}

/**
 * 假 CDP HTTP 服务：/json/list、/json/new（默认只收 PUT，可切 405）、
 * /json/close/<id>、/json/activate/<id>。同一 URL 的 /json/new 返回同一 target。
 */
async function startFakeCdp(t, opts = {}) {
  const state = {
    targets: [],
    requests: [],
    nextId: 1,
    newMethod: opts.newMethod ?? "PUT",
    failList: false,
  };
  const server = createServer((req, res) => {
    const parsed = new URL(req.url, "http://127.0.0.1");
    const { pathname } = parsed;
    res.setHeader("connection", "close");
    state.requests.push(`${req.method} ${req.url}`);
    if (pathname === "/json/list") {
      if (state.failList) { res.statusCode = 500; return res.end("boom"); }
      return sendJson(res, state.targets);
    }
    if (pathname === "/json/new") {
      if (req.method !== state.newMethod) { res.statusCode = 405; return res.end("use PUT"); }
      // 查询串就是 encodeURIComponent 后的目标 URL（没有 key，与 Chrome 一致）
      const targetUrl = decodeURIComponent(parsed.search.slice(1)) || "";
      let target = state.targets.find((t) => t.targetUrl === targetUrl);
      if (!target) {
        target = {
          id: `t${state.nextId++}`,
          targetUrl,
          type: "page",
          url: targetUrl,
          title: "fake page",
          webSocketDebuggerUrl: `ws://fake-${targetUrl}`,
        };
        state.targets.push(target);
      }
      return sendJson(res, target);
    }
    const closed = pathname.match(/^\/json\/close\/(.+)$/);
    if (closed) {
      if (!state.targets.some((t) => t.id === closed[1])) { res.statusCode = 404; return res.end("no such target"); }
      return sendJson(res, { ok: true });
    }
    const activated = pathname.match(/^\/json\/activate\/(.+)$/);
    if (activated) {
      if (!state.targets.some((t) => t.id === activated[1])) { res.statusCode = 404; return res.end("no such target"); }
      return sendJson(res, true);
    }
    res.statusCode = 404;
    res.end("no such endpoint");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  });

  const connects = []; // 每次 connect 收到的 ws 地址
  const pages = []; // 每次 connect 产生的 page client
  const connect = async (wsUrl) => {
    connects.push(wsUrl);
    const target = state.targets.find((t) => t.webSocketDebuggerUrl === wsUrl);
    const page = makePage({ url: target?.url ?? "", wsUrl });
    pages.push(page);
    opts.onConnect?.(page);
    return page;
  };
  const extra = opts.loadTimeout ? { loadTimeout: opts.loadTimeout } : {};
  const tabs = createTabs({ port: server.address().port, connect, ...extra });
  return { tabs, state, connects, pages };
}

test("list() 过滤非 page 类型，只留 id/url/title", async (t) => {
  const { tabs, state } = await startFakeCdp(t);
  state.targets = [
    { id: "p1", type: "page", url: "http://a/", title: "A" },
    { id: "p2", type: "page", url: "http://b/" },
    { id: "sw1", type: "service_worker", url: "http://a/sw.js", title: "SW" },
    { id: "b1", type: "browser", url: "", title: "" },
    { id: "i1", type: "iframe", url: "http://a/f", title: "F" },
  ];
  assert.deepEqual(await tabs.list(), [
    { id: "p1", url: "http://a/", title: "A" },
    { id: "p2", url: "http://b/", title: "" },
  ]);
});

test("open() 走 PUT /json/new，返回 id 且已加载", async (t) => {
  const { tabs, state, connects } = await startFakeCdp(t);
  const opened = await tabs.open("http://a/");
  assert.deepEqual(opened, { id: "t1", url: "http://a/", loaded: true });
  assert.ok(state.requests.some((r) => r.startsWith("PUT /json/new?")));
  assert.equal(connects.length, 1);
});

test("open() 在 405 时回退 GET", async (t) => {
  const { tabs, state } = await startFakeCdp(t, { newMethod: "GET" });
  const opened = await tabs.open("http://b/");
  assert.equal(opened.id, "t1");
  assert.ok(state.requests.includes("PUT /json/new?http%3A%2F%2Fb%2F"));
  assert.ok(state.requests.includes("GET /json/new?http%3A%2F%2Fb%2F"));
});

test("open() 等不到加载事件时超时不算失败（loaded:false）", async (t) => {
  const { tabs } = await startFakeCdp(t, {
    loadTimeout: 60,
    onConnect: (page) => { page.readyState = "loading"; },
  });
  assert.deepEqual(await tabs.open("http://slow/"), { id: "t1", url: "http://slow/", loaded: false });
});

test("open() 收到 Page.loadEventFired 时立即 loaded:true", async (t) => {
  const { tabs } = await startFakeCdp(t, {
    onConnect: (page) => {
      page.readyState = "loading";
      setTimeout(() => page.emit("Page.loadEventFired"), 30);
    },
  });
  assert.deepEqual(await tabs.open("http://event/"), { id: "t1", url: "http://event/", loaded: true });
});

test("open() 相同 URL 复用同一连接的缓存（connect 只调一次）", async (t) => {
  const { tabs, connects } = await startFakeCdp(t);
  const first = await tabs.open("http://same/");
  const second = await tabs.open("http://same/");
  assert.equal(first.id, second.id);
  assert.equal(connects.length, 1);
});

test("同一 id 第二次 evalIn 复用连接（connect 只调一次）", async (t) => {
  const { tabs, connects } = await startFakeCdp(t);
  const opened = await tabs.open("http://eval/");
  assert.equal(await tabs.evalIn(opened.id, "1+1"), "1+1");
  assert.equal(await tabs.evalIn(opened.id, "2+2"), "2+2");
  assert.equal(connects.length, 1);
});

test("evalIn 把 Runtime.evaluate 参数传对（returnByValue/awaitPromise）", async (t) => {
  const { tabs, pages } = await startFakeCdp(t);
  const opened = await tabs.open("http://params/");
  await tabs.evalIn(opened.id, "document.title");
  const evaluate = pages[0].calls.find(
    (c) => c.method === "Runtime.evaluate" && c.params.expression === "document.title",
  );
  assert.ok(evaluate, "应收到对 document.title 的求值");
  assert.deepEqual(evaluate.params, { expression: "document.title", returnByValue: true, awaitPromise: true });
});

test("evalIn 在 exceptionDetails 时抛带异常文本的错误", async (t) => {
  const { tabs, pages } = await startFakeCdp(t);
  const opened = await tabs.open("http://boom/");
  pages[0].onEvaluate = () => ({ exceptionDetails: { text: "ReferenceError: missing is not defined" } });
  await assert.rejects(tabs.evalIn(opened.id, "missing()"), /ReferenceError: missing is not defined/);
});

test("close() 关掉缓存的连接，之后再 evalIn 会重新 connect", async (t) => {
  const { tabs, pages, connects } = await startFakeCdp(t);
  const opened = await tabs.open("http://resume/");
  assert.deepEqual(await tabs.close(opened.id), { closed: true });
  assert.equal(pages[0].closed, true);
  assert.equal(await tabs.evalIn(opened.id, "1"), "1");
  assert.equal(connects.length, 2);
});

test("close() 对未知 id 不抛错，返回 closed:false", async (t) => {
  const { tabs } = await startFakeCdp(t);
  assert.deepEqual(await tabs.close("ghost-1"), { closed: false });
});

test("activate() 返回 activated:true 并命中 /json/activate/<id>", async (t) => {
  const { tabs, state } = await startFakeCdp(t);
  const opened = await tabs.open("http://act/");
  assert.deepEqual(await tabs.activate(opened.id), { activated: true });
  assert.ok(state.requests.some((r) => r.includes("/json/activate/t1")));
});

test("非 2xx 抛带状态码与 URL 的错误", async (t) => {
  const { tabs, state } = await startFakeCdp(t);
  state.failList = true;
  await assert.rejects(tabs.list(), (error) => {
    assert.match(error.message, /500/);
    assert.match(error.message, /\/json\/list/);
    return true;
  });
});