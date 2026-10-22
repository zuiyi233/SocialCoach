/**
 * flaky 定位（纯分析模块，不做任何执行；接线由调用方负责）。
 *
 * 输入：runScenario --repeat 的结果 —— data.runs 数组，每轮
 *   {run, name, ok, ms, steps: [{index, cmd, ok, ms, data?, error?}]}
 * 也可直接传裸步骤数组（[steps[], steps[]]）。
 *
 * 判定规则：
 * - 按 step index 对齐，逐索引比较第 1 轮与后续轮；
 * - normalizeStep 忽略 ms 与 data 里明显易变的键（ms / startedAt / at /
 *   timestamp / duration，递归生效），其余键排序后做稳定字符串比较；
 * - 某索引 ok 不同 → kind = "status"；ok 相同但归一化结果不同 → kind = "data"；
 *   某轮步数更短（该索引缺步）也报 kind = "data" 并带 missing 说明。
 */
const VOLATILE_KEYS = ["ms", "startedAt", "at", "timestamp", "duration"];

/** 递归剔除易变键后的稳定字符串（键排序，与键顺序无关）。 */
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (VOLATILE_KEYS.includes(key)) continue;
      out[key] = scrub(v);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

/** 步骤归一化：去掉 ms 与 data 里的易变键，返回与键顺序无关的稳定字符串。 */
export function normalizeStep(step) {
  const copy = { ...step };
  delete copy.ms;
  copy.data = scrub(copy.data);
  // 场景共享同一个浏览器：state.load / ui.click 的 data.url 会带着上一轮停留的页面，
  // 这不是 flake。只有 nav/reload 的 url 才是断言目标。
  if (copy.data && typeof copy.data === "object" && !/^(nav|reload)$/.test(String(step.cmd ?? ""))) {
    delete copy.data.url;
  }
  return stableStringify(copy);
}

/** 把一轮结果规整成步骤数组：裸数组或 {steps} 都接受。 */
function toSteps(run) {
  if (Array.isArray(run)) return run;
  return run?.steps ?? [];
}

const NO_DIVERGENCE = {
  stable: true,
  index: -1,
  cmd: null,
  kind: "none",
  baseline: null,
  diverged: null,
  baselineRun: 1,
  divergedRun: null,
};

/**
 * 找多轮跑的第一个分叉步骤。
 * @param {Array} runs 轮次数组（runScenario --repeat 的 data.runs，或裸步骤数组）
 * @returns {{stable: boolean, index: number, cmd: string|null, kind: string,
 *            baseline: Object|null, diverged: Object|null, divergedRun: number|null}}
 */
export function firstDivergence(runs) {
  const stepLists = runs.map(toSteps);
  if (stepLists.length < 2) return { ...NO_DIVERGENCE };
  const baselineList = stepLists[0];
  const maxLen = Math.max(...stepLists.map((list) => list.length));
  for (let i = 0; i < maxLen; i += 1) {
    const baseline = baselineList[i];
    for (let j = 1; j < stepLists.length; j += 1) {
      const candidate = stepLists[j][i];
      if (!baseline || !candidate) {
        if (!baseline && !candidate) continue; // 两轮都在更早处结束，不是这里的差异
        const shortRun = !baseline ? 1 : j + 1; // 步数更短的那一轮（1 起）
        const missingInfo = { missing: true, run: shortRun, length: (!baseline ? baselineList : stepLists[j]).length };
        if (!baseline) {
          // 第 1 轮反而更短：baseline 缺步，diverged 是第 j 轮的真实步骤。
          return {
            stable: false,
            index: i,
            cmd: candidate.cmd,
            kind: "data",
            baseline: missingInfo,
            diverged: candidate,
            baselineRun: 1,
            divergedRun: j + 1,
          };
        }
        return {
          stable: false,
          index: i,
          cmd: baseline.cmd,
          kind: "data",
          baseline,
          diverged: missingInfo,
          baselineRun: 1,
          divergedRun: j + 1,
        };
      }
      if (normalizeStep(baseline) === normalizeStep(candidate)) continue;
      if (baseline.ok !== candidate.ok) {
        return {
          stable: false,
          index: i,
          cmd: candidate.cmd,
          kind: "status",
          baseline,
          diverged: candidate,
          baselineRun: 1,
          divergedRun: j + 1,
        };
      }
      return {
        stable: false,
        index: i,
        cmd: candidate.cmd,
        kind: "data",
        baseline,
        diverged: candidate,
        baselineRun: 1,
        divergedRun: j + 1,
      };
    }
  }
  return { ...NO_DIVERGENCE };
}

