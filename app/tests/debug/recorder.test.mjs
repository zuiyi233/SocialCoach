import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRecorder,
  mergeRecording,
  normalizeCliEvent,
  normalizePageEvent,
} from "../../scripts/debug/recorder.mjs";

const cli = (at, cmd, args) => ({ at, cmd, args });
const page = (at, action, target, text) => ({ at, action, target, text });

test("规则1：CLI 事件映射为步骤", () => {
  assert.deepEqual(normalizeCliEvent(cli(100, "nav", { path: "love/play" })), {
    at: 100,
    step: { cmd: "nav", path: "love/play" },
  });
  assert.deepEqual(normalizeCliEvent(cli(101, "state.load", { fixture: "love-start" })), {
    at: 101,
    step: { cmd: "state.load", fixture: "love-start" },
  });
  assert.deepEqual(normalizeCliEvent(cli(102, "state.set", { key: "volume", value: 3 })), {
    at: 102,
    step: { cmd: "state.set", key: "volume", value: 3 },
  });
  assert.deepEqual(normalizeCliEvent(cli(103, "model.use", { fixtures: ["love-flow"] })), {
    at: 103,
    step: { cmd: "model.use", fixtures: ["love-flow"] },
  });
  assert.deepEqual(normalizeCliEvent(cli(104, "ui.click", { target: "love.option-0" })), {
    at: 104,
    step: { cmd: "ui.click", target: "love.option-0" },
  });
  assert.deepEqual(normalizeCliEvent(cli(105, "ui.type", { target: "practice.input", text: "hi" })), {
    at: 105,
    step: { cmd: "ui.type", target: "practice.input", text: "hi" },
  });
});

test("规则1：未知/缺 at/非对象 CLI 事件返回 null", () => {
  assert.equal(normalizeCliEvent(cli(106, "eval", { expression: "1+1" })), null);
  assert.equal(normalizeCliEvent(cli(107, "assert.text", { target: "x" })), null);
  assert.equal(normalizeCliEvent(cli(108, "state.dump", {})), null);
  assert.equal(normalizeCliEvent({ cmd: "nav", args: { path: "x" } }), null); // 缺 at
  assert.equal(normalizeCliEvent(null), null);
  assert.equal(normalizeCliEvent(undefined), null);
  assert.equal(normalizeCliEvent("nav"), null);
});

test("规则2：页面 click/type 映射为步骤", () => {
  assert.deepEqual(normalizePageEvent(page(200, "click", "love.send")), {
    at: 200,
    step: { cmd: "ui.click", target: "love.send" },
  });
  assert.deepEqual(normalizePageEvent(page(201, "type", "love.input", "你好")), {
    at: 201,
    step: { cmd: "ui.type", target: "love.input", text: "你好" },
  });
  assert.equal(normalizePageEvent(page(202, "scroll", "love.list")), null);
  assert.equal(normalizePageEvent(page(203, "hover", "love.card")), null);
});

test("规则2：无锚点的页面动作返回 skip 标记，未知输入返回 null", () => {
  assert.deepEqual(normalizePageEvent(page(300, "click", "", "发送")), {
    at: 300,
    step: null,
    skip: true,
  });
  assert.deepEqual(normalizePageEvent(page(301, "type", "", "随便写点什么")), {
    at: 301,
    step: null,
    skip: true,
  });
  assert.equal(normalizePageEvent({ action: "click", target: "a" }), null); // 缺 at
  assert.equal(normalizePageEvent(null), null);
  assert.equal(normalizePageEvent(42), null);
});

test("规则4：两类事件按 at 升序合并，输出不含 at", () => {
  const recording = mergeRecording({
    cli: [cli(300, "nav", { path: "practice" }), cli(100, "ui.click", { target: "a" })],
    page: [page(200, "click", "b"), page(50, "click", "c")],
  });
  assert.deepEqual(recording.steps, [
    { cmd: "ui.click", target: "c" },
    { cmd: "ui.click", target: "a" },
    { cmd: "ui.click", target: "b" },
    { cmd: "nav", path: "practice" },
  ]);
  for (const step of recording.steps) {
    assert.equal(Object.hasOwn(step, "at"), false);
    assert.equal("at" in step, false);
  }
});

test("规则4：at 相同时 CLI 优先", () => {
  const recording = mergeRecording({
    cli: [cli(100, "ui.click", { target: "cli-first" })],
    page: [page(100, "click", "page-second")],
  });
  assert.deepEqual(recording.steps, [
    { cmd: "ui.click", target: "cli-first" },
    { cmd: "ui.click", target: "page-second" },
  ]);
});

test("规则3：500ms 内同 cmd 同 target 的页面事件被 CLI 去重", () => {
  const recording = mergeRecording({
    cli: [cli(1000, "ui.click", { target: "love.send" })],
    page: [
      page(1400, "click", "love.send"), // |Δt|=400 ≤ 500 → 丢弃
      page(1600, "click", "love.send"), // |Δt|=600 → 保留
    ],
  });
  assert.deepEqual(recording.steps, [
    { cmd: "ui.click", target: "love.send" },
    { cmd: "ui.click", target: "love.send" },
  ]);
});

