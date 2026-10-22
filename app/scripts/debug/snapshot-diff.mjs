/**
 * debug diff 核心：比较两份语义快照（engine.snapshot() 产出），只输出变化。
 *
 * 用途：AI 改完代码做回归时，拿新快照与上次保存的快照 diff，不用重读整页。
 * 纯函数：不改入参，同输入必得同输出；输出形状与 spec-ai-debug-harness.md §4.6
 * 的 snapshot 字段一一对应。
 */

const DEFAULT_LIMIT = 40;
const FALLBACK_TAG = "element";

/** 字符串字段容错：null / 缺字段 / 纯空白都视为没有。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** 快照整体容错：null / 非对象按空快照处理，字段缺的按空值处理。 */
function normalizeSnapshot(snapshot) {
  const s =
    snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : {};
  return {
    url: typeof s.url === "string" ? s.url : "",
    title: typeof s.title === "string" ? s.title : "",
    ready: typeof s.ready === "string" ? s.ready : "",
    text: typeof s.text === "string" ? s.text : "",
    interactive: Array.isArray(s.interactive) ? s.interactive : [],
    state:
      s.state !== null && typeof s.state === "object" && !Array.isArray(s.state)
        ? s.state
        : {},
  };
}

/** 文本拆行：trim 后丢掉空行。 */
function textLines(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line !== "") lines.push(line);
  }
  return lines;
}

/** 行 → 出现次数（多重集合语义）。 */
function countBy(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/**
 * 文本 diff：多重集合差——同一行出现两次要算两次，但输出对重复去重并保持首次出现顺序。
 * 先算全量再截断，any 用全量判断，保证截断不影响 changed 结论。
 */
function diffText(beforeText, afterText, limit) {
  const beforeCounts = countBy(textLines(beforeText));
  const afterCounts = countBy(textLines(afterText));
  const added = [];
  const removed = [];
  const seenAdded = new Set();
  const seenRemoved = new Set();
  for (const line of textLines(afterText)) {
    const surplus = (afterCounts.get(line) ?? 0) - (beforeCounts.get(line) ?? 0);
    if (surplus > 0 && !seenAdded.has(line)) {
      seenAdded.add(line);
      added.push(line);
    }
  }
  for (const line of textLines(beforeText)) {
    const missing = (beforeCounts.get(line) ?? 0) - (afterCounts.get(line) ?? 0);
    if (missing > 0 && !seenRemoved.has(line)) {
      seenRemoved.add(line);
      removed.push(line);
    }
  }
  return {
    added: added.slice(0, limit),
    removed: removed.slice(0, limit),
    truncated: added.length > limit || removed.length > limit,
    any: added.length > 0 || removed.length > 0,
  };
}

/**
 * interactive 的 key：依次取 debug、label，都缺时才用 `${tag}#序号`；
 * 序号只对真正落到 tag 回退的元素按同 tag 计数（1 起）。
 */
function keysOf(list) {
  const tagSeen = new Map();
  return list.map((el) => {
    const debug = nonEmptyString(el?.debug);
    if (debug) return debug;
    const label = nonEmptyString(el?.label);
    if (label) return label;
    const tag = nonEmptyString(el?.tag) ?? FALLBACK_TAG;
    const n = tagSeen.get(tag) ?? 0;
    tagSeen.set(tag, n + 1);
    return `${tag}#${n + 1}`;
  });
}

function compactView(el, key) {
  return { key, label: el?.label ?? null, disabled: el?.disabled ?? null };
}

function fullView(el) {
  return { label: el?.label ?? null, disabled: el?.disabled ?? null, value: el?.value ?? null };
}

/**
 * interactive diff：按 key 配对（同 key 重复时按多重集配对，before 中按顺序取第一个
 * 未配对的），changed 只报 label / disabled / value 三项，全同不算 changed。
 */
function diffInteractive(beforeList, afterList, limit) {
  const beforeKeys = keysOf(beforeList);
  const afterKeys = keysOf(afterList);
  const used = new Array(beforeList.length).fill(false);
  const added = [];
  const removed = [];
  const changed = [];
  for (let i = 0; i < afterList.length; i++) {
    let match = -1;
    for (let j = 0; j < beforeList.length; j++) {
      if (!used[j] && beforeKeys[j] === afterKeys[i]) {
        match = j;
        break;
      }
    }
    if (match === -1) {
      added.push(compactView(afterList[i], afterKeys[i]));
      continue;
    }
    used[match] = true;
    const before = fullView(beforeList[match]);
    const after = fullView(afterList[i]);
    if (before.label !== after.label || before.disabled !== after.disabled || before.value !== after.value) {
      changed.push({ key: afterKeys[i], before, after });
    }
  }
  for (let j = 0; j < beforeList.length; j++) {
    if (!used[j]) removed.push(compactView(beforeList[j], beforeKeys[j]));
  }
  return {
    added: added.slice(0, limit),
    removed: removed.slice(0, limit),
    changed: changed.slice(0, limit),
    truncated: added.length > limit || removed.length > limit || changed.length > limit,
    any: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}

/** 值比较：原始标量用 ===；对象/其他按 JSON 序列化比较（快照值理论上是标量）。 */
function sameValue(a, b) {
  if (a === b) return true;
  const aPrim = typeof a === "number" || typeof a === "string" || typeof a === "boolean";
  const bPrim = typeof b === "number" || typeof b === "string" || typeof b === "boolean";
  if (aPrim || bPrim) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffState(beforeObj, afterObj, limit) {
  const beforeKeys = Object.keys(beforeObj);
  const beforeSet = new Set(beforeKeys);
  const afterKeys = Object.keys(afterObj);
  const afterSet = new Set(afterKeys);
  const removed = [];
  const changed = [];
  for (const key of beforeKeys) {
    if (!afterSet.has(key)) {
      removed.push({ key, before: beforeObj[key] });
    } else if (!sameValue(beforeObj[key], afterObj[key])) {
      changed.push({ key, before: beforeObj[key], after: afterObj[key] });
    }
  }
  const added = [];
  for (const key of afterKeys) {
    if (!beforeSet.has(key)) added.push({ key, after: afterObj[key] });
  }
  return {
    added: added.slice(0, limit),
    removed: removed.slice(0, limit),
    changed: changed.slice(0, limit),
    truncated: added.length > limit || removed.length > limit || changed.length > limit,
    any: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}

function scalarDiff(before, after) {
  return { before, after, changed: before !== after };
}

/**
 * 比较两份快照。options.limit 控制每个桶的最大输出条数（默认 40）；
 * changed 按完整差异判定，截断只减少输出、不影响结论。
 */
export function diffSnapshots(before, after, options = {}) {
  const limit =
    Number.isInteger(options?.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const b = normalizeSnapshot(before);
  const a = normalizeSnapshot(after);
  const url = scalarDiff(b.url, a.url);
  const title = scalarDiff(b.title, a.title);
  const ready = scalarDiff(b.ready, a.ready);
  const text = diffText(b.text, a.text, limit);
  const interactive = diffInteractive(b.interactive, a.interactive, limit);
  const state = diffState(b.state, a.state, limit);
  return {
    url,
    title,
    ready,
    text: { added: text.added, removed: text.removed, truncated: text.truncated },
    interactive: {
      added: interactive.added,
      removed: interactive.removed,
      changed: interactive.changed,
      truncated: interactive.truncated,
    },
    state: {
      added: state.added,
      removed: state.removed,
      changed: state.changed,
      truncated: state.truncated,
    },
    changed:
      url.changed || title.changed || ready.changed || text.any || interactive.any || state.any,
  };
}