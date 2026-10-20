/** 阅读层：已读索引（逐字文本）与阅读偏好都是设备端独立 slot。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOVE_READ_KEY,
  clearLoveReadSlot,
  isLoveTextSeen,
  loveContentKey,
  markLoveTextSeen,
  readLoveReadState,
} from "../../src/lib/love-read";
import {
  DEFAULT_LOVE_READER,
  LOVE_READER_KEY,
  readLoveReaderSettings,
  writeLoveReaderSettings,
} from "../../src/lib/love-reader-settings";
import { subscribeLoveSlots } from "../../src/lib/love-slot-events";

const slots = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => { slots.set(key, value); },
    removeItem: (key: string) => { slots.delete(key); },
  },
});
const reset = () => slots.clear();

test("content keys are stable, scenario-scoped and text-specific", () => {
  const a = loveContentKey("scene-a", "你来了。");
  assert.equal(a, loveContentKey("scene-a", "你来了。"));
  assert.notEqual(a, loveContentKey("scene-b", "你来了。"));
  assert.notEqual(a, loveContentKey("scene-a", "你来了！"));
  assert.ok(a.startsWith("scene-a:"));
});

test("marking a line seen keeps its timestamp and reads back", () => {
  reset();
  const key = loveContentKey("scene-a", "你来了。");
  assert.equal(isLoveTextSeen("scene-a", "你来了。"), false);
  assert.equal(markLoveTextSeen("scene-a", [key]), true);
  assert.equal(isLoveTextSeen("scene-a", "你来了。"), true);
  const state = readLoveReadState();
  assert.equal(state.status, "ok");
  assert.ok(state.seenAt[key] > 0, "recency is preserved, not zeroed");
});

test("marking a second line keeps the first line's timestamp", () => {
  reset();
  const first = loveContentKey("scene-a", "第一句");
  const second = loveContentKey("scene-a", "第二句");
  slots.set(LOVE_READ_KEY, JSON.stringify({ v: 1, seen: { [first]: 123 }, updatedAt: 123 }));
  assert.equal(markLoveTextSeen("scene-a", [second]), true);
  const state = readLoveReadState();
  assert.equal(state.seenAt[first], 123);
  assert.ok(state.seenAt[second] > 0);
});

test("a corrupt read slot is never overwritten and reports not-seen", () => {
  reset();
  const raw = '{"v":1,"seen":';
  slots.set(LOVE_READ_KEY, raw);
  assert.equal(markLoveTextSeen("scene-a", [loveContentKey("scene-a", "你来了。")]), false);
  assert.equal(slots.get(LOVE_READ_KEY), raw);
  assert.equal(readLoveReadState().status, "corrupt");
});

test("clearing the read slot notifies subscribers", () => {
  reset();
  slots.set(LOVE_READ_KEY, JSON.stringify({ v: 1, seen: { x: 1 }, updatedAt: 1 }));
  const keys: (string | null)[] = [];
  const off = subscribeLoveSlots((key) => keys.push(key));
  clearLoveReadSlot();
  off();
  assert.deepEqual(keys, [LOVE_READ_KEY]);
  assert.equal(slots.has(LOVE_READ_KEY), false);
});

test("reader settings default, validate and round-trip", () => {
  reset();
  assert.deepEqual(readLoveReaderSettings(), DEFAULT_LOVE_READER);
  const next = {
    v: 1 as const,
    textSize: "lg" as const,
    speed: "fast" as const,
    auto: true,
    skipRead: true,
    reduceMotion: false,
  };
  assert.equal(writeLoveReaderSettings(next), true);
  assert.deepEqual(readLoveReaderSettings(), next);
});

test("unknown reader values fall back instead of breaking the reader", () => {
  reset();
  slots.set(LOVE_READER_KEY, JSON.stringify({ v: 1, textSize: "huge", speed: 1, auto: "yes" }));
  assert.deepEqual(readLoveReaderSettings(), DEFAULT_LOVE_READER);
  slots.set(LOVE_READER_KEY, '{"v":1,');
  assert.deepEqual(readLoveReaderSettings(), DEFAULT_LOVE_READER);
});
