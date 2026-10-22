import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSuggestions,
  mergeIntoScenario,
  suggestAssertions,
} from "../../scripts/debug/record-suggest.mjs";

/** 与 engine.#recordApiCall 产物同形状的请求记录。 */
const call = (route, method, bodyJson, overrides = {}) => ({
  route,
  method,
  url: `/api/${route}`,
  body: bodyJson ? JSON.stringify(bodyJson) : "",
  bodyJson: bodyJson ?? null,
  replay: false,
  at: 0,
  ...overrides,
});

test("请求类：按 (route, method) 聚合，min 等于观察次数，method 大小写归一", () => {
  const result = suggestAssertions({
    apiCalls: [
      call("hint", "POST"),
      call("hint", "post"), // 小写归一进同一组
      call("settings", "GET"),
      call("api/settings", "GET"), // 前缀归一进同一组
      call("health", "GET"),
    ],
  });
  assert.deepEqual(
    result.suggestions.map((s) => [s.cmd, s.route, s.method, s.min, s.confidence]),
    [
      ["assert.api", "hint", "POST", 2, "high"],
      ["assert.api", "settings", "GET", 2, "high"],
      ["assert.api", "health", "GET", 1, "high"],
    ],
  );
  for (const s of result.suggestions) {
    assert.equal(typeof s.why, "string");
    assert.ok(s.why.length > 0);
  }
});

test("StrictMode 双调用：同一 (route, method) 只出一条，用 min 不用 count", () => {
  const result = suggestAssertions({
    apiCalls: [call("hint", "POST"), call("hint", "POST")],
  });
  assert.equal(result.suggestions.length, 1);
  const s = result.suggestions[0];
  assert.equal(s.cmd, "assert.api");
  assert.equal(s.min, 2);
  assert.ok(!("count" in s), "不应产出 count 字段");
  assert.ok(result.notes.some((n) => n.includes("min 而非 count")), "notes 应说明 min 的取舍");
});

test("请求体：稳定标量被挑出，id / sessionId / at 跳过并记进 skipped", () => {
  const result = suggestAssertions({
    apiCalls: [call("hint", "POST", { scenario: "workplace", tts: true, id: "abc", sessionId: "s1", at: 123 })],
  });
  const s = result.suggestions[0];
  assert.deepEqual(s.body, { scenario: "workplace", tts: true });
  assert.equal(s.confidence, "medium"); // 只有一次观测
  assert.equal(result.skipped.length, 3);
  assert.ok(result.skipped.some((x) => x.includes("id") && x.includes("标识")));
  assert.ok(result.skipped.some((x) => x.includes("sessionId")));
  assert.ok(result.skipped.some((x) => x.includes("at")));
});

test("请求体：值像 ISO 时间戳 / UUID 的键也跳过", () => {
  const result = suggestAssertions({
    apiCalls: [call("chat", "POST", { trace: "2026-10-23T10:00:00.000Z", ref: "a1b2c3d4-1111-2222-3333-444455556666", text: "你好" })],
  });
  assert.deepEqual(result.suggestions[0].body, { text: "你好" });
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.some((x) => x.includes("ISO 时间戳")));
  assert.ok(result.skipped.some((x) => x.includes("UUID")));
});

test("请求体：超过 2 个稳定字段只取 2 个，id 类键仍全部记 skipped", () => {
  const result = suggestAssertions({
    apiCalls: [call("chat", "POST", { a: 1, b: 2, c: 3, userId: "u1", updatedAt: 123 })],
  });
  assert.deepEqual(result.suggestions[0].body, { a: 1, b: 2 });
  assert.equal(result.skipped.length, 2); // userId / updatedAt 都在 picked 上限之外也会被扫到
  assert.ok(result.skipped.some((x) => x.includes("userId")));
  assert.ok(result.skipped.some((x) => x.includes("updatedAt")));
});

test("请求体：字段跨请求不一致则视为不稳定，不选", () => {
  const result = suggestAssertions({
    apiCalls: [call("chat", "POST", { text: "hello" }), call("chat", "POST", { text: "world" })],
  });
  const s = result.suggestions[0];
  assert.ok(!("body" in s), "不稳定字段不应进 body");
  assert.equal(s.min, 2);
  assert.equal(s.confidence, "high");
  assert.equal(result.skipped.length, 0);
});

