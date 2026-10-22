/**
 * audio-stub 黑盒测试：把生成源码塞进最小假 window 执行，验证页面侧契约；
 * 外加 speech-flow.json 夹具的结构与解码检查。不依赖真实浏览器。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audioStubSource } from "../../scripts/debug/audio-stub.mjs";
import { auditContracts } from "../../scripts/debug/api-contracts.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// 最小假 window：可选的媒体元素 / Audio / WebAudio 类，全开则都装上。
function install({ media = true, audio = true, ctx = true } = {}) {
  const window = {};
  class FakeMedia {
    constructor() { this.src = ""; this.currentTime = 0; this.duration = 0; this.played = false; }
    play() { this.played = true; return Promise.resolve(); }
    pause() {}
  }
  class FakeAudio {
    constructor(src) { this.src = src || ""; }
  }
  class FakeAudioContext {
    constructor() { this.state = "running"; }
    decodeAudioData() {}
    createBuffer(channels, length, sampleRate) { return { channels, length, sampleRate }; }
  }
  class FakeBufferSource {
    start() {}
  }
  if (media) window.HTMLMediaElement = FakeMedia;
  if (audio) window.Audio = FakeAudio;
  if (ctx) {
    window.AudioContext = FakeAudioContext;
    window.AudioBufferSourceNode = FakeBufferSource;
  }
  new Function("window", audioStubSource())(window);
  return window;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("安装后暴露 window.__scAudio（version 1），log() 结构完整", () => {
  const window = install();
  assert.equal(window.__scAudio.version, 1);
  assert.equal(typeof window.__scAudio.log, "function");
  assert.equal(typeof window.__scAudio.clear, "function");
  const log = window.__scAudio.log();
  assert.deepEqual(log.media, { plays: 0, pauses: 0, entries: [] });
  assert.deepEqual(log.audio, { constructed: [] });
  assert.deepEqual(log.webaudio, { decode: 0, buffers: [], sourcesStarted: 0 });
});

test("HTMLMediaElement.play 记录 src 前缀与 currentTime/duration，且透传原实现", () => {
  const window = install();
  const el = new window.HTMLMediaElement();
  el.src = "blob:http://localhost:3000/" + "x".repeat(73); // 100 字符，验证 80 前缀
  el.currentTime = 1.5;
  el.duration = 12;
  el.play();
  const log = window.__scAudio.log();
  assert.equal(log.media.plays, 1);
  assert.equal(log.media.entries.length, 1);
  const entry = log.media.entries[0];
  assert.equal(entry.src, "blob:http://localhost:3000/" + "x".repeat(53)); // 80 字符前缀
  assert.equal(entry.src.length, 80);
  assert.equal(entry.currentTime, 1.5);
  assert.equal(entry.duration, 12);
  assert.equal(el.played, true); // 透传：原 play 真的被调用了
});

test("play/pause 次数分开计数", () => {
  const window = install();
  const el = new window.HTMLMediaElement();
  el.play();
  el.play();
  el.pause();
  el.pause();
  const log = window.__scAudio.log();
  assert.equal(log.media.plays, 2);
  assert.equal(log.media.pauses, 2);
  assert.equal(log.media.entries.length, 2);
});

test("无 src 的 play 不抛错，记录空 src", () => {
  const window = install();
  const el = new window.HTMLMediaElement();
  el.play(); // 无 src、currentTime/duration 为 0
  const log = window.__scAudio.log();
  assert.equal(log.media.plays, 1);
  assert.equal(log.media.entries[0].src, "");
  assert.equal(log.media.entries[0].currentTime, 0);
  assert.equal(log.media.entries[0].duration, 0);
});

test("new Audio(src) 记录构造 src，返回原构造器的实例", () => {
  const window = install();
  const el = new window.Audio("love-ambient/rio-loop.mp3");
  const log = window.__scAudio.log();
  assert.deepEqual(log.audio.constructed, ["love-ambient/rio-loop.mp3"]);
  assert.equal(el.constructor.name, "FakeAudio"); // 透传原构造器
  const bare = new window.Audio();
  assert.deepEqual(window.__scAudio.log().audio.constructed, ["love-ambient/rio-loop.mp3", ""]);
  assert.equal(bare.src, "");
});

test("decodeAudioData / createBuffer / AudioBufferSourceNode.start 记录（TTS PCM 路径）", () => {
  const window = install();
  const ctx = new window.AudioContext();
  ctx.decodeAudioData();
  const buffer = ctx.createBuffer(1, 2000, 24000);
  assert.deepEqual(buffer, { channels: 1, length: 2000, sampleRate: 24000 }); // 透传
  const source = new window.AudioBufferSourceNode();
  source.start();
  const webaudio = window.__scAudio.log().webaudio;
  assert.equal(webaudio.decode, 1);
  assert.deepEqual(webaudio.buffers, [{ channels: 1, length: 2000, sampleRate: 24000 }]);
  assert.equal(webaudio.sourcesStarted, 1);
});

test("clear() 清空统计，之后的播放从零计", () => {
  const window = install();
  const el = new window.HTMLMediaElement();
  el.src = "x.mp3";
  el.play();
  assert.equal(window.__scAudio.clear(), true);
  assert.deepEqual(window.__scAudio.log().media, { plays: 0, pauses: 0, entries: [] });
  el.play();
  assert.equal(window.__scAudio.log().media.plays, 1);
});

test("重复注入不叠加：同一对象、统计保留、原型方法不二次包装", async () => {
  const window = install();
  const first = window.__scAudio;
  const el1 = new window.HTMLMediaElement();
  el1.src = "a.mp3";
  el1.play();
  // 第二次注入：守卫直接返回，不重置状态、不换对象
  new Function("window", audioStubSource())(window);
  assert.equal(window.__scAudio, first);
  assert.equal(window.__scAudio.log().media.plays, 1);
  // 若被二次包装，这一次 play 会 +2；未被二次包装则 +1
  const el2 = new window.HTMLMediaElement();
  el2.src = "b.mp3";
  el2.play();
  await sleep(0);
  assert.equal(window.__scAudio.log().media.plays, 2);
});

test("非浏览器环境（空 window）不抛错，桩照常安装", () => {
  const window = {};
  assert.doesNotThrow(() => new Function("window", audioStubSource())(window));
  assert.equal(window.__scAudio.version, 1);
  assert.deepEqual(window.__scAudio.log().webaudio.buffers, []);
});

test("缺哪类 API 就只观测哪类：只装媒体元素时 Audio/WebAudio 不记录", () => {
  const window = install({ media: true, audio: false, ctx: false });
  const el = new window.HTMLMediaElement();
  el.play();
  const log = window.__scAudio.log();
  assert.equal(log.media.plays, 1);
  assert.equal(log.audio.constructed.length, 0);
  assert.equal(log.webaudio.decode, 0);
});

// ── speech-flow.json 夹具结构 ──────────────────────────────────────────────

const SPEECH_FIXTURE = JSON.parse(readFileSync(join(APP_ROOT, "debug/fixtures/models/speech-flow.json"), "utf8"));

test("speech-flow.json：name 与 routes.speech 形状（by/responses/__raw/__contentType）", () => {
  assert.equal(SPEECH_FIXTURE.name, "speech-flow");
  const route = SPEECH_FIXTURE.routes?.speech;
  assert.ok(route, "缺 routes.speech");
  assert.equal(route.by, "counter");
  assert.ok(Array.isArray(route.responses) && route.responses.length >= 1);
  const payload = route.responses[0];
  assert.equal(typeof payload.__raw, "string");
  assert.match(payload.__contentType, /^audio\/pcm/);
});

test("speech-flow.json：占位 PCM 经 UTF-8 解码为偶数长度的零字节（引擎回放可解析）", () => {
  const raw = SPEECH_FIXTURE.routes.speech.responses[0].__raw;
  const bytes = Buffer.from(raw, "utf8"); // 与 engine.mjs 回放路径同口径
  assert.ok(bytes.length >= 2, "至少一个采样");
  assert.equal(bytes.length % 2, 0, "int16 字节数必须为偶数");
  assert.ok(bytes.every((b) => b === 0), "占位应为 16-bit 静音（全零）");
  // 引擎侧会再做一次 base64 交给 Fetch.fulfillRequest；往返后仍是这些字节
  const roundtrip = Buffer.from(bytes.toString("base64"), "base64");
  assert.deepEqual(roundtrip, bytes);
});

test("speech-flow.json：probes.speech 的 body 符合 SpeechInputSchema 字段", () => {
  const probe = SPEECH_FIXTURE.probes?.speech;
  assert.ok(probe, "缺 probes.speech");
  assert.equal(probe.method, "POST");
  const body = probe.body;
  assert.equal(typeof body.text, "string");
  assert.ok(body.text.length >= 1 && body.text.length <= 500);
  assert.ok(["zh", "en"].includes(body.lang));
  assert.ok(["白桦", "苏打", "茉莉", "冰糖", "Mia", "Chloe", "Milo", "Dean"].includes(body.voice));
  assert.ok(["neutral", "firm", "gentle"].includes(body.tone));
  assert.equal(body.delivery, "pcm");
  // strict schema：不携带未知字段
  assert.deepEqual(Object.keys(body).sort(), ["delivery", "lang", "text", "tone", "voice"].sort());
});

test("speech-flow.json：契约巡检覆盖 /api/speech，且不产生 unknown", () => {
  const result = auditContracts({ appRoot: APP_ROOT, fixtureDir: join(APP_ROOT, "debug/fixtures/models") });
  const covered = result.covered.find((r) => r.route === "speech");
  assert.ok(covered, `speech 未被覆盖；missing: ${JSON.stringify(result.missing)}`);
  assert.ok(covered.fixtures.includes("speech-flow"));
  assert.ok(!result.unknown.some((u) => u.fixture === "speech-flow"), "speech-flow 不应出现在 unknown");
  assert.ok(!result.errors.some((e) => e.file.includes("speech-flow")), "speech-flow.json 不应有解析错误");
});
