import assert from "node:assert/strict";
import { test } from "node:test";
import { diffSnapshots } from "../../scripts/debug/snapshot-diff.mjs";

const BASE = {
  url: "http://localhost:3000/love",
  title: "SocialCoach",
  ready: "complete",
  text: "你好\n世界",
  interactive: [
    { debug: "love.send", tag: "button", label: "发送", disabled: false, value: null },
    { debug: "love.input", tag: "input", label: "输入框", disabled: false, value: "hi" },
  ],
  state: { "socialcoach.track.open": 10, "socialcoach.v1": 229 },
};

test("text：新增与删除的行", () => {
  const diff = diffSnapshots(
    { ...BASE, text: "你好\n世界" },
    { ...BASE, text: "你好\n世界\n新的台词" },
  );
  assert.deepEqual(diff.text.added, ["新的台词"]);
  assert.deepEqual(diff.text.removed, []);
  assert.equal(diff.text.truncated, false);
  assert.equal(diff.changed, true);
  const removed = diffSnapshots(
    { ...BASE, text: "你好\n世界\n旧台词" },
    { ...BASE, text: "你好\n世界" },
  );
  assert.deepEqual(removed.text.added, []);
  assert.deepEqual(removed.text.removed, ["旧台词"]);
});

test("text：trim 后比对，空行不参与", () => {
  const diff = diffSnapshots(
    { ...BASE, text: "  你好  \n\n\n" },
    { ...BASE, text: "你好\n  " },
  );
  assert.deepEqual(diff.text.added, []);
  assert.deepEqual(diff.text.removed, []);
  assert.equal(diff.changed, false);
});

test("text：重复行按多重集合算，输出去重并保持首次出现顺序", () => {
  const diff = diffSnapshots(
    { ...BASE, text: "a\nb" },
    { ...BASE, text: "a\na\nb\nb\nc" },
  );
  // a、b 各多 1 次，c 新增；输出都只出现一次，顺序按 after 首次出现。
  assert.deepEqual(diff.text.added, ["a", "b", "c"]);
  const removed = diffSnapshots(
    { ...BASE, text: "a\na\nb\nb" },
    { ...BASE, text: "a\nb" },
  );
  assert.deepEqual(removed.text.removed, ["a", "b"]);
});

test("interactive：新增与移除（含同 tag 无锚点按钮的 key 回退）", () => {
  const before = {
    ...BASE,
    interactive: [
      { debug: "keep", tag: "button", label: "保留", disabled: false },
      { tag: "button", label: null, disabled: false },
    ],
  };
  const after = {
    ...BASE,
    interactive: [
      { debug: "keep", tag: "button", label: "保留", disabled: false },
      { tag: "button", label: null, disabled: false },
      { tag: "button", label: null, disabled: true },
    ],
  };
  const addedDiff = diffSnapshots(before, after);
  assert.deepEqual(addedDiff.interactive.added, [{ key: "button#2", label: null, disabled: true }]);
  assert.deepEqual(addedDiff.interactive.removed, []);
  const removedDiff = diffSnapshots(after, before);
  assert.deepEqual(removedDiff.interactive.removed, [{ key: "button#2", label: null, disabled: true }]);
});

test("interactive：key 依次取 debug、label，再 fallback 到 tag#序号", () => {
  const before = {
    ...BASE,
    interactive: [
      { debug: "a", tag: "button", label: "甲", disabled: false },
      { tag: "button", label: "乙", disabled: false },
    ],
  };
  const after = {
    ...BASE,
    interactive: [
      { tag: "button", label: "乙", disabled: false },
      { debug: "a", tag: "button", label: "甲", disabled: false },
    ],
  };
  // 键相同（debug/label 优先），只是顺序变了 → 无任何差异。
  const diff = diffSnapshots(before, after);
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.interactive.added, []);
  assert.deepEqual(diff.interactive.removed, []);
  assert.deepEqual(diff.interactive.changed, []);
});

test("interactive：disabled 翻转与 value 变化算 changed", () => {
  const diff = diffSnapshots(
    {
      ...BASE,
      interactive: [{ debug: "send", tag: "button", label: "发送", disabled: false, value: null }],
    },
    {
      ...BASE,
      interactive: [{ debug: "send", tag: "button", label: "发送", disabled: true, value: "x" }],
    },
  );
  assert.deepEqual(diff.interactive.changed, [
    {
      key: "send",
      before: { label: "发送", disabled: false, value: null },
      after: { label: "发送", disabled: true, value: "x" },
    },
  ]);
  assert.equal(diff.changed, true);
});

test("interactive：三项都没变不算 changed", () => {
  const el = { debug: "send", tag: "button", label: "发送", disabled: false, value: null };
  const diff = diffSnapshots(
    { ...BASE, interactive: [el] },
    { ...BASE, interactive: [{ ...el }] },
  );
  assert.deepEqual(diff.interactive.changed, []);
  assert.equal(diff.changed, false);
});

test("state：键的新增、移除与值修改（数字/字符串/布尔）", () => {
  const before = {
    ...BASE,
    state: { a: 1, b: "x", c: true, gone: 9 },
  };
  const after = {
    ...BASE,
    state: { a: 2, b: "y", c: true, fresh: "new" },
  };
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.state.added, [{ key: "fresh", after: "new" }]);
  assert.deepEqual(diff.state.removed, [{ key: "gone", before: 9 }]);
  assert.deepEqual(diff.state.changed, [
    { key: "a", before: 1, after: 2 },
    { key: "b", before: "x", after: "y" },
  ]);
  assert.equal(diff.changed, true);
});

