/**
 * 失败包离线分诊：不启浏览器、不碰守护进程，直接读 `.debug/failures/<ts>/` 的现场
 * （report.json / trace.json / snapshot.json / page.html / screen.png），
 * 给出排序后的假设与「下一条该跑的命令」。
 *
 * 判定依据全部来自包内容（error 文本、失败 step 的 cmd、trace 事件、snapshot），
 * 不凭场景名猜。命令名与 `scripts/debug.mjs` 的 CLI 表面一致，可直接粘贴执行。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACK_FILES = ["report.json", "trace.json", "snapshot.json", "page.html", "screen.png"];

/** dev 噪声口径与 commands.mjs / debug.mjs 相同：跨场景残留的错误不算场景自己失败。 */
const DEV_NOISE = /_next\/hmr|ERR_INVALID_HTTP_RESPONSE/;

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };

// ── 读取 ───────────────────────────────────────────────────────────────────

/**
 * 读一个失败包目录。任何文件缺失只记进 `missing`，JSON 解析失败记进 `errors`，
 * 绝不抛错；目录不存在也一样（全部文件缺失）。
 * @param {string} dir
 * @returns {{dir: string, report: object|null, trace: object|null, snapshot: object|null,
 *   htmlPath: string|null, screenshotPath: string|null, missing: string[], errors: string[]}}
 */
export function readBundle(dir) {
  const bundle = {
    dir,
    report: null,
    trace: null,
    snapshot: null,
    htmlPath: null,
    screenshotPath: null,
    missing: [],
    errors: [],
  };
  for (const name of PACK_FILES) {
    if (!existsSync(join(dir, name))) bundle.missing.push(name);
  }
  const readJson = (name) => {
    const path = join(dir, name);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      bundle.errors.push(`${name}: ${error.message}`);
      return null;
    }
  };
  const readPath = (name) => (existsSync(join(dir, name)) ? join(dir, name) : null);
  bundle.report = readJson("report.json");
  bundle.trace = readJson("trace.json");
  bundle.snapshot = readJson("snapshot.json");
  bundle.htmlPath = readPath("page.html");
  bundle.screenshotPath = readPath("screen.png");
  return bundle;
}

// ── 分类 ───────────────────────────────────────────────────────────────────

/** 失败 step = results 里最后一条 ok:false；没有则取最后一条（report 可能只有半截）。 */
function failingStep(bundle) {
  const results = bundle.report?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (results[i] && results[i].ok === false) return results[i];
  }
  return results[results.length - 1] ?? null;
}

const stepError = (bundle) => String(failingStep(bundle)?.error ?? bundle.report?.error ?? "");
const stepCmd = (bundle) => String(failingStep(bundle)?.cmd ?? "");
const traceEvents = (bundle) => (Array.isArray(bundle.trace?.events) ? bundle.trace.events : []);

/** 把 error 文本里带引号 / 冒号的「目标」抠出来当分组锚点。 */
function anchorFromError(error) {
  const quoted = error.match(/"([^"]{1,80})"/);
  if (quoted) return quoted[1];
  const colon = error.match(/^[^:]+:\s*([^\n]{1,80})/);
  if (colon) return colon[1].trim().replace(/ \(\d+ms\)$/, "");
  return "";
}

/** trace 事件里的「脏」控制台错误：与 assert.noErrors 同口径（kind + DEV_NOISE）。 */
function badConsoleEvents(bundle) {
  return traceEvents(bundle).filter(
    (e) =>
      (e.kind === "console.error" || e.kind === "error" || e.kind === "exception" || e.kind === "rejection" || (e.kind === "console" && e.level === "error")) &&
      !DEV_NOISE.test(String(e.text ?? "")),
  );
}

