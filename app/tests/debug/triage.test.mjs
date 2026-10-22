import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readBundle,
  classifyFailure,
  hypotheses,
  summarizeBundles,
  formatTriage,
  formatBundle,
} from "../../scripts/debug/triage.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REAL_FAILURES = join(APP_ROOT, ".debug", "failures");

const tmpRoot = mkdtempSync(join(tmpdir(), "sc-triage-"));

/** 造一个合成失败包目录，返回 readBundle 结果。dir 名按 ISO 时间形态，可排序。 */
function makeBundle(name, { report = {}, trace = null, snapshot = null, files = [] } = {}) {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  if (report !== null) {
    writeFileSync(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (trace !== null) writeFileSync(join(dir, "trace.json"), `${JSON.stringify(trace, null, 2)}\n`);
  if (snapshot !== null) writeFileSync(join(dir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  for (const file of files) writeFileSync(join(dir, file), file === "screen.png" ? "\u0089PNG" : "<html>");
  return readBundle(dir);
}

function failStep(index, cmd, error, { ms = 123, ok = false } = {}) {
  return { index, cmd, ok, ms, error };
}

const snapshot = {
  url: "http://localhost:3000/love/play/love-approach-cafe",
  title: "SocialCoach",
  ready: "complete",
  text: "你也点了这款豆子",
  interactive: [{ debug: "love.option-0", tag: "button", label: "试试" }],
  state: {},
};

// ── readBundle ─────────────────────────────────────────────────────────────

test("readBundle 读全量包：字段齐全、missing 为空", () => {
  const bundle = makeBundle("full", {
    report: { scenario: "love-happy", file: "debug/scenarios/love-happy.json", error: "x", results: [] },
    trace: { events: [{ kind: "console.warn", text: "w" }] },
    snapshot,
    files: ["page.html", "screen.png"],
  });
  assert.deepEqual(bundle.missing, []);
  assert.deepEqual(bundle.errors, []);
  assert.equal(bundle.report.scenario, "love-happy");
  assert.equal(bundle.trace.events.length, 1);
  assert.equal(bundle.snapshot.url, snapshot.url);
  assert.ok(bundle.htmlPath.endsWith("page.html"));
  assert.ok(bundle.screenshotPath.endsWith("screen.png"));
});

test("readBundle 缺 trace.json：不抛错，missing 记 trace.json，其余照常", () => {
  const bundle = makeBundle("no-trace", {
    report: { scenario: "s", file: "f", error: "e", results: [] },
    trace: null,
    files: ["page.html"],
  });
  assert.ok(bundle.missing.includes("trace.json"));
  assert.ok(bundle.missing.includes("snapshot.json"));
  assert.ok(bundle.missing.includes("screen.png"));
  assert.ok(!bundle.missing.includes("report.json"));
  assert.equal(bundle.report.scenario, "s");
  assert.equal(bundle.trace, null);
});

test("readBundle 坏 JSON：不抛错，errors 记文件名与原因", () => {
  const dir = join(tmpRoot, "bad-json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), "{ not json\n");
  writeFileSync(join(dir, "trace.json"), "[]"); // 结构对但不是 {events}，也不抛
  const bundle = readBundle(dir);
  assert.equal(bundle.report, null);
  assert.ok(bundle.errors.some((e) => e.startsWith("report.json")));
  assert.equal(bundle.trace.events, undefined);
  // report.json / trace.json 存在（不算 missing），另外三个文件没写 → missing
  assert.deepEqual(bundle.missing, ["snapshot.json", "page.html", "screen.png"]);
});

test("readBundle 只有 report.json：missing 列出其余文件，不抛错", () => {
  const bundle = makeBundle("only-report", {
    report: { scenario: "s", file: "f", error: "e", results: [] },
    trace: null,
    snapshot: null,
  });
  assert.deepEqual(bundle.missing, ["trace.json", "snapshot.json", "page.html", "screen.png"]);
  assert.equal(bundle.report.error, "e");
});

test("readBundle 目录不存在：全部 missing、不抛错", () => {
  const bundle = readBundle(join(tmpRoot, "does-not-exist"));
  assert.deepEqual(bundle.missing, ["report.json", "trace.json", "snapshot.json", "page.html", "screen.png"]);
  assert.equal(bundle.report, null);
});

// ── classifyFailure：12 种 kind 全覆盖 ────────────────────────────────────

test("classifyFailure 覆盖全部 12 种 kind", () => {
  const cases = [
    {
      name: "sel-missing",
      kind: "selector-missing",
      report: { scenario: "love-happy", file: "f", error: "missing: love.option-0", results: [failStep(0, "assert.exists", "missing: love.option-0")] },
      trace: { events: [] },
      snapshot,
    },
    {
      name: "timeout",
      kind: "timeout",
      report: { scenario: "dinner-turn", file: "f", error: "not found: dinner.input (30000ms)", results: [failStep(2, "ui.wait", "not found: dinner.input (30000ms)")] },
      trace: { events: [] },
      snapshot,
    },
    {
      name: "model-missing",
      kind: "model-missing",
      report: { scenario: "practice-chat", file: "f", error: "", results: [failStep(3, "assert.text", "text not found in love.line: 你好")] },
      trace: {
        events: [
          { kind: "model.missing", route: "roleplay", at: 1 },
          { kind: "fetch", url: "http://localhost:3000/api/roleplay", method: "POST", status: 503, ms: 2, body: '{"error":"No debug fixture for /api/roleplay","code":"debug-fixture-missing"}' },
        ],
      },
      snapshot,
    },
    {
      name: "model-unexpected",
      kind: "model-unexpected",
      report: { scenario: "love-happy", file: "f", error: "", results: [failStep(4, "assert.trace", "trace event not found: {kind:model.replay}")] },
      trace: { events: [{ kind: "model.replay.error", route: "love-play", text: "Fetch.fulfillRequest failed" }] },
      snapshot,
    },
    {
      name: "console-error",
      kind: "console-error",
      report: { scenario: "dinner-conflict", file: "f", error: "console errors: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:3000/x", results: [failStep(5, "assert.noErrors", "console errors: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:3000/x")] },
      trace: { events: [{ kind: "console.error", text: "THREE.GLTFLoader: Couldn't load texture blob:http://localhost:3000/x" }] },
      snapshot,
    },
    {
      name: "assertion",
      kind: "assertion-mismatch",
      report: { scenario: "love-happy", file: "f", error: 'text does not contain "不用换": "你也点了这款豆子，对吗？"', results: [failStep(3, "assert.text", 'text does not contain "不用换": "你也点了这款豆子，对吗？"')] },
      trace: { events: [{ kind: "model.replay", route: "love-play", index: 0, by: "counter" }] },
      snapshot,
    },
    {
      name: "http-error",
      kind: "http-error",
      report: { scenario: "practice-chat", file: "f", error: "Failed to fetch: POST http://localhost:3000/api/roleplay", results: [failStep(4, "assert.text", "Failed to fetch: POST http://localhost:3000/api/roleplay")] },
      trace: { events: [{ kind: "fetch", url: "http://localhost:3000/api/roleplay", method: "POST", status: 500, ms: 15, body: "Internal Server Error" }] },
      snapshot,
    },
    {
      name: "lock-conflict",
      kind: "lock-conflict",
      report: { scenario: "dinner-turn", file: "f", error: 'selector not found or still disabled: [data-debug="dinner.send"]', results: [failStep(5, "ui.click", 'selector not found or still disabled: [data-debug="dinner.send"]')] },
      trace: {
        events: [
          { kind: "lock", text: "dinner.storage #2 request ifAvailable" },
          { kind: "lock", text: "dinner.storage #2 acquired" },
          { kind: "lock", text: "dinner.storage #3 request ifAvailable" },
          { kind: "lock", text: "dinner.storage #3 NULL" },
        ],
      },
      snapshot,
    },
    {
      name: "storage",
      kind: "storage",
      report: { scenario: "practice-voice", file: "f", error: "SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied", results: [failStep(0, "state.load", "SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied")] },
      trace: { events: [] },
      snapshot,
    },
    {
      name: "navigation",
      kind: "navigation",
      report: { scenario: "love-happy", file: "f", error: 'selector not found after navigate: [data-debug="love.options"]', results: [failStep(2, "nav", 'selector not found after navigate: [data-debug="love.options"]')] },
      trace: { events: [] },
      snapshot,
    },
    {
      name: "studio-einval",
      kind: "studio-unavailable",
      report: { scenario: "studio-chat", file: "f", error: "spawn EINVAL", results: [failStep(0, "studio.up", "spawn EINVAL", { ms: 6005 })] },
      trace: { events: [] },
      snapshot,
    },
    {
      name: "unknown",
      kind: "unknown",
      report: { scenario: "coach-flows", file: "f", error: "state.load needs a fixture name", results: [failStep(0, "state.load", "state.load needs a fixture name")] },
      trace: { events: [] },
      snapshot,
    },
  ];
  for (const c of cases) {
    const bundle = makeBundle(`kind-${c.name}`, { report: c.report, trace: c.trace, snapshot: c.snapshot });
    const triage = classifyFailure(bundle);
    assert.equal(triage.kind, c.kind, `kind-${c.name}: got ${triage.kind}`);
    assert.ok(triage.evidence.length > 0, `kind-${c.name}: evidence 非空`);
  }
});

test("classifyFailure 判定依据是包内容，不是场景名", () => {
  // 场景名叫 studio-chat，但错误是选择器缺失 → selector-missing，不猜 studio
  const a = makeBundle("name-trap-1", {
    report: { scenario: "studio-chat", file: "f", error: "missing: studio.send", results: [failStep(0, "assert.exists", "missing: studio.send")] },
    trace: { events: [] },
    snapshot,
  });
  assert.equal(classifyFailure(a).kind, "selector-missing");
  // 场景名叫 love-happy，但错误是 studio EINVAL → studio-unavailable
  const b = makeBundle("name-trap-2", {
    report: { scenario: "love-happy", file: "f", error: "spawn EINVAL", results: [failStep(0, "studio.up", "spawn EINVAL")] },
    trace: { events: [] },
    snapshot,
  });
  assert.equal(classifyFailure(b).kind, "studio-unavailable");
});

test("classifyFailure 对空包（无 report）不抛错，kind 为 unknown", () => {
  const bundle = readBundle(join(tmpRoot, "empty"));
  const triage = classifyFailure(bundle);
  assert.equal(triage.kind, "unknown");
  assert.ok(triage.evidence.some((e) => e.includes("missing files")));
});

// ── hypotheses ────────────────────────────────────────────────────────────

test("hypotheses 排序：high -> medium -> low，同级顺序稳定", () => {
  const bundle = makeBundle("hyp-order", {
    report: { scenario: "love-happy", file: "debug/scenarios/love-happy.json", error: "missing: love.option-0", results: [failStep(0, "assert.exists", "missing: love.option-0")] },
    trace: { events: [] },
    snapshot,
  });
  const list = hypotheses(bundle);
  assert.ok(list.length >= 2);
  const order = list.map((h) => h.confidence);
  assert.deepEqual(order, [...order].sort((x, y) => ({ high: 0, medium: 1, low: 2 }[x] - { high: 0, medium: 1, low: 2 }[y])));
  assert.ok(list.every((h) => h.cause && h.nextCommand));
});

test("hypotheses 的 nextCommand 覆盖规定的命令清单", () => {
  const cases = [
    { name: "sel", error: "missing: love.option-0", cmd: "assert.exists", want: ["pnpm debug anchors", "pnpm debug snapshot"] },
    { name: "to", error: "not found: dinner.input (30000ms)", cmd: "ui.wait", want: ["--repeat=1", '"timeout": 30000'] },
    { name: "mm", error: "model fixture not found: L:/x.json", cmd: "model.use", want: ["fixture probe", "pnpm debug contracts"] },
    { name: "ce", error: "console errors: boom", cmd: "assert.noErrors", want: ["pnpm debug errors", "pnpm debug trace"] },
    { name: "lc", error: "另一窗口修改了这场练习", cmd: "assert.text", want: ["pnpm debug tab list"] },
    { name: "su", error: "Studio venv not found: L:/x", cmd: "studio.up", want: ["pnpm debug studio status"] },
    { name: "he", error: "Failed to fetch: POST http://localhost:3000/api/roleplay", cmd: "assert.text", want: ["pnpm debug logs"] },
  ];
  for (const c of cases) {
    const events =
      c.name === "lc"
        ? [{ kind: "lock", text: "dinner.storage #2 NULL" }]
        : c.name === "he"
          ? [{ kind: "fetch", url: "http://localhost:3000/api/roleplay", method: "POST", status: 500, ms: 5 }]
          : c.name === "ce"
            ? [{ kind: "console.error", text: "boom" }]
            : [];
    const bundle = makeBundle(`hyp-cmd-${c.name}`, {
      report: { scenario: "s", file: "debug/scenarios/x.json", error: c.error, results: [failStep(0, c.cmd, c.error)] },
      trace: { events },
      snapshot,
    });
    const list = hypotheses(bundle);
    const nextAll = list.map((h) => h.nextCommand).join("\n");
    for (const want of c.want) {
      assert.ok(nextAll.includes(want), `hyp-cmd-${c.name}: nextCommand 应包含 ${want}\n${nextAll}`);
    }
  }
});

test("assertion-mismatch 的假设带期望与实际", () => {
  const bundle = makeBundle("hyp-assert", {
    report: {
      scenario: "love-happy",
      file: "f",
      error: 'text does not contain "不用换": "你也点了这款豆子，对吗？"',
      results: [failStep(3, "assert.text", 'text does not contain "不用换": "你也点了这款豆子，对吗？"')],
    },
    trace: { events: [] },
    snapshot,
  });
  const top = hypotheses(bundle)[0];
  assert.ok(top.evidence.some((e) => e.includes("expected contains: 不用换")), JSON.stringify(top.evidence));
  assert.ok(top.evidence.some((e) => e.includes("actual text:")), JSON.stringify(top.evidence));
});

test("lock-conflict 的假设提示另一标签页/上一轮实例", () => {
  const bundle = makeBundle("hyp-lock", {
    report: { scenario: "dinner-turn", file: "f", error: "另一窗口修改了这场练习", results: [failStep(4, "assert.text", "另一窗口修改了这场练习")] },
    trace: { events: [{ kind: "lock", text: "dinner.storage #2 request ifAvailable" }, { kind: "lock", text: "dinner.storage #2 NULL" }] },
    snapshot,
  });
  const top = hypotheses(bundle)[0];
  assert.ok(top.cause.includes("标签页") || top.cause.includes("上一轮"), top.cause);
});

// ── summarizeBundles / format ─────────────────────────────────────────────

test("summarizeBundles 分组、计数、排序、latest", () => {
  const mk = (dir, scenario, error) =>
    makeBundle(dir, {
      report: { scenario, file: "f", error, results: [failStep(0, "assert.exists", error)] },
      trace: { events: [] },
      snapshot,
    });
  const bundles = [
    mk("2026-10-22T10-00-00-000Z", "dinner-turn", "missing: dinner.send"),
    mk("2026-10-22T11-00-00-000Z", "dinner-turn", "missing: dinner.send"),
    mk("2026-10-22T12-00-00-000Z", "love-happy", "missing: love.option-0"),
    mk("2026-10-22T13-00-00-000Z", "coach-flows", "missing: practice.input"),
  ];
  const summary = summarizeBundles(bundles);
  assert.equal(summary.total, 4);
  // 前两条同签名（kind+cmd+anchor 相同）合并成一组
  assert.equal(summary.groups.length, 3);
  const first = summary.groups[0];
  assert.equal(first.count, 2);
  assert.equal(first.kind, "selector-missing");
  assert.ok(first.firstSeen.endsWith("2026-10-22T10-00-00-000Z"), first.firstSeen);
  assert.ok(first.lastSeen.endsWith("2026-10-22T11-00-00-000Z"), first.lastSeen);
  assert.ok(first.latestDir.endsWith("2026-10-22T11-00-00-000Z"), first.latestDir);
  assert.equal(first.scenario, "dinner-turn");
  // count 降序
  const counts = summary.groups.map((g) => g.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  // latest = 目录名最大的包
  assert.ok(summary.latest.dir.endsWith("2026-10-22T13-00-00-000Z"), summary.latest.dir);
  assert.equal(summary.latest.signature, "selector-missing@assert.exists:practice.input");
});

test("formatTriage 输出包含每个分组的 kind 与「下一步」", () => {
  const mk = (dir, error) =>
    makeBundle(dir, {
      report: { scenario: "s", file: "debug/scenarios/x.json", error, results: [failStep(0, "ui.click", error)] },
      trace: { events: [{ kind: "console.error", text: "boom" }] },
      snapshot,
    });
  const summary = summarizeBundles([
    mk("2026-10-22T10-00-00-000Z", "console errors: boom"),
    mk("2026-10-22T11-00-00-000Z", "missing: love.option-0"),
  ]);
  const out = formatTriage(summary);
  const lines = out.split("\n");
  assert.ok(lines.length <= 60);
  assert.ok(out.includes("[console-error]"), out);
  assert.ok(out.includes("[selector-missing]"), out);
  assert.ok(out.includes("下一步:"), out);
  assert.ok(out.includes("最新失败包"), out);
});

test("formatBundle 输出包含 kind、error 与 next 命令", () => {
  const bundle = makeBundle("fmt-bundle", {
    report: { scenario: "dinner-turn", file: "debug/scenarios/dinner-turn.json", error: "not found: dinner.input (30000ms)", results: [failStep(2, "ui.wait", "not found: dinner.input (30000ms)", { ms: 30000 })] },
    trace: { events: [] },
    snapshot,
  });
  const out = formatBundle(bundle);
  const lines = out.split("\n");
  assert.ok(lines.length <= 60);
  assert.ok(out.includes("kind: timeout"), out);
  assert.ok(out.includes("cmd=ui.wait"), out);
  assert.ok(out.includes("next:"), out);
  assert.ok(out.includes("--repeat=1"), out);
});

// ── 真实形状 ──────────────────────────────────────────────────────────────

test("真实形状：最近一个失败包分类不抛错且非 unknown", (t) => {
  if (!existsSync(REAL_FAILURES)) {
    t.skip(`没有失败包目录：${REAL_FAILURES}`);
    return;
  }
  const dirs = readdirSync(REAL_FAILURES).sort();
  const newest = dirs[dirs.length - 1];
  if (!newest) {
    t.skip("失败包目录为空");
    return;
  }
  const bundle = readBundle(join(REAL_FAILURES, newest));
  let triage = null;
  assert.doesNotThrow(() => {
    triage = classifyFailure(bundle);
  });
  assert.notEqual(triage.kind, "unknown", `最近失败包 ${newest} 分类成 unknown`);
  // 假设清单也应当能跑出至少一条
  assert.ok(hypotheses(bundle).length >= 1);
});
