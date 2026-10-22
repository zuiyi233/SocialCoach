/**
 * 语音识别确定性桩：生成一段可注入页面的 IIFE 源码，用假 SpeechRecognition 替换真实实现。
 *
 * 背景：语音输入链路（Chat.tsx 的 startListening、dinner 的 SpeechSession）在无头
 * Chrome 里没有真实麦克风，行为不可回放。注入本桩后，主控方通过
 * `window.__scSpeech.say("你好")` 精确指定「这次识别返回什么」，让链路变成确定性的。
 *
 * 注入方式（供 engine 侧集成参考）：
 *   const src = speechStubSource({ lang: "zh-CN", interim: false });
 *   在导航前用 Page.addScriptToEvaluateOnNewDocument 注入（需 reload/导航后才生效），
 *   或对已加载页面用 Runtime.evaluate 执行（立即生效）。
 *
 * 页面侧契约：
 * - 定义 window.SpeechRecognition / window.webkitSpeechRecognition（同一构造器）；
 * - start() 同步触发 onstart，然后按队列顺序以 setTimeout(delay) 派发结果；
 * - 结果事件与真实浏览器同形：results 为类数组、results[i][0].transcript、
 *   results[i].isFinal、results[i][0].confidence === 0.9、event.resultIndex；
 * - interimResults 关闭时 isFinal:false 的条目被抑制（与真实浏览器一致）；
 * - __scSpeech.say / fail / reset / log（统计只读，供断言）。
 *
 * 限制：不模拟真实引擎的停顿自动结束、音量检测、多语言重试；done。
 */

// IIFE 函数体（不含开头两行配置注入与结尾收口）。注意：本常量内禁止出现反引号和 ${。
const STUB_BODY = `
  var stats = { starts: 0, stops: 0, aborts: 0, results: 0, errors: 0 };
  var pending = [];    // start() 之前由 say() 排队的条目，归属下一次 start()
  var failCode = null; // 非 null 时下一次 start() 直接失败
  var active = null;   // 当前 started 且未结束的实例（say 的追加目标）

  function makeEntry(text, delay, final, end) {
    var d = typeof delay === "number" && delay > 0 ? delay : 0;
    return { text: String(text == null ? "" : text), delay: d, final: final !== false, end: !!end };
  }

  function FakeSpeechRecognition() {
    this.lang = langOpt;
    this.interimResults = interimOpt;
    this.continuous = false;
    this.maxAlternatives = 1;
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.onspeechend = null;
    this.onaudiostart = null;
    this._started = false;
    this._queue = [];
    this._timers = [];
    this._results = []; // 整个会话的结果槽，与真实浏览器一样每次事件复用同一列表
    this._chain = false;
  }

  FakeSpeechRecognition.prototype.start = function () {
    if (this._started) return; // 幂等：重复 start 忽略，避免误报
    this._started = true;
    stats.starts++;
    active = this;
    var batch = pending.splice(0, pending.length);
    for (var i = 0; i < batch.length; i++) this._queue.push(batch[i]);
    if (failCode !== null) {
      // 失败会话不发任何结果；onerror 先于 onend 同步触发（接近 not-allowed 的真实顺序）。
      var code = failCode;
      failCode = null;
      stats.errors++;
      if (typeof this.onerror === "function") this.onerror.call(this, { error: code });
      this._end();
      return;
    }
    if (typeof this.onstart === "function") this.onstart.call(this);
    this._kick();
  };

  FakeSpeechRecognition.prototype._kick = function () {
    if (this._chain || this._queue.length === 0) return;
    this._chain = true;
    this._tick();
  };

  FakeSpeechRecognition.prototype._tick = function () {
    var self = this;
    if (!self._started) { self._chain = false; return; }
    var entry = self._queue.shift();
    if (!entry) { self._chain = false; return; }
    var timer = setTimeout(function () {
      self._deliver(entry);
      self._tick();
    }, entry.delay);
    self._timers.push(timer);
  };

  FakeSpeechRecognition.prototype._deliver = function (entry) {
    var self = this;
    self._timers = [];
    if (!entry.final && !self.interimResults) return; // interimResults 关闭时抑制 interim 条目
    var tail = self._results[self._results.length - 1];
    var index = self._results.length;
    if (tail && !tail.isFinal) {
      // 尾部 interim 槽就地替换或提升为 final，results 与真实浏览器一致（无重复槽）。
      index = self._results.length - 1;
      tail.isFinal = entry.final;
      tail[0].transcript = entry.text;
    } else {
      self._results.push({ isFinal: entry.final, length: 1, 0: { transcript: entry.text, confidence: 0.9 } });
    }
    stats.results++;
    if (typeof self.onresult === "function") {
      self.onresult.call(self, { resultIndex: index, results: self._results });
    }
    if (entry.end) self._end(); // end:true 表示「这句话说完会话自然结束」
  };

  FakeSpeechRecognition.prototype._end = function () {
    if (active === this) active = null;
    this._started = false;
    if (typeof this.onend === "function") this.onend.call(this);
  };

  FakeSpeechRecognition.prototype._clearTimers = function () {
    for (var i = 0; i < this._timers.length; i++) {
      if (this._timers[i] !== undefined) clearTimeout(this._timers[i]);
    }
    this._timers = [];
  };

  FakeSpeechRecognition.prototype.stop = function () {
    if (!this._started) return;
    stats.stops++;
    this._clearTimers();
    this._queue = [];
    this._end();
  };

  FakeSpeechRecognition.prototype.abort = function () {
    if (!this._started) return;
    stats.aborts++;
    this._clearTimers();
    this._queue = [];
    this._end(); // 真实浏览器 abort 也会触发 onend
  };

  window.__scSpeech = {
    // 排一条识别结果。start() 前调用归入共享队列，由下一次 start() 领取；
    // start() 后调用立即追加给当前会话（模拟用户持续说话）。
    say: function (text, opts) {
      var o = opts || {};
      var entry = makeEntry(text, o.delay, o.final, o.end);
      if (active && active._started) {
        active._queue.push(entry);
        active._kick();
      } else {
        pending.push(entry);
      }
    },
    fail: function (code) {
      failCode = typeof code === "string" && code ? code : "no-speech";
    },
    reset: function () {
      // 只清共享队列与统计；进行中的会话（含已排定的定时器）不受影响。
      pending = [];
      failCode = null;
      stats = { starts: 0, stops: 0, aborts: 0, results: 0, errors: 0 };
    },
    log: function () {
      var s = stats;
      return { starts: s.starts, stops: s.stops, aborts: s.aborts, results: s.results, errors: s.errors };
    },
  };
`;

/**
 * 生成可注入页面的 IIFE 源码字符串。
 * @param {{lang?: string, interim?: boolean}} [options]
 *   lang —— 实例默认识别语言（默认 "zh-CN"）；
 *   interim —— 实例默认 interimResults（默认 false，interim 条目会被抑制）。
 * @returns {string}
 */
export function speechStubSource(options = {}) {
  const lang = options.lang ?? "zh-CN";
  const interim = options.interim ?? false;
  return (
    "(function (window, document) {\n" +
    "  if (!window || window.__scSpeech) return; // 幂等：重复注入不覆盖已有桩\n" +
    "  var langOpt = " + JSON.stringify(lang) + ";\n" +
    "  var interimOpt = " + (interim ? "true" : "false") + ";\n" +
    STUB_BODY +
    "\n  window.SpeechRecognition = FakeSpeechRecognition;\n" +
    "  window.webkitSpeechRecognition = FakeSpeechRecognition;\n" +
    "})(window, document);\n"
  );
}