/**
 * 失败 step 的分类。判定规则按顺序（先命中先赢），全部基于包内容。
 * 分层原则：error 文本是失败 step 的直接信号，优先于 trace 里的环境噪声；
 * trace 事件（model.missing / lock NULL / /api/ 5xx）只在 error 文本无法定性时兜底。
 *
 * | kind                | 依据（先命中先赢）                                                                   |
 * |---------------------|-------------------------------------------------------------------------------------|
 * | studio-unavailable  | 失败 cmd 是 studio.* 且 error 含 venv/EINVAL/seed/not ready；或 error 是 Studio venv / seed / 8000/5180 端口就绪超时 |
 * | console-error       | error 以 "console errors:" 开头，或失败 cmd 是 assert.noErrors 且 trace 有脏控制台事件 |
 * | lock-conflict       | error 提到「另一窗口」；或 trace 有 lock "NULL"（ifAvailable 拿不到）且 error 是 disabled/not found（F14 表象） |
 * | model-missing       | error 是夹具缺失（model fixture not found / debug-fixture-missing / fixture not found）；或 trace 有 model.missing(.error) 事件 |
 * | model-unexpected    | trace 有 model.replay.error / model.record.error 事件                                |
 * | navigation          | error 是 nav/reload 的 wait 失败、Chrome 起不来、evaluate 的 Promise 被页面导航回收；或失败 cmd 是 nav/reload |
 * | timeout             | error 含 CDP timeout / not become ready / "text not found in" / "not found: X (Nms)" / "still present: X (Nms)" |
 * | selector-missing    | error 是 missing: / selector not found / still disabled / "<target>: not found" / no clickable element contains / submit selector 等 |
 * | storage             | error 是 localStorage / SecurityError / QuotaExceeded 等设备存储错误                 |
 * | assertion-mismatch  | error 是 text does not contain / audio assert failed / trace event not found / assert.gone 的 still present |
 * | http-error          | （文本无法定性时兜底）trace 有 /api/ 路由的 fetch 5xx 或 fetch 失败；或 error 是 Failed to fetch 等网络错误 |
 * | unknown             | 其余                                                               |
 */
