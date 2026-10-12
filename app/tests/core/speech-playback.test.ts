import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceChunks, startStreamSpeech, type PcmSink, type SpeechHandle } from "../../src/lib/speech-playback";

const response = (body: ReadableStream<Uint8Array>) => new Response(body, { headers: { "Content-Type": "audio/pcm;rate=24000;channels=1" } });
function harness() {
  const samples: number[] = []; let fallbacks = 0, cancelled = false, paused = false;
  const sink: PcmSink = { write(v) { samples.push(...v); }, async finish() {}, cancel() { cancelled = true; }, pause(v) { paused = v; } };
  const fallback = (): SpeechHandle => { fallbacks++; return { done: Promise.resolve(), cancel() {}, pause() {} }; };
  return { sink, fallback, samples, get fallbacks() { return fallbacks; }, get cancelled() { return cancelled; }, get paused() { return paused; } };
}
test("first PCM plays before completion; odd network boundaries preserve sample order", async () => {
  const h = harness(); let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { stream = c; c.enqueue(new Uint8Array([0, 64, 0])); } });
  const speech = startStreamSpeech({ fetch: async () => response(body), sink: h.sink, fallback: h.fallback });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(h.samples, [.5]); // The tail is still open.
  stream.enqueue(new Uint8Array([128])); stream.close(); await speech.done;
  assert.deepEqual(h.samples, [.5, -1]); assert.equal(h.fallbacks, 0);
});
test("slow first audio falls back once; a late response cannot start playing", async () => {
  const h = harness(); let resolve!: (r: Response) => void; let signal!: AbortSignal;
  const speech = startStreamSpeech({ fetch: s => { signal = s; return new Promise(r => { resolve = r; }); }, sink: h.sink, fallback: h.fallback, firstAudioMs: 10 });
  await speech.done; assert.equal(h.fallbacks, 1); assert.equal(signal.aborted, true);
  resolve(response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0, 64])); c.close(); } })));
  await new Promise(r => setTimeout(r, 5)); assert.deepEqual(h.samples, []);
});
test("explicit cancellation drops audio and never invokes the fallback", async () => {
  const h = harness(); let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { stream = c; } });
  const speech = startStreamSpeech({ fetch: async () => response(body), sink: h.sink, fallback: h.fallback });
  speech.cancel(); await speech.done;
  try { stream.enqueue(new Uint8Array([0, 64])); } catch {}
  assert.equal(h.cancelled, true); assert.equal(h.fallbacks, 0); assert.deepEqual(h.samples, []);
});
test("a failed stream after speech starts never repeats the full line with another voice", async () => {
  const h = harness(); let stream!: ReadableStreamDefaultController<Uint8Array>;
  const speech = startStreamSpeech({ fetch: async () => response(new ReadableStream({ start(c) { stream = c; c.enqueue(new Uint8Array([0, 64])); } })), sink: h.sink, fallback: h.fallback });
  await new Promise(r => setTimeout(r, 5)); stream.error(new Error("disconnect")); await speech.done;
  assert.deepEqual(h.samples, [.5]); assert.equal(h.fallbacks, 0);
});
test("pausing also pauses prepared audio and the fallback inherits that pause", async () => {
  const h = harness(); let fallbackPause: boolean | undefined;
  const speech = startStreamSpeech({ fetch: async () => new Response("unavailable", { status: 503 }), sink: h.sink, fallback: () => ({ done: Promise.resolve(), cancel() {}, pause(v) { fallbackPause = v; } }) });
  speech.pause(true); await speech.done; assert.equal(h.paused, true); assert.equal(fallbackPause, true);
});
const strip = (value: string) => value.replace(/\s+/g, "");
test("a line the engine can finish in one breath is spoken untouched", () => {
  const line = "我们先把这件事说清楚。";
  assert.deepEqual(deviceChunks(line, "zh"), [line]);
});
test("long lines split at sentence ends without losing a single character", () => {
  const zh = "今天我想先说清楚我自己的感受，然后我们再谈你的安排，好吗？".repeat(9);
  const en = "I would rather say what I actually need before we talk about the schedule again, you know? ".repeat(7);
  const cases: [string, "zh" | "en", number][] = [[zh, "zh", 120], [en, "en", 240], [`${zh}\n\n${en}`, "zh", 120]];
  for (const [text, lang, bound] of cases) {
    const parts = deviceChunks(text, lang);
    assert.ok(parts.length > 1, text.slice(0, 8));
    assert.equal(strip(parts.join("")), strip(text));
    for (const part of parts) assert.ok(part.length <= bound, `${lang} chunk too long: ${part.length}`);
  }
});
test("Chinese is chunked on a tighter budget than English, because seconds are not characters", () => {
  // 一条 100 字的中文台词按 4–5 字/秒就是 20 秒以上，早就越过 Chrome 的 ~15 秒硬截断；
  // 英文同样长度只需 7 秒上下。共用一个字符预算的话，中文这条根本没被修好。
  const zh = "这是一句足够长的中文台词需要被拆开念完才不会在半路被浏览器掐断".repeat(4);
  assert.ok(deviceChunks(zh, "zh").length > 1, "long Chinese must split");
  assert.deepEqual(deviceChunks(zh, "en"), [zh], "the same characters fit English's budget");
});
test("a run with no punctuation and no space is still cut, and still lossless", () => {
  const text = "嗯".repeat(400);
  const parts = deviceChunks(text, "zh");
  assert.ok(parts.length >= 2);
  assert.equal(parts.join(""), text);
});
test("only a whitespace tail may disappear, never spoken content", () => {
  const text = `${"这是一句足够长的台词，需要拆开念完。".repeat(12)}   \n  `;
  assert.equal(strip(deviceChunks(text, "zh").join("")), strip(text));
});