test("请求体：两条一致观测 → high 且带 body；无 body 的请求 → high", () => {
  const withBody = suggestAssertions({
    apiCalls: [call("hint", "POST", { tts: true }), call("hint", "POST", { tts: true })],
  });
  assert.equal(withBody.suggestions[0].confidence, "high");
  assert.deepEqual(withBody.suggestions[0].body, { tts: true });
  const plain = suggestAssertions({ apiCalls: [call("settings", "GET")] });
  assert.equal(plain.suggestions[0].confidence, "high");
  assert.ok(!("body" in plain.suggestions[0]));
});

test("锚点：anchors 参数与 steps.target 合并去重，data-debug 选择器归一为锚点名", () => {
  const result = suggestAssertions({
    anchors: ["practice.input", "practice.send"],
    steps: [
      { cmd: "ui.click", target: "practice.send" }, // 与 anchors 重复
      { cmd: "ui.type", target: '[data-debug="practice.messages"]', text: "hi" },
      { cmd: "nav", path: "practice" }, // 无 target
    ],
  });
  assert.deepEqual(
    result.suggestions.map((s) => [s.cmd, s.target, s.confidence]),
    [
      ["assert.exists", "practice.input", "high"],
      ["assert.exists", "practice.send", "high"],
      ["assert.exists", "practice.messages", "high"],
    ],
  );
  const send = result.suggestions[1];
  assert.equal(send.why, "录制中操作过锚点 practice.send");
  assert.equal(result.suggestions[0].why, "录制中观察到锚点 practice.input");
});

test("锚点：CSS 选择器 target 不生成断言建议", () => {
  const result = suggestAssertions({
    steps: [
      { cmd: "ui.click", target: ".foo" },
      { cmd: "ui.click", target: "#bar" },
      { cmd: "ui.type", target: "practice.input", text: "x" },
    ],
  });
  assert.deepEqual(result.suggestions.map((s) => s.target), ["practice.input"]);
});

test("锚点：最多 6 条，超出部分进 notes", () => {
  const anchors = Array.from({ length: 8 }, (_, i) => `anchor.${i}`);
  const result = suggestAssertions({ anchors });
  assert.equal(result.suggestions.filter((s) => s.cmd === "assert.exists").length, 6);
  assert.ok(result.notes.some((n) => n.includes("上限 6")));
});

test("计数：同一锚点数量从 a 变到 b，建议 assert.count min b", () => {
  const result = suggestAssertions({
    snapshots: [
      { counts: { "practice.messages": 0 } },
      { counts: { "practice.messages": 1 } },
      { counts: { "practice.messages": 2 } },
    ],
  });
  assert.deepEqual(result.suggestions, [
    {
      cmd: "assert.count",
      target: "practice.messages",
      min: 2,
      why: "录制中 practice.messages 元素数量从 0 变到 2",
      confidence: "high",
    },
  ]);
});

test("计数：数量下降给 min 且 confidence medium；降到 0 记 skipped", () => {
  const result = suggestAssertions({
    snapshots: [
      { counts: { spinner: 1 } },
      { counts: { spinner: 0 } },
      { counts: { list: 3 } },
      { counts: { list: 1 } },
    ],
  });
  assert.ok(result.skipped.some((x) => x.includes("spinner") && x.includes("降到 0")));
  const list = result.suggestions.find((s) => s.target === "list");
  assert.deepEqual(list, {
    cmd: "assert.count",
    target: "list",
    min: 1,
    why: "录制中 list 元素数量从 3 变到 1",
    confidence: "medium",
  });
});

test("计数：snapshots 也接受 elements 数组形状（target / debug 两种键名）", () => {
  const result = suggestAssertions({
    snapshots: [
      { elements: [{ target: "m", count: 0 }] },
      { elements: [{ debug: "m", count: 4 }] },
    ],
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].cmd, "assert.count");
  assert.equal(result.suggestions[0].min, 4);
});

test("confidence 排序：medium 排在所有 high 之后，同档保持生成顺序", () => {
  const result = suggestAssertions({
    apiCalls: [call("single", "POST", { tts: true }), call("plain", "GET")], // single 只有一次观测 → medium
    anchors: ["anchor.a"],
  });
  assert.deepEqual(
    result.suggestions.map((s) => s.confidence),
    ["high", "high", "medium"],
  );
  assert.equal(result.suggestions[0].route, "plain");
  assert.equal(result.suggestions[1].target, "anchor.a");
  assert.equal(result.suggestions[2].route, "single");
});