export function classifyFailure(bundle) {
  const error = stepError(bundle);
  const cmd = stepCmd(bundle);
  const events = traceEvents(bundle);
  const evidence = [];

  evidence.push(`error: ${error.slice(0, 160)}`);
  const step = failingStep(bundle);
  if (step) evidence.push(`failing step: index=${step.index} cmd=${step.cmd} ms=${step.ms}`);
  const results = Array.isArray(bundle.report?.results) ? bundle.report.results : [];
  const done = results.filter((r) => r.ok).map((r) => r.cmd);
  if (done.length) evidence.push(`preceding steps: ${done.slice(-6).join(" -> ")}`);
  if (bundle.snapshot?.url) evidence.push(`page: ${bundle.snapshot.url} (${bundle.snapshot.title ?? "no title"})`);
  if (bundle.missing.length) evidence.push(`missing files: ${bundle.missing.join(", ")}`);

  const counts = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  if (events.length) evidence.push(`trace events: ${Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(" ")}`);

  const badConsole = badConsoleEvents(bundle);
  const fetchApiBad = events.filter(
    (e) => e.kind === "fetch" && /\/api\//.test(String(e.url ?? "")) && (Number(e.status) >= 500 || e.error),
  );
  const fetch5xx = events.filter(
    (e) => e.kind === "fetch" && Number(e.status) >= 500 && !String(e.body ?? "").includes("debug-fixture-missing"),
  );
  const fetchErr = events.find((e) => e.kind === "fetch" && e.error);
  const lockNull = events.filter((e) => e.kind === "lock" && String(e.text ?? "").includes("NULL"));
  const modelMissing = events.filter((e) => e.kind === "model.missing" || e.kind === "model.missing.error");
  const modelBad = events.filter((e) => e.kind === "model.replay.error" || e.kind === "model.record.error");

  let kind = "unknown";
  const add = (item) => evidence.push(item);

  if (cmd.startsWith("studio.") && /venv|EINVAL|seed returned no JSON|did not become ready|not ready|failed/i.test(error)) {
    kind = "studio-unavailable";
  } else if (/Studio venv not found|studio seed returned no JSON|did not become ready within \d+ms: http:\/\/127\.0\.0\.1:(8000|5180)/i.test(error)) {
    kind = "studio-unavailable";
  } else if (error.startsWith("console errors:") || (cmd === "assert.noErrors" && badConsole.length)) {
    kind = "console-error";
    if (badConsole.length) add("console errors: " + badConsole.slice(-4).map((e) => String(e.text ?? "").slice(0, 100)).join(" | "));
  } else if (/另一窗口|another (window|tab)|modified by another/i.test(error)) {
    kind = "lock-conflict";
  } else if (lockNull.length && /disabled|not found|still present/i.test(error)) {
    // F14：按钮 disabled 的表象是 selector 缺失，根因是 Web Lock 被自己上一轮占着。
    kind = "lock-conflict";
    add("lock NULL events: " + lockNull.map((e) => e.text).slice(-3).join(" | "));
  } else if (modelMissing.length || /model fixture not found|model\.use needs at least one fixture name|No debug fixture for|debug-fixture-missing|fixture has no route|fixture not found/i.test(error)) {
    kind = "model-missing";
    if (modelMissing.length) add("model.missing: " + modelMissing.map((e) => e.route ?? e.text).slice(-4).join(", "));
  } else if (modelBad.length) {
    kind = "model-unexpected";
    add("model trace errors: " + modelBad.map((e) => `${e.kind}${e.route ? ` ${e.route}` : ""}${e.text ? ` ${e.text.slice(0, 80)}` : ""}`).slice(-3).join(" | "));
  } else if (/selector not found after (navigate|reload)|Chrome (did not expose|exposed no page|not found|exited early)|CDP connect timeout|Promise was collected/i.test(error) || cmd === "nav" || cmd === "reload") {
    kind = "navigation";
  } else if (/CDP timeout|timed out|did not become ready|not become ready|text not found in|not found: .+\(\d+ms\)|still present: .+\(\d+ms\)/i.test(error)) {
    kind = "timeout";
  } else if (/missing: |selector not found|no clickable element contains|still disabled|: still (?:disabled|invisible)|: not found(?:$|\s)|submit selector not found|selector not found for enter/i.test(error)) {
    kind = "selector-missing";
  } else if (/localStorage|SecurityError|QuotaExceeded|sessionStorage|IndexedDB/i.test(error)) {
    kind = "storage";
    const storage = events.filter((e) => e.kind === "storage").slice(-3);
    if (storage.length) add("storage events: " + storage.map((e) => e.text).join(" | "));
  } else if (/^(assert\.\w+|audio assert|canvas assert) failed|text does not contain|audio assert failed|trace event not found|^still present: /i.test(error)) {
    kind = "assertion-mismatch";
  } else if (fetchApiBad.length || /Failed to fetch|NetworkError|net::/i.test(error)) {
    // 文本无法定性时兜底：/api/ 路由的 5xx / 网络失败（health 轮询等环境噪声不会命中分类，
    // 只出现在 evidence 里）。
    kind = "http-error";
    if (fetchApiBad.length) add("fetch 5xx/failed: " + fetchApiBad.map((e) => `${e.status ?? "ERR"} ${e.method} ${e.url}`).slice(-3).join(" | "));
    if (fetchErr) add(`fetch failed: ${fetchErr.method} ${fetchErr.url}: ${String(fetchErr.error).slice(0, 80)}`);
  }

  // 签名：kind@cmd[:anchor]，同因失败包据此聚合。
  let anchor = anchorFromError(error);
  if (!anchor && kind === "http-error") {
    const route = (fetch5xx[0]?.url ?? fetchErr?.url ?? "").match(/\/api\/([^?/]+)/);
    if (route) anchor = route[1];
  }
  if (!anchor && kind === "model-missing" && modelMissing.length) anchor = modelMissing[0].route ?? "";
  if (!anchor && (kind === "console-error" || kind === "unknown") && error) anchor = error.slice(0, 48);
  const signature = `${kind}@${cmd || "?"}${anchor ? `:${anchor}` : ""}`.slice(0, 120);
  return { signature, kind, evidence };
}

// ── 假设（排序：high -> medium -> low，同级保持顺序）────────────────────────

