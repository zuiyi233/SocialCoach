/**
 * 录制后生成断言草稿：纯函数、无 IO、无时间依赖。
 * 输入一次录制期间真实观测到的请求、锚点、元素数量变化，输出可直接
 * 粘进场景 JSON 的断言建议（只出骨架，断言由人补——按项目约定不自动
 * 插进 steps，但每条建议的字段形状与 assert.api / assert.exists /
 * assert.count 的命令参数一一对应，原样可用）。
 *
 * 输入形状（与 recorder.mjs / engine.mjs 的产物对齐）：
 * - steps:     mergeRecording 产出的步骤 [{cmd, target?, path?, ...}]
 * - apiCalls:  engine.#recordApiCall 产出的记录
 *              [{route, method, url, body, bodyJson, replay, at}]
 * - anchors:   录制期间出现过的 data-debug 锚点名，按出现顺序
 * - snapshots: 按时间顺序的语义快照，两种等价形状都接受：
 *              {at?, counts: {锚点名: 数量}} 或
 *              {at?, elements: [{target|debug: 锚点名, count: 数量}]}
 * - pageUrls:  录制期间访问过的 URL（只进 notes，不生成建议）
 *
 * 为什么用 min 而不是 count：开发模式下 React StrictMode 会把
 * useEffect 里的请求双调，精确次数（count）会假红；min:n 表示「至少
 * 观察到 n 次」，回放时不依赖双调行为。
 */

const MAX_ANCHOR_SUGGESTIONS = 6; // 锚点类建议上限
const MAX_SUGGESTIONS = 12; // 全部建议总上限
const MAX_BODY_FIELDS = 2; // 每条请求体建议最多挑的稳定字段数

/** 与 engine.mjs 的 anchorName 同口径：`[data-debug="x"]` → `x`；其余原样。 */
function anchorName(target) {
  const text = String(target ?? "");
  const match = text.match(/^\[data-debug=["']?([^"'\]]+)["']?\]$/);
  return match ? match[1] : text;
}

/** 是否是锚点名（字母或数字开头，只含字母数字点横线）而不是 CSS 选择器。 */
function isAnchorName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name);
}

