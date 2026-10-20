import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOVE_STUDIO_HEALTH_URL,
  LOVE_STUDIO_PORT,
  LOVE_STUDIO_URL,
  loveStudioOpenUrl,
  probeLoveStudio,
} from "../../src/lib/love-studio-link";

/**
 * 本地 Studio 探测：只回答「有没有服务在监听」，从不抛错。
 * 入口卡要在 Studio 未启动时给出安装说明，而不是把主站页面弄崩。
 *
 * 顺序是语义的一部分：先 no-cors 判连通、再 CORS 读版本。Studio 没启动时
 * 只发一次请求（浏览器那条 ERR_CONNECTION_REFUSED 因此只有一条），
 * 而 no-cors 的响应不可读（status 0 / ok false），所以判据只能是「有没有答」，
 * 不能要求 `ok`。
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 真 fetch 会响应 AbortSignal；假 fetch 必须照做，否则超时测不出来。 */
function honoring(handler: (input: string, init?: RequestInit) => Promise<Response>): FetchLike {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      handler(input, init).then(resolve, reject);
    });
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 浏览器里 no-cors 的响应：读不出正文，status 为 0，ok 为 false。 */
const opaque = { status: 0, ok: false, json: () => Promise.reject(new TypeError("opaque")) } as unknown as Response;

function recorder() {
  const modes: Array<string | undefined> = [];
  const urls: string[] = [];
  return { modes, urls };
}

test("地址常量就是主站要链的本地 Studio", () => {
  assert.equal(LOVE_STUDIO_PORT, 5180);
  assert.equal(LOVE_STUDIO_URL, "http://127.0.0.1:5180");
  assert.equal(LOVE_STUDIO_HEALTH_URL, "http://127.0.0.1:5180/api/health");
  assert.equal(loveStudioOpenUrl(), "http://127.0.0.1:5180/");
});

test("先判连通、再读版本，两次都打健康检查地址", async () => {
  const rec = recorder();
  const probe = await probeLoveStudio({
    fetchImpl: honoring(async (input, init) => {
      rec.urls.push(input);
      rec.modes.push(init?.mode);
      return init?.mode === "no-cors" ? opaque : jsonResponse({ status: "ok", version: "1.2.3" });
    }),
  });
  assert.deepEqual(probe, { kind: "up", version: "1.2.3" });
  assert.deepEqual(rec.modes, ["no-cors", "cors"]);
  assert.deepEqual(rec.urls, [LOVE_STUDIO_HEALTH_URL, LOVE_STUDIO_HEALTH_URL]);
});

test("回答里没有版本字段时算在运行，版本为空", async () => {
  const probe = await probeLoveStudio({
    fetchImpl: honoring(async (_input, init) =>
      init?.mode === "no-cors" ? opaque : jsonResponse({ status: "ok" }),
    ),
  });
  assert.deepEqual(probe, { kind: "up", version: null });
});

test("正文不是 JSON 时不算失败，只是没有版本", async () => {
  const probe = await probeLoveStudio({
    fetchImpl: honoring(async (_input, init) =>
      init?.mode === "no-cors" ? opaque : new Response("<html>ok</html>", { status: 200 }),
    ),
  });
  assert.deepEqual(probe, { kind: "up", version: null });
});

test("版本请求被 CORS 拦掉时仍算在运行，只是没有版本", async () => {
  const rec = recorder();
  const probe = await probeLoveStudio({
    fetchImpl: honoring(async (_input, init) => {
      rec.modes.push(init?.mode);
      if (init?.mode === "cors") throw new TypeError("Failed to fetch");
      return opaque;
    }),
  });
  assert.deepEqual(probe, { kind: "up", version: null });
  assert.deepEqual(rec.modes, ["no-cors", "cors"]);
});

test("健康检查答了非 ok 就算「起了一半」，不报已运行", async () => {
  const probe = await probeLoveStudio({
    fetchImpl: honoring(async (_input, init) =>
      init?.mode === "no-cors" ? opaque : jsonResponse({ status: "degraded", db: "down" }, 200),
    ),
  });
  assert.deepEqual(probe, { kind: "degraded" });
});

test("反代回 502（前端在、后端不在）算「起了一半」", async () => {
  const probe = await probeLoveStudio({
    fetchImpl: honoring(async (_input, init) =>
      init?.mode === "no-cors" ? opaque : jsonResponse({ detail: "bad gateway" }, 502),
    ),
  });
  assert.deepEqual(probe, { kind: "degraded" });
});

test("连不上就是没运行，而且只试一次", async () => {
  let calls = 0;
  const probe = await probeLoveStudio({
    fetchImpl: honoring(async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }),
  });
  assert.deepEqual(probe, { kind: "down" });
  assert.equal(calls, 1);
});

test("连接挂着不答时按超时算没运行，不把入口卡吊住", async () => {
  const probe = await probeLoveStudio({
    timeoutMs: 20,
    fetchImpl: honoring(() => new Promise<Response>(() => {})),
  });
  assert.deepEqual(probe, { kind: "down" });
});