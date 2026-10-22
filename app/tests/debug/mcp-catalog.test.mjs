import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createCatalog } from "../../scripts/debug/mcp-catalog.mjs";

// 真实仓库：tests/debug/mcp-catalog.test.mjs 向上两层 = app/。
// 这些资源就是给真实仓库用的，不造假目录。
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEBUG_ROOT = join(APP_ROOT, ".debug");
const catalog = createCatalog({ appRoot: APP_ROOT, debugRoot: DEBUG_ROOT });

const read = (uri) => catalog.resources.read(uri);
const readJson = (uri) => JSON.parse(read(uri).text);

test("resources.list() 恰好 6 条静态资源：URI 唯一、都有 mimeType 与 title/description", () => {
  const list = catalog.resources.list();
  assert.equal(list.length, 6);
  const uris = list.map((r) => r.uri);
  assert.equal(new Set(uris).size, 6, "URI 有重复");
  for (const r of list) {
    assert.ok(r.uri.startsWith("socialcoach://"), r.uri);
    assert.ok(r.mimeType, `${r.uri} 缺 mimeType`);
    assert.ok(r.title && r.description, `${r.uri} 缺 title/description`);
  }
});

test("resources.templates() 2 条：uriTemplate 以 {name} 结尾", () => {
  const list = catalog.resources.templates();
  assert.equal(list.length, 2);
  for (const t of list) {
    assert.ok(t.uriTemplate.endsWith("{name}"), t.uriTemplate);
    assert.ok(t.mimeType && t.title && t.description, t.uriTemplate);
  }
});

test("read guide：非空 Markdown、含 sc_why 与三条禁区", () => {
  const out = read("socialcoach://guide");
  assert.equal(out.mimeType, "text/markdown");
  assert.equal(out.uri, "socialcoach://guide");
  assert.ok(out.text.trim().length > 0, "guide 为空");
  assert.match(out.text, /sc_why/);
  assert.match(out.text, /禁区/);
  assert.match(out.text, /data-debug/);
});

test("read scenarios：数组、按 name 排序、每条有 name/steps", () => {
  const list = readJson("socialcoach://scenarios");
  assert.ok(Array.isArray(list) && list.length >= 6, `场景数异常：${list.length}`);
  const names = list.map((s) => s.name);
  assert.deepEqual(names, [...names].sort(), "未按 name 排序");
  for (const s of list) {
    assert.ok(s.name, "缺 name");
    assert.equal(typeof s.steps, "number", `${s.name} 的 steps 不是条数`);
    assert.ok(s.steps > 0, `${s.name} 的 steps 为空`);
    assert.ok(s.file.endsWith(".json"), `${s.name} 缺 file`);
  }
  assert.ok(list.some((s) => s.requires === "studio"), "studio-chat 的 requires 丢了");
});

test("read scenarios/love-happy：返回该场景且 steps 非空", () => {
  const s = readJson("socialcoach://scenarios/love-happy");
  assert.equal(s.name, "love-happy");
  assert.ok(Array.isArray(s.steps) && s.steps.length > 0, "steps 为空");
  assert.ok(s.steps.some((row) => row.cmd === "assert.text"), "场景里没有断言");
});

test("read 不存在的场景名 → 抛 no scenario named", () => {
  assert.throws(() => read("socialcoach://scenarios/no-such"), /no scenario named no-such/);
});

test("read fixtures/models：每条有 name 与 routes 数组", () => {
  const list = readJson("socialcoach://fixtures/models");
  assert.ok(Array.isArray(list) && list.length >= 3, `模型夹具数异常：${list.length}`);
  for (const m of list) {
    assert.ok(m.name, "缺 name");
    assert.ok(Array.isArray(m.routes), `${m.name} 缺 routes`);
    assert.ok(m.file.endsWith(".json"), `${m.name} 缺 file`);
  }
  const names = list.map((m) => m.name);
  assert.deepEqual(names, [...names].sort(), "未按 name 排序");
  assert.ok(list.some((m) => m.routes.includes("love-play")), "love-flow 的路由丢了一个");
});

test("read fixtures/models/love-flow：返回夹具全文；不存在抛 no model fixture named", () => {
  const m = readJson("socialcoach://fixtures/models/love-flow");
  assert.equal(m.name, "love-flow");
  assert.ok(m.routes && Object.keys(m.routes).length > 0, "routes 为空");
  assert.throws(() => read("socialcoach://fixtures/models/no-such"), /no model fixture named no-such/);
});

test("read fixtures/states：每条有 name 与 keys 数组", () => {
  const list = readJson("socialcoach://fixtures/states");
  assert.ok(Array.isArray(list) && list.length >= 3, `状态夹具数异常：${list.length}`);
  for (const s of list) {
    assert.ok(s.name && s.file, `${s.name} 缺 name/file`);
    assert.ok(Array.isArray(s.keys), `${s.name} 缺 keys`);
  }
  const names = list.map((s) => s.name);
  assert.deepEqual(names, [...names].sort(), "未按 name 排序");
});

