/**
 * MCP 工具表：把 AI 调试引擎的命令层声明成 MCP 工具（sc_* 前缀）。
 *
 * createToolset({ commands, daemon }) 返回 { list(), call(name, args) }：
 * - list() 只给元数据（name/title/description/inputSchema），不暴露 handler；
 * - call() 永不抛错：成功 {text: 紧凑 JSON, isError:false}，失败 {text, isError:true}，
 *   失败文本带 error.console 内容（最多 5 条）。
 *
 * 路由分两层：浏览器内命令走 daemon.rpc(cmd, args)（常驻守护进程），
 * 文件 / 进程级命令（logs / run / suite / smoke / diff / contracts / record /
 * fixture build / studio）走注入的 commands 层。命令契约见
 * wiki/specs/spec-ai-debug-harness.md §4。
 */

/** dev 噪声：无头 Chrome 下 Next HMR 常被代理/端口策略打断，不代表页面有错。 */
const DEV_NOISE = /_next\/hmr|ERR_INVALID_HTTP_RESPONSE/;

/** 一条事件算不算「要人管」的失败（与 daemon / debug.mjs 同口径）。 */
function isBadEvent(e) {
  const bad = e.kind === "exception" || e.kind === "error" || e.kind === "console.error" || e.kind === "model.missing" || (e.kind === "log" && e.level === "error");
  return bad && !DEV_NOISE.test(String(e.text ?? ""));
}

/** 语义锚点名 → 选择器。命令层没注入 `resolveTarget` 时的兜底；正常路径走 commands.resolveTarget。 */
const ALIASES = {
  "love.input": '[data-debug="love.input"]',
  "love.send": '[data-debug="love.send"]',
  "love.line": '[data-debug="love.line"]',
  "love.options": '[data-debug="love.options"]',
  "love.option-0": '[data-debug="love.option-0"]',
  "love.option-1": '[data-debug="love.option-1"]',
  "love.option-2": '[data-debug="love.option-2"]',
  "love.option-3": '[data-debug="love.option-3"]',
  "practice.input": '[data-debug="practice.input"]',
  "practice.send": '[data-debug="practice.send"]',
  "practice.end": '[data-debug="practice.end"]',
  "practice.messages": '[data-debug="practice.messages"]',
  "practice.mic": '[data-debug="practice.mic"]',
  "dinner.input": '[data-debug="dinner.input"]',
  "dinner.send": '[data-debug="dinner.send"]',
};

function resolveTarget(target) {
  if (typeof target !== "string" || !target) return target;
  return ALIASES[target] ?? target;
}

/** 统计 data-debug 锚点与没有锚点的可交互元素（照 debug.mjs 的 anchors 实现）。 */
const ANCHORS_EXPR = `(() => {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const nodes = Array.from(document.querySelectorAll("button,a,input,textarea,select,[role=button],[role=switch]")).filter(visible);
  const anchors = Array.from(document.querySelectorAll("[data-debug]")).map((el) => el.getAttribute("data-debug"));
  const unlabeled = nodes
    .filter((el) => !el.closest("[data-debug]") && !el.getAttribute("data-debug"))
    .map((el) => ({ tag: el.tagName.toLowerCase(), label: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.type || "").trim().slice(0, 40) }))
    .filter((item) => item.label);
  return { url: location.href, anchors, unlabeled };
})()`;

/** rpc 封装：ok:false 或抛错都转成带 console 的 Error，成功原样返回 payload。 */
async function rpc(daemon, cmd, args = {}, { ensure = true } = {}) {
  // MCP 是「工具本来就在手里」：第一次碰浏览器时自动把守护进程拉起来，
  // 而不是让调用方先记得调 sc_up。sc_doctor 例外——它要如实报告，不去修。
  if (ensure && typeof daemon.session === "function" && !daemon.session()) await daemon.ensure({ serve: true });
  const payload = await daemon.rpc(cmd, args);
  if (!payload || payload.ok === false) {
    const error = new Error(payload?.error?.message ?? `rpc ${cmd} failed`);
    error.console = payload?.console ?? [];
    throw error;
  }
  return payload;
}

/** rpc 返回里的 data（容忍 daemon 直接返回裸数据）。 */
function rpcData(payload) {
  return payload?.data ?? payload ?? {};
}

/** 成功文本的载体：data + 非空 console 事件（观测不靠截图，事件随命令返回）。 */
function summarize(payload) {
  const data = rpcData(payload);
  // data 有时是数组（tab.list、suite 的结果列表）。展开成对象会变成 {"0":…,"1":…}，
  // 对调用方是误导，统一包成 {items:[…]}。
  const out = Array.isArray(data) ? { items: data } : { ...data };
  if (Array.isArray(payload?.console) && payload.console.length) out.console = payload.console;
  return out;
}