const p = (cause, confidence, evidence, nextCommand) => ({ cause, confidence, evidence, nextCommand });

/** 每种 kind 的假设清单；nextCommand 全部是可直接粘贴的真实 CLI 命令。 */
function hypothesesFor(kind, bundle, error, cmd, evidence) {
  const file = bundle.report?.file ?? "<scenario-file>";
  const runAgain = `pnpm debug run ${file} --repeat=1`;
  const runAgainCmd = `${runAgain}（观察是否稳定复现；偶发就在该步骤加 "timeout": 30000，ui.wait / assert.text 默认 15000ms）`;
  switch (kind) {
    case "selector-missing":
      return [
        p(
          "场景引用的锚点/选择器在当前页面不存在或不可交互（页面结构与场景步骤脱节）",
          "high",
          evidence.slice(0, 4),
          "pnpm debug snapshot（先看当前页面实际结构：URL/可见文字/interactive 锚点），再 pnpm debug anchors 列出可用锚点对比",
        ),
        p(
          "页面尚未到达预期状态：前置步骤没生效或渲染未完成",
          "medium",
          evidence.filter((e) => e.startsWith("preceding steps")),
          runAgainCmd,
        ),
        p(
          "锚点存在但被 disabled（点击类步骤）：前置动作没有触发目标状态",
          "low",
          error.includes("still disabled") ? ["error 含 still disabled"] : [],
          "pnpm debug snapshot 确认元素 disabled 状态，检查前置步骤（如 state.load / nav / model.use）是否真的生效",
        ),
      ];
    case "timeout":
      return [
        p(
          "等待窗口内目标未出现：慢渲染 / 慢模型 / 偶发抖动（F4 冷启动也会叠加）",
          "high",
          evidence.slice(0, 3),
          runAgainCmd,
        ),
        p(
          "dev 首次编译与 Chrome 冷启动叠加，单步 15s 默认超时不够",
          "medium",
          ["error 为等待超时（CDP timeout / not found ... (Nms) / text not found in）"],
          `保持 daemon 常驻（pnpm debug up 一次，别每条命令重启），再 ${runAgain}`,
        ),
      ];
    case "model-missing":
      return [
        p(
          "请求命中了没有夹具的路由：strict 离线模式返回 503 debug-fixture-missing",
          "high",
          evidence.filter((e) => e.startsWith("model.missing") || e.startsWith("error")).slice(0, 2),
          "pnpm debug fixture probe <fixture>（文件存在 ≠ 可回放，F26）；pnpm debug contracts 看路由覆盖缺口",
        ),
        p(
          "夹具文件缺失或名字拼错（model fixture not found / fixture not found）",
          "medium",
          evidence.filter((e) => e.startsWith("error")).slice(0, 1),
          "pnpm debug fixture show <name> 确认夹具存在；缺失则用 fixture build <spec.json> 重新生成",
        ),
      ];
    case "model-unexpected":
      return [
        p(
          "夹具回放/录制链路出错（model.replay.error / model.record.error：CDP 层没把响应回填成功）",
          "high",
          evidence.filter((e) => e.startsWith("model trace errors")).slice(0, 1),
          "pnpm debug fixture probe <fixture> 自检回放；pnpm debug trace 看 replay/record 错误事件详情",
        ),
        p(
          "页面处理模型响应时抛错（夹具形状与页面期望不符）",
          "medium",
          evidence.slice(0, 3),
          "pnpm debug errors 看页面侧异常；pnpm debug snapshot 看当前渲染结果",
        ),
      ];
    case "console-error":
      return [
        p(
          "页面出现未忽略的控制台错误 / 异常，assert.noErrors 抓到（bad 列表在 error 文本里）",
          "high",
          evidence.filter((e) => e.startsWith("console errors") || e.startsWith("error")).slice(0, 2),
          "pnpm debug errors 看完整错误列表；pnpm debug trace 看事件序列",
        ),
        p(
          "预期内噪声未在场景里声明 ignore，或上一轮 trace 残留算到本轮（F18 GLTFLoader 纹理 / F22 跨场景累积）",
          "medium",
          error.includes("GLTFLoader") || /texture|blob/.test(error) ? ["error 含 GLTFLoader/纹理字样，通常是重载竞态或上一轮残留"] : ["检查错误文本是否与场景无关（如纹理/资源类）"],
          '在场景 assert.noErrors 里加 "ignore" 正则（写明理由，F18），或先 pnpm debug errors 确认来源',
        ),
      ];
    case "assertion-mismatch": {
      const expected = error.match(/text does not contain "([^"]*)"/);
      const actual = error.match(/text does not contain "[^"]*": (.+)$/);
      // 断言失败的原因按断言类型分支：api 是「请求没发出/次数不符」，count 是「元素数不对」，
      // state 是「存储不对」，text 才是「文本没出现」。一句「assert.text 期望…」套所有断言会误导。
      const first = /^assert\.api/.test(error)
        ? p(
            "应用没有按预期发出该请求，或次数不符：请求被拦到但没达到断言条件",
            "high",
            [error.split("\n")[0], "routes seen 列出的是实际被拦到的路由", ...evidence.slice(0, 2)],
            "pnpm debug api.calls 看最近被拦到的请求与 body；次数若在不同轮次波动（StrictMode/重试），把 count 改成 min",
          )
        : /^assert\.count/.test(error)
        ? p(
            "元素数量与预期不符：锚点可能只挂在容器上，或列表根本没渲染出来",
            "high",
            [error.split("\n")[0], ...evidence.slice(0, 2)],
            "pnpm debug snapshot 看 interactive 列表里该锚点出现几次；再用 pnpm debug eval 数一遍 querySelectorAll",
          )
        : /^assert\.state/.test(error)
        ? p(
            "localStorage 里的状态与断言不一致：夹具没装、路径写错，或页面还没写入",
            "high",
            [error.split("\n")[0], ...evidence.slice(0, 2)],
            "pnpm debug state.dump 看实际存储；确认场景开头有 state.load 且 key/path 拼写正确",
          )
        : p(
            "断言期望与实际不符：assert.text 期望文本没出现在目标里",
            "high",
            [
              expected ? `expected contains: ${expected[1]}` : error,
              actual ? `actual text: ${actual[1].slice(0, 120)}` : null,
              ...evidence.slice(0, 2),
            ].filter(Boolean),
            "pnpm debug snapshot 看目标元素当前文本；pnpm debug run <file> --repeat=1 确认是否稳定",
          );
      return [
        first,
        p(
          "命中上一轮/历史数据：有状态的存储（Studio SQLite / localStorage）没在场景开头重置，断言匹配旧内容（F23 假绿）",
          "medium",
          ["步骤是 assert.* 且有前置 studio.seed / state.load"],
          '场景开头显式重置：studio.seed 加 "reset": true，或 state.clear；断言锚到最新一条（如 studio.lastReply）',
        ),
      ];
    }
    case "http-error":
      return [
        p(
          "页面请求后端返回 5xx / 网络失败（fetch 事件里有 status 或 error）",
          "high",
          evidence.filter((e) => e.startsWith("fetch")).slice(0, 2),
          "pnpm debug logs --file=next（next-dev.log 尾部）看后端报错；pnpm debug errors 看页面侧异常",
        ),
        p(
          "夹具响应形状与后端契约不符，页面拿到坏数据后才炸（F26 变体）",
          "medium",
          evidence.filter((e) => e.startsWith("trace events")).slice(0, 1),
          "pnpm debug fixture probe <fixture> 验证夹具可回放且 2xx",
        ),
      ];
    case "lock-conflict":
      return [
        p(
          "Web Lock 被占：另一个标签页 / 上一轮实例没释放（F14），或真有人开第二个窗口在写",
          "high",
          evidence.filter((e) => e.startsWith("lock") || e.startsWith("error")).slice(0, 2),
          "pnpm debug tab list 检查其它标签页并 pnpm debug tab close <id>；或 pnpm debug down 重置会话后重跑场景",
        ),
        p(
          "应用把 ifAvailable 拿不到锁直接判成冲突，收尾与真正占用没分开（F14 建议）",
          "medium",
          ["trace 有 lock 'request ifAvailable' 后跟 'NULL' 的事件对"],
          "看 trace 里 lock 事件序列：连续同 id 的 request->acquired->request->NULL 就是自己抢自己",
        ),
      ];
    case "storage":
      return [
        p(
          "设备存储访问/写入异常：localStorage SecurityError（F9 about:blank 跨源）或配额超限",
          "high",
          evidence.slice(0, 2),
          "pnpm debug why 看 storage 事件序列（谁在什么时候写了 localStorage）；确认页面停在应用源（localhost:3000）",
        ),
        p(
          "多窗口/多标签同时写同一存档键，状态互相覆盖",
          "medium",
          evidence.filter((e) => e.startsWith("storage events")).slice(0, 1),
          "pnpm debug tab list 看是否有其它标签页在写；场景里先 state.clear 重置",
        ),
      ];
    case "navigation":
      return [
        p(
          "页面没有导航到预期地址 / 没就绪（nav/reload 的 wait 失败、evaluate 期间页面导航走了）",
          "high",
          evidence.slice(0, 3),
          "pnpm debug why（一条命令看 url/ready/errors/model/storage/lock），或 pnpm debug snapshot 看实际 URL",
        ),
        p(
          "基址 / 路由写法问题：Git Bash 把 /love 转成 Windows 路径（F7）、127.0.0.1 跨源不 hydration（F8）、绝对 URL 被拼接（F12）",
          "medium",
          String(bundle.snapshot?.url ?? "").includes("127.0.0.1") || error.includes("C:/Program Files") ? ["snapshot.url 或 error 含 127.0.0.1 / C:/Program Files 字样"] : [],
          "基址用 http://localhost:3000；跨运行时用绝对 URL（http://127.0.0.1:5180/debug.html）原样传",
        ),
      ];
    case "studio-unavailable":
      return [
        p(
          "Studio 运行时不可达：venv 缺失（F19）、前端/后端没起来、或 Windows 上 spawn npm.cmd EINVAL（F29）",
          "high",
          evidence.slice(0, 2),
          "pnpm debug studio status 看两端健康；venv 缺失先跑一次 love-studio/start.bat；EINVAL 用 pnpm debug studio up 重试（已走 cmd.exe /c）",
        ),
        p(
          "冷启动超时：首次起后端（90000ms）/ 前端（120000ms）预算不够",
          "medium",
          error.includes("did not become ready") ? ["error 是就绪等待超时"] : [],
          "pnpm debug studio up 等就绪后再跑场景，别让场景第一步 studio.up 承担冷启动",
        ),
      ];
    case "unknown":
      return [
        p(
          "未识别的失败模式：先用一条命令拿全量现场再定位",
          "medium",
          evidence.slice(0, 4),
          "pnpm debug why（url/errors/model/storage/lock 一次给全），对照场景步骤定位",
        ),
        p(
          "harness 抖动 / 场景参数写错（如 state.load needs a fixture name）",
          "low",
          [],
          runAgainCmd,
        ),
      ];
    default:
      return [];
  }
}