test("state：值与类型不同的字面量也算 changed", () => {
  const diff = diffSnapshots(
    { ...BASE, state: { n: 1 } },
    { ...BASE, state: { n: "1" } },
  );
  assert.deepEqual(diff.state.changed, [{ key: "n", before: 1, after: "1" }]);
});

test("limit 截断：各桶独立截断并置 truncated", () => {
  const before = {
    ...BASE,
    text: "a\nb\nc\nd",
    interactive: [
      { debug: "k1", label: "一", disabled: false },
      { debug: "k2", label: "二", disabled: false },
      { debug: "k3", label: "三", disabled: false },
    ],
    state: { a: 1, b: 2, c: 3 },
  };
  const after = {
    ...BASE,
    text: "a\nb\nx\ny",
    interactive: [
      { debug: "k1", label: "一", disabled: false },
      { debug: "k2", label: "二", disabled: true },
      { debug: "k5", label: "五", disabled: false },
      { debug: "k6", label: "六", disabled: false },
    ],
    state: { b: 9, d: 4, e: 5 },
  };
  const diff = diffSnapshots(before, after, { limit: 1 });
  assert.equal(diff.text.truncated, true);
  assert.equal(diff.text.added.length, 1);
  assert.equal(diff.text.removed.length, 1);
  assert.equal(diff.interactive.truncated, true);
  assert.equal(diff.interactive.added.length, 1);
  assert.equal(diff.interactive.changed.length, 1);
  assert.equal(diff.state.truncated, true);
  assert.equal(diff.state.changed.length, 1);
  assert.equal(diff.state.added.length, 1);
  assert.equal(diff.state.removed.length, 1);
});

test("changed 按完整差异判定，不因截断误报或漏报", () => {
  const before = { ...BASE, state: { a: 1, b: 2 } };
  const after = { ...BASE, state: { a: 1, b: 3 } };
  const diff = diffSnapshots(before, after, { limit: 1 });
  assert.equal(diff.changed, true);
  assert.equal(diff.state.truncated, false); // 只有 1 条差异，没截断
  const truncated = diffSnapshots(before, after, { limit: 1 });
  assert.deepEqual(truncated.state.changed, [{ key: "b", before: 2, after: 3 }]);
});

test("完全相同时 changed 为 false", () => {
  const diff = diffSnapshots(BASE, JSON.parse(JSON.stringify(BASE)));
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.text.added, []);
  assert.deepEqual(diff.text.removed, []);
  assert.deepEqual(diff.interactive.added, []);
  assert.deepEqual(diff.interactive.removed, []);
  assert.deepEqual(diff.interactive.changed, []);
  assert.deepEqual(diff.state.added, []);
  assert.deepEqual(diff.state.removed, []);
  assert.deepEqual(diff.state.changed, []);
  assert.equal(diff.url.changed, false);
  assert.equal(diff.title.changed, false);
  assert.equal(diff.ready.changed, false);
});

test("缺字段 / null / 非数组容错，不抛错", () => {
  const diff = diffSnapshots(null, undefined);
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.text.added, []);
  assert.deepEqual(diff.interactive.added, []);
  assert.deepEqual(diff.state.added, []);
  const weird = diffSnapshots(
    { interactive: "not-array", state: null, text: 42 },
    { interactive: [null, { disabled: true }], state: [1, 2], text: "行" },
  );
  assert.deepEqual(weird.interactive.added, [
    { key: "element#1", label: null, disabled: null },
    { key: "element#2", label: null, disabled: true },
  ]);
  assert.deepEqual(weird.text.added, ["行"]);
  assert.equal(weird.changed, true);
});

test("纯函数：不改入参", () => {
  const before = JSON.parse(JSON.stringify(BASE));
  const after = JSON.parse(JSON.stringify(BASE));
  after.interactive.push({ debug: "new.btn", label: "新按钮", disabled: false });
  after.state["socialcoach.new"] = 1;
  after.text += "\n新行";
  diffSnapshots(before, after, { limit: 2 });
  assert.deepEqual(before, BASE);
  assert.deepEqual(after, {
    ...BASE,
    interactive: [...BASE.interactive, { debug: "new.btn", label: "新按钮", disabled: false }],
    state: { ...BASE.state, "socialcoach.new": 1 },
    text: BASE.text + "\n新行",
  });
});

test("输出顺序稳定：同输入两次 diff 结果一致", () => {
  const before = {
    ...BASE,
    text: "甲\n乙\n丙",
    interactive: [
      { debug: "a", label: "A", disabled: false },
      { tag: "button", label: null, disabled: false },
    ],
    state: { x: 1, y: 2 },
  };
  const after = {
    ...BASE,
    text: "乙\n丙\n丁",
    interactive: [
      { tag: "button", label: null, disabled: true },
      { debug: "a", label: "A", disabled: false },
      { debug: "b", label: "B", disabled: false },
    ],
    state: { x: 3, z: 4 },
  };
  const first = diffSnapshots(before, after);
  const second = diffSnapshots(
    JSON.parse(JSON.stringify(before)),
    JSON.parse(JSON.stringify(after)),
  );
  assert.deepEqual(second, first);
});

test("url / title / ready 变化", () => {
  const diff = diffSnapshots(BASE, { ...BASE, url: "http://localhost:3000/practice", title: "练习", ready: "interactive" });
  assert.deepEqual(diff.url, { before: BASE.url, after: "http://localhost:3000/practice", changed: true });
  assert.deepEqual(diff.title, { before: BASE.title, after: "练习", changed: true });
  assert.deepEqual(diff.ready, { before: "complete", after: "interactive", changed: true });
  assert.equal(diff.changed, true);
});