/** 与 assert.api 同口径的路由归一：去前导斜杠与 api/ 前缀。 */
function normalizeRoute(route) {
  return String(route ?? "")
    .replace(/^\/+/, "")
    .replace(/^api\//, "");
}

/** 候选标量：布尔 / 有限数字 / 长度 1–40 的字符串。 */
function isStableScalar(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length >= 1 && value.length <= 40;
  return false;
}

const ID_LIKE_KEY = /^(id|sessionId|at|ts|time|timestamp|uuid)$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 键或值看起来像 id / 时间戳 / uuid 时返回一句理由，否则 null。 */
function idLikeReason(key, value) {
  if (ID_LIKE_KEY.test(key)) return `键 ${key} 是标识/时间戳类字段，回放时值会变`;
  if (/Id$/.test(key) || /_id$/i.test(key)) return `键 ${key} 以 Id 结尾，是标识类字段`;
  if (/At$/.test(key)) return `键 ${key} 以 At 结尾（createdAt / updatedAt 类），是时间戳字段`;
  if (typeof value === "string") {
    if (ISO_TIMESTAMP.test(value)) return `键 ${key} 的值是 ISO 时间戳`;
    if (UUID_VALUE.test(value)) return `键 ${key} 的值是 UUID`;
  }
  if (typeof value === "number" && value > 1e12) return `键 ${key} 的值像毫秒时间戳`;
  return null;
}

/**
 * 从一组 bodyJson 里挑「看起来稳定」的标量字段（最多 MAX_BODY_FIELDS 个）：
 * 以最后一条 bodyJson 为准取字段，值必须在同组所有 bodyJson 里一致
 * （只有一条观测时视为稳定，置信度由调用方降为 medium）。
 * 返回 [{key, value, skipped: [理由...]}]。
 */
function pickStableBodyFields(bodies, route) {
  const last = bodies[bodies.length - 1];
  const picked = [];
  const skipped = [];
  for (const [key, value] of Object.entries(last)) {
    if (!isStableScalar(value)) continue;
    const reason = idLikeReason(key, value);
    if (reason) {
      skipped.push(`跳过请求体键 ${key}（${route}）：${reason}`);
      continue;
    }
    if (picked.length >= MAX_BODY_FIELDS) continue;
    const stable = bodies.every((b) => Object.hasOwn(b, key) && Object.is(b[key], value));
    if (!stable) continue; // 非 id 类但跨请求不稳定的字段：静默不选
    picked.push({ key, value });
  }
  return { picked, skipped };
}

/** 按 (route, method) 聚合 apiCalls，保留首次出现顺序。 */
function groupApiCalls(apiCalls) {
  const groups = new Map(); // key: route\u0000method
  for (const call of apiCalls) {
    if (!call || typeof call !== "object") continue;
    const route = normalizeRoute(call.route);
    if (!route) continue;
    const method = String(call.method ?? "GET").toUpperCase();
    const key = `${route}\u0000${method}`;
    if (!groups.has(key)) groups.set(key, { route, method, records: [] });
    groups.get(key).records.push(call);
  }
  return [...groups.values()];
}

/** 一条快照 → {锚点名: 数量}。 */
function snapshotCounts(entry) {
  const map = new Map();
  const counts = entry?.counts;
  if (counts && typeof counts === "object" && !Array.isArray(counts)) {
    for (const [raw, value] of Object.entries(counts)) {
      const name = anchorName(raw);
      const n = Number(value);
      if (isAnchorName(name) && Number.isFinite(n)) map.set(name, n);
    }
  }
  const elements = entry?.elements;
  if (Array.isArray(elements)) {
    for (const el of elements) {
      const raw = el?.target ?? el?.debug;
      const name = anchorName(raw);
      const n = Number(el?.count);
      if (isAnchorName(name) && Number.isFinite(n)) map.set(name, n);
    }
  }
  return map;
}

/**
 * 生成断言草稿。空输入返回 {suggestions: [], notes: [], skipped: []}，不抛错。
 * 建议按 confidence（high 优先，同档按生成顺序）排序，总上限
 * MAX_SUGGESTIONS 条；每条带 why（引用证据的一句话）与 confidence。
 */
export function suggestAssertions({ steps = [], apiCalls = [], anchors = [], snapshots = [], pageUrls = [] } = {}) {
  const stepsList = Array.isArray(steps) ? steps : [];
  const apiList = Array.isArray(apiCalls) ? apiCalls : [];
  const anchorList = Array.isArray(anchors) ? anchors : [];
  const snapshotList = Array.isArray(snapshots) ? snapshots : [];
  const urlList = Array.isArray(pageUrls) ? pageUrls : [];
  const notes = [];
  const skipped = [];
  const suggestions = [];

  // ── 请求类 + 请求体类：按 (route, method) 聚合 ─────────────────────────
  const groups = groupApiCalls(apiList);
  if (groups.length > 0) {
    notes.push("assert.api 用 min 而非 count：React StrictMode 在开发模式会双调 useEffect 里的请求，精确 count 会假红；min:n 表示「至少观察到 n 次」，回放时不依赖双调行为");
  }
  for (const group of groups) {
    const { route, method, records } = group;
    const n = records.length;
    const suggestion = {
      cmd: "assert.api",
      route,
      method,
      min: n,
      why: `录制中 /api/${route} 被调用了 ${n} 次`,
      confidence: "high",
    };
    const bodies = records
      .filter((r) => r.bodyJson && typeof r.bodyJson === "object" && !Array.isArray(r.bodyJson))
      .map((r) => r.bodyJson);
    if (bodies.length > 0) {
      const { picked, skipped: bodySkipped } = pickStableBodyFields(bodies, route);
      skipped.push(...bodySkipped);
      if (picked.length > 0) {
        suggestion.body = Object.fromEntries(picked.map((p) => [p.key, p.value]));
        suggestion.why += `；请求体含稳定字段 ${picked.map((p) => `${p.key}=${JSON.stringify(p.value)}`).join("、")}`;
        suggestion.confidence = bodies.length >= 2 ? "high" : "medium"; // 单次观测视为稳定但置信度降档
      }
    }
    suggestions.push(suggestion);
  }

  // ── 锚点类：anchors 参数优先，再补 steps 里出现过的 target，按出现顺序去重 ──
  const seen = [];
  const stepAnchors = new Set();
  for (const step of stepsList) {
    if (step && typeof step.target === "string" && isAnchorName(anchorName(step.target))) {
      stepAnchors.add(anchorName(step.target));
    }
  }
  const addAnchor = (raw) => {
    const name = anchorName(raw);
    if (isAnchorName(name) && !seen.includes(name)) seen.push(name);
  };
  for (const raw of anchorList) addAnchor(raw);
  for (const name of stepAnchors) addAnchor(name);
  for (const name of seen.slice(0, MAX_ANCHOR_SUGGESTIONS)) {
    suggestions.push({
      cmd: "assert.exists",
      target: name,
      why: stepAnchors.has(name) ? `录制中操作过锚点 ${name}` : `录制中观察到锚点 ${name}`,
      confidence: "high",
    });
  }
  if (seen.length > MAX_ANCHOR_SUGGESTIONS) {
    notes.push(`锚点建议上限 ${MAX_ANCHOR_SUGGESTIONS} 条，另有 ${seen.length - MAX_ANCHOR_SUGGESTIONS} 个锚点未生成建议`);
  }

  // ── 计数类：同一锚点在快照序列里的数量从 a 变到 b ─────────────────────
  const series = new Map(); // 锚点名 → [数量...]
  for (const snap of snapshotList) {
    if (!snap || typeof snap !== "object") continue;
    for (const [name, count] of snapshotCounts(snap)) {
      if (!series.has(name)) series.set(name, []);
      series.get(name).push(count);
    }
  }
  for (const [name, counts] of series) {
    if (counts.length < 2) continue;
    const a = counts[0];
    const b = counts[counts.length - 1];
    if (a === b) continue;
    if (b === 0) {
      skipped.push(`跳过计数断言 ${name}：数量从 ${a} 降到 0，消失断言请手写 assert.gone 或 assert.count max`);
      continue;
    }
    suggestions.push({
      cmd: "assert.count",
      target: name,
      min: b,
      why: `录制中 ${name} 元素数量从 ${a} 变到 ${b}`,
      confidence: b > a ? "high" : "medium", // 下降后用 min 语义偏弱，降档
    });
  }

  // ── 收尾：按 confidence 排序（稳定排序保留同档生成顺序），截断到上限 ──
  suggestions.sort((x, y) => (x.confidence === "medium" ? 1 : 0) - (y.confidence === "medium" ? 1 : 0));
  if (suggestions.length > MAX_SUGGESTIONS) {
    notes.push(`共生成 ${suggestions.length} 条建议，超过上限 ${MAX_SUGGESTIONS}，按 confidence 截断，另有 ${suggestions.length - MAX_SUGGESTIONS} 条未列出`);
    suggestions.length = MAX_SUGGESTIONS;
  }

  if (urlList.length > 0) {
    notes.push(`录制期间访问过 ${urlList.length} 个 URL；导航 / URL 断言不自动生成，需要手写（assert.state / assert.text）`);
  }

  return { suggestions, notes, skipped };
}

/**
 * 可粘贴的 JSON 片段：每条建议上方一行 // 注释（why + confidence），
 * 整体是一个合法 JSON 数组（剥掉注释行后可直接 JSON.parse）。
 * 只输出断言参数（cmd 与字段），不带 why / confidence。
 */
export function formatSuggestions(result) {
  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  const lines = [];
  lines.push(`// 断言草稿 · 录制后生成 · 共 ${suggestions.length} 条（confidence: high 优先，用前请人工核对）`);
  lines.push("[");
  suggestions.forEach((suggestion, i) => {
    const { why, confidence, ...step } = suggestion;
    lines.push(`// ${i + 1}/${suggestions.length} · ${step.cmd} · ${confidence} · ${why ?? ""}`);
    lines.push(`${JSON.stringify(step)}${i < suggestions.length - 1 ? "," : ""}`);
  });
  lines.push("]");
  return `${lines.join("\n")}\n`;
}

/**
 * 把草稿合并进场景对象：返回新对象（不改入参），suggestions 放进
 * scenario.suggested 字段（不自动插进 steps——只出骨架，断言由人补）。
 */
export function mergeIntoScenario(scenario, result) {
  const base = scenario && typeof scenario === "object" && !Array.isArray(scenario) ? scenario : {};
  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  return { ...base, suggested: suggestions.map((s) => ({ ...s })) };
}
