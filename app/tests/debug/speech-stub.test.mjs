/**
 * speech-stub 黑盒测试：把生成源码塞进最小假 window 执行，验证页面侧契约。
 * 不依赖真实浏览器；异步派发只等 setTimeout(0) 链，固定等 20ms。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { speechStubSource } from "../../scripts/debug/speech-stub.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 在最小假 window（无任何 DOM）上执行桩源码，返回该 window。
function install(options = {}) {
  const window = {};
  new Function("window", "document", speechStubSource(options))(window, {});
  return window;
}

test("暴露 SpeechRecognition 与 webkitSpeechRecognition，且是同一个构造器", () => {
  const window = install();
  assert.ok("SpeechRecognition" in window);
  assert.ok("webkitSpeechRecognition" in window);
  assert.equal(window.SpeechRecognition, window.webkitSpeechRecognition);
  const rec = new window.SpeechRecognition();
  assert.equal(typeof rec.start, "function");
  assert.equal(typeof rec.stop, "function");
  assert.equal(typeof rec.abort, "function");
  // 回调与可写属性挂点齐全
  rec.onstart = rec.onresult = rec.onerror = rec.onend = rec.onspeechend = rec.onaudiostart = null;
  rec.continuous = true;
  rec.maxAlternatives = 3;
  assert.equal(rec.continuous, true);
  assert.equal(rec.maxAlternatives, 3);
});

test("start() 同步触发 onstart，log().starts 为 1", () => {
  const window = install();
  const rec = new window.SpeechRecognition();
  let started = 0;
  rec.onstart = () => started++;
  rec.start();
  assert.equal(started, 1); // 同步，无需等待
  assert.equal(window.__scSpeech.log().starts, 1);
});

test("say() 后再 start() 派发 final 结果：transcript / isFinal / confidence / resultIndex", async () => {
  const window = install();
  const rec = new window.SpeechRecognition();
  const events = [];
  rec.onresult = (e) => events.push(e);
  window.__scSpeech.say("你好");
  rec.start();
  await sleep(20);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.resultIndex, 0);
  assert.equal(event.results.length, 1);
  assert.equal(event.results[0].isFinal, true);
  assert.equal(event.results[0][0].transcript, "你好");
  assert.equal(event.results[0][0].confidence, 0.9);
  assert.equal(window.__scSpeech.log().results, 1);
});

test("say(…, {final:false}) 派发 interim 结果（interimResults 开启时）", async () => {
  const window = install({ interim: true });
  const rec = new window.SpeechRecognition();
  const events = [];
  rec.onresult = (e) => events.push(e);
  window.__scSpeech.say("你", { final: false });
  rec.start();
  await sleep(20);
  assert.equal(events.length, 1);
  assert.equal(events[0].results[0].isFinal, false);
  assert.equal(events[0].results[0][0].transcript, "你");
});

test("interim 条目在 interimResults 关闭时被抑制，final 条目照常", async () => {
  const window = install(); // 默认 interim:false
  const rec = new window.SpeechRecognition();
  const events = [];
  rec.onresult = (e) => events.push(e);
  window.__scSpeech.say("前半", { final: false });
  window.__scSpeech.say("后半");
  rec.start();
  await sleep(20);
  assert.equal(events.length, 1); // 只有 final 一条被发出
  assert.equal(events[0].results[0].isFinal, true);
  assert.equal(events[0].results[0][0].transcript, "后半");
});

test("fail() 让下一次 start() 先 onerror 再 onend，且只生效一次", () => {
  const window = install();
  const rec = new window.SpeechRecognition();
  const order = [];
  rec.onerror = (e) => order.push("error:" + e.error);
  rec.onend = () => order.push("end");
  window.__scSpeech.fail("not-allowed");
  rec.start();
  assert.deepEqual(order, ["error:not-allowed", "end"]); // 同步触发
  assert.equal(window.__scSpeech.log().errors, 1);
  // fail 是一次性的：下一次 start() 恢复正常
  const events = [];
  rec.onresult = (e) => events.push(e);
  window.__scSpeech.say("你好");
  rec.start();
  return sleep(20).then(() => assert.equal(events.length, 1));
});

test("abort() 清掉未派发结果且不再触发 onresult，log().aborts 为 1", async () => {
  const window = install();
  const rec = new window.SpeechRecognition();
  let results = 0;
  rec.onresult = () => results++;
  window.__scSpeech.say("你好", { delay: 5 });
  rec.start();
  rec.abort();
  await sleep(20);
  assert.equal(results, 0);
  assert.equal(window.__scSpeech.log().aborts, 1);
  assert.equal(window.__scSpeech.log().results, 0);
});

test("队列为空时 start() 不出结果也不结束；会话中途 say() 仍可派发", async () => {
  const window = install();
  const rec = new window.SpeechRecognition();
  const transcripts = [];
  let ended = 0;
  rec.onresult = (e) => transcripts.push(e.results[0][0].transcript);
  rec.onend = () => ended++;
  rec.start();
  await sleep(20);
  assert.equal(transcripts.length, 0); // 模拟「用户没说话」
  assert.equal(ended, 0);
  assert.equal(window.__scSpeech.log().results, 0);
  window.__scSpeech.say("补一句");
  await sleep(20);
  assert.deepEqual(transcripts, ["补一句"]); // start 后 say 归属当前会话
});

test("默认 lang 与 interimResults 落到实例上（options 覆盖生效）", () => {
  const defaults = install();
  const rec = new defaults.SpeechRecognition();
  assert.equal(rec.lang, "zh-CN");
  assert.equal(rec.interimResults, false);
  const overridden = install({ lang: "en-US", interim: true });
  const rec2 = new overridden.SpeechRecognition();
  assert.equal(rec2.lang, "en-US");
  assert.equal(rec2.interimResults, true);
  // 实例属性可写且不污染后续实例
  rec2.lang = "ja-JP";
  const rec3 = new overridden.SpeechRecognition();
  assert.equal(rec3.lang, "en-US");
});

test("say(…, {end:true}) 在结果派发后触发 onend（会话自然结束）", async () => {
  const window = install();
  const rec = new window.SpeechRecognition();
  const order = [];
  rec.onresult = () => order.push("result");
  rec.onend = () => order.push("end");
  window.__scSpeech.say("就这些", { end: true });
  rec.start();
  await sleep(20);
  assert.deepEqual(order, ["result", "end"]);
});

test("say(…, {delay}) 按间隔顺序派发多条", async () => {
  const window = install();
  const rec = new window.SpeechRecognition();
  const transcripts = [];
  rec.onresult = (e) => transcripts.push(e.results[e.results.length - 1][0].transcript);
  window.__scSpeech.say("一");
  window.__scSpeech.say("二", { delay: 10 });
  window.__scSpeech.say("三", { delay: 10 });
  rec.start();
  await sleep(60);
  assert.deepEqual(transcripts, ["一", "二", "三"]);
});

test("重复注入同一源码不重置已有桩（幂等）", () => {
  const window = install();
  const first = window.__scSpeech;
  first.say("你好");
  new Function("window", "document", speechStubSource())(window, {});
  assert.equal(window.__scSpeech, first); // 未被覆盖
  assert.equal(window.SpeechRecognition, window.webkitSpeechRecognition);
});

test("reset() 清空队列与统计，log() 归零", () => {
  const window = install();
  window.__scSpeech.say("你好");
  window.__scSpeech.fail("no-speech");
  const rec = new window.SpeechRecognition();
  rec.start(); // 失败路径：errors +1
  assert.equal(window.__scSpeech.log().errors, 1);
  window.__scSpeech.reset();
  assert.deepEqual(window.__scSpeech.log(), { starts: 0, stops: 0, aborts: 0, results: 0, errors: 0 });
  const events = [];
  const rec2 = new window.SpeechRecognition();
  rec2.onresult = (e) => events.push(e);
  rec2.start(); // 队列已清，不再派发
  return sleep(20).then(() => assert.equal(events.length, 0));
});