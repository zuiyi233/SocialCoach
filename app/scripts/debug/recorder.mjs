// 场景录制核心：把「人点一遍」产生的两类事件（CLI 命令事件 + 页面 DOM 事件）合并成可回放场景。
// 纯函数、无 IO、无时间依赖：`at` 一律由调用方提供，本模块不取时钟。

// CLI 命令 → 场景步骤的映射（规则 1）；其它 cmd 一律不记录。
const CLI_STEPS = {
  nav: (args) => ({ cmd: "nav", path: args?.path }),
  "state.load": (args) => ({ cmd: "state.load", fixture: args?.fixture }),
  "state.set": (args) => ({ cmd: "state.set", key: args?.key, value: args?.value }),
  "model.use": (args) => ({ cmd: "model.use", fixtures: args?.fixtures }),
  "ui.click": (args) => ({ cmd: "ui.click", target: args?.target }),
  "ui.type": (args) => ({ cmd: "ui.type", target: args?.target, text: args?.text }),
};

const DEDUP_MS = 500; // 规则 3：CLI 与页面同一动作的去重时间窗
const CLICK_MERGE_MS = 300; // 规则 5：同一 target 连续点击的合并窗
const DEFAULT_NAME = "recorded";
const NO_LABEL = "(无文案)";

/**
 * 规范化一条 CLI 事件：{at, cmd, args} → {at, step} | null。
 * 未知 cmd、缺 at、非对象输入返回 null（不记录）。
 */
export function normalizeCliEvent(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { at, cmd, args } = entry;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const build = CLI_STEPS[cmd];
  if (!build) return null;
  return { at, step: build(args) };
}

/**
 * 规范化一条页面事件：{at, action, target, text} → {at, step} | {at, step:null, skip:true} | null。
 * 无锚点（target 为空）的动作返回 skip 标记，由 mergeRecording 记进 notes——
 * 文案选择器不稳定，录进场景会在改文案后断。
 */
export function normalizePageEvent(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { at, action, target, text } = entry;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (action === "click") {
    if (!target) return { at, step: null, skip: true };
    return { at, step: { cmd: "ui.click", target } };
  }
  if (action === "type") {
    if (!target) return { at, step: null, skip: true };
    return { at, step: { cmd: "ui.type", target, text: text ?? "" } };
  }
  return null;
}

/** 无锚点动作按（动作类型, 文案）分组计数成 notes。 */
function collectNotes(skipped) {
  const groups = new Map(); // key → {verb, label, count}
  const keys = [];
  for (const entry of skipped) {
    const verb = entry.action === "type" ? "输入" : "点击";
    const label = entry.text ? String(entry.text) : NO_LABEL;
    const key = `${verb}\u0000${label}`;
    if (!groups.has(key)) {
      groups.set(key, { verb, label, count: 0 });
      keys.push(key);
    }
    groups.get(key).count += 1;
  }
  return keys.map((key) => {
    const { verb, label, count } = groups.get(key);
    return `跳过 ${count} 次无锚点${verb}：${label}`;
  });
}

/** 规则 3：页面事件被同 cmd、同 target、|Δt| ≤ 500ms 的 CLI 事件遮蔽时丢弃。 */
function dedupPageEvents(pageEvents, cliEvents) {
  return pageEvents.filter(
    (pe) =>
      !cliEvents.some(
        (ce) =>
          ce.step.cmd === pe.step.cmd &&
          ce.step.target === pe.step.target &&
          Math.abs(ce.at - pe.at) <= DEDUP_MS,
      ),
  );
}

/** 规则 5：折叠——空 text 输入丢弃；连续同 target 输入只留最后一条；300ms 内同 target 连点视为一次。 */
function foldSteps(entries) {
  const out = []; // 元素为 {at, step}，折叠需要 at 判定连点窗口
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (entry.step.cmd === "ui.type") {
      if (entry.step.text == null || entry.step.text === "") continue;
      if (last?.step.cmd === "ui.type" && last.step.target === entry.step.target) out[out.length - 1] = entry;
      else out.push(entry);
    } else if (entry.step.cmd === "ui.click") {
      const merged =
        last?.step.cmd === "ui.click" &&
        last.step.target === entry.step.target &&
        entry.at - last.at <= CLICK_MERGE_MS;
      if (!merged) out.push(entry);
    } else {
      out.push(entry);
    }
  }
  return out.map((e) => e.step);
}

/**
 * 合并录制：{cli, page, meta} → {name, description, steps, notes}。
 * 规则 4：按 at 升序、at 相同 CLI 优先；输出步骤不含 at。空输入返回空 steps，不抛错。
 */
export function mergeRecording({ cli = [], page = [], meta = {} } = {}) {
  const metaObj = meta && typeof meta === "object" ? meta : {};
  const cliEvents = (Array.isArray(cli) ? cli : []).map(normalizeCliEvent).filter(Boolean);
  const pageEvents = [];
  const skipped = [];
  for (const raw of Array.isArray(page) ? page : []) {
    const normalized = normalizePageEvent(raw);
    if (!normalized) continue;
    if (normalized.skip) skipped.push(raw);
    else pageEvents.push(normalized);
  }
  const merged = [
    ...cliEvents.map((e) => ({ ...e, source: "cli" })),
    ...dedupPageEvents(pageEvents, cliEvents).map((e) => ({ ...e, source: "page" })),
  ];
  merged.sort((a, b) => a.at - b.at || (a.source === "cli" ? -1 : 1));
  return {
    name: typeof metaObj.name === "string" && metaObj.name ? metaObj.name : DEFAULT_NAME,
    description: typeof metaObj.description === "string" ? metaObj.description : "",
    steps: foldSteps(merged),
    notes: collectNotes(skipped),
  };
}

/** 有状态录制器：cli(page) 喂原始事件，drain() 取合并结果并清空缓冲。 */
export function createRecorder() {
  const cli = [];
  const page = [];
  return {
    cli(entry) {
      if (normalizeCliEvent(entry)) cli.push(entry);
    },
    page(entry) {
      if (normalizePageEvent(entry)) page.push(entry);
    },
    drain() {
      const recording = mergeRecording({ cli, page });
      cli.length = 0;
      page.length = 0;
      return recording;
    },
  };
}