test("read contracts：含 routes / covered / missing / unknown / errors", () => {
  const out = read("socialcoach://contracts");
  assert.equal(out.mimeType, "application/json");
  const c = readJson("socialcoach://contracts");
  assert.ok(Array.isArray(c.routes) && c.routes.length > 0, "routes 为空");
  assert.ok(Array.isArray(c.covered) && Array.isArray(c.missing), "缺 covered/missing");
  assert.ok(Array.isArray(c.unknown) && Array.isArray(c.errors), "缺 unknown/errors");
  assert.ok(c.routes.some((r) => r.route && Array.isArray(r.methods)), "route 条目形状不对");
});

test("read failures：数组（目录不存在也返回 []），有数据时最新在前且 ≤10 条", () => {
  const list = readJson("socialcoach://failures");
  assert.ok(Array.isArray(list), "failures 不是数组");
  assert.ok(list.length <= 10, "超过 10 条");
  for (const f of list) {
    assert.ok(typeof f.dir === "string", "缺 dir");
    assert.equal(typeof f.hasReport, "boolean");
    assert.equal(typeof f.hasTrace, "boolean");
    assert.equal(typeof f.hasSnapshot, "boolean");
  }
  if (list.length > 1) {
    const dirs = list.map((f) => f.dir);
    assert.deepEqual(dirs, [...dirs].sort().reverse(), "未按时间戳倒序（最新在前）");
  }
});

test("read 未知 URI → 抛 unknown resource", () => {
  assert.throws(() => read("socialcoach://nope"), /unknown resource: socialcoach:\/\/nope/);
  assert.throws(() => read("socialcoach://fixtures/states/love-start"), /unknown resource/);
});

test("JSON 资源都是 2 空格缩进、text 非空", () => {
  for (const uri of [
    "socialcoach://scenarios",
    "socialcoach://fixtures/models",
    "socialcoach://fixtures/states",
    "socialcoach://failures",
    "socialcoach://contracts",
  ]) {
    const out = read(uri);
    assert.ok(out.text.length > 0, `${uri} 为空`);
    assert.match(out.text, /\n  /, `${uri} 不是 2 空格缩进`);
  }
});

test("prompts.list() 4 条：都有 title/description/arguments，必填标记正确", () => {
  const list = catalog.prompts.list();
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((p) => p.name), ["debug-repro", "debug-regression", "debug-new-scenario", "debug-api-fixture"]);
  for (const p of list) {
    assert.ok(p.title && p.description, `${p.name} 缺 title/description`);
    assert.ok(Array.isArray(p.arguments), `${p.name} 缺 arguments`);
    for (const a of p.arguments) {
      assert.ok(a.name && a.description, `${p.name} 的参数缺字段`);
      assert.equal(typeof a.required, "boolean");
    }
  }
});

test("debug-repro：缺 symptom 抛错；给齐参数后文本含 symptom 与 route", () => {
  assert.throws(() => catalog.prompts.get("debug-repro", {}), /debug-repro needs symptom/);
  const out = catalog.prompts.get("debug-repro", { symptom: "发送按钮点了没反应", route: "love/play/x" });
  assert.equal(out.messages.length, 1);
  const msg = out.messages[0];
  assert.equal(msg.role, "user");
  assert.equal(msg.content.type, "text");
  assert.match(msg.content.text, /发送按钮点了没反应/);
  assert.match(msg.content.text, /love\/play\/x/);
  assert.match(msg.content.text, /sc_why/);
  assert.match(msg.content.text, /data-debug/);
});

test("其余 prompt 必填校验与内容要点", () => {
  assert.throws(() => catalog.prompts.get("debug-new-scenario", {}), /debug-new-scenario needs name/);
  const scenario = catalog.prompts.get("debug-new-scenario", { name: "dinner-take" });
  assert.match(scenario.messages[0].content.text, /dinner-take/);
  assert.match(scenario.messages[0].content.text, /--repeat=2/);
  assert.match(scenario.messages[0].content.text, /骨架/);

  assert.throws(() => catalog.prompts.get("debug-api-fixture", {}), /debug-api-fixture needs route/);
  const fixture = catalog.prompts.get("debug-api-fixture", { route: "love-play" });
  assert.match(fixture.messages[0].content.text, /love-play/);
  assert.match(fixture.messages[0].content.text, /sc_contracts/);
  assert.match(fixture.messages[0].content.text, /虚构/);
});

test("debug-regression：无参数即可 get，文本含三层回归与 failures 指引", () => {
  const out = catalog.prompts.get("debug-regression", {});
  assert.deepEqual(out.messages, [{ role: "user", content: { type: "text", text: out.messages[0].content.text } }]);
  const text = out.messages[0].content.text;
  assert.match(text, /sc_suite/);
  assert.match(text, /sc_smoke/);
  assert.match(text, /sc_contracts/);
  assert.match(text, /socialcoach:\/\/failures/);
  assert.match(text, /report\.json/);
});

test("prompts.get 未知 name → 抛 unknown prompt", () => {
  assert.throws(() => catalog.prompts.get("sc_repro", {}), /unknown prompt: sc_repro/);
});