import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStep,
  firstDivergence,
  describeDivergence,
  flakeSummary,
} from "../../scripts/debug/flake.mjs";

/** 造一个步骤行（runScenarioFile 的 row 形状）。 */
function step(index, cmd, ok, { ms = 10, data = null, error = null } = {}) {
  const row = { index, cmd, ok, ms };
  if (data !== null) row.data = data;
  if (error !== null) row.error = error;
  return row;
}

function run(n, steps) {
  return { run: n, name: "demo", ok: steps.every((s) => s.ok), ms: 100, steps };
}

test("firstDivergence：status 分叉（ok 不同）返回 index/cmd/两轮步骤", () => {
  const r1 = run(1, [
    step(0, "state.load", true, { data: { fixture: "a" } }),
    step(1, "nav", true, { data: { url: "/" } }),
    step(2, "ui.click", true, { data: { clicked: "text:发送" } }),
  ]);
  const r2 = run(2, [
    step(0, "state.load", true, { data: { fixture: "a" } }),
    step(1, "nav", true, { data: { url: "/" } }),
    step(2, "ui.click", false, { data: { clicked: "text:发送" }, error: "element not found" }),
  ]);
  const d = firstDivergence([r1, r2]);
  assert.equal(d.stable, false);
  assert.equal(d.index, 2);
  assert.equal(d.cmd, "ui.click");
  assert.equal(d.kind, "status");
  assert.equal(d.baseline.ok, true);
  assert.equal(d.diverged.ok, false);
  assert.equal(d.divergedRun, 2);
});

test("firstDivergence：data 分叉（ok 同但 data 不同）", () => {
  const r1 = run(1, [step(0, "assert.text", true, { data: { text: "你好" } })]);
  const r2 = run(2, [step(0, "assert.text", true, { data: { text: "您好" } })]);
  const d = firstDivergence([r1, r2]);
  assert.equal(d.stable, false);
  assert.equal(d.index, 0);
  assert.equal(d.kind, "data");
  assert.equal(d.baseline.data.text, "你好");
  assert.equal(d.diverged.data.text, "您好");
});

test("firstDivergence：全稳定 → kind none", () => {
  const steps = [step(0, "state.load", true, { data: { fixture: "a" } }), step(1, "nav", true, {})];
  const d = firstDivergence([run(1, steps), run(2, steps)]);
  assert.equal(d.stable, true);
  assert.equal(d.kind, "none");
  assert.equal(d.index, -1);
  assert.equal(d.cmd, null);
});

test("firstDivergence：只有 ms 不同不算分叉", () => {
  const r1 = run(1, [step(0, "nav", true, { ms: 100, data: { url: "/" } })]);
  const r2 = run(2, [step(0, "nav", true, { ms: 9999, data: { url: "/" } })]);
  assert.equal(firstDivergence([r1, r2]).stable, true);
});

test("firstDivergence：data.at / 时间戳不同不算分叉", () => {
  const r1 = run(1, [step(0, "assert.trace", true, { data: { at: 111, kind: "model.replay", route: "dinner/direct" } })]);
  const r2 = run(2, [step(0, "assert.trace", true, { data: { at: 222, kind: "model.replay", route: "dinner/direct" } })]);
  assert.equal(firstDivergence([r1, r2]).stable, true);
});

test("firstDivergence：某轮步数更短也报 data 分叉并带 missing 说明", () => {
  const r1 = run(1, [
    step(0, "state.load", true, {}),
    step(1, "nav", true, {}),
    step(2, "assert.text", true, {}),
  ]);
  const r2 = run(2, [step(0, "state.load", true, {}), step(1, "nav", true, {})]);
  const d = firstDivergence([r1, r2]);
  assert.equal(d.stable, false);
  assert.equal(d.index, 2);
  assert.equal(d.kind, "data");
  assert.deepEqual(d.diverged, { missing: true, run: 2, length: 2 });
  assert.equal(d.cmd, "assert.text");
});

test("firstDivergence：三轮时 divergedRun 指向第一个分叉轮", () => {
  const base = [step(0, "nav", true, { data: { url: "/" } })];
  const d = firstDivergence([
    run(1, base),
    run(2, base),
    run(3, [step(0, "nav", false, { error: "boom" })]),
  ]);
  assert.equal(d.stable, false);
  assert.equal(d.kind, "status");
  assert.equal(d.divergedRun, 3);
  assert.equal(d.baselineRun, 1);
});

test("firstDivergence：不足两轮/空输入 → stable none", () => {
  const single = [step(0, "nav", true, {})];
  assert.equal(firstDivergence([run(1, single)]).stable, true);
  assert.equal(firstDivergence([]).stable, true);
  // 裸步骤数组输入也接受
  assert.equal(firstDivergence([single, single]).stable, true);
});

