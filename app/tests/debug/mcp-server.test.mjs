/**
 * mcp-server.mjs 的单元测试：假 toolset 直接调 handle() / start()，
 * 不 spawn 任何进程（端到端留给主控方）。覆盖协议要求的全部行为。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createMcpServer } from "../../scripts/debug/mcp-server.mjs";

const TOOLS = [
  { name: "sc_x", title: "假工具", description: "只用于测试", inputSchema: { type: "object" } },
  { name: "sc_y", title: "假工具二", description: "只用于测试", inputSchema: { type: "object" } },
];

/** 可覆写的假 toolset：call 记录调用并可注入延迟 / 返回。 */
function fakeToolset(overrides = {}) {
  const calls = [];
  return {
    calls,
    toolset: {
      list: () => TOOLS.map((t) => ({ ...t })),
      async call(name, args = {}) {
        calls.push({ name, args });
        if (overrides.call) return overrides.call(name, args);
        return { text: `ok:${name}`, isError: false };
      },
    },
  };
}

function server(ts, opts = {}) {
  return createMcpServer({
    toolset: ts,
    catalog: opts.catalog ?? null,
    input: opts.input ?? new PassThrough(),
    output: opts.output ?? new PassThrough(),
    version: "9.9.9",
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("initialize 回显合法 protocolVersion", async () => {
  const s = server(fakeToolset().toolset);
  const reply = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  assert.equal(reply.id, 1);
  assert.equal(reply.result.protocolVersion, "2024-11-05");
  assert.deepEqual(reply.result.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(reply.result.serverInfo, { name: "socialcoach-debug", version: "9.9.9" });
});

test("initialize 给不认识的版本时回落 2025-06-18", async () => {
  const s = server(fakeToolset().toolset);
  const reply = await s.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
  assert.equal(reply.result.protocolVersion, "2025-06-18");
  const bare = await s.handle({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
  assert.equal(bare.result.protocolVersion, "2025-06-18");
});

test("notifications/initialized 返回 null", async () => {
  const s = server(fakeToolset().toolset);
  assert.equal(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  // 带 id 的诡异形态也不写任何东西
  assert.equal(await s.handle({ jsonrpc: "2.0", id: 9, method: "notifications/initialized" }), null);
});

test("tools/list 透传 toolset.list()", async () => {
  const s = server(fakeToolset().toolset);
  const reply = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(reply.id, 1);
  assert.deepEqual(reply.result.tools.map((t) => t.name), ["sc_x", "sc_y"]);
});

test("tools/call 成功 → content[0].text 与 isError:false", async () => {
  const f = fakeToolset();
  const s = server(f.toolset);
  const reply = await s.handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "sc_x", arguments: { a: 1 } } });
  assert.equal(reply.id, 5);
  assert.equal(reply.result.content[0].type, "text");
  assert.equal(reply.result.content[0].text, "ok:sc_x");
  assert.equal(reply.result.isError, false);
  assert.deepEqual(f.calls, [{ name: "sc_x", args: { a: 1 } }]);
});

test("tools/call 不传 arguments 时补空对象", async () => {
  const f = fakeToolset();
  const s = server(f.toolset);
  await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sc_x" } });
  assert.deepEqual(f.calls[0].args, {});
});

test("tools/call 失败（isError:true）也原样返回", async () => {
  const f = fakeToolset({ call: async () => ({ text: "boom: details", isError: true }) });
  const s = server(f.toolset);
  const reply = await s.handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sc_x" } });
  assert.equal(reply.result.content[0].text, "boom: details");
  assert.equal(reply.result.isError, true);
});

test("tools/call 缺 params.name → -32602", async () => {
  const f = fakeToolset();
  const s = server(f.toolset);
  for (const params of [undefined, {}, { arguments: {} }, { name: "" }]) {
    const reply = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params });
    assert.equal(reply.error.code, -32602, JSON.stringify(params));
    assert.equal(f.calls.length, 0, "参数错时不该碰 toolset");
  }
});

test("未知方法 → -32601", async () => {
  const s = server(fakeToolset().toolset);
  const reply = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/doSomething" });
  assert.equal(reply.error.code, -32601);
  assert.equal(reply.error.message, "Method not found: tools/doSomething");
});

test("ping → {}", async () => {
  const s = server(fakeToolset().toolset);
  const reply = await s.handle({ jsonrpc: "2.0", id: 7, method: "ping" });
  assert.deepEqual(reply, { jsonrpc: "2.0", id: 7, result: {} });
});

test("无 id 的通知不触发工具调用也不写响应", async () => {
  const f = fakeToolset();
  const s = server(f.toolset);
  assert.equal(await s.handle({ jsonrpc: "2.0", method: "tools/call", params: { name: "sc_x" } }), null);
  assert.equal(f.calls.length, 0);
});

test("并发两次 tools/call：第二个等第一个完成（顺序入队）", async () => {
  const order = [];
  const ts = {
    list: () => [],
    async call(name) {
      order.push(`start:${name}`);
      await sleep(30);
      order.push(`end:${name}`);
      return { text: name, isError: false };
    },
  };
  const s = server(ts);
  const [r1, r2] = await Promise.all([
    s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "a" } }),
    s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "b" } }),
  ]);
  assert.deepEqual(order, ["start:a", "end:a", "start:b", "end:b"]);
  assert.equal(r1.result.content[0].text, "a");
  assert.equal(r2.result.content[0].text, "b");
});

