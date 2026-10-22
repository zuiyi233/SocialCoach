import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deepMatch, getPath, describeMismatch } from "../../scripts/debug/assertions.mjs";

const FIXTURES = new URL("../../debug/fixtures/models/", import.meta.url);

/** 读模型夹具某路由第 index 条响应，JSON.parse 掉 __raw 包装。 */
function fixtureParsed(file, route, index = 0) {
  const data = JSON.parse(readFileSync(fileURLToPath(new URL(file, FIXTURES)), "utf8"));
  const raw = data.routes[route].responses[index].__raw;
  return JSON.parse(raw);
}

// ── deepMatch ─────────────────────────────────────────────────────────────

test("deepMatch: 对象子集——actual 多键也匹配，只查 expected 给的键", () => {
  const actual = { role: "npc", text: "你好", extra: [1, 2], nested: { a: 1 } };
  assert.equal(deepMatch(actual, { role: "npc" }).ok, true);
  assert.equal(deepMatch(actual, { role: "npc", text: "你好", nested: { a: 1 } }).ok, true);
  assert.equal(deepMatch(actual, { role: "learner" }).ok, false);
});

test("deepMatch: 缺键与值不同都失败，path 指向第一个不匹配位置", () => {
  const actual = { a: 1, b: { c: 2 } };
  let r = deepMatch(actual, { b: { c: 3 } });
  assert.equal(r.ok, false);
  assert.equal(r.path, "b.c");
  r = deepMatch(actual, { nope: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.path, "nope");
  r = deepMatch(actual, { a: 1, b: { d: 2 } });
  assert.equal(r.ok, false);
  assert.equal(r.path, "b.d");
});

test("deepMatch: 嵌套数组路径（messages.1.role）", () => {
  const actual = {
    messages: [
      { role: "npc", text: "a" },
      { role: "learner", text: "b" },
    ],
  };
  assert.equal(deepMatch(actual, { messages: [{ role: "npc" }, { role: "learner" }] }).ok, true);
  const r = deepMatch(actual, { messages: [{ role: "npc" }, { role: "system" }] });
  assert.equal(r.ok, false);
  assert.equal(r.path, "messages.1.role");
});

test("deepMatch: 数组要求等长并逐项匹配，长度不符带 reason=length", () => {
  assert.equal(deepMatch([1, 2, 3], [1, 2, 3]).ok, true);
  assert.equal(deepMatch([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }]).ok, true);
  const r = deepMatch([{ id: 1 }, { id: 2 }], [{ id: 1 }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "length");
  assert.equal(r.actual, 2);
  assert.equal(r.expected, 1);
});

test("deepMatch: 原始值用 Object.is（类型严格、NaN 相等、+0≠-0）", () => {
  assert.equal(deepMatch(1, 1).ok, true);
  assert.equal(deepMatch(1, "1").ok, false);
  assert.equal(deepMatch(true, 1).ok, false);
  assert.equal(deepMatch(NaN, NaN).ok, true);
  assert.equal(deepMatch(0, -0).ok, false);
  assert.equal(deepMatch("x", "x").ok, true);
  assert.equal(deepMatch(null, null).ok, true);
  assert.equal(deepMatch(null, undefined).ok, false);
});

test("deepMatch: 形状不符（数组 vs 非数组、对象 vs 数组）失败", () => {
  assert.equal(deepMatch("abc", ["a"]).ok, false);
  assert.equal(deepMatch({ 0: "a" }, ["a"]).ok, false);
  assert.equal(deepMatch(["a"], { 0: "a" }).ok, false);
  assert.equal(deepMatch(null, { a: 1 }).ok, false);
  assert.equal(deepMatch(42, { a: 1 }).ok, false);
});

test("deepMatch: 空对象与空数组边界", () => {
  assert.equal(deepMatch({ a: 1 }, {}).ok, true);
  assert.equal(deepMatch([], []).ok, true);
  assert.equal(deepMatch([1], []).ok, false);
  assert.equal(deepMatch([], [1]).ok, false);
});

// ── getPath ───────────────────────────────────────────────────────────────

test("getPath: 点号路径", () => {
  const state = { settings: { tts: true }, name: "x", tags: ["a", "b"] };
  assert.deepEqual(getPath(state, "settings.tts"), { found: true, value: true });
  assert.deepEqual(getPath(state, "name"), { found: true, value: "x" });
});

test("getPath: 数组下标路径", () => {
  const state = { messages: [{ role: "npc" }, { role: "learner", text: "b" }] };
  assert.deepEqual(getPath(state, "messages.0.role"), { found: true, value: "npc" });
  assert.deepEqual(getPath(state, "messages.1.text"), { found: true, value: "b" });
  assert.deepEqual(getPath(state, "messages.2.role"), { found: false, value: undefined });
});

test("getPath: 中间缺键与非对象不抛错，返回 found:false", () => {
  const state = { a: { b: 1 } };
  assert.deepEqual(getPath(state, "a.c.d"), { found: false, value: undefined });
  assert.deepEqual(getPath(state, "x.y"), { found: false, value: undefined });
  assert.deepEqual(getPath(42, "a"), { found: false, value: undefined });
  assert.deepEqual(getPath(null, "a"), { found: false, value: undefined });
  assert.deepEqual(getPath(undefined, "a"), { found: false, value: undefined });
  assert.deepEqual(getPath("str", "length"), { found: false, value: undefined });
});

test("getPath: 空路径原样返回", () => {
  const v = { a: 1 };
  assert.deepEqual(getPath(v, ""), { found: true, value: v });
  assert.deepEqual(getPath(v, null), { found: true, value: v });
  assert.deepEqual(getPath(7, undefined), { found: true, value: 7 });
});

// ── describeMismatch ──────────────────────────────────────────────────────

test("describeMismatch: 一行可读，含 path 与期望/实际，长值截断到 120 字符", () => {
  const long = "很".repeat(300);
  const r = deepMatch({ msg: "短" }, { msg: long });
  const line = describeMismatch(r);
  assert.match(line, /"msg"/);
  assert.match(line, /expected/);
  assert.match(line, /actual/);
  assert.ok(line.includes("…"), "截断标记");
  const actualPart = line.split("actual")[1] ?? "";
  assert.ok(actualPart.length <= 125, `actual 部分应截断到 120 字符左右，实际 ${actualPart.length}`);
});

test("describeMismatch: 数组长度不匹配的格式", () => {
  const r = deepMatch([1, 2, 3], [1, 2]);
  assert.equal(r.reason, "length");
  const line = describeMismatch(r);
  assert.match(line, /expected length 2, actual length 3/);
});

test("describeMismatch: NaN 与 undefined 显示不炸", () => {
  assert.match(describeMismatch(deepMatch(NaN, 1)), /NaN/);
  assert.match(describeMismatch(deepMatch(undefined, "x")), /undefined/);
  assert.match(describeMismatch(deepMatch(1, 2)), /expected 2, actual 1/);
});

// ── 真实夹具形状 ──────────────────────────────────────────────────────────

test("真实夹具: practice-side hint 响应 deepMatch 部分匹配", () => {
  const hint = fixtureParsed("practice-side.json", "hint", 0);
  assert.equal(typeof hint.hint, "string");
  assert.ok(hint.hint.length > 10, "hint 文本应非空");
  assert.equal(deepMatch(hint, { hint: hint.hint }).ok, true);
  const r = deepMatch(hint, { hint: "完全不一样的提示" });
  assert.equal(r.ok, false);
  assert.equal(r.path, "hint");
});

test("真实夹具: practice-side pattern 响应的 evidence 数组子集", () => {
  const pattern = fixtureParsed("practice-side.json", "pattern", 0);
  assert.equal(pattern.evidence.length, 2);
  const want = [{ sessionId: "session-demo-a" }, { sessionId: "session-demo-b" }];
  assert.equal(deepMatch(pattern, { evidence: want, found: true }).ok, true);
  const short = deepMatch(pattern, { evidence: [{ sessionId: "session-demo-a" }] });
  assert.equal(short.ok, false);
  assert.equal(short.reason, "length");
});

test("真实夹具: coach-side schedule 响应的深层子集", () => {
  const schedule = fixtureParsed("coach-side.json", "schedule", 0);
  assert.equal(schedule.scenario.characters.length, 2);
  const want = {
    scenario: {
      id: "work-meeting-reorder",
      title: { zh: "明天的汇报，我要申请调顺序" },
      characters: [{ id: "you" }, { id: "wang" }],
    },
  };
  assert.equal(deepMatch(schedule, want).ok, true);
  const bad = deepMatch(schedule, { scenario: { characters: [{ id: "you" }, { id: "zzz" }] } });
  assert.equal(bad.ok, false);
  assert.equal(bad.path, "scenario.characters.1.id");
  assert.equal(getPath(schedule, "scenario.characters.0.playable").value, true);
});