test("normalizeStep：去易变键、键排序、与键顺序无关", () => {
  const a = step(0, "nav", true, { ms: 1, data: { z: 1, at: 999, url: "/", nested: { startedAt: 5, keep: 1 } } });
  const b = { cmd: "nav", ok: true, index: 0, ms: 200, data: { url: "/", nested: { keep: 1, startedAt: 99999 }, z: 1, at: 2 } };
  assert.equal(normalizeStep(a), normalizeStep(b));
  assert.match(normalizeStep(a), /"url":"\/"/);
  assert.ok(!normalizeStep(a).includes("startedAt"));
  assert.ok(!normalizeStep(a).includes("999"));
});

test("flakeSummary：okRate 在 (0,1) 之间才列，按不稳定度排序（0.5 最前）", () => {
  const runs = [
    run(1, [
      step(0, "nav", true, {}),
      step(1, "click", true, {}),
      step(2, "assert", false, { error: "x" }),
      step(3, "never", true, {}),
    ]),
    run(2, [
      step(0, "nav", true, {}),
      step(1, "click", false, { error: "y" }),
      step(2, "assert", true, {}),
      step(3, "never", false, { error: "z" }),
    ]),
    run(3, [
      step(0, "nav", true, {}),
      step(1, "click", true, {}),
      step(2, "assert", false, { error: "x" }),
      step(3, "never", false, { error: "z" }),
    ]),
  ];
  const summary = flakeSummary(runs);
  assert.deepEqual(summary.map((s) => s.index), [1, 2, 3]);
  assert.equal(summary[0].okRate, 2 / 3, "click 两过一败，离 0.5 最近排最前");
  assert.deepEqual(summary[1], { index: 2, cmd: "assert", okRate: 1 / 3, passed: 1, total: 3 });
  assert.ok(summary.every((s) => s.okRate > 0 && s.okRate < 1));
});

test("flakeSummary：okRate 0 与 1 的步不列", () => {
  const runs = [
    run(1, [step(0, "always", true, {}), step(1, "never", false, { error: "e" })]),
    run(2, [step(0, "always", true, {}), step(1, "never", false, { error: "e" })]),
  ];
  assert.deepEqual(flakeSummary(runs), []);
});

test("flakeSummary：步数不足的轮只按有该步的轮计 total，0/1 边界不列", () => {
  const runs = [
    run(1, [step(0, "nav", true, {}), step(1, "tail", false, { error: "e" })]),
    run(2, [step(0, "nav", true, {})]),
  ];
  const summary = flakeSummary(runs);
  // tail 只有一轮参与（total 1, okRate 0），在 (0,1) 之外不列
  assert.deepEqual(summary, []);
});

test("describeDivergence：status 分叉含第 N 步/第 1 轮/第 2 轮/错误与建议命令", () => {
  const d = firstDivergence([
    run(1, [step(0, "state.load", true, {}), step(1, "nav", true, {}), step(2, "ui.click", true, { data: { clicked: "text:发送" } })]),
    run(2, [
      step(0, "state.load", true, {}),
      step(1, "nav", true, {}),
      step(2, "ui.click", false, { data: { clicked: "text:发送" }, error: "element not found" }),
    ]),
  ]);
  const text = describeDivergence(d, { file: "practice-chat.json" });
  assert.match(text, /第 3 步 ui\.click 在第 1 轮是 ok、第 2 轮是 failed/);
  assert.match(text, /第 2 轮错误：element not found/);
  assert.match(text, /pnpm debug run practice-chat\.json --repeat=2/);
});

test("describeDivergence：data 分叉列出两轮 data", () => {
  const d = firstDivergence([
    run(1, [step(0, "assert.text", true, { data: { text: "你好" } })]),
    run(2, [step(0, "assert.text", true, { data: { text: "您好" } })]),
  ]);
  const text = describeDivergence(d, { file: "demo.json" });
  assert.match(text, /第 1 步 assert\.text 在第 1 轮是 ok、第 2 轮是 ok/);
  assert.match(text, /第 1 轮 data：.*你好/);
  assert.match(text, /第 2 轮 data：.*您好/);
  assert.match(text, /pnpm debug run demo\.json --repeat=2/);
});

test("describeDivergence：无分叉时说明一致并给建议", () => {
  const steps = [step(0, "nav", true, {})];
  const d = firstDivergence([run(1, steps), run(2, steps)]);
  const text = describeDivergence(d, { file: "demo.json" });
  assert.match(text, /无分叉/);
  assert.match(text, /pnpm debug run demo\.json --repeat=2/);
});

test("describeDivergence：步数不足分叉说明短轮步数", () => {
  const d = firstDivergence([
    run(1, [step(0, "state.load", true, {}), step(1, "nav", true, {}), step(2, "assert.text", true, {})]),
    run(2, [step(0, "state.load", true, {}), step(1, "nav", true, {})]),
  ]);
  const text = describeDivergence(d, { file: "demo.json" });
  assert.match(text, /第 3 步 assert\.text 在第 1 轮是 ok、第 2 轮是 提前结束（该轮只有 2 步）/);
  assert.match(text, /pnpm debug run demo\.json --repeat=2/);
});