test("start() 用 PassThrough：一行进一行出，且不产生多余输出", async () => {
  const ts = fakeToolset().toolset;
  const input = new PassThrough();
  const output = new PassThrough();
  let buf = "";
  output.on("data", (chunk) => (buf += chunk));
  const s = server(ts, { input, output });
  s.start();

  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
  await sleep(20);
  assert.equal(buf, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "socialcoach-debug", version: "9.9.9" } } }) + "\n");

  buf = "";
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }) + "\n");
  await sleep(20);
  assert.equal(buf, JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }) + "\n");

  // 通知必须零输出
  buf = "";
  input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await sleep(20);
  assert.equal(buf, "");
  s.stop();
});

test("start() 收到非法 JSON 行 → -32700 Parse error 且继续处理后续行", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let buf = "";
  output.on("data", (chunk) => (buf += chunk));
  const s = server(fakeToolset().toolset, { input, output });
  s.start();

  input.write("this is not json\n");
  await sleep(20);
  assert.equal(buf, JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");

  buf = "";
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }) + "\n");
  await sleep(20);
  assert.equal(buf, JSON.stringify({ jsonrpc: "2.0", id: 3, result: {} }) + "\n");
  s.stop();
});

test("toolset 缺 list/call 时构造抛 TypeError", () => {
  assert.throws(() => createMcpServer({ toolset: {}, input: new PassThrough(), output: new PassThrough() }), TypeError);
  assert.throws(() => createMcpServer({ toolset: { list: () => [] }, input: new PassThrough(), output: new PassThrough() }), TypeError);
});

// ---------- resources / prompts（catalog 注入） ----------

/**
 * 可覆写的假 catalog：形状与 mcp-catalog.mjs 一致（list/templates/read、list/get），
 * 额外记录 read / get 调用，供断言「参数是否正确穿透」。
 */
function fakeCatalog(overrides = {}) {
  const calls = { reads: [], gets: [] };
  return {
    calls,
    catalog: {
      resources: {
        list: () => [
          { uri: "socialcoach://guide", name: "guide", title: "t", description: "d", mimeType: "text/markdown" },
        ],
        templates: () => [
          { uriTemplate: "socialcoach://scenarios/{name}", name: "scenario", title: "t", description: "d", mimeType: "application/json" },
        ],
        async read(uri) {
          calls.reads.push(uri);
          if (overrides.read) return overrides.read(uri);
          if (uri === "socialcoach://guide") return { uri, mimeType: "text/markdown", text: "# hi" };
          throw new Error("unknown resource: " + uri);
        },
      },
      prompts: {
        list: () => [
          { name: "debug-repro", title: "t", description: "d", arguments: [{ name: "symptom", description: "d", required: true }] },
        ],
        async get(name, args) {
          calls.gets.push({ name, args });
          if (overrides.get) return overrides.get(name, args);
          return { description: "d", messages: [{ role: "user", content: { type: "text", text: "repro " + args.symptom } }] };
        },
      },
    },
  };
}

test("initialize（catalog 非空）→ capabilities 同时含 tools / resources / prompts", async () => {
  const { catalog } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  const reply = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.deepEqual(reply.result.capabilities, {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false },
  });
});

test("initialize（catalog 为 null）→ capabilities 只有 tools", async () => {
  const s = server(fakeToolset().toolset); // catalog 默认 null
  const reply = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.deepEqual(reply.result.capabilities, { tools: { listChanged: false } });
  assert.equal(reply.result.capabilities.resources, undefined);
  assert.equal(reply.result.capabilities.prompts, undefined);
});