/**
 * 排序后的假设清单：confidence high -> medium -> low，同级保持原有顺序。
 * @returns {{cause: string, confidence: "high"|"medium"|"low", evidence: string[], nextCommand: string}[]}
 */
export function hypotheses(bundle) {
  const { kind, evidence } = classifyFailure(bundle);
  const list = hypothesesFor(kind, bundle, stepError(bundle), stepCmd(bundle), evidence);
  return [...list].sort(
    (a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence],
  );
}

// ── 汇总 ───────────────────────────────────────────────────────────────────

/**
 * 多包汇总：按 signature 分组、count 降序；latest 为目录名（ISO 时间）最大的包。
 * 每组带 topCause / nextCommand（来自该组最新包的最高置信度假设），formatTriage 直接可用。
 * @param {ReturnType<typeof readBundle>[]} bundles
 */
export function summarizeBundles(bundles) {
  const bySignature = new Map();
  let latest = null;
  for (const bundle of bundles) {
    const { signature, kind } = classifyFailure(bundle);
    const group = bySignature.get(signature) ?? {
      signature,
      kind,
      count: 0,
      latestDir: null,
      firstSeen: null,
      lastSeen: null,
      scenario: null,
      topCause: null,
      nextCommand: null,
    };
    group.count += 1;
    if (group.firstSeen === null || bundle.dir < group.firstSeen) group.firstSeen = bundle.dir;
    if (group.lastSeen === null || bundle.dir > group.lastSeen) group.lastSeen = bundle.dir;
    if (bundle.report?.scenario ?? bundle.report?.file) group.scenario = bundle.report.scenario ?? bundle.report.file;
    if (!latest || bundle.dir > latest.dir) {
      latest = { dir: bundle.dir, kind, signature, scenario: group.scenario };
    }
    // 该组最新包的假设（目录名是 ISO 时间，字典序即可比）
    if (group.latestDir === null || bundle.dir > group.latestDir) {
      group.latestDir = bundle.dir;
      const top = hypotheses(bundle)[0] ?? null;
      group.topCause = top?.cause ?? null;
      group.nextCommand = top?.nextCommand ?? null;
    }
    bySignature.set(signature, group);
  }
  const groups = [...bySignature.values()].sort(
    (a, b) => b.count - a.count || (a.signature < b.signature ? -1 : 1),
  );
  return { total: bundles.length, groups, latest };
}

