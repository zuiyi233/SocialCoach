import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scanAnchors,
  scanScenarios,
  aggregateCoverage,
  formatCoverage,
  normalizeAnchorRef,
} from "../../scripts/debug/coverage.mjs";

/** 造一个小工程：src（含各种锚点写法）+ scenarios + fixtures。 */
function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "sc-cov-"));
  const src = join(root, "src");
  const srcSub = join(src, "sub");
  const scenarios = join(root, "scenarios");
  const fixtures = join(root, "fixtures");
  mkdirSync(srcSub, { recursive: true });
  mkdirSync(scenarios, { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(
    join(src, "Panel.tsx"),
    [
      '<div data-debug="practice.input" />',
      `<div data-debug="practice.send" />`,
      "<div data-debug='dinner.input' />",
      '// 注释里的伪锚点不该算：data-debug="ghost"',
      "/* 块注释：data-debug='ghost2' */",
      '<div data-debug={`love.option-${i}`} />',
      `<div data-debug={cond ? 'studio.cond' : undefined} />`,
      `const s = 'data-debug="fake"';`,
      "",
    ].join("\n"),
  );
  writeFileSync(join(srcSub, "Chat.tsx"), '<span data-debug="practice.messages">x</span>\n');
  writeFileSync(
    join(scenarios, "one.json"),
    JSON.stringify({
      name: "one",
      steps: [
        { cmd: "state.load", fixture: "practice-active" },
        { cmd: "model.use", fixtures: ["flow-a"] },
        { cmd: "assert.text", target: "practice.messages", contains: "hi" },
        { cmd: "ui.type", target: "practice.input", text: "你好" },
        { cmd: "ui.click", target: "practice.send" },
        { cmd: "ui.click", text: "发送", role: "button" },
        { cmd: "ui.wait", target: '[data-debug="dinner.input"]', timeout: 1000 },
        { cmd: "assert.text", target: "body", contains: "ok" },
      ],
    }),
  );
  writeFileSync(
    join(scenarios, "two.json"),
    JSON.stringify({
      name: "two",
      steps: [
        { cmd: "model.use", fixtures: ["flow-b"] },
        { cmd: "ui.click", target: "love.option-0" },
        { cmd: "ui.click", text: "开始" },
      ],
    }),
  );
  writeFileSync(
    join(fixtures, "flow-a.json"),
    JSON.stringify({ name: "flow-a", routes: { health: {}, roleplay: {} } }),
  );
  writeFileSync(join(fixtures, "flow-b.json"), JSON.stringify({ name: "flow-b", routes: { "love-play": {} } }));
  // 没有任何场景引用的夹具：它的路由应出现在 routesUnused。
  writeFileSync(join(fixtures, "flow-c.json"), JSON.stringify({ name: "flow-c", routes: { "debrief-chat": {} } }));
  return { root, src, srcSub, scenarios, fixtures };
}

test("scanAnchors：双引号字面量锚点，相对各自 root 的文件路径", () => {
  const { root } = makeProject();
  const anchors = scanAnchors([join(root, "src")]);
  assert.deepEqual(anchors["practice.input"], ["Panel.tsx"]);
  assert.deepEqual(anchors["practice.send"], ["Panel.tsx"]);
  assert.deepEqual(anchors["practice.messages"], ["sub/Chat.tsx"]);
  assert.deepEqual(anchors["dinner.input"], ["Panel.tsx"], "单引号形式也要抓到");
  assert.ok(!Object.hasOwn(anchors, "love.option-0"));
  assert.ok(!anchors["practice.messages"][0].startsWith(".."), "路径相对 root");
});

test("scanAnchors：单引号字面量也认", () => {
  const { root } = makeProject();
  const anchors = scanAnchors([join(root, "src")]);
  assert.deepEqual(anchors["dinner.input"], ["Panel.tsx"]);
});

test("scanAnchors：注释里的伪锚点不算", () => {
  const { root } = makeProject();
  const anchors = scanAnchors([join(root, "src")]);
  assert.ok(!Object.hasOwn(anchors, "ghost"), "行注释里的 data-debug 不算");
  assert.ok(!Object.hasOwn(anchors, "ghost2"), "块注释里的 data-debug 不算");
});

test("scanAnchors：模板值 / 条件值 / 字符串里的 data-debug 不算（只认字面量属性）", () => {
  const { root } = makeProject();
  const anchors = scanAnchors([join(root, "src")]);
  assert.ok(!Object.hasOwn(anchors, "love.option-0"), "data-debug={`love.option-${i}`} 不算字面量");
  assert.ok(!Object.hasOwn(anchors, "studio.cond"), "data-debug={cond ? 'x' : undefined} 不算字面量");
  assert.ok(!Object.hasOwn(anchors, "fake"), "字符串里的 data-debug 不算锚点");
});

test("scanAnchors：多 root 合并、锚点文件列表排序、不存在的 root 抛错", () => {
  const { root } = makeProject();
  const src2 = join(root, "src2");
  mkdirSync(src2, { recursive: true });
  writeFileSync(join(src2, "Studio.tsx"), '<div data-debug="studio.card" />\n<div data-debug="practice.input" />\n');
  const anchors = scanAnchors([join(root, "src"), src2]);
  assert.deepEqual(anchors["practice.input"], ["Panel.tsx", "Studio.tsx"], "文件路径相对各自 root");
  assert.deepEqual(anchors["studio.card"], ["Studio.tsx"]);
  assert.throws(() => scanAnchors([join(root, "nope")]), /anchor root not found/);
});

test("normalizeAnchorRef：完整选择器归一成锚点名，裸名原样", () => {
  assert.equal(normalizeAnchorRef('[data-debug="practice.input"]'), "practice.input");
  assert.equal(normalizeAnchorRef("[data-debug='love.options']"), "love.options");
  assert.equal(normalizeAnchorRef("practice.send"), "practice.send");
  assert.equal(normalizeAnchorRef(""), "");
});

test("scanScenarios：target/submit 提取锚点（含选择器归一），requires 透传", () => {
  const { scenarios, fixtures } = makeProject();
  const result = scanScenarios({ scenarioDir: scenarios, fixtureDir: fixtures });
  const one = result.scenarios.find((s) => s.name === "one");
  assert.deepEqual(one.anchors, ["body", "dinner.input", "practice.input", "practice.messages", "practice.send"]);
  assert.equal(one.requires, null);
  const two = result.scenarios.find((s) => s.name === "two");
  assert.deepEqual(two.anchors, ["love.option-0"]);
  assert.equal(two.file, "two.json");
  assert.equal(two.steps.length, 3);
});

test("scanScenarios：ui.click 的 text 不算锚点覆盖，单独进 textClicks", () => {
  const { scenarios, fixtures } = makeProject();
  const result = scanScenarios({ scenarioDir: scenarios, fixtureDir: fixtures });
  const one = result.scenarios.find((s) => s.name === "one");
  assert.deepEqual(one.textClicks, ["发送"]);
  assert.ok(!one.anchors.includes("发送"), "文字点击不能算锚点使用");
  const two = result.scenarios.find((s) => s.name === "two");
  assert.deepEqual(two.textClicks, ["开始"]);
});

test("scanScenarios：路由来自 model.use 引用的夹具文件 routes 键；缺夹具记录 missingFixtures", () => {
  const { scenarios, fixtures } = makeProject();
  writeFileSync(
    join(scenarios, "three.json"),
    JSON.stringify({ name: "three", steps: [{ cmd: "model.use", fixtures: ["flow-c", "nope"] }] }),
  );
  const result = scanScenarios({ scenarioDir: scenarios, fixtureDir: fixtures });
  const three = result.scenarios.find((s) => s.name === "three");
  assert.deepEqual(three.routes, ["debrief-chat"]);
  assert.deepEqual(result.missingFixtures, [{ scenario: "three.json", fixture: "nope" }]);
  assert.deepEqual(result.fixtureRoutes["flow-c"], ["debrief-chat"]);
});

test("aggregateCoverage：已用/未用/未知锚点分开，未知单独列出", () => {
  const { root, scenarios, fixtures } = makeProject();
  const scanned = scanScenarios({ scenarioDir: scenarios, fixtureDir: fixtures });
  const anchors = scanAnchors([join(root, "src")]);
  const cov = aggregateCoverage({ scenarios: scanned, anchors });
  assert.deepEqual(cov.anchorsUsed, ["dinner.input", "practice.input", "practice.messages", "practice.send"]);
  assert.deepEqual(cov.anchorsUnknown, ["body", "love.option-0"], "场景引用但代码字面量里没有的单独列出（body 是页面级伪目标，不算锚点）");
  assert.deepEqual(cov.anchorsUnused, []);
});

test("aggregateCoverage：路由已用/未用按夹具全集，perScenario 计数", () => {
  const { scenarios, fixtures } = makeProject();
  const scanned = scanScenarios({ scenarioDir: scenarios, fixtureDir: fixtures });
  const cov = aggregateCoverage({ scenarios: scanned, anchors: {} });
  assert.deepEqual(cov.routesUsed, ["health", "love-play", "roleplay"]);
  assert.deepEqual(cov.routesUnused, ["debrief-chat"], "flow-c 没有任何场景 model.use，路由算未用");
  assert.equal(cov.perScenario.one.routeCount, 2);
  assert.equal(cov.perScenario.two.routeCount, 1);
  assert.equal(cov.perScenario.one.anchorCount, 5);
  assert.equal(cov.perScenario.one.textClickCount, 1);
});

test("aggregateCoverage：assert.api 的 route 单独记 asserted；routesUnasserted 只减断言过的", () => {
  const { scenarios, fixtures } = makeProject();
  writeFileSync(
    join(scenarios, "four.json"),
    JSON.stringify({
      name: "four",
      steps: [
        { cmd: "model.use", fixtures: ["flow-a"] },
        { cmd: "assert.api", route: "/api/roleplay", method: "POST", min: 1 },
      ],
    }),
  );
  const scanned = scanScenarios({ scenarioDir: scenarios, fixtureDir: fixtures });
  const cov = aggregateCoverage({ scenarios: scanned, anchors: {} });
  assert.deepEqual(cov.routesAsserted, ["roleplay"], "带 /api/ 前缀的写法归一化成路由键");
  assert.deepEqual(cov.perScenario.four.asserted, ["roleplay"]);
  assert.ok(cov.routesUnasserted.includes("health"), "加载了但没断言的仍算未断言");
  assert.ok(!cov.routesUnasserted.includes("roleplay"));
  assert.ok(!cov.routesUnasserted.includes("debrief-chat"), "未被任何场景加载的路由只在 routesUnused 里");
});

test("aggregateCoverage：裸场景数组也能用（无夹具全集时 routesUnused 为空）", () => {
  const cov = aggregateCoverage({
    scenarios: [{ name: "x", anchors: ["a"], textClicks: [], routes: ["r1"] }],
    anchors: { a: ["A.tsx"], b: ["B.tsx"] },
  });
  assert.deepEqual(cov.anchorsUsed, ["a"]);
  assert.deepEqual(cov.anchorsUnused, ["b"]);
  assert.deepEqual(cov.routesUnused, []);
  assert.deepEqual(cov.routesAsserted, []);
  assert.equal(cov.perScenario.x.anchorCount, 1);
});

test("formatCoverage：分组、未用路由、未知锚点、每场景计数，≤ 50 行", () => {
  const { root, scenarios, fixtures } = makeProject();
  // 补几个没有任何场景引用的锚点，让三个前缀分组 + 「其他」都有内容
  writeFileSync(
    join(root, "src", "Extra.tsx"),
    '<div data-debug="practice.unused" />\n<div data-debug="studio.unused" />\n<div data-debug="plainAnchor" />\n',
  );
  const scanned = scanScenarios({ scenarioDir: scenarios, fixtureDir: fixtures });
  const anchors = scanAnchors([join(root, "src")]);
  const cov = aggregateCoverage({ scenarios: scanned, anchors });
  const text = formatCoverage(cov);
  const lines = text.split("\n");
  assert.ok(lines.length <= 50, `报告 ${lines.length} 行，应 ≤ 50`);
  assert.match(text, /practice\.\*/);
  assert.match(text, /studio\.\*/);
  assert.match(text, /practice\.unused/);
  assert.match(text, /studio\.unused/);
  assert.match(text, /plainAnchor/);
  assert.match(text, /未用路由/);
  assert.match(text, /debrief-chat/);
  assert.match(text, /未知锚点/);
  assert.match(text, /love\.option-0/);
  assert.match(text, /one\s+5 锚点\s+1 文字点击\s+2 路由/);
});