test("resources/list 透传 catalog.resources.list()", async () => {
  const { catalog } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  const reply = await s.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" });
  assert.equal(reply.id, 2);
  assert.equal(reply.result.resources.length, 1);
  assert.deepEqual(reply.result.resources[0], {
    uri: "socialcoach://guide",
    name: "guide",
    title: "t",
    description: "d",
    mimeType: "text/markdown",
  });
});

test("resources/templates/list 透传且键名必须是 resourceTemplates", async () => {
  const { catalog } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  const reply = await s.handle({ jsonrpc: "2.0", id: 3, method: "resources/templates/list" });
  assert.ok(Array.isArray(reply.result.resourceTemplates), "结果应挂在 resourceTemplates 键下");
  assert.equal(reply.result.resourceTemplates.length, 1);
  assert.equal(reply.result.resourceTemplates[0].uriTemplate, "socialcoach://scenarios/{name}");
  assert.equal(reply.result.resourceTemplates[0].mimeType, "application/json");
  assert.equal(reply.result.resources, undefined, "模板列表不该挂在 resources 键下");
});

test("resources/read 成功 → contents[0] 含 uri / mimeType / text", async () => {
  const { catalog, calls } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  const reply = await s.handle({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "socialcoach://guide" } });
  assert.equal(reply.error, undefined);
  assert.deepEqual(reply.result.contents, [{ uri: "socialcoach://guide", mimeType: "text/markdown", text: "# hi" }]);
  assert.deepEqual(calls.reads, ["socialcoach://guide"]);
});

test("resources/read 缺 uri → -32602", async () => {
  const { catalog, calls } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  for (const params of [undefined, {}, { uri: "" }]) {
    const reply = await s.handle({ jsonrpc: "2.0", id: 4, method: "resources/read", params });
    assert.equal(reply.error.code, -32602, JSON.stringify(params));
  }
  assert.equal(calls.reads.length, 0, "参数错时不该碰 catalog.read");
});

test("resources/read 的 catalog 抛错 → -32602 且 message 是原错误文本", async () => {
  const { catalog } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  const reply = await s.handle({ jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "socialcoach://nope" } });
  assert.equal(reply.error.code, -32602);
  assert.ok(reply.error.message.includes("unknown resource: socialcoach://nope"), reply.error.message);
});

test("prompts/list 透传 catalog.prompts.list()", async () => {
  const { catalog } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  const reply = await s.handle({ jsonrpc: "2.0", id: 6, method: "prompts/list" });
  assert.equal(reply.result.prompts.length, 1);
  assert.deepEqual(reply.result.prompts[0], {
    name: "debug-repro",
    title: "t",
    description: "d",
    arguments: [{ name: "symptom", description: "d", required: true }],
  });
});

test("prompts/get 成功 → messages 透传且 catalog 收到正确 arguments", async () => {
  const { catalog, calls } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  const reply = await s.handle({
    jsonrpc: "2.0",
    id: 7,
    method: "prompts/get",
    params: { name: "debug-repro", arguments: { symptom: "点保存没反应" } },
  });
  assert.equal(reply.error, undefined);
  assert.equal(reply.result.description, "d");
  assert.deepEqual(reply.result.messages, [{ role: "user", content: { type: "text", text: "repro 点保存没反应" } }]);
  assert.deepEqual(calls.gets, [{ name: "debug-repro", args: { symptom: "点保存没反应" } }]);
});

test("prompts/get 缺 name → -32602", async () => {
  const { catalog, calls } = fakeCatalog();
  const s = server(fakeToolset().toolset, { catalog });
  for (const params of [undefined, {}, { name: "" }]) {
    const reply = await s.handle({ jsonrpc: "2.0", id: 8, method: "prompts/get", params });
    assert.equal(reply.error.code, -32602, JSON.stringify(params));
  }
  assert.equal(calls.gets.length, 0, "参数错时不该碰 catalog.get");
});

test("catalog 为 null 时 resources/list → [], resources/read → -32602（not available）", async () => {
  const s = server(fakeToolset().toolset); // catalog 默认 null
  const list = await s.handle({ jsonrpc: "2.0", id: 9, method: "resources/list" });
  assert.deepEqual(list.result.resources, []);
  const read = await s.handle({ jsonrpc: "2.0", id: 10, method: "resources/read", params: { uri: "socialcoach://guide" } });
  assert.equal(read.error.code, -32602);
  assert.ok(read.error.message.includes("not available"), read.error.message);
});