/** 失败文本：错误信息 + error.console 最多 5 条。 */
function formatError(error) {
  const lines = [String(error?.message ?? error)];
  const events = Array.isArray(error?.console) ? error.console.slice(-5) : [];
  for (const e of events) {
    const text = typeof e === "string" ? e : e?.text ?? e?.message ?? JSON.stringify(e);
    lines.push(`console: ${String(text ?? "").slice(0, 200)}`);
  }
  return lines.join("\n");
}

/** 结果带着 ok:false（结果对象与 result.data 两级都查）就算失败。 */
function isFailed(result) {
  return Boolean(result && (result.ok === false || result?.data?.ok === false));
}

/** 场景类失败（suite / smoke / run）的失败文本：点出前几个失败项。 */
function failResult(label, result) {
  // suite/smoke 的失败行在 data（数组）；run 的失败行在 data.runs。
  const rows = Array.isArray(result?.data) ? result.data : (result?.data?.runs ?? []);
  const failing = rows.filter((r) => r && r.ok === false).slice(0, 3);
  const detail = failing.map((r) => `${r.name ?? r.run ?? "?"}: ${String(r.error ?? "failed").slice(0, 120)}`).join(" | ");
  return new Error(`${label} failed${detail ? `: ${detail}` : " (ok=false)"}`);
}

