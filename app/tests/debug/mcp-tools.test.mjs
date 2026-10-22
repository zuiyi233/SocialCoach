import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolset } from "../../scripts/debug/mcp-tools.mjs";

/** 假 daemon：记录每次调用；可通过 rpc 覆写返回/抛错。 */
function fakeDaemon(overrides = {}) {
  const calls = [];
  const rpc = async (cmd, args = {}) => {
    calls.push({ cmd, args });
    if (overrides.alwaysThrow) {
      const error = new Error("rpc exploded");
      error.console = ["console-event-1", "console-event-2"];
      throw error;
    }
    if (overrides.rpc) return overrides.rpc(cmd, args);
    return { ok: true, data: { cmd, ...args } };
  };
  const ensure = async (args) => {
    calls.push({ ensure: args });
    return { ok: true, port: 43210, base: "http://localhost:3000", ...args };
  };
  const stop = async () => {
    calls.push({ stop: true });
    return { down: true };
  };
  return { daemon: { rpc, ensure, stop }, calls };
}

/** 假 commands：记录每次调用；可用覆写替换某个方法。 */
function fakeCommands(overrides = {}) {
  const calls = [];
  const make = (name) => async (...args) => {
    calls.push({ name, args });
    if (overrides[name]) return overrides[name](...args);
    return { ok: true, data: { name } };
  };
  const commands = {
    logs: make("logs"),
    runScenario: make("runScenario"),
    suite: make("suite"),
    smoke: make("smoke"),
    diff: make("diff"),
    contracts: make("contracts"),
    recordStart: make("recordStart"),
    recordStop: make("recordStop"),
    fixtureBuild: make("fixtureBuild"),
    studioUp: make("studioUp"),
    studioSeed: make("studioSeed"),
    studioDown: make("studioDown"),
    studioStatus: make("studioStatus"),
  };
  return { commands, calls };
}

function toolset(daemonOverrides = {}, commandOverrides = {}) {
  const d = fakeDaemon(daemonOverrides);
  const c = fakeCommands(commandOverrides);
  return {
    ts: createToolset({ commands: c.commands, daemon: d.daemon }),
    dcalls: d.calls,
    ccalls: c.calls,
  };
}

test("list() 恰好 32 个工具：名字唯一、sc_ 前缀、描述非空、schema 是 object", () => {
  const { ts } = toolset();
  const tools = ts.list();
  assert.equal(tools.length, 33);
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, 33, "名字有重复");
  for (const t of tools) {
    assert.match(t.name, /^sc_/, `名字缺前缀: ${t.name}`);
    assert.ok(t.title && t.title.length > 0, `${t.name} 缺 title`);
    assert.ok(t.description && t.description.length > 0, `${t.name} 缺 description`);
    assert.equal(t.inputSchema.type, "object", `${t.name} 的 inputSchema 不是 object`);
    assert.ok(!("handler" in t), `${t.name} 把 handler 泄出去了`);
  }
});

test("每个工具的 required 字段都出现在 properties 里", () => {
  const { ts } = toolset();
  for (const t of ts.list()) {
    for (const key of t.inputSchema.required ?? []) {
      assert.ok(key in t.inputSchema.properties, `${t.name} required=${key} 不在 properties`);
    }
  }
});

test('call("sc_nav",{path:"/"}) 透传给 rpc 为 ("nav",{path:"/"})', async () => {
  const { ts, dcalls } = toolset();
  const out = await ts.call("sc_nav", { path: "/" });
  assert.equal(out.isError, false);
  assert.deepEqual(dcalls, [{ cmd: "nav", args: { path: "/" } }]);
});

test('call("sc_canvas",{ms}) 透传给 rpc 为 ("canvas.stats",{ms})', async () => {
  const { ts, dcalls } = toolset();
  const out = await ts.call("sc_canvas", { ms: 1500 });
  assert.equal(out.isError, false);
  assert.deepEqual(dcalls, [{ cmd: "canvas.stats", args: { ms: 1500 } }]);
});

test('call("sc_canvas",{action:"bogus"}) 报错且不调 rpc', async () => {
  const { ts, dcalls } = toolset();
  const out = await ts.call("sc_canvas", { action: "bogus" });
  assert.equal(out.isError, true);
  assert.match(out.text, /needs action: stats/);
  assert.equal(dcalls.length, 0);
});