test("总上限 12 条：超出按 confidence 截断并进 notes", () => {
  const apiCalls = Array.from({ length: 10 }, (_, i) => call(`route.${i}`, "GET"));
  const anchors = Array.from({ length: 6 }, (_, i) => `anchor.${i}`);
  const result = suggestAssertions({ apiCalls, anchors });
  assert.equal(result.suggestions.length, 12);
  assert.ok(result.notes.some((n) => n.includes("超过上限 12")));
});

test("mergeIntoScenario：不改入参，返回新对象，suggestions 放进 suggested", () => {
  const scenario = { name: "practice-chat", description: "d", steps: [{ cmd: "nav" }] };
  const result = {
    suggestions: [{ cmd: "assert.api", route: "hint", method: "POST", min: 2, why: "x", confidence: "high" }],
    notes: [],
    skipped: [],
  };
  const merged = mergeIntoScenario(scenario, result);
  assert.deepEqual(merged.suggested, result.suggestions);
  assert.deepEqual(merged.steps, scenario.steps);
  assert.notEqual(merged, scenario);
  assert.deepEqual(scenario, { name: "practice-chat", description: "d", steps: [{ cmd: "nav" }] }, "入参不能变");
  assert.ok(!("suggested" in scenario), "入参不能出现 suggested");
});

test("mergeIntoScenario：没有建议时 suggested 为空数组，非对象入参容错", () => {
  const merged = mergeIntoScenario({ name: "x" }, { notes: [] });
  assert.deepEqual(merged, { name: "x", suggested: [] });
  assert.deepEqual(mergeIntoScenario(null, {}), { suggested: [] });
  assert.deepEqual(mergeIntoScenario(undefined, undefined), { suggested: [] });
});

test("formatSuggestions：剥掉 // 注释后可 JSON.parse，内容等于建议的断言参数", () => {
  const result = {
    suggestions: [
      { cmd: "assert.api", route: "hint", method: "POST", min: 2, body: { scenario: "workplace" }, why: "录制中 /api/hint 被调用了 2 次", confidence: "high" },
      { cmd: "assert.exists", target: "practice.send", why: "录制中操作过锚点 practice.send", confidence: "high" },
      { cmd: "assert.count", target: "practice.messages", min: 2, why: "录制中 practice.messages 元素数量从 0 变到 2", confidence: "medium" },
    ],
  };
  const text = formatSuggestions(result);
  const lines = text.split("\n").filter((line) => !line.trim().startsWith("//"));
  assert.deepEqual(JSON.parse(lines.join("\n")), [
    { cmd: "assert.api", route: "hint", method: "POST", min: 2, body: { scenario: "workplace" } },
    { cmd: "assert.exists", target: "practice.send" },
    { cmd: "assert.count", target: "practice.messages", min: 2 },
  ]);
  assert.ok(text.split("\n").length <= 60, "输出不能超过 60 行");
  assert.ok(text.includes("录制中 /api/hint 被调用了 2 次"), "注释要带上 why");
  assert.ok(text.includes("// 2/3 · assert.exists · high"), "注释要带上序号与 confidence");
});

test("formatSuggestions：空建议输出可解析的空数组", () => {
  const text = formatSuggestions({ suggestions: [], notes: [] });
  const lines = text.split("\n").filter((line) => !line.trim().startsWith("//"));
  assert.deepEqual(JSON.parse(lines.join("\n")), []);
  assert.equal(formatSuggestions(), formatSuggestions({ suggestions: [] }));
});

test("空输入：返回空建议与空 notes / skipped，不抛错", () => {
  assert.deepEqual(suggestAssertions(), { suggestions: [], notes: [], skipped: [] });
  assert.deepEqual(
    suggestAssertions({ steps: null, apiCalls: null, anchors: null, snapshots: null, pageUrls: null }),
    { suggestions: [], notes: [], skipped: [] },
  );
  assert.deepEqual(suggestAssertions({ apiCalls: [null, "x", {}], steps: [null, "x"] }), {
    suggestions: [],
    notes: [],
    skipped: [],
  });
});

test("pageUrls：只进 notes 说明边界，不生成建议", () => {
  const result = suggestAssertions({ pageUrls: ["/practice", "/learn"] });
  assert.equal(result.suggestions.length, 0);
  assert.ok(result.notes.some((n) => n.includes("2 个 URL")));
});