// ── 终端输出 ───────────────────────────────────────────────────────────────

function divider() {
  return "─".repeat(64);
}

/**
 * 单包分诊文本（≤ 60 行）：头部 + 失败 step + evidence + 排序后的假设与下一步。
 * @param {ReturnType<typeof readBundle>} bundle
 */
export function formatBundle(bundle) {
  const { signature, kind, evidence } = classifyFailure(bundle);
  const guesses = hypotheses(bundle);
  const step = failingStep(bundle);
  const lines = [
    `bundle: ${bundle.dir}`,
    `scenario: ${bundle.report?.scenario ?? bundle.report?.file ?? "?"}`,
    `kind: ${kind}`,
    `signature: ${signature}`,
    divider(),
  ];
  if (step) {
    lines.push(`failed step: index=${step.index} cmd=${step.cmd} ms=${step.ms}`);
    lines.push(`error: ${String(step.error ?? "").slice(0, 200)}`);
  }
  for (const line of evidence.slice(0, 8)) lines.push(`  - ${line}`);
  if (bundle.missing.length) lines.push(`missing: ${bundle.missing.join(", ")}`);
  if (bundle.errors.length) lines.push(`read errors: ${bundle.errors.join("; ")}`);
  lines.push(divider());
  for (const guess of guesses) {
    lines.push(`[${guess.confidence}] ${guess.cause}`);
    for (const line of guess.evidence.slice(0, 2)) lines.push(`      ${line}`);
    lines.push(`    next: ${guess.nextCommand}`);
  }
  return lines.slice(0, 60).join("\n");
}

/**
 * 汇总文本（≤ 60 行）：总数 + 每组（kind / count / 区间 / 场景 / 下一步）。
 * @param {ReturnType<typeof summarizeBundles>} summary
 */
export function formatTriage(summary) {
  const lines = [
    `失败包汇总：共 ${summary.total} 个，${summary.groups.length} 组（count 降序）`,
    divider(),
  ];
  for (const g of summary.groups) {
    lines.push(`[${g.kind}] × ${g.count}  signature: ${g.signature}`);
    lines.push(`    scenario: ${g.scenario ?? "?"}`);
    lines.push(`    区间: ${g.firstSeen} -> ${g.lastSeen}`);
    lines.push(`    最新: ${g.latestDir}`);
    if (g.topCause) lines.push(`    原因: ${g.topCause}`);
    if (g.nextCommand) lines.push(`    下一步: ${g.nextCommand}`);
    lines.push(divider());
  }
  if (summary.latest) {
    lines.push(`最新失败包: ${summary.latest.dir} (${summary.latest.kind})`);
  }
  return lines.slice(0, 60).join("\n");
}