test("sc_click 缺 target/text 时报错且不调 rpc；给锚点名会解析成选择器", async () => {
  const { ts, dcalls } = toolset();
  const bad = await ts.call("sc_click", {});
  assert.equal(bad.isError, true);
  assert.match(bad.text, /target or text/);
  assert.equal(dcalls.length, 0);

  const good = await ts.call("sc_click", { target: "love.option-0" });
  assert.equal(good.isError, false);
  assert.deepEqual(dcalls, [
    { cmd: "ui.click", args: { target: '[data-debug="love.option-0"]', nth: 0, timeout: 15000 } },
  ]);
});

test("sc_click 无锚点时可用 text", async () => {
  const { ts, dcalls } = toolset();
  const out = await ts.call("sc_click", { text: "开始接话" });
  assert.equal(out.isError, false);
  assert.deepEqual(dcalls, [{ cmd: "ui.click", args: { text: "开始接话", nth: 0, timeout: 15000 } }]);
});

test("sc_type 缺 target 时报错且不调 rpc；submit 锚点也解析", async () => {
  const { ts, dcalls } = toolset();
  const bad = await ts.call("sc_type", { text: "你好" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /needs target/);
  assert.equal(dcalls.length, 0);

  const good = await ts.call("sc_type", { target: "practice.input", text: "你好", submit: "practice.send" });
  assert.equal(good.isError, false);
  assert.deepEqual(dcalls, [
    {
      cmd: "ui.type",
      args: { target: '[data-debug="practice.input"]', text: "你好", submit: '[data-debug="practice.send"]' },
    },
  ]);
});

test("sc_model use 不传 fixtures 时报错且不调 rpc", async () => {
  const { ts, dcalls } = toolset();
  const out = await ts.call("sc_model", { action: "use" });
  assert.equal(out.isError, true);
  assert.match(out.text, /fixtures/);
  assert.equal(dcalls.length, 0);

  const good = await ts.call("sc_model", { action: "use", fixtures: ["love-flow"], strict: true });
  assert.equal(good.isError, false);
  assert.deepEqual(dcalls, [{ cmd: "model.use", args: { fixtures: ["love-flow"], strict: true } }]);
});

test("未知工具名 → isError 且文案固定", async () => {
  const { ts } = toolset();
  const out = await ts.call("sc_nope", {});
  assert.equal(out.isError, true);
  assert.equal(out.text, "unknown tool: sc_nope");
});

test("rpc 抛错时 call 不抛、isError 且文本含错误信息与 console", async () => {
  const { ts } = toolset({ alwaysThrow: true });
  let out;
  await assert.doesNotReject(async () => {
    out = await ts.call("sc_snapshot", {});
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /rpc exploded/);
  assert.match(out.text, /console-event-1/);
  assert.match(out.text, /console-event-2/);
});

test("rpc 返回 ok:false（不抛）也转成 isError，带 error.message", async () => {
  const { ts } = toolset({
    rpc: async () => ({ ok: false, error: { message: "nav timeout" }, console: ["noise"] }),
  });
  const out = await ts.call("sc_nav", { path: "/" });
  assert.equal(out.isError, true);
  assert.match(out.text, /nav timeout/);
  assert.match(out.text, /noise/);
});

test("sc_suite 在 commands.suite 返回含 ok:false 时 isError", async () => {
  const { ts } = toolset(
    {},
    { suite: async () => ({ ok: false, data: [{ name: "a.json", ok: false, error: "step 0 failed" }] }) },
  );
  const out = await ts.call("sc_suite", {});
  assert.equal(out.isError, true);
  assert.match(out.text, /step 0 failed/);

  const pass = toolset();
  const good = await pass.ts.call("sc_suite", { all: true });
  assert.equal(good.isError, false);
  assert.deepEqual(pass.ccalls.find((c) => c.name === "suite").args, [{ all: true }]);
});

test("sc_contracts 把参数正确透传给 commands.contracts", async () => {
  const { ts, ccalls } = toolset(
    {},
    { contracts: async () => ({ ok: true, data: { routes: [], covered: [], missing: [], unknown: [], errors: [] } }) },
  );
  const out = await ts.call("sc_contracts", { strict: true });
  assert.equal(out.isError, false);
  assert.deepEqual(ccalls.find((c) => c.name === "contracts").args, [{ strict: true }]);
  assert.match(out.text, /"missing"/);
});

test("sc_why 合成 url/text/交互/错误/model/storage/lock 且文本封顶 1200", async () => {
  const { ts } = toolset({
    rpc: async (cmd) => {
      if (cmd === "snapshot") {
        return {
          ok: true,
          data: {
            url: "http://localhost:3000/love",
            title: "T",
            ready: "complete",
            text: "字".repeat(3000),
            state: { k: 1 },
            interactive: [{ debug: "love.options" }],
          },
        };
      }
      if (cmd === "trace") {
        return {
          ok: true,
          data: {
            events: [
              { kind: "console.error", text: "bad thing" },
              { kind: "log", level: "info", text: "fine" },
              { kind: "model.missing", text: "health" },
              { kind: "storage", text: "set socialcoach.v1" },
              { kind: "lock", text: "NULL" },
            ],
          },
        };
      }
      return { ok: true, data: {} };
    },
  });
  const out = await ts.call("sc_why", {});
  assert.equal(out.isError, false);
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.text.length, 1200);
  assert.equal(parsed.url, "http://localhost:3000/love");
  assert.equal(parsed.errors.length, 2, "console.error + model.missing 算失败");
  assert.equal(parsed.errors[0].text, "bad thing");
  assert.equal(parsed.model.length, 1);
  assert.equal(parsed.storage.length, 1);
  assert.equal(parsed.lock.length, 1);
  assert.ok(Array.isArray(parsed.interactive));
});

test("sc_doctor：server.ok=false 时 isError，健康时 ok", async () => {
  const sick = toolset({
    rpc: async (cmd) => (cmd === "doctor" ? { ok: true, data: { server: { ok: false }, chromeExists: true, base: "http://x" } } : { ok: true, data: {} }),
  });
  const bad = await sick.ts.call("sc_doctor", {});
  assert.equal(bad.isError, true);
  assert.match(bad.text, /server\.ok=false/);

  const healthy = toolset({
    rpc: async (cmd) => (cmd === "doctor" ? { ok: true, data: { server: { ok: true }, chromeExists: true } } : { ok: true, data: {} }),
  });
  const good = await healthy.ts.call("sc_doctor", {});
  assert.equal(good.isError, false);
  assert.equal(JSON.parse(good.text).chromeExists, true);
});

test("sc_up 默认参数走 daemon.ensure({serve:true,headless:true})；sc_down 走 daemon.stop", async () => {
  const { ts, dcalls } = toolset();
  const up = await ts.call("sc_up", {});
  assert.equal(up.isError, false);
  assert.deepEqual(dcalls[0], { ensure: { serve: true, headless: true } });

  const down = await ts.call("sc_down", {});
  assert.equal(down.isError, false);
  assert.deepEqual(dcalls[1], { stop: true });
});

test("sc_state：load 缺 fixture 报错；load/set/clear/dump 分别打到对应 rpc", async () => {
  const { ts, dcalls } = toolset();
  const bad = await ts.call("sc_state", { action: "load" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /fixture/);

  await ts.call("sc_state", { action: "load", fixture: "love-start" });
  await ts.call("sc_state", { action: "set", key: "socialcoach.foo", value: { a: 1 } });
  await ts.call("sc_state", { action: "clear" });
  await ts.call("sc_state", { action: "dump", save: "before-change" });
  assert.deepEqual(dcalls, [
    { cmd: "state.load", args: { fixture: "love-start" } },
    { cmd: "state.set", args: { key: "socialcoach.foo", value: { a: 1 } } },
    { cmd: "state.clear", args: {} },
    { cmd: "state.dump", args: { save: "before-change" } },
  ]);
});

test("sc_eval 缺 expression 报错且不调 rpc", async () => {
  const { ts, dcalls } = toolset();
  const bad = await ts.call("sc_eval", {});
  assert.equal(bad.isError, true);
  assert.match(bad.text, /expression/);
  assert.equal(dcalls.length, 0);
});

test("sc_anchors 给 route 时先 nav 再 eval", async () => {
  const { ts, dcalls } = toolset();
  const out = await ts.call("sc_anchors", { route: "love" });
  assert.equal(out.isError, false);
  assert.deepEqual(dcalls[0], { cmd: "nav", args: { path: "love", wait: "body" } });
  assert.equal(dcalls[1].cmd, "eval");
  assert.match(dcalls[1].args.expression, /data-debug/);
});

test("sc_errors 只挑异常/错误/model.missing 并计数", async () => {
  const { ts } = toolset({
    rpc: async (cmd) =>
      cmd === "trace"
        ? {
            ok: true,
            data: {
              events: [
                { kind: "console.error", text: "boom" },
                { kind: "log", level: "info", text: "ok" },
                { kind: "exception", text: "uncaught" },
              ],
            },
          }
        : { ok: true, data: {} },
  });
  const out = await ts.call("sc_errors", {});
  assert.equal(out.isError, false);
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.count, 2);
});

test("sc_logs / sc_run / sc_fixture_build / sc_record / sc_studio 透传到 commands", async () => {
  const { ts, ccalls } = toolset();

  await ts.call("sc_logs", { file: "daemon", lines: 50 });
  await ts.call("sc_run", { file: "debug/scenarios/x.json", repeat: 2 });
  await ts.call("sc_fixture_build", { file: "debug/fixtures/specs/p.json" });
  await ts.call("sc_record", { action: "start", name: "my-flow" });
  await ts.call("sc_record", { action: "stop" });
  await ts.call("sc_studio", { action: "seed", card: "ganyu" });

  const named = (n) => ccalls.filter((c) => c.name === n);
  assert.deepEqual(named("logs")[0].args, [{ file: "daemon", lines: 50 }]);
  assert.deepEqual(named("runScenario")[0].args, ["debug/scenarios/x.json", { repeat: 2 }]);
  assert.deepEqual(named("fixtureBuild")[0].args, ["debug/fixtures/specs/p.json"]);
  assert.deepEqual(named("recordStart")[0].args, ["my-flow"]);
  assert.deepEqual(named("recordStop")[0].args, []);
  assert.deepEqual(named("studioSeed")[0].args, ["ganyu"]);
});

test("sc_run 在结果 ok:false 时 isError（与 CLI 退出码 1 一致）", async () => {
  const { ts } = toolset(
    {},
    { runScenario: async () => ({ ok: false, data: { repeat: 1, passed: 0, runs: [{ run: 1, ok: false, error: "step 2 failed" }] } }) },
  );
  const out = await ts.call("sc_run", { file: "debug/scenarios/x.json" });
  assert.equal(out.isError, true);
  assert.match(out.text, /step 2 failed/);
});

test('call("sc_assert",{kind:"api",...}) 透传为 ("assert.api",{...})', async () => {
  const { ts, dcalls } = toolset();
  const body = { lang: "zh", messages: [{ role: "learner", text: "你好" }] };
  const out = await ts.call("sc_assert", { kind: "api", route: "roleplay", method: "POST", body, count: 1, min: 2, timeout: 8000 });
  assert.equal(out.isError, false);
  assert.deepEqual(dcalls, [
    { cmd: "assert.api", args: { route: "roleplay", method: "POST", body, count: 1, min: 2, timeout: 8000 } },
  ]);
});

test('call("sc_assert",{kind:"state"/"count"}) 透传且锚点名解析成选择器', async () => {
  const { ts, dcalls } = toolset();
  const stateOut = await ts.call("sc_assert", { kind: "state", path: "state.settings.tts", equals: true });
  assert.equal(stateOut.isError, false);
  const countOut = await ts.call("sc_assert", { kind: "count", target: "practice.messages", min: 2, max: 4 });
  assert.equal(countOut.isError, false);
  assert.deepEqual(dcalls, [
    { cmd: "assert.state", args: { key: "socialcoach.v1", path: "state.settings.tts", equals: true } },
    { cmd: "assert.count", args: { target: '[data-debug="practice.messages"]', min: 2, max: 4 } },
  ]);
});

test("sc_assert 缺 kind 或 api 缺 route 时报错且不调 rpc", async () => {
  const { ts, dcalls } = toolset();
  const noKind = await ts.call("sc_assert", { route: "roleplay" });
  assert.equal(noKind.isError, true);
  assert.match(noKind.text, /kind: api\|state\|count/);
  const noRoute = await ts.call("sc_assert", { kind: "api" });
  assert.equal(noRoute.isError, true);
  assert.match(noRoute.text, /route/);
  assert.equal(dcalls.length, 0);
});