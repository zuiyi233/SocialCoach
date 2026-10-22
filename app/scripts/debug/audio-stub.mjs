/**
 * 音频播放观测桩：生成可注入页面的 IIFE 源码，观测三类播放入口。
 *
 * 背景：TTS 链路（/api/speech → audio/pcm → WebAudio）在无头 Chrome 里
 * 「fetch 成功」不等于「真的播了」——PCM 字节可能被丢弃、buffer 可能没建。
 * 本桩在页面脚本执行前包装播放入口，只累计观测统计（不篡改行为，全部
 * 透传原实现），主控方用 engine 侧的 audio.log / audio.clear 取数断言。
 *
 * 覆盖三类入口（按任务核查的真实链路）：
 * - HTMLMediaElement.play / pause：记录 src 前缀与 play/pause 次数，并在
 *   play 调用时点快照 currentTime / duration（元素已就绪时即真实值）；
 * - new Audio(src)：记录构造时传入的 src 前缀（love-ambient 环境音用）；
 * - WebAudio：AudioContext.decodeAudioData 次数、createBuffer 的参数
 *   （channels / length / sampleRate，TTS 的 pcmSink 用它）、
 *   AudioBufferSourceNode.start 次数。
 *
 * 注入方式（与 engine.mjs 的 PAGE_HELPERS 集成）：
 *   const src = audioStubSource();
 *   在导航前用 Page.addScriptToEvaluateOnNewDocument 注入，或对已加载页面
 *   用 Runtime.evaluate 执行（立即生效）。
 *
 * 页面侧契约：
 * - window.__scAudio = { version: 1, log, clear }；
 * - log() → { media: {plays,pauses,entries:[{src,currentTime,duration}]},
 *   audio: {constructed:[src…]}, webaudio: {decode,buffers:[…],sourcesStarted} }，
 *   entries / constructed / buffers 是累计快照（各上限 200 条，防内存膨胀）；
 * - clear() → 清空统计（不卸包装、不重置原型补丁）；
 * - 重复注入不二次包装原型方法（幂等，__scAudioPatched 标记）。
 *
 * 限制：只证明「播放入口被调用过」，不验证真实声卡输出；无头环境的
 * currentTime / duration 在元素未加载元数据时是 0。done。
 */

// IIFE 函数体（不含开头的幂等守卫与结尾收口）。注意：本常量内禁止出现
// 反引号和 ${ —— 它会被插进 engine.mjs 的 String.raw 模板。
const STUB_BODY = `
  var state = {
    media: { plays: 0, pauses: 0, entries: [] },
    audioSources: [],
    webaudio: { decode: 0, buffers: [], sourcesStarted: 0 }
  };
  var ENTRY_LIMIT = 200;

  function defineMethod(obj, name, fn) {
    try {
      Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });
    } catch (e) {
      try { obj[name] = fn; } catch (e2) {}
    }
  }

  // 包一层实例方法：先记录再透传，保留返回值与 this。
  function wrapMethod(proto, name, record) {
    if (!proto || typeof proto[name] !== "function") return;
    if (proto[name].__scAudioPatched) return; // 同文档重复注入时不二次包装
    var orig = proto[name];
    function wrapped() {
      try { record(this, arguments); } catch (e) {}
      return orig.apply(this, arguments);
    }
    wrapped.__scAudioPatched = true;
    defineMethod(proto, name, wrapped);
  }

  function srcPrefix(value) {
    try { return String(value || "").slice(0, 80); } catch (e) { return ""; }
  }

  function recordPlay(el) {
    var entry = { src: srcPrefix(el.src) };
    try { entry.currentTime = Number(el.currentTime) || 0; } catch (e) { entry.currentTime = 0; }
    try { entry.duration = Number(el.duration) || 0; } catch (e) { entry.duration = 0; }
    state.media.plays += 1;
    state.media.entries.push(entry);
    if (state.media.entries.length > ENTRY_LIMIT) state.media.entries.shift();
  }

  // 媒体元素：<video> / <audio> 的播放与暂停（VideoLesson 的 <video> 走这里）。
  var mediaProto = window.HTMLMediaElement ? window.HTMLMediaElement.prototype : null;
  wrapMethod(mediaProto, "play", function (el) { recordPlay(el); });
  wrapMethod(mediaProto, "pause", function () { state.media.pauses += 1; });

  // new Audio(src)：love-ambient 环境音播放器用。包装后原构造器照常工作。
  if (window.Audio && !window.Audio.__scAudioPatched) {
    var OrigAudio = window.Audio;
    function WrappedAudio(src) {
      state.audioSources.push(srcPrefix(src));
      if (state.audioSources.length > ENTRY_LIMIT) state.audioSources.shift();
      return new OrigAudio(src);
    }
    WrappedAudio.__scAudioPatched = true;
    defineMethod(window, "Audio", WrappedAudio);
  }

  // WebAudio：TTS 的 pcmSink 用 createBuffer + AudioBufferSourceNode.start
  // 逐块排程 PCM；decodeAudioData 是另一条解码入口，一并观测。
  var ctxProto = window.AudioContext ? window.AudioContext.prototype : null;
  wrapMethod(ctxProto, "decodeAudioData", function () { state.webaudio.decode += 1; });
  // wrapMethod 的 record 签名是 (this, arguments)：createBuffer 的实参在 args 里。
  wrapMethod(ctxProto, "createBuffer", function (ctx, args) {
    state.webaudio.buffers.push({
      channels: Number(args[0]) || 0,
      length: Number(args[1]) || 0,
      sampleRate: Number(args[2]) || 0
    });
    if (state.webaudio.buffers.length > ENTRY_LIMIT) state.webaudio.buffers.shift();
  });
  wrapMethod(window.AudioBufferSourceNode ? window.AudioBufferSourceNode.prototype : null, "start", function () { state.webaudio.sourcesStarted += 1; });

  window.__scAudio = {
    version: 1,
    log: function () {
      return {
        media: { plays: state.media.plays, pauses: state.media.pauses, entries: state.media.entries.slice() },
        audio: { constructed: state.audioSources.slice() },
        webaudio: { decode: state.webaudio.decode, buffers: state.webaudio.buffers.slice(), sourcesStarted: state.webaudio.sourcesStarted }
      };
    },
    clear: function () {
      state.media = { plays: 0, pauses: 0, entries: [] };
      state.audioSources = [];
      state.webaudio = { decode: 0, buffers: [], sourcesStarted: 0 };
      return true;
    }
  };
`;

/**
 * 生成可注入页面的 IIFE 源码字符串。
 * @returns {string}
 */
export function audioStubSource() {
  return (
    "(function (window) {\n" +
    "  if (!window || (window.__scAudio && window.__scAudio.version === 1)) return; // 幂等：重复注入不重置统计\n" +
    STUB_BODY +
    "})(window);\n"
  );
}