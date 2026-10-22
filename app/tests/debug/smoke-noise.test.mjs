import { test } from "node:test";
import assert from "node:assert/strict";
import { isSmokeNoise } from "../../scripts/debug/engine.mjs";

// smoke 的豁免必须窄：CI 上没有 Studio，/love 必然记一条连接被拒，
// 但同一条日志出现在别的路由上就是真的坏了。

test("love 路由忽略 Studio 健康探测的连接被拒", () => {
  const text = "Failed to load resource: net::ERR_CONNECTION_REFUSED";
  for (const route of ["/love", "/love/archive", "/love/cards", "/love/studio"]) {
    assert.equal(isSmokeNoise(text, route), true, route);
  }
});

test("非 love 路由不豁免连接被拒", () => {
  const text = "Failed to load resource: net::ERR_CONNECTION_REFUSED";
  for (const route of ["/", "/3d", "/progress", "/arena"]) {
    assert.equal(isSmokeNoise(text, route), false, route);
  }
});

test("love 路由上的真实错误仍然报出来", () => {
  assert.equal(isSmokeNoise("TypeError: x is not a function", "/love"), false);
  assert.equal(isSmokeNoise("Uncaught Error: hydration failed", "/love/cards"), false);
});

test("开发服务器自身的握手噪声一律忽略", () => {
  assert.equal(isSmokeNoise("Failed to load resource: ERR_INVALID_HTTP_RESPONSE", "/3d"), true);
  assert.equal(isSmokeNoise("WebSocket connection to '/_next/hmr' failed", "/"), true);
});

test("缺 text / route 不抛错", () => {
  assert.equal(isSmokeNoise(undefined, undefined), false);
  assert.equal(isSmokeNoise(null, "/love"), false);
});
