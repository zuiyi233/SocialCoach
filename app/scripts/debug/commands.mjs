/**
 * debug CLI 的命令实现：与守护进程通信或读写文件，但不 print、不设 exitCode。
 * 语义与重构前的 scripts/debug.mjs 完全一致；打印与退出码判断由调用方负责。
 * 供 scripts/debug.mjs 与未来 MCP 层共用。
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { auditContracts } from "./api-contracts.mjs";
import { buildFromFile, loadFixture } from "./fixture-build.mjs";
import { diffSnapshots } from "./snapshot-diff.mjs";
import { aggregateCoverage, formatCoverage, scanAnchors, scanScenarios } from "./coverage.mjs";
import { describeDivergence, firstDivergence, flakeSummary } from "./flake.mjs";
import { mergeIntoScenario, suggestAssertions } from "./record-suggest.mjs";
import { classifyFailure, formatBundle, formatTriage, hypotheses, readBundle, summarizeBundles } from "./triage.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 与 daemon 同口径的 dev 噪声过滤；debug.mjs 里也有一份，改动要同步。 */
const DEV_NOISE = /_next\/hmr|ERR_INVALID_HTTP_RESPONSE/;

export function createCommands({ appRoot, debugRoot, daemon }) {
  const repoRoot = resolve(appRoot, "..");
  const studioRoot = join(repoRoot, "love-studio");
  const studioBackend = join(studioRoot, "AnimaBackend");
  const studioFrontend = join(studioRoot, "frontend");
  const studioSessionFile = join(debugRoot, "studio.json");

  /** 语义选择器别名：AI 不需要知道 DOM 结构，只需要知道控件名字。 */
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
    "practice.message": '[data-debug="practice.message"]',
    "practice.mic": '[data-debug="practice.mic"]',
    "dinner.input": '[data-debug="dinner.input"]',
    "dinner.send": '[data-debug="dinner.send"]',
    // Studio 是独立运行时（:5180），锚点名与主站同规则，便于场景共用一套写法。
    "studio.composer": '[data-debug="studio.composer"]',
    "studio.send": '[data-debug="studio.send"]',
    "studio.stop": '[data-debug="studio.stop"]',
    "studio.regenerate": '[data-debug="studio.regenerate"]',
    "studio.newChat": '[data-debug="studio.newChat"]',
    "studio.cardList": '[data-debug="studio.cardList"]',
    "studio.card": '[data-debug="studio.card"]',
    "studio.creatorTab": '[data-debug="studio.creatorTab"]',
    "studio.modelSelect": '[data-debug="studio.modelSelect"]',
    "studio.save": '[data-debug="studio.save"]',
    "studio.lastReply": '[data-debug="studio.lastReply"]',
  };

  function resolveTarget(target) {
    if (!target) return target;
    return ALIASES[target] ?? target;
  }

  // ── Love Studio（独立运行时：FastAPI :8000 + Vite :5180）────────────────

  function studioPython() {
    const path = join(studioRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    if (!existsSync(path)) throw new Error(`Studio venv not found: ${path}. Run love-studio/start.bat once.`);
    return path;
  }

  /** 场景声明的外部依赖是否具备。目前只有 studio；未知依赖一律当不满足。 */
  function requirementMet(requires) {
    const list = Array.isArray(requires) ? requires : [requires];
    return list.every((item) => {
      if (item !== "studio") return false;
      try { return existsSync(studioPython()); } catch { return false; }
    });
  }

  async function reachableUrl(url, timeout = 2500) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function waitForUrl(url, timeout, label) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await reachableUrl(url)) return true;
      await sleep(500);
    }
    throw new Error(`${label} did not become ready within ${timeout}ms: ${url}`);
  }

  function readStudioSession() {
    try {
      return JSON.parse(readFileSync(studioSessionFile, "utf8"));
    } catch {
      return {};
    }
  }

  function killTree(pid) {
    if (!pid) return;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-pid, "SIGKILL");
    } catch {}
  }

  /** Studio 的状态在 SQLite，不在 localStorage；这个函数就是它的 state.load。 */
  function studioSeed(card, { reset = false } = {}) {
    const python = studioPython();
    const args = ["-m", "app.debug_seed", card ?? "genshin-ganyu"];
    // 场景必须可重跑：不重置的话上一轮的对话留在 SQLite 里，
    // 断言会被旧消息命中，看着绿其实这一轮什么都没发出去。
    if (reset) args.push("--reset");
    const out = execFileSync(python, args, {
      cwd: studioBackend,
      encoding: "utf8",
      timeout: 300000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`studio seed returned no JSON:\n${out.slice(-2000)}`);
    }
  }

  /**
   * Studio 真实 BYOK 验证：建一条临时连接 → 发一句话 → 断言回复非空 → 删掉连接。
   * 没有 key 时明确 skipped（不伪装成通过）；`apiType: "mock"` 可以自检这套流程本身。
   * key 只从环境变量读，不落盘、不进日志、不写进返回值。
   */
  async function studioByok({
    apiType = "openai",
    baseUrl = null,
    model = "",
    keyEnv = "STUDIO_BYOK_KEY",
    prompt = "只回复两个字：收到",
  } = {}) {
    const api = "http://127.0.0.1:8000";
    const isMock = apiType === "mock";
    const key = isMock ? null : String(process.env[keyEnv] ?? "").trim();
    if (!isMock && !key) {
      return {
        skipped: true,
        apiType,
        reason: `环境里没有 ${keyEnv}。真实 BYOK 必须由你提供 key：export ${keyEnv}=<key> 后再跑同一条命令；不需要重新改代码。`,
      };
    }
    if (!isMock && !model) throw new Error("studio byok needs --model=<name> for a real provider");

    const call = async (path, init) => {
      const res = await fetch(`${api}${path}`, init);
      const text = await res.text();
      if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    };

    const name = `调试 BYOK ${new Date().toISOString().slice(0, 19)}`;
    const created = await call("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, api_type: apiType, base_url: baseUrl, api_key: key, model, stream: false }),
    });
    try {
      const started = Date.now();
      const result = await call(`/api/connections/${created.id}/test-message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: prompt }),
      });
      const reply = String(result?.reply ?? "");
      if (!reply.trim()) throw new Error("BYOK 回复为空：连接建起来了，但 provider 没返回内容");
      if (!isMock && /mock/i.test(reply)) throw new Error("回复里出现 mock：可能连到了假 provider");
      return { skipped: false, apiType, model: model || "(mock)", ms: Date.now() - started, reply: reply.slice(0, 400) };
    } finally {
      // 临时连接必须删掉：不留 key、不污染用户的连接列表。
      await fetch(`${api}/api/connections/${created.id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  async function studioStatus() {
    const session = readStudioSession();
    const frontend = await reachableUrl("http://127.0.0.1:5180/api/health");
    const backend = await reachableUrl("http://127.0.0.1:8000/api/health");
    const db = join(studioBackend, "data", "animabackend.db");
    return {
      frontend: { url: "http://127.0.0.1:5180/debug.html", up: frontend },
      backend: { url: "http://127.0.0.1:8000", up: backend },
      db: { path: db, exists: existsSync(db) },
      started: session,
    };
  }

  async function studioUp() {
    mkdirSync(debugRoot, { recursive: true });
    const session = readStudioSession();
    const started = { ...session };

    if (!(await reachableUrl("http://127.0.0.1:8000/api/health"))) {
      const python = studioPython();
      const logFd = openSync(join(debugRoot, "studio-backend.log"), "a");
      const child = spawn(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], {
        cwd: studioBackend,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", logFd, logFd],
      });
      child.unref();
      started.backendPid = child.pid;
      await waitForUrl("http://127.0.0.1:8000/api/health", 90000, "Studio backend");
    }

    if (!(await reachableUrl("http://127.0.0.1:5180/api/health"))) {
      const logFd = openSync(join(debugRoot, "studio-frontend.log"), "a");
      // Windows 上 npm 是 .cmd：Node 24 不允许直接 spawn（EINVAL），而 shell:true 会触发
      // DEP0190 并把告警打到 stdout。显式走 cmd.exe /c，两边都避开。
      const child = process.platform === "win32"
        ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
            cwd: studioFrontend,
            detached: true,
            windowsHide: true,
            stdio: ["ignore", logFd, logFd],
            env: { ...process.env, STUDIO_PORT: "5180" },
          })
        : spawn("npm", ["run", "dev"], {
            cwd: studioFrontend,
            detached: true,
            windowsHide: true,
            stdio: ["ignore", logFd, logFd],
            env: { ...process.env, STUDIO_PORT: "5180" },
          });
      child.unref();
      started.frontendPid = child.pid;
      await waitForUrl("http://127.0.0.1:5180/api/health", 120000, "Studio frontend");
    }

    started.startedAt = started.startedAt ?? Date.now();
    writeFileSync(studioSessionFile, `${JSON.stringify(started, null, 2)}\n`);
    return { ...(await studioStatus()), started };
  }

  function studioDown() {
    const session = readStudioSession();
    const killed = [];
    for (const key of ["frontendPid", "backendPid"]) {
      if (session[key]) {
        killTree(session[key]);
        killed.push({ key, pid: session[key] });
      }
    }
    rmSync(studioSessionFile, { force: true });
    return { down: true, killed };
  }

  // ── 失败包：报告 + trace + 语义快照 + HTML + 截图，一次落盘。 ────────────

  async function saveFailureBundle(scenario, file, results, error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = join(debugRoot, "failures", stamp);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "report.json"),
      `${JSON.stringify({ scenario: scenario.name ?? file, file, error: String(error?.message ?? error), results }, null, 2)}\n`,
    );
    try {
      const trace = await daemon.rpc("trace", { clear: false });
      writeFileSync(join(dir, "trace.json"), `${JSON.stringify(trace.data, null, 2)}\n`);
      const snapshot = await daemon.rpc("snapshot", {});
      writeFileSync(join(dir, "snapshot.json"), `${JSON.stringify(snapshot.data, null, 2)}\n`);
      const html = await daemon.rpc("eval", { expression: "document.documentElement.outerHTML" });
      writeFileSync(join(dir, "page.html"), String(html.data.value ?? ""));
      await daemon.rpc("shot", { path: join(dir, "screen.png") });
    } catch {}
    return dir;
  }

  /** 跑单个场景文件；任一 step 失败即抛错（带 results / scenario / ms / bundle 属性）。 */
  async function runScenarioFile(file) {
    const path = resolve(appRoot, file);
    if (!existsSync(path)) throw new Error(`scenario not found: ${path}`);
    const scenario = JSON.parse(readFileSync(path, "utf8"));
    const steps = scenario.steps ?? [];
    const results = [];
    const started = Date.now();
    // trace 存在 sessionStorage，跨导航不清：不清掉的话，上一轮手工浏览留下的控制台错误
    // 会被这一轮的 assert.noErrors 抓到，看起来像场景自己失败。
    try { await daemon.rpc("trace.clear", {}); } catch {}
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepStarted = Date.now();
      const row = { index: i, cmd: step.cmd, ok: false, ms: 0 };
      try {
        if (step.cmd === "assert.text") {
          const data = await daemon.rpc("ui.text", { target: resolveTarget(step.target), nth: step.nth ?? 0, contains: step.contains ?? null, timeout: step.timeout ?? 15000 });
          if (step.contains && !String(data.data.text).includes(step.contains)) throw new Error(`text does not contain ${JSON.stringify(step.contains)}: ${JSON.stringify(String(data.data.text).slice(0, 200))}`);
          row.data = data.data;
        } else if (step.cmd === "assert.exists") {
          const data = await daemon.rpc("ui.exists", { target: resolveTarget(step.target) });
          if (!data.data.exists) throw new Error(`missing: ${step.target}`);
          row.data = data.data;
        } else if (step.cmd === "assert.gone") {
          const data = await daemon.rpc("ui.exists", { target: resolveTarget(step.target) });
          if (data.data.exists) throw new Error(`still present: ${step.target}`);
          row.data = data.data;
        } else if (step.cmd === "assert.noErrors") {
          const data = await daemon.rpc("trace", { clear: false });
          // 场景可以声明自己预期内的噪声（`ignore` 正则，字符串或数组）。
          // 全局过滤只留真正的环境噪声，其余必须在场景里写明理由。
          const ignore = (Array.isArray(step.ignore) ? step.ignore : step.ignore ? [step.ignore] : []).map((pattern) => new RegExp(pattern));
          const raw = data.data.events.filter(
            (e) =>
              (e.kind === "exception" || e.kind === "error" || e.kind === "console.error") &&
              !DEV_NOISE.test(String(e.text ?? "")),
          );
          const ignored = raw.filter((e) => ignore.some((pattern) => pattern.test(String(e.text ?? ""))));
          const bad = raw.filter((e) => !ignore.some((pattern) => pattern.test(String(e.text ?? ""))));
          if (bad.length) throw new Error(`console errors: ${bad.map((e) => e.text).join(" | ").slice(0, 500)}`);
          row.data = { errors: 0, ignored: ignored.length };
        } else if (step.cmd === "assert.trace") {
          const data = await daemon.rpc("trace", { clear: false });
          const match = data.data.events.find((e) => (!step.kind || e.kind === step.kind) && (!step.contains || String(e.text ?? e.body ?? e.url ?? e.route ?? "").includes(step.contains)));
          if (!match) throw new Error(`trace event not found: ${JSON.stringify({ kind: step.kind, contains: step.contains })}`);
          row.data = match;
        } else if (step.cmd === "assert.audio") {
          // 断言音频观测统计：mediaPlays / mediaPauses / audioConstructed /
          // decode / buffers / sourcesStarted 达到阈值（默认 10s 内轮询，
          // 因为 TTS 在整句流式回复结束后才开播）。不给任何阈值 = 至少有一种
          // 播放活动被记录。
          const until = Date.now() + (step.timeout ?? 10000);
          let counts = null;
          let problems = [];
          for (;;) {
            const data = await daemon.rpc("audio.log", {});
            const log = data.data;
            counts = {
              mediaPlays: Number(log?.media?.plays ?? 0),
              mediaPauses: Number(log?.media?.pauses ?? 0),
              audioConstructed: Array.isArray(log?.audio?.constructed) ? log.audio.constructed.length : 0,
              decode: Number(log?.webaudio?.decode ?? 0),
              buffers: Array.isArray(log?.webaudio?.buffers) ? log.webaudio.buffers.length : 0,
              sourcesStarted: Number(log?.webaudio?.sourcesStarted ?? 0),
            };
            problems = [];
            for (const [key, min] of Object.entries(step)) {
              if (key === "cmd" || key === "timeout" || !(key in counts)) continue;
              if (counts[key] < Number(min)) problems.push(`${key} ${counts[key]} < ${min}`);
            }
            if (problems.length === 0 && !Object.keys(step).some((k) => k !== "cmd" && k !== "timeout" && k in counts)) {
              if (counts.mediaPlays + counts.audioConstructed + counts.buffers + counts.sourcesStarted === 0) {
                problems.push("no audio activity recorded (media play / new Audio() / WebAudio)");
              }
            }
            if (problems.length === 0 || Date.now() >= until) break;
            await sleep(120);
          }
          if (problems.length) throw new Error(`audio assert failed: ${problems.join("; ")}`);
          row.data = counts;
        } else if (step.cmd === "studio.seed" || step.cmd === "studio.up" || step.cmd === "studio.down" || step.cmd === "studio.status") {
          // Studio 的启停与 SQLite 种子不经过浏览器，直接在 CLI 侧执行。
          if (step.cmd === "studio.seed") row.data = studioSeed(step.card, { reset: step.reset === true });
          else if (step.cmd === "studio.up") row.data = await studioUp();
          else if (step.cmd === "studio.down") row.data = studioDown();
          else row.data = await studioStatus();
        } else {
          const args = { ...step };
          delete args.cmd;
          if (args.target) args.target = resolveTarget(args.target);
          if (args.submit) args.submit = resolveTarget(args.submit);
          const data = await daemon.rpc(step.cmd, args);
          row.data = data.data;
        }
        row.ok = true;
      } catch (error) {
        row.error = String(error.message ?? error);
        row.console = error.console ?? [];
        row.ms = Date.now() - stepStarted;
        results.push(row);
        // 失败包：报告 + trace + 语义快照 + HTML + 截图，一次落盘，事后不用重跑。
        let bundle = null;
        try {
          bundle = await saveFailureBundle(scenario, file, results, error);
        } catch {}
        throw Object.assign(
          new Error(`step ${i} (${step.cmd}) failed: ${row.error}${bundle ? `\n--- failure bundle: ${bundle}` : ""}`),
          { results, scenario: scenario.name, ms: Date.now() - started, bundle },
        );
      }
      row.ms = Date.now() - stepStarted;
      results.push(row);
    }
    return { name: scenario.name ?? file, ok: true, ms: Date.now() - started, steps: results };
  }

  // ── 对外命令 ─────────────────────────────────────────────────────────────

  /** 跑场景（含 --repeat 循环与失败包）；失败时在 error.results 上带步骤明细。 */
  async function runScenario(file, { repeat = 1 } = {}) {
    const runs = [];
    for (let i = 0; i < Math.max(1, repeat); i += 1) {
      try {
        runs.push({ run: i + 1, ...(await runScenarioFile(file)) });
      } catch (error) {
        runs.push({ run: i + 1, ok: false, error: String(error.message ?? error), steps: error.results ?? [] });
        break;
      }
    }
    const ok = runs.every((r) => r.ok);
    const data = { repeat: Math.max(1, repeat), passed: runs.filter((r) => r.ok).length, runs };
    // 多轮才有「分叉」可言：同一场景两次结果不同，比「两次都红」更难查。
    if (runs.length > 1) {
      data.divergence = firstDivergence(runs);
      data.flake = flakeSummary(runs);
      if (!data.divergence.stable) data.divergenceText = describeDivergence(data.divergence, { file });
    }
    return { ok, data };
  }

  /** 最近一个失败包目录（按时间戳名字排序取最后）。 */
  function latestFailureDir() {
    const root = join(debugRoot, "failures");
    if (!existsSync(root)) return null;
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return names.length ? join(root, names[names.length - 1]) : null;
  }

  /**
   * 失败包离线分诊：不碰浏览器、不碰守护进程，直接读 `.debug/failures/<ts>/`。
   * 默认取最近一个包；`dir` 可指定。
   */
  function whyBundle(dir = null) {
    const target = dir ? resolve(appRoot, dir) : latestFailureDir();
    if (!target) throw new Error("no failure bundle under .debug/failures; run a scenario first or pass --bundle=<dir>");
    if (!existsSync(target)) throw new Error(`failure bundle not found: ${target}`);
    const bundle = readBundle(target);
    const { signature, kind, evidence } = classifyFailure(bundle);
    return {
      dir: target,
      signature,
      kind,
      evidence,
      hypotheses: hypotheses(bundle),
      text: formatBundle(bundle),
    };
  }

  /** 所有失败包按签名聚合（最近 limit 个）。 */
  function triage({ limit = 20 } = {}) {
    const root = join(debugRoot, "failures");
    const dirs = existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(root, entry.name))
          .sort()
          .slice(-Math.max(1, Number(limit) || 20))
      : [];
    const summary = summarizeBundles(dirs.map((dir) => readBundle(dir)));
    return { ...summary, text: formatTriage(summary) };
  }

  /**
   * 场景覆盖：代码里的 data-debug 锚点 vs 场景引用，夹具路由 vs 场景用到。
   * 纯静态扫描（不启浏览器），所以「引用级覆盖」不等于「执行级覆盖」。
   */
  function coverage() {
    const anchors = scanAnchors([join(appRoot, "src"), join(studioFrontend, "src")]);
    const scanned = scanScenarios({
      scenarioDir: join(appRoot, "debug", "scenarios"),
      fixtureDir: join(appRoot, "debug", "fixtures", "models"),
    });
    const report = { ...aggregateCoverage({ scenarios: scanned, anchors }), scenarios: scanned.scenarios, missingFixtures: scanned.missingFixtures };
    return { ...report, text: formatCoverage(report) };
  }

  /** 全量场景（requires 不满足且未 --all 时跳过）。 */
  async function suite({ all = false } = {}) {
    const dir = join(appRoot, "debug", "scenarios");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const results = [];
    for (const file of files) {
      const scenario = JSON.parse(readFileSync(join(dir, file), "utf8"));
      // `requires` 声明外部依赖（Studio 要 Python venv）；环境不在就跳过而不是整条套件红。
      // 需要强制跑就加 --all（CI 里没有 Studio，走跳过分支）。
      if (scenario.requires && !requirementMet(scenario.requires) && !all) {
        results.push({ name: file, ok: true, skipped: `requires ${scenario.requires}` });
        continue;
      }
      try {
        results.push(await runScenarioFile(join("debug/scenarios", file)));
      } catch (error) {
        results.push({ name: file, ok: false, error: String(error.message ?? error), steps: error.results ?? [] });
      }
    }
    const ok = results.every((r) => r.ok);
    return { ok, data: results };
  }

  /** 路由冒烟：返回 rpc payload，调用方用 payload.data.ok 判断退出码。 */
  function smoke(routes) {
    return daemon.rpc("smoke", { routes });
  }

  /** API 契约巡检结果。 */
  function contracts() {
    return auditContracts({ appRoot, fixtureDir: join(appRoot, "debug", "fixtures", "models") });
  }

  function fixtureBuild(file) {
    return buildFromFile(file);
  }

  function fixtureShow(name) {
    const { path, fixture } = loadFixture(name);
    return { path, fixture };
  }

  /**
   * 夹具自检：装上夹具，按文件里的 `probes` 逐条真发一次请求。
   * 「文件存在」不等于「回放可用」——这一步才证明请求被拦到、响应形状对。
   * 场景里也可以直接写 {"cmd":"fixture.probe","fixtures":["practice-side"],"url":"/"}。
   */
  async function fixtureProbe(names, { url = "/" } = {}) {
    const list = (Array.isArray(names) ? names : String(names ?? "").split(",")).map((n) => n.trim()).filter(Boolean);
    if (!list.length) throw new Error("fixture probe needs at least one fixture name");
    const payload = await daemon.rpc("fixture.probe", { fixtures: list, url });
    return payload.data;
  }

  /** 录制开始：rpc 到 daemon，会话里从零攒事件。 */
  function recordStart(name) {
    return daemon.rpc("record.start", { name: name ?? "recorded" });
  }

  /** 录制结束：落成 debug/scenarios/<name>.json（可回放），并按录制期观测附断言草稿。 */
  async function recordStop() {
    const payload = await daemon.rpc("record.stop", {});
    const suggestion = suggestAssertions({
      steps: payload.data.steps ?? [],
      apiCalls: payload.data.apiCalls ?? [],
    });
    const scenario = mergeIntoScenario(
      { name: payload.data.name, description: payload.data.description ?? "", steps: payload.data.steps },
      suggestion,
    );
    const file = join(appRoot, "debug", "scenarios", `${payload.data.name}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(scenario, null, 2)}\n`);
    return {
      ...payload.data,
      file,
      steps: payload.data.steps.length,
      suggested: suggestion.suggestions.length,
      suggestions: suggestion.suggestions,
      notes: suggestion.notes,
    };
  }

  /** 语义快照 diff：save 时写 .debug/snapshots/<name>.json，否则读旧快照对比。 */
  async function diff({ save = false, name = "baseline", limit = 40 } = {}) {
    const dir = join(debugRoot, "snapshots");
    const file = join(dir, `${name}.json`);
    const snap = await daemon.rpc("snapshot", {});
    if (save) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(snap.data, null, 2)}\n`);
      return { saved: file, url: snap.data.url };
    }
    if (!existsSync(file)) throw new Error(`no saved snapshot: ${file} (run \`pnpm debug diff --save\` first)`);
    const before = JSON.parse(readFileSync(file, "utf8"));
    return { baseline: file, ...diffSnapshots(before, snap.data, { limit }) };
  }

  /** 各日志文件尾部；file 为 "all" 或文件名键。 */
  function logs({ file = "all", lines = 80 } = {}) {
    const files = {
      next: join(debugRoot, "next-dev.log"),
      daemon: join(debugRoot, "daemon.log"),
      studioBackend: join(debugRoot, "studio-backend.log"),
      studioFrontend: join(debugRoot, "studio-frontend.log"),
    };
    const data = {};
    for (const [key, path] of Object.entries(files)) {
      if (file !== "all" && file !== key) continue;
      try {
        data[key] = { path, lines: readFileSync(path, "utf8").split(/\r?\n/).slice(-lines) };
      } catch {
        data[key] = { path, lines: [] };
      }
    }
    return data;
  }

  return {
    runScenario,
    suite,
    smoke,
    contracts,
    fixtureBuild,
    fixtureShow,
    fixtureProbe,
    whyBundle,
    triage,
    coverage,
    recordStart,
    recordStop,
    diff,
    logs,
    studioUp,
    studioSeed,
    studioDown,
    studioStatus,
    studioByok,
    requirementMet,
    resolveTarget, // 额外导出：arg 映射与场景 step 都依赖它（debug.mjs 复用）
  };
}