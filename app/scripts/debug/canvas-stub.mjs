/**
 * 3D canvas 观测桩：生成可注入页面的 IIFE 源码 + 采样窗口求和的纯函数。
 *
 * 背景：无头 Chrome 里「3D 场景在不在渲染、有没有在响应输入」没法靠截图或
 * 关键文案证明——场景可能挂了但页面照样能打字。本桩在页面脚本执行前替换
 * WebGL 绘制入口与 requestAnimationFrame，只累计次数（不记录参数，避免内存
 * 膨胀），并在 getContext 时登记 canvas 尺寸与上下文类型。主控方取两个时刻的
 * 累计值相减，得到采样窗口内的帧数与绘制调用数。
 *
 * 注入方式（与 engine.mjs 的 PAGE_HELPERS 集成）：
 *   const src = canvasStubSource();
 *   在导航前用 Page.addScriptToEvaluateOnNewDocument 注入（每个新文档执行一次），
 *   或对已加载页面用 Runtime.evaluate 执行（立即生效）。
 *
 * 页面侧契约：
 * - window.__scCanvas = { version: 1, stats }；
 * - stats() → { canvases: [{w,h,type}], contexts: {type: count}, frames: {count}, draws: {count} }，
 *   frames/draws 是累计值；canvases 只含 webgl/webgl2（在 getContext 时登记、stats() 时刷新尺寸），
 *   contexts 按类型统计全部 getContext 调用次数（2d 画布不保留引用）；
 * - 重复注入不重置统计、不二次包装原型方法（幂等）。
 *
 * 限制：只证明「调用发生过」，不验证 GPU 是否真的画对了像素；three.js 内部
 * 对象数、纹理上传、Shader 编译状态都看不到。done。
 */

// IIFE 函数体（不含开头的幂等守卫与结尾收口）。注意：本常量内禁止出现
// 反引号和 ${ —— 它会被插进 engine.mjs 的 String.raw 模板。
const STUB_BODY = `
  var state = { canvases: [], contexts: {}, draws: 0, frames: 0 };

  function defineMethod(obj, name, fn) {
    try {
      Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });
    } catch (e) {
      try { obj[name] = fn; } catch (e2) {}
    }
  }

  // 包一层实例方法：计数后透传调用，保留返回值与 this。
  function wrapMethod(proto, name) {
    if (!proto || typeof proto[name] !== "function") return;
    if (proto[name].__scCanvasPatched) return; // 同文档重复注入时不二次包装
    var orig = proto[name];
    function wrapped() {
      state.draws += 1;
      return orig.apply(this, arguments);
    }
    wrapped.__scCanvasPatched = true;
    defineMethod(proto, name, wrapped);
  }

  // WebGL1 / WebGL2 的绘制入口：只累计次数，不抄参数。
  wrapMethod(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype, "drawArrays");
  wrapMethod(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype, "drawElements");
  wrapMethod(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype, "drawArraysInstanced");
  wrapMethod(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype, "drawElementsInstanced");
  wrapMethod(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype, "drawArrays");
  wrapMethod(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype, "drawElements");
  wrapMethod(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype, "drawArraysInstanced");
  wrapMethod(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype, "drawElementsInstanced");

  // getContext：只登记 webgl/webgl2 的 canvas（3D 场景关心的就是它们），
  // 其余类型只按调用次数计数。Next / three.js 会造几百个 1x1 的 2d 画布，
  // 全登记既污染输出又白留引用，所以非 webgl 的 canvas 不留引用。
  var canvasProto = window.HTMLCanvasElement ? window.HTMLCanvasElement.prototype : null;
  if (canvasProto && typeof canvasProto.getContext === "function" && !canvasProto.getContext.__scCanvasPatched) {
    var origGetContext = canvasProto.getContext;
    function wrappedGetContext() {
      var ctx = origGetContext.apply(this, arguments);
      var type = arguments.length > 0 ? String(arguments[0]) : "";
      try {
        if (type) state.contexts[type] = (state.contexts[type] || 0) + 1;
        if (type.indexOf("webgl") === 0) {
          var entry = null;
          for (var i = 0; i < state.canvases.length; i++) {
            if (state.canvases[i].el === this) { entry = state.canvases[i]; break; }
          }
          if (!entry) state.canvases.push({ el: this, type: type, w: this.width, h: this.height });
          else entry.type = type;
        }
      } catch (e) {}
      return ctx;
    }
    wrappedGetContext.__scCanvasPatched = true;
    defineMethod(canvasProto, "getContext", wrappedGetContext);
  }

  // rAF：包一层回调计数。调用方传的不是函数（异常用法）时原样透传。
  if (window.requestAnimationFrame && !window.requestAnimationFrame.__scCanvasPatched) {
    var origRAF = window.requestAnimationFrame;
    function wrappedRAF(cb) {
      if (typeof cb !== "function") return origRAF.call(this, cb);
      function counted(t) { state.frames += 1; return cb(t); }
      return origRAF.call(this, counted);
    }
    wrappedRAF.__scCanvasPatched = true;
    defineMethod(window, "requestAnimationFrame", wrappedRAF);
  }

  window.__scCanvas = {
    version: 1,
    stats: function () {
      var list = [];
      for (var i = 0; i < state.canvases.length; i++) {
        var c = state.canvases[i];
        var w = c.w;
        var h = c.h;
        try { w = c.el.width; h = c.el.height; } catch (e) {}
        list.push({ w: w, h: h, type: c.type });
      }
      var contexts = {};
      for (var k in state.contexts) { if (Object.prototype.hasOwnProperty.call(state.contexts, k)) contexts[k] = state.contexts[k]; }
      return { canvases: list, contexts: contexts, frames: { count: state.frames }, draws: { count: state.draws } };
    },
  };
`;

/**
 * 生成可注入页面的 IIFE 源码字符串。
 * @returns {string}
 */
export function canvasStubSource() {
  return (
    "(function (window) {\n" +
    "  if (!window || (window.__scCanvas && window.__scCanvas.version === 1)) return; // 幂等：重复注入不重置计数\n" +
    STUB_BODY +
    "})(window);\n"
  );
}

/**
 * 两个时刻的累计值相减 → 采样窗口内的统计（纯函数，供引擎方法与单测共用）。
 * @param {{canvases?: Array, frames?: {count?: number}, draws?: {count?: number}} | null} before
 * @param {*} after
 * @param {number} [ms] 采样窗口毫秒；0 / 负值视为零间隔（fps / perSecond 返回 0，不除零）
 * @returns {{canvases: Array, frames: {count: number, fps: number}, draws: {count: number, perSecond: number}, deltas: {frames: number, draws: number, ms: number}}}
 */
export function summarizeCanvas(before, after, ms = 1000) {
  const span = Math.max(0, Number(ms) || 0);
  const frameDelta = Math.max(0, Number(after?.frames?.count ?? 0) - Number(before?.frames?.count ?? 0));
  const drawDelta = Math.max(0, Number(after?.draws?.count ?? 0) - Number(before?.draws?.count ?? 0));
  const perMs = (count) => (span > 0 ? Math.round((count / span) * 1000) : 0);
  return {
    canvases: Array.isArray(after?.canvases) ? after.canvases : [],
    contexts: after?.contexts && typeof after.contexts === "object" ? after.contexts : {},
    frames: { count: frameDelta, fps: perMs(frameDelta) },
    draws: { count: drawDelta, perSecond: perMs(drawDelta) },
    deltas: { frames: frameDelta, draws: drawDelta, ms: span },
  };
}