export function createToolset({ commands, daemon }) {
  // 命令层已经导出了同一份别名表；优先用它，避免两处 ALIASES 各自漂移。
  const toTarget = (target) => (typeof commands?.resolveTarget === "function" ? commands.resolveTarget(target) : resolveTarget(target));
  // 处理器只在这里注册；list() 永远不暴露它们。
  const handlers = {
    "sc_up": async (args) => summarize(await daemon.ensure({ serve: args.serve ?? true, headless: args.headless ?? true })),
    "sc_down": async () => summarize(await daemon.stop()),
    "sc_doctor": async () => {
      const payload = await rpc(daemon, "doctor", {}, { ensure: false });
      const info = rpcData(payload);
      if (info.server?.ok === false || info.chromeExists === false) {
        const error = new Error(`doctor unhealthy: server.ok=${String(info.server?.ok)} chromeExists=${String(info.chromeExists)} base=${String(info.base ?? "")}`);
        error.console = payload?.console ?? [];
        throw error;
      }
      return summarize(payload);
    },
    // 排查首选：一条命令给全局面，输出量照 debug.mjs 的 why 封顶。
    "sc_why": async () => {
      const [snap, trace] = await Promise.all([rpc(daemon, "snapshot", {}), rpc(daemon, "trace", { clear: false })]);
      const events = rpcData(trace).events ?? [];
      const tail = (kind, n = 8) => events.filter((e) => e.kind === kind).slice(-n);
      const s = rpcData(snap);
      return {
        url: s.url,
        title: s.title,
        ready: s.ready,
        text: String(s.text ?? "").slice(0, 1200),
        state: s.state ?? {},
        interactive: (s.interactive ?? []).slice(0, 40),
        errors: events.filter(isBadEvent).slice(-10),
        model: events.filter((e) => e.kind === "model.replay" || e.kind === "model.missing").slice(-8),
        storage: tail("storage", 10),
        lock: tail("lock", 10),
      };
    },
    "sc_snapshot": async () => summarize(await rpc(daemon, "snapshot", {})),
    "sc_anchors": async (args) => {
      if (args.route !== undefined) await rpc(daemon, "nav", { path: String(args.route), wait: "body" });
      const payload = await rpc(daemon, "eval", { expression: ANCHORS_EXPR });
      return rpcData(payload).value ?? {};
    },
    "sc_eval": async (args) => {
      if (!args.expression) throw new Error("sc_eval needs expression");
      return summarize(await rpc(daemon, "eval", { expression: String(args.expression) }));
    },
    "sc_nav": async (args) => {
      if (!args.path) throw new Error("sc_nav needs path");
      const call = { path: String(args.path) };
      if (args.wait !== undefined) call.wait = String(args.wait);
      return summarize(await rpc(daemon, "nav", call));
    },
    "sc_state": async (args) => {
      const { action } = args;
      if (action === "load") {
        if (!args.fixture) throw new Error("sc_state load needs fixture");
        return summarize(await rpc(daemon, "state.load", { fixture: String(args.fixture) }));
      }
      if (action === "set") {
        if (!args.key) throw new Error("sc_state set needs key");
        return summarize(await rpc(daemon, "state.set", { key: String(args.key), value: args.value }));
      }
      if (action === "clear") return summarize(await rpc(daemon, "state.clear", {}));
      if (action === "dump") {
        const call = {};
        if (args.save !== undefined) call.save = String(args.save);
        return summarize(await rpc(daemon, "state.dump", call));
      }
      throw new Error("sc_state needs action: load|set|clear|dump");
    },
    "sc_click": async (args) => {
      const hasTarget = args.target !== undefined && args.target !== "";
      const hasText = args.text !== undefined && String(args.text) !== "";
      if (!hasTarget && !hasText) throw new Error("sc_click needs target or text");
      const call = { nth: args.nth ?? 0, timeout: args.timeout ?? 15000 };
      if (hasTarget) call.target = toTarget(String(args.target));
      if (hasText) call.text = String(args.text);
      return summarize(await rpc(daemon, "ui.click", call));
    },
    "sc_type": async (args) => {
      if (!args.target) throw new Error("sc_type needs target");
      if (args.text === undefined) throw new Error("sc_type needs text");
      const call = { target: toTarget(String(args.target)), text: String(args.text) };
      if (args.enter !== undefined) call.enter = Boolean(args.enter);
      if (args.submit !== undefined) call.submit = toTarget(String(args.submit));
      return summarize(await rpc(daemon, "ui.type", call));
    },
    "sc_wait": async (args) => {
      if (!args.target) throw new Error("sc_wait needs target");
      const call = { target: toTarget(String(args.target)), timeout: args.timeout ?? 15000 };
      if (args.gone !== undefined) call.gone = Boolean(args.gone);
      if (args.visible !== undefined) call.visible = Boolean(args.visible);
      return summarize(await rpc(daemon, "ui.wait", call));
    },
    "sc_text": async (args) => {
      if (!args.target) throw new Error("sc_text needs target");
      const call = { target: toTarget(String(args.target)) };
      if (args.contains !== undefined) call.contains = String(args.contains);
      if (args.nth !== undefined) call.nth = Number(args.nth);
      return summarize(await rpc(daemon, "ui.text", call));
    },
    "sc_shot": async (args) => {
      const call = {};
      if (args.path !== undefined) call.path = String(args.path);
      if (args.full !== undefined) call.full = Boolean(args.full);
      return summarize(await rpc(daemon, "shot", call));
    },
    "sc_model": async (args) => {
      const { action } = args;
      if (action === "use") {
        const fixtures = Array.isArray(args.fixtures) ? args.fixtures : args.fixtures ? [String(args.fixtures)] : [];
        if (!fixtures.length) throw new Error("sc_model use needs fixtures (array of fixture names)");
        const call = { fixtures: fixtures.map(String) };
        if (args.strict !== undefined) call.strict = Boolean(args.strict);
        return summarize(await rpc(daemon, "model.use", call));
      }
      if (action === "record") {
        if (!args.name) throw new Error("sc_model record needs name");
        return summarize(await rpc(daemon, "model.record", { name: String(args.name) }));
      }
      if (action === "stop") return summarize(await rpc(daemon, "model.stop", {}));
      if (action === "off") return summarize(await rpc(daemon, "model.off", {}));
      throw new Error("sc_model needs action: use|record|stop|off");
    },
    "sc_trace": async (args) => summarize(await rpc(daemon, "trace", { clear: args.clear ?? false })),
    "sc_errors": async () => {
      const payload = await rpc(daemon, "trace", {});
      const bad = (rpcData(payload).events ?? []).filter(isBadEvent);
      return { count: bad.length, errors: bad };
    },
    "sc_logs": async (args) => commands.logs({ file: args.file ?? "all", lines: args.lines ?? 80 }),
    "sc_run": async (args) => {
      if (!args.file) throw new Error("sc_run needs file");
      const result = await commands.runScenario(args.file, { repeat: args.repeat ?? 1 });
      if (isFailed(result)) throw failResult("sc_run", result);
      return result;
    },
    "sc_suite": async (args) => {
      const result = await commands.suite({ all: args.all ?? false });
      if (isFailed(result)) throw failResult("sc_suite", result);
      return result;
    },
    "sc_smoke": async (args) => {
      const routes = Array.isArray(args.routes) && args.routes.length ? args.routes : undefined;
      const result = await commands.smoke(routes);
      if (isFailed(result)) throw failResult("sc_smoke", result);
      return result;
    },
    "sc_diff": async (args) => commands.diff({ save: args.save ?? false, name: args.name ?? "baseline", limit: args.limit ?? 40 }),
    "sc_contracts": async (args) => commands.contracts({ strict: args.strict ?? false }),
    "sc_record": async (args) => {
      if (args.action !== "start" && args.action !== "stop") throw new Error("sc_record needs action: start|stop");
      if (args.action === "start") return args.name ? commands.recordStart(args.name) : commands.recordStart();
      return commands.recordStop();
    },
    "sc_speech": async (args) => {
      const { action } = args;
      if (action === "stub") {
        const call = { lang: args.lang ?? "zh-CN", interim: Boolean(args.interim) };
        if (args.text !== undefined) call.transcript = String(args.text);
        return summarize(await rpc(daemon, "speech.stub", call));
      }
      if (action === "say") {
        if (args.text === undefined || args.text === "") throw new Error("sc_speech say needs text");
        return summarize(await rpc(daemon, "speech.say", { text: String(args.text), delay: Number(args.delay ?? 0), final: args.final ?? true }));
      }
      if (action === "log") return summarize(await rpc(daemon, "speech.log", {}));
      if (action === "off") return summarize(await rpc(daemon, "speech.off", {}));
      throw new Error("sc_speech needs action: stub|say|log|off");
    },
    "sc_tab": async (args) => {
      const { action } = args;
      if (action === "open") {
        if (!args.url) throw new Error("sc_tab open needs url");
        return summarize(await rpc(daemon, "tab.open", { url: String(args.url) }));
      }
      if (action === "list") return summarize(await rpc(daemon, "tab.list", {}));
      if (action === "close" || action === "use") {
        if (!args.id) throw new Error(`sc_tab ${action} needs id (or "last")`);
        return summarize(await rpc(daemon, action === "close" ? "tab.close" : "tab.use", { id: String(args.id) }));
      }
      if (action === "eval") {
        if (!args.id || !args.expression) throw new Error("sc_tab eval needs id and expression");
        return summarize(await rpc(daemon, "tab.eval", { id: String(args.id), expression: String(args.expression) }));
      }
      throw new Error("sc_tab needs action: open|list|close|use|eval");
    },
    "sc_canvas": async (args) => {
      const action = args.action ?? "stats";
      if (action !== "stats") throw new Error("sc_canvas needs action: stats");
      const call = {};
      if (args.ms !== undefined) call.ms = Number(args.ms);
      return summarize(await rpc(daemon, "canvas.stats", call));
    },
    "sc_audio": async (args) => {
      const action = args.action ?? "log";
      if (action === "log") return summarize(await rpc(daemon, "audio.log", {}));
      if (action === "clear") return summarize(await rpc(daemon, "audio.clear", {}));
      throw new Error("sc_audio needs action: log|clear");
    },
    "sc_assert": async (args) => {
      const { kind } = args;
      if (kind === "api") {
        if (!args.route) throw new Error("sc_assert api needs route");
        const call = { route: String(args.route) };
        if (args.method !== undefined) call.method = String(args.method);
        if (args.body !== undefined) call.body = args.body;
        if (args.count !== undefined) call.count = Number(args.count);
        if (args.min !== undefined) call.min = Number(args.min);
        if (args.timeout !== undefined) call.timeout = Number(args.timeout);
        return summarize(await rpc(daemon, "assert.api", call));
      }
      if (kind === "state") {
        const call = { key: args.key !== undefined ? String(args.key) : "socialcoach.v1" };
        if (args.path !== undefined) call.path = String(args.path);
        if (args.equals !== undefined) call.equals = args.equals;
        if (args.contains !== undefined) call.contains = String(args.contains);
        if (args.exists !== undefined) call.exists = Boolean(args.exists);
        if (args.timeout !== undefined) call.timeout = Number(args.timeout);
        return summarize(await rpc(daemon, "assert.state", call));
      }
      if (kind === "count") {
        if (!args.target) throw new Error("sc_assert count needs target");
        const call = { target: toTarget(String(args.target)) };
        if (args.equals !== undefined) call.equals = Number(args.equals);
        if (args.min !== undefined) call.min = Number(args.min);
        if (args.max !== undefined) call.max = Number(args.max);
        if (args.timeout !== undefined) call.timeout = Number(args.timeout);
        return summarize(await rpc(daemon, "assert.count", call));
      }
      throw new Error("sc_assert needs kind: api|state|count");
    },
    "sc_fixture_build": async (args) => {
      if (!args.file) throw new Error("sc_fixture_build needs file");
      return commands.fixtureBuild(args.file);
    },
    "sc_fixture_probe": async (args) => {
      const names = args.fixtures ?? args.name;
      if (!names) throw new Error("sc_fixture_probe needs fixtures");
      return commands.fixtureProbe(names, { url: args.url ?? "/" });
    },
    "sc_report": async (args) => {
      switch (args.kind) {
        case "coverage": return commands.coverage();
        case "triage": return commands.triage({ limit: args.limit ?? 20 });
        case "bundle": return commands.whyBundle(args.dir ?? null);
        default: throw new Error("sc_report needs kind: coverage|triage|bundle");
      }
    },
    "sc_studio": async (args) => {
      switch (args.action) {
        case "up": return commands.studioUp();
        case "seed": return args.card ? commands.studioSeed(args.card) : commands.studioSeed();
        case "down": return commands.studioDown();
        case "status": return commands.studioStatus();
        case "byok": return commands.studioByok({
          apiType: args.apiType ?? "openai",
          baseUrl: args.baseUrl ?? null,
          model: args.model ?? "",
          keyEnv: args.keyEnv ?? "STUDIO_BYOK_KEY",
        });
        default: throw new Error("sc_studio needs action: up|seed|down|status|byok");
      }
    },
  };

  return {
    list() {
      return TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
    },
    async call(name, args = {}) {
      const handler = handlers[name];
      if (!handler) return { text: `unknown tool: ${name}`, isError: true };
      try {
        return { text: JSON.stringify((await handler(args)) ?? {}), isError: false };
      } catch (error) {
        return { text: formatError(error), isError: true };
      }
    },
  };
}