test("规则3：ui.type 同样去重，target 不同不去重", () => {
  const recording = mergeRecording({
    cli: [cli(100, "ui.type", { target: "in.a", text: "hello" })],
    page: [
      page(200, "type", "in.a", "h"), // 同 target，被 CLI 整段输入遮蔽
      page(200, "type", "in.b", "x"), // 不同 target，保留
    ],
  });
  assert.deepEqual(recording.steps, [
    { cmd: "ui.type", target: "in.a", text: "hello" },
    { cmd: "ui.type", target: "in.b", text: "x" },
  ]);
});

test("规则5：同 target 连续 click 在 300ms 内视为一次", () => {
  const recording = mergeRecording({
    page: [
      page(0, "click", "btn"),
      page(200, "click", "btn"), // 距前一条 200ms → 合并
      page(600, "click", "btn"), // 距前一条 600ms → 保留
      page(800, "click", "btn"), // 距前一条 200ms → 合并
    ],
  });
  assert.deepEqual(recording.steps, [
    { cmd: "ui.click", target: "btn" },
    { cmd: "ui.click", target: "btn" },
  ]);
});

test("规则5：不同类型 target 的 click 不合并", () => {
  const recording = mergeRecording({
    page: [page(0, "click", "a"), page(100, "click", "b"), page(200, "click", "a")],
  });
  assert.deepEqual(recording.steps, [
    { cmd: "ui.click", target: "a" },
    { cmd: "ui.click", target: "b" },
    { cmd: "ui.click", target: "a" },
  ]);
});

test("规则5：连续同 target 的 ui.type 只保留最后一条", () => {
  const recording = mergeRecording({
    page: [
      page(0, "type", "input.x", "我"),
      page(100, "type", "input.x", "我们"),
      page(200, "type", "input.x", "我们明早九点见"),
      page(250, "type", "input.y", "ok"), // 不同 target 各自成段
    ],
  });
  assert.deepEqual(recording.steps, [
    { cmd: "ui.type", target: "input.x", text: "我们明早九点见" },
    { cmd: "ui.type", target: "input.y", text: "ok" },
  ]);
});

test("规则5：空 text 的 ui.type 丢弃（CLI 与页面两侧）", () => {
  const recording = mergeRecording({
    cli: [cli(10, "ui.type", { target: "in.a", text: "" })],
    page: [page(20, "type", "in.b", ""), page(30, "type", "in.c", "有字")],
  });
  assert.deepEqual(recording.steps, [{ cmd: "ui.type", target: "in.c", text: "有字" }]);
});

test("规则2：无锚点动作记进 notes，同标签合并计数", () => {
  const recording = mergeRecording({
    page: [
      page(0, "click", "", "发送"),
      page(10, "click", "", "发送"),
      page(20, "click", "", "重置"),
      page(30, "type", "", "随便写点"),
    ],
  });
  assert.deepEqual(recording.notes, [
    "跳过 2 次无锚点点击：发送",
    "跳过 1 次无锚点点击：重置",
    "跳过 1 次无锚点输入：随便写点",
  ]);
  assert.deepEqual(recording.steps, []);
});

test("规则6：空输入返回空 steps 与默认名，不抛错", () => {
  assert.deepEqual(mergeRecording(), { name: "recorded", description: "", steps: [], notes: [] });
  assert.deepEqual(mergeRecording({}), { name: "recorded", description: "", steps: [], notes: [] });
  assert.deepEqual(mergeRecording({ cli: [], page: [] }), {
    name: "recorded",
    description: "",
    steps: [],
    notes: [],
  });
});

test("规则6：meta.name / meta.description 覆盖输出", () => {
  const recording = mergeRecording({
    meta: { name: "love-happy", description: "恋爱 Galgame 主路径" },
    page: [page(0, "click", "love.option-0")],
  });
  assert.equal(recording.name, "love-happy");
  assert.equal(recording.description, "恋爱 Galgame 主路径");
  assert.deepEqual(recording.steps, [{ cmd: "ui.click", target: "love.option-0" }]);
});

test("规则7：null / 缺字段输入容错", () => {
  assert.deepEqual(mergeRecording({ cli: null, page: null }), {
    name: "recorded",
    description: "",
    steps: [],
    notes: [],
  });
  assert.deepEqual(mergeRecording({ cli: [null, "x", {}], page: [42, page(1, "click", "ok")] }), {
    name: "recorded",
    description: "",
    steps: [{ cmd: "ui.click", target: "ok" }],
    notes: [],
  });
  assert.deepEqual(mergeRecording({ meta: null }), {
    name: "recorded",
    description: "",
    steps: [],
    notes: [],
  });
});

test("createRecorder：累积两类事件，drain 返回合并结果并清空", () => {
  const rec = createRecorder();
  rec.cli(cli(100, "nav", { path: "practice" }));
  rec.page(page(50, "click", "send"));
  rec.cli(null); // 非法输入被忽略
  rec.page(page(60, "click", "", "无锚点按钮"));
  const first = rec.drain();
  assert.deepEqual(first.steps, [
    { cmd: "ui.click", target: "send" },
    { cmd: "nav", path: "practice" },
  ]);
  assert.deepEqual(first.notes, ["跳过 1 次无锚点点击：无锚点按钮"]);
  const second = rec.drain();
  assert.deepEqual(second, { name: "recorded", description: "", steps: [], notes: [] });
});