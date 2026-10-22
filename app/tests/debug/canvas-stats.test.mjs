/**
 * canvas-stub 测试：纯函数 summarizeCanvas + 注入源码的静态检查 + 假 window
 * 黑盒执行（不依赖真实浏览器，也不启动任何 Chrome 进程）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasStubSource, summarizeCanvas } from "../../scripts/debug/canvas-stub.mjs";

// ── summarizeCanvas：纯函数 ────────────────────────────────────────────────

test("帧率与帧数差：fps 按采样窗口线性换算", () => {
  const out = summarizeCanvas(
    { frames: { count: 10 }, draws: { count: 5 } },
    { frames: { count: 100 }, draws: { count: 905 } },
    1000,
  );
  assert.equal(out.frames.count, 90);
  assert.equal(out.frames.fps, 90);
  assert.equal(out.draws.count, 900);
  assert.equal(out.draws.perSecond, 900);
});

test("draws perSecond 四舍五入（半值向上）", () => {
  // 995 次 / 2000ms → 497.5/s → round 498
  const out = summarizeCanvas(
    { draws: { count: 0 } },
    { draws: { count: 995 }, frames: { count: 0 } },
    2000,
  );
  assert.equal(out.draws.perSecond, 498);
  assert.equal(out.draws.count, 995);
  // 整数倍不取整误差
  const exact = summarizeCanvas({ draws: { count: 0 } }, { draws: { count: 1500 } }, 2000);
  assert.equal(exact.draws.perSecond, 750);
});

test("零间隔不除零：ms=0 时 fps / perSecond 为 0，计数仍返回", () => {
  const out = summarizeCanvas(
    { frames: { count: 0 }, draws: { count: 0 } },
    { frames: { count: 5 }, draws: { count: 12 } },
    0,
  );
  assert.equal(out.frames.count, 5);
  assert.equal(out.frames.fps, 0);
  assert.equal(out.draws.count, 12);
  assert.equal(out.draws.perSecond, 0);
  assert.equal(out.deltas.ms, 0);
});

test("canvases 透传：取 after 的登记表，忽略 before", () => {
  const after = { canvases: [{ w: 1280, h: 720, type: "webgl2" }], contexts: { webgl2: 1, "2d": 748 }, frames: { count: 30 }, draws: { count: 400 } };
  const before = { canvases: [{ w: 1, h: 1, type: "stale" }], frames: { count: 0 }, draws: { count: 0 } };
  const out = summarizeCanvas(before, after, 1000);
  assert.deepEqual(out.canvases, after.canvases);
  assert.deepEqual(out.contexts, { webgl2: 1, "2d": 748 }, "contexts 透传：2d 只计数、不进 canvases");
  assert.equal(out.deltas.frames, 30);
  assert.equal(out.deltas.draws, 400);
});

test("缺失字段容错：null / undefined / 空对象都归零，不抛错", () => {
  assert.deepEqual(summarizeCanvas(null, null), {
    canvases: [],
    contexts: {},
    frames: { count: 0, fps: 0 },
    draws: { count: 0, perSecond: 0 },
    deltas: { frames: 0, draws: 0, ms: 1000 },
  });
  assert.deepEqual(summarizeCanvas(undefined, undefined, 500), {
    canvases: [],
    contexts: {},
    frames: { count: 0, fps: 0 },
    draws: { count: 0, perSecond: 0 },
    deltas: { frames: 0, draws: 0, ms: 500 },
  });
  assert.equal(summarizeCanvas({}, {}).frames.count, 0);
  assert.equal(summarizeCanvas({ frames: { count: 7 } }, { draws: { count: 3 } }).draws.count, 3);
  assert.equal(summarizeCanvas({ frames: { count: 7 } }, { draws: { count: 3 } }).frames.count, 0);
});

test("deltas 结构：{frames, draws, ms} 与顶层计数一致", () => {
  const out = summarizeCanvas(
    { frames: { count: 1 }, draws: { count: 1 } },
    { frames: { count: 61 }, draws: { count: 1001 } },
    1500,
  );
  assert.deepEqual(out.deltas, { frames: 60, draws: 1000, ms: 1500 });
});

// ── 源码字符串：静态检查（不执行浏览器代码）────────────────────────────────

test("源码包含 WebGL1/WebGL2 两个原型的四个绘制入口补丁点", () => {
  const src = canvasStubSource();
  for (const needle of ["WebGLRenderingContext", "WebGL2RenderingContext", "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
    assert.ok(src.includes(needle), `源码缺 patch 点: ${needle}`);
  }
});

test("源码包含 getContext / requestAnimationFrame 补丁与幂等标记", () => {
  const src = canvasStubSource();
  for (const needle of ["getContext", "requestAnimationFrame", "__scCanvas", "version === 1", "__scCanvasPatched"]) {
    assert.ok(src.includes(needle), `源码缺标记: ${needle}`);
  }
});

test("源码语法可解析，且只计数不记录参数（无 draw 参数收集）", () => {
  const src = canvasStubSource();
  assert.doesNotThrow(() => new Function("window", src));
  assert.ok(!src.includes("arguments[0]") || src.includes("String(arguments[0])"), "getContext 只读类型，其余不得抄参数");
  // 绘制包装体里不该出现对 args 的引用
  assert.ok(!src.includes("wrapped(arg"), "绘制包装不应收集参数");
});

// ── 假 window 黑盒：注入后计数真的生效 ────────────────────────────────────

function installFake() {
  const window = {};
  // 假 rAF：同步派发一帧（模拟 vsync），返回句柄 id。
  window.requestAnimationFrame = function (cb) {
    cb(0);
    return 42;
  };
  const baseProto = {
    drawArrays() { return "drawn"; },
    drawElements() {},
    drawArraysInstanced: undefined,
    drawElementsInstanced: undefined,
  };
  window.WebGLRenderingContext = function () {};
  window.WebGLRenderingContext.prototype = baseProto;
  window.WebGL2RenderingContext = function () {};
  window.WebGL2RenderingContext.prototype = Object.create(baseProto);
  window.WebGL2RenderingContext.prototype.drawArraysInstanced = function () {};
  window.WebGL2RenderingContext.prototype.drawElementsInstanced = function () {};
  function Canvas() {}
  Canvas.prototype.getContext = function (type) {
    return /^webgl/.test(type) ? ctx : null;
  };
  const canvas = new Canvas();
  canvas.width = 800;
  canvas.height = 600;
  const ctx = Object.create(window.WebGLRenderingContext.prototype);
  const gl2 = Object.create(window.WebGL2RenderingContext.prototype);
  window.HTMLCanvasElement = Canvas;
  new Function("window", canvasStubSource())(window);
  return { window, canvas, ctx, gl2 };
}

test("黑盒：getContext 登记 canvas 尺寸/类型，draw*/rAF 计数，原行为保留", () => {
  const { window, canvas, ctx, gl2 } = installFake();
  canvas.getContext("webgl");
  assert.deepEqual(window.__scCanvas.stats().canvases, [{ w: 800, h: 600, type: "webgl" }]);
  canvas.getContext("webgl2");
  assert.deepEqual(window.__scCanvas.stats().canvases, [{ w: 800, h: 600, type: "webgl2" }], "同一 canvas 再取 webgl2 应更新类型而非重复登记");
  const plain = new (window.HTMLCanvasElement)();
  plain.width = 640;
  plain.height = 480;
  plain.getContext("2d");
  // 只登记 webgl/webgl2：2d 画布只计次，不占 canvases（Next / three.js 会造几百个）
  assert.equal(window.__scCanvas.stats().canvases.length, 1);
  assert.equal(window.__scCanvas.stats().contexts["2d"], 1);
  assert.equal(window.__scCanvas.stats().contexts.webgl2, 1);
  // 四个入口各计一次，返回值不受影响
  assert.equal(ctx.drawArrays(), "drawn");
  ctx.drawElements();
  gl2.drawArraysInstanced();
  gl2.drawElementsInstanced();
  assert.equal(window.__scCanvas.stats().draws.count, 4);
  // rAF 回调真正执行才算一帧
  assert.equal(window.__scCanvas.stats().frames.count, 0);
  window.requestAnimationFrame(function () {});
  window.requestAnimationFrame(function () {});
  assert.equal(window.__scCanvas.stats().frames.count, 2);
});

test("黑盒：stats() 按 DOM 当前值刷新 canvas 尺寸（three.js 事后改大小）", () => {
  const { window, canvas } = installFake();
  canvas.getContext("webgl");
  canvas.width = 1920;
  canvas.height = 1080;
  assert.deepEqual(window.__scCanvas.stats().canvases, [{ w: 1920, h: 1080, type: "webgl" }]);
});

test("黑盒：重复注入幂等——不重置统计、不二次包装、不重复登记", () => {
  const { window, canvas, ctx } = installFake();
  canvas.getContext("webgl");
  ctx.drawArrays();
  const first = window.__scCanvas;
  const before = window.__scCanvas.stats();
  new Function("window", canvasStubSource())(window);
  assert.equal(window.__scCanvas, first, "重复注入不得替换 __scCanvas");
  assert.deepEqual(window.__scCanvas.stats(), before, "重复注入不得重置统计");
  ctx.drawArrays();
  assert.equal(window.__scCanvas.stats().draws.count, before.draws.count + 1, "重复注入后单次调用只计一次");
  assert.equal(window.__scCanvas.stats().canvases.length, 1, "重复注入不得重复登记 canvas");
});