/** 工具元数据：名字固定（32 个，全 sc_ 前缀），与 spec §4 命令表一一对应。 */
const TOOLS = [
  { name: "sc_up", title: "启动调试环境",
    description: "启动（或复用）调试守护进程，可选顺带拉起 dev server。开始排查前先调它；返回 base / Chrome / pid 等会话信息。",
    inputSchema: { type: "object", properties: { serve: { type: "boolean", default: true, description: "顺带拉起 pnpm dev" }, headless: { type: "boolean", default: true, description: "无头模式" } }, required: [] } },
  { name: "sc_down", title: "关闭调试环境",
    description: "关闭调试守护进程：关 Chrome、关它拉起的 dev server、清理会话文件。收尾或重开环境时用；返回停机结果。",
    inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "sc_doctor", title: "环境体检",
    description: "体检守护进程：Node / Chrome / base / server 可达性 / 当前模型夹具模式。确认环境可用时用；server 不可达或找不到 Chrome 时报错。",
    inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "sc_why", title: "全局面诊断",
    description: "排查首选，一条命令给全局面：url / 可见文本 / 可交互元素 / 错误 / 模型回放 / storage 写入 / lock。输出量已封顶；看完再决定要不要 eval 或 trace 深挖。",
    inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "sc_snapshot", title: "语义快照",
    description: "语义快照（不截图）：url / title / ready / 可见文本 / data-debug 锚点与可交互元素状态。想知道页面当前长什么样时用。",
    inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "sc_anchors", title: "锚点清单",
    description: "列出当前页（给 route 则先导航过去）的 data-debug 锚点与没有锚点的可交互元素（unlabeled 即待补锚点清单）。AI 找不到按钮时先用它。",
    inputSchema: { type: "object", properties: { route: { type: "string", description: "先导航到的路由，不带前导斜杠" } }, required: [] } },
  { name: "sc_eval", title: "页面求值",
    description: "在页面里执行 JS 表达式并返回求值结果。语义命令覆盖不了时才用（比如直接读某段 DOM）；只给表达式本身。",
    inputSchema: { type: "object", properties: { expression: { type: "string", description: "在页面执行的 JS 表达式" } }, required: ["expression"] } },
  { name: "sc_nav", title: "导航",
    description: "导航到路由并等页面就绪；wait 给选择器时再等该元素出现。跑场景前先 sc_state 装好状态再导航；路由不带前导斜杠。",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "路由，如 love/play/love-approach-cafe（不带前导斜杠）" }, wait: { type: "string", description: "可选选择器，给了就再等它出现，如 [data-debug=\"love.options\"]" } }, required: ["path"] } },
  { name: "sc_state", title: "状态读写",
    description: "读写页面 localStorage 状态：load 载入夹具（先清 socialcoach* 键，干净起点）、set 写单键、clear 全清、dump 导出当前存档（save 给名字可落成夹具）。跑场景前先 load。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["load", "set", "clear", "dump"], description: "要做的操作" }, fixture: { type: "string", description: "load 用的夹具名（debug/fixtures/states/）" }, key: { type: "string", description: "set 用的键" }, value: { type: ["string", "number", "boolean", "object", "array"], description: "set 用的值（对象会 stringify）" }, save: { type: "string", description: "dump 给名字则把当前存档落成夹具" } }, required: ["action"] } },
  { name: "sc_click", title: "点击",
    description: "点击元素。优先用 target（data-debug 锚点名，稳定不随文案变，如 love.option-0）；没有锚点才用 text 按可见文字找。两者都缺会报参数错。",
    inputSchema: { type: "object", properties: { target: { type: "string", description: "data-debug 锚点名（优先）或 CSS 选择器" }, text: { type: "string", description: "可见文字 / aria-label，锚点缺失时才用" }, nth: { type: "integer", default: 0, minimum: 0, description: "同选择器命中多个时取第几个" }, timeout: { type: "integer", default: 15000, description: "等可点击的超时（ms）" } }, required: [] } },
  { name: "sc_type", title: "输入文字",
    description: "向输入框写入文字（会先等可输入）；enter 触发回车，submit 给锚点则在输入后点提交按钮。输入内容与 target 都必填。",
    inputSchema: { type: "object", properties: { target: { type: "string", description: "输入框的 data-debug 锚点名，如 practice.input / dinner.input" }, text: { type: "string", description: "要写入的文字" }, enter: { type: "boolean", default: false, description: "写完触发回车" }, submit: { type: "string", description: "提交按钮锚点名，写完点它" } }, required: ["target", "text"] } },
  { name: "sc_wait", title: "等待元素",
    description: "等元素出现（默认）/ 消失（gone）/ 可见（visible），超时报错。页面异步渲染、动画过渡后需要等时机时用。",
    inputSchema: { type: "object", properties: { target: { type: "string", description: "data-debug 锚点名或选择器" }, gone: { type: "boolean", default: false, description: "等它消失" }, visible: { type: "boolean", default: false, description: "等它可见" }, timeout: { type: "integer", default: 15000, description: "超时（ms）" } }, required: ["target"] } },
  { name: "sc_text", title: "读取文本",
    description: "读元素文本（输入框返回 value）；contains 给定时先等该文本出现再返回。验证 NPC 反馈 / 页面文案时用。",
    inputSchema: { type: "object", properties: { target: { type: "string", description: "data-debug 锚点名或选择器" }, contains: { type: "string", description: "可选：先等这个片段出现再读" }, nth: { type: "integer", default: 0, minimum: 0, description: "同选择器命中多个时取第几个" } }, required: ["target"] } },
  { name: "sc_shot", title: "截图",
    description: "截图存到 .debug/shots/（或 path 指定位置）。只在确实需要看画面时用；语义信息优先 snapshot / why，截图又慢又占上下文。",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "保存路径（相对 app/）" }, full: { type: "boolean", default: false, description: "整页截图" } }, required: [] } },
  { name: "sc_model", title: "模型夹具",
    description: "模型夹具控制：use 开启 Fetch 拦截离线回放，必须给 fixtures 数组（如 [\"love-flow\"]）；record 透传真实模型并录制；stop 录制落盘；off 关闭拦截清空夹具。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["use", "record", "stop", "off"], description: "要做的操作" }, fixtures: { type: "array", items: { type: "string" }, description: "夹具名列表（debug/fixtures/models/*.json）；use 必填" }, name: { type: "string", description: "record 时的夹具名" }, strict: { type: "boolean", default: false, description: "strict 模式：没配夹具的路由回 503" } }, required: ["action"] } },
  { name: "sc_trace", title: "事件缓冲",
    description: "读页面事件环形缓冲（fetch / console.error / error / rejection / model.replay / model.missing / storage / lock）。why 不够细时用它看原始事件；clear 清空缓冲。",
    inputSchema: { type: "object", properties: { clear: { type: "boolean", default: false, description: "读完同时清空缓冲" } }, required: [] } },
  { name: "sc_errors", title: "错误事件",
    description: "只挑异常 / 错误 / model.missing 事件并计数。改完代码快速确认页面没有新错误时用。",
    inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "sc_logs", title: "服务日志",
    description: "读守护进程自己拉起的服务日志（next dev / daemon / studio 前后端）。rpc 报错且信息不足时看 daemon 日志定位。",
    inputSchema: { type: "object", properties: { file: { type: "string", enum: ["next", "daemon", "studioBackend", "studioFrontend", "all"], default: "all", description: "读哪个服务" }, lines: { type: "integer", default: 80, minimum: 1, description: "读末尾多少行" } }, required: [] } },
  { name: "sc_run", title: "跑场景",
    description: "顺序执行场景 JSON（含 state.load / model.use / nav / ui.* / assert.*），失败即停并报第几步。跑之前先 sc_state + sc_model 就位（或场景自己带）；repeat≥2 抓不稳定。",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "场景文件路径（相对 app/，如 debug/scenarios/love-happy.json）" }, repeat: { type: "integer", default: 1, minimum: 1, description: "连跑次数，抓不稳定" } }, required: ["file"] } },
  { name: "sc_suite", title: "场景套件",
    description: "跑 debug/scenarios/ 下全部场景；requires 外部依赖（如 studio 缺 venv）时跳过。改代码后回归用；任何场景失败报错。",
    inputSchema: { type: "object", properties: { all: { type: "boolean", default: false, description: "连 requires 的场景也强制跑" } }, required: [] } },
  { name: "sc_smoke", title: "路由冒烟",
    description: "逐路由冒烟：无应用错误文案、body 有内容、无控制台错误。routes 省略跑默认路由；任何路由失败报错。",
    inputSchema: { type: "object", properties: { routes: { type: "array", items: { type: "string" }, description: "路由列表；省略跑默认列表" } }, required: [] } },
  { name: "sc_diff", title: "快照对比",
    description: "与语义快照基线对比，只输出变化的文本行 / 可交互元素 / 存档键。改样式文案前先 save=true 存基线，改完再跑对比。",
    inputSchema: { type: "object", properties: { save: { type: "boolean", default: false, description: "把当前快照存成基线" }, name: { type: "string", default: "baseline", description: "基线名" }, limit: { type: "integer", default: 40, minimum: 1, description: "最多输出的变化条数" } }, required: [] } },
  { name: "sc_contracts", title: "接口契约巡检",
    description: "对账真实 API 路由与模型夹具键：covered / missing（不能离线回放）/ unknown（拼错）。新接口上线后用；strict 时缺失即报错。",
    inputSchema: { type: "object", properties: { strict: { type: "boolean", default: false, description: "静态路由没夹具就算失败（门禁）" } }, required: [] } },
  { name: "sc_record", title: "录制场景",
    description: "录制：人点一遍页面，落成可回放场景骨架。start 后正常操作页面，stop 合并写 debug/scenarios/<name>.json；回放前自己补断言，录制不自动加。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["start", "stop"], description: "开始或结束录制" }, name: { type: "string", description: "场景名（start 时给）" } }, required: ["action"] } },
  { name: "sc_speech", title: "假语音识别",
    description: "假 SpeechRecognition：stub 注入桩（lang / interim，text 可预排一条），say 排一条转写（delay / final），log 看计数，off 撤掉。语音输入链路测试用。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["stub", "say", "log", "off"], description: "要做的操作" }, text: { type: "string", description: "stub 的预排转写 / say 的转写内容" }, delay: { type: "integer", default: 0, minimum: 0, description: "say 的延迟（ms）" }, final: { type: "boolean", default: true, description: "say 是否为最终结果" }, lang: { type: "string", default: "zh-CN", description: "stub 的语言" }, interim: { type: "boolean", default: false, description: "stub 是否支持中间结果" } }, required: ["action"] } },
  { name: "sc_tab", title: "多标签页",
    description: "多标签页：open 新开同源标签、list 列出、use / close 激活或关闭（id 可传 last）、eval 在指定标签页求值。测「另一窗口改存档」这类冲突。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["open", "list", "close", "use", "eval"], description: "要做的操作" }, url: { type: "string", description: "open 的 URL" }, id: { type: "string", description: "目标标签页 id；最近打开的可用 last" }, expression: { type: "string", description: "eval 的 JS 表达式" } }, required: ["action"] } },
  { name: "sc_canvas", title: "Canvas 渲染观测",
    description: "观测 WebGL canvas 渲染活动：采样窗口（ms，默认 1000）内累计的 rAF 帧数与绘制调用次数（含每秒换算），并列出各 canvas 尺寸与上下文类型（webgl / webgl2 / 2d）。要证明 3D 场景真的在渲染而不是只显示文案时用；统计来自引擎侧注入的 window.__scCanvas，生产代码无调试入口。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["stats"], default: "stats", description: "要做的操作" }, ms: { type: "integer", default: 1000, minimum: 0, description: "采样窗口（ms）：先取基线、等窗口、再取一次" } }, required: [] } },
  { name: "sc_audio", title: "音频播放观测",
    description: "观测页面音频播放入口：log 返回媒体元素 play/pause 与 src 快照、new Audio() 构造列表、WebAudio（decodeAudioData 次数 / createBuffer 参数 / AudioBufferSourceNode.start 次数）；clear 清空统计。验证 TTS 链路（/api/speech → PCM → WebAudio buffer）真的播了时用；统计来自引擎侧注入的 window.__scAudio，生产代码无调试入口。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["log", "clear"], default: "log", description: "要做的操作" } }, required: [] } },
  { name: "sc_assert", title: "断言",
    description: "三种断言原语：api 断言应用真正发出的请求（route/method 过滤，count 精确 / min 至少，body 对最后一条匹配请求体做部分匹配）；state 断言 localStorage 里的状态（key/path 取值，exists/equals/contains）；count 断言选择器命中的元素数量（equals/min/max）。请求与状态断言带轮询超时；只在模型夹具回放/录制模式下能断言请求。",
    inputSchema: { type: "object", properties: {
      kind: { type: "string", enum: ["api", "state", "count"], description: "断言类型" },
      route: { type: "string", description: "api 的路由，如 roleplay / hint（不带 /api/ 前缀）" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "api 的 HTTP 方法（可选）" },
      body: { type: ["object", "array", "string", "boolean", "number"], description: "api 请求体：对象只要求给出的键存在且匹配（部分匹配）；请求体不是 JSON 时退化为字符串包含" },
      count: { type: "integer", minimum: 0, description: "api 的精确请求次数；count 断言的元素精确数量" },
      min: { type: "integer", minimum: 0, description: "api 的最少请求次数；count 断言的最少元素数量" },
      max: { type: "integer", minimum: 0, description: "count 断言的最多元素数量" },
      key: { type: "string", default: "socialcoach.v1", description: "state 的 localStorage 键" },
      path: { type: "string", description: "state 取值路径，如 state.settings.tts / messages.0.role" },
      equals: { type: ["object", "array", "string", "boolean", "number"], description: "state 期望值（部分匹配）" },
      contains: { type: "string", description: "state 值应包含的字符串" },
      exists: { type: "boolean", default: true, description: "state 值是否应存在（false = 断言缺席）" },
      target: { type: "string", description: "count 的选择器（data-debug 锚点名或 CSS 选择器）" },
      timeout: { type: "integer", default: 5000, minimum: 0, description: "轮询超时（ms）" },
    }, required: ["kind"] } },
  { name: "sc_report", title: "离线报告：覆盖 / 分诊 / 失败包",
    description: "不碰浏览器：kind=coverage 扫「代码里的 data-debug 锚点 vs 场景引用」与「夹具路由 vs 场景用到」；kind=triage 把 .debug/failures 按签名聚合并给出下一步命令；kind=bundle 读指定（或最近）失败包，返回分类、证据、排序假设。",
    inputSchema: { type: "object", properties: {
      kind: { type: "string", enum: ["coverage", "triage", "bundle"], description: "报告类型" },
      limit: { type: "integer", default: 20, minimum: 1, description: "triage 只看最近 N 个失败包" },
      dir: { type: "string", description: "bundle 的失败包目录（省略取最近一个）" },
    }, required: ["kind"] } },
  { name: "sc_fixture_build", title: "生成模型夹具",
    description: "把「人写的一回合」spec JSON（debug/fixtures/specs/）编译成模型夹具，自动拼 @@meta / @@final 协议。不用手写转义。",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "spec 文件路径（相对 app/）" } }, required: ["file"] } },
  { name: "sc_fixture_probe", title: "夹具自检",
    description: "装上夹具，按夹具里的 probes 逐条真发一次请求，验证请求被拦到、响应状态与形状对。「文件存在」不等于「回放可用」；但这一步只证明回放链路，不证明 UI 接线（UI 用 sc_run 跑场景）。",
    inputSchema: { type: "object", properties: { fixtures: { type: "string", description: "夹具名，多个用逗号分隔" }, url: { type: "string", description: "在哪个页面探测，默认 /" } }, required: ["fixtures"] } },
  { name: "sc_studio", title: "Love Studio 控制",
    description: "Love Studio（独立运行时，不经浏览器）：up 起后端+前端、seed 种 SQLite 数据（card 指定角色卡）、status 查可达性、down 杀掉自己起的进程、byok 真实模型验证（建临时连接 → 发一句 → 断言回复 → 删连接；key 只从环境变量读，没有就返回 skipped）。Studio 场景前用。",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["up", "seed", "down", "status", "byok"], description: "要做的操作" }, card: { type: "string", description: "seed 的角色卡名" }, apiType: { type: "string", description: "byok 的 provider 类型，默认 openai；mock 可自检" }, model: { type: "string", description: "byok 的模型名（真实 provider 必填）" }, baseUrl: { type: "string", description: "byok 的 base_url" }, keyEnv: { type: "string", description: "读 key 的环境变量名，默认 STUDIO_BYOK_KEY" } }, required: ["action"] } },
];