/** 步骤状态的短描述：ok / failed / 提前结束。 */
function stateOf(step) {
  if (!step) return "无此步";
  if (step.missing) return `提前结束（该轮只有 ${step.length} 步）`;
  return step.ok ? "ok" : "failed";
}

function shortJson(value, max = 160) {
  if (value === undefined || value === null) return "null";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 分叉的多行描述（含复现建议命令）。
 * @param {Object} result firstDivergence 的返回值
 * @param {{file: string}} options 场景文件名，出现在建议命令里
 */
export function describeDivergence(result, { file } = {}) {
  const name = file ?? "scenario.json";
  const suggest = `建议：pnpm debug run ${name} --repeat=2 复现并对比`;
  if (result.stable) {
    return ["无分叉：所有轮次的步骤 ok 状态与归一化 data 一致。", suggest].join("\n");
  }
  const n = result.index + 1;
  const cmd = result.cmd ?? "?";
  const baselineRun = result.baselineRun ?? 1;
  const divergedRun = result.divergedRun ?? 2;
  const lines = [`第 ${n} 步 ${cmd} 在第 ${baselineRun} 轮是 ${stateOf(result.baseline)}、第 ${divergedRun} 轮是 ${stateOf(result.diverged)}`];
  if (result.kind === "status" && result.diverged && !result.diverged.missing && !result.diverged.ok) {
    lines.push(`第 ${divergedRun} 轮错误：${shortJson(result.diverged.error)}`);
  } else if (
    result.kind === "data" &&
    result.baseline &&
    result.diverged &&
    !result.baseline.missing &&
    !result.diverged.missing
  ) {
    lines.push(`第 ${baselineRun} 轮 data：${shortJson(result.baseline.data)}`);
    lines.push(`第 ${divergedRun} 轮 data：${shortJson(result.diverged.data)}`);
  }
  lines.push(suggest);
  return lines.join("\n");
}

/**
 * 每步的 okRate，按不稳定度排序（离 0.5 越近越不稳定），只列 0 < okRate < 1 的步。
 * @returns {Array<{index: number, cmd: string, okRate: number, passed: number, total: number}>}
 */
export function flakeSummary(runs) {
  const stepLists = runs.map(toSteps);
  const perIndex = new Map();
  for (const list of stepLists) {
    list.forEach((step, i) => {
      const entry = perIndex.get(i) ?? { index: i, cmd: step.cmd, passed: 0, total: 0 };
      entry.cmd = step.cmd;
      entry.total += 1;
      if (step.ok === true) entry.passed += 1;
      perIndex.set(i, entry);
    });
  }
  const out = [];
  for (const entry of perIndex.values()) {
    const okRate = entry.passed / entry.total;
    if (okRate > 0 && okRate < 1) {
      out.push({ index: entry.index, cmd: entry.cmd, okRate, passed: entry.passed, total: entry.total });
    }
  }
  out.sort((a, b) => {
    const instability = Math.abs(a.okRate - 0.5) - Math.abs(b.okRate - 0.5);
    if (instability !== 0) return instability;
    if (a.okRate !== b.okRate) return a.okRate - b.okRate;
    return a.index - b.index;
  });
  return out;
}
