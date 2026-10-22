/**
 * 断言原语：纯函数，不碰 DOM、不碰 CDP，供引擎的 assert.api / assert.state
 * 命令与单元测试共用。
 *
 * - deepMatch(actual, expected)：部分匹配。expected 是对象时只要求这些键存在
 *   且匹配（actual 可以多键）；expected 是数组时要求长度相等并逐项 deepMatch；
 *   原始值用 Object.is 严格相等（NaN 等于 NaN，+0 不等于 -0）。
 *   path 指向第一个不匹配的位置（如 messages.1.role）。
 * - getPath(value, path)：点号 + 数组下标路径取值（state.settings.tts、
 *   messages.0.role）；中间缺键返回 found:false 而不是抛错。
 * - describeMismatch(result)：把 deepMatch 的结果压成一行可读文本（含 path、
 *   期望、实际，实际值截断到 120 字符）。
 */

const MAX_PREVIEW = 120;

function joinPath(path, segment) {
  return path ? `${path}.${segment}` : segment;
}

function matchAt(actual, expected, path) {
  if (typeof expected !== "object" || expected === null) {
    return Object.is(actual, expected)
      ? { ok: true, path, actual, expected }
      : { ok: false, path, actual, expected };
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return { ok: false, path, actual, expected };
    if (actual.length !== expected.length) {
      return { ok: false, path, actual: actual.length, expected: expected.length, reason: "length" };
    }
    for (let i = 0; i < expected.length; i += 1) {
      const sub = matchAt(actual[i], expected[i], joinPath(path, String(i)));
      if (!sub.ok) return sub;
    }
    return { ok: true, path, actual, expected };
  }
  // expected 是普通对象时 actual 不允许是数组：形状不同直接失败。
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return { ok: false, path, actual, expected };
  }
  for (const key of Object.keys(expected)) {
    const sub = matchAt(actual[key], expected[key], joinPath(path, key));
    if (!sub.ok) return sub;
  }
  return { ok: true, path, actual, expected };
}

/** 部分匹配：expected 的每个键都要在 actual 里存在且匹配（actual 允许多键）。 */
export function deepMatch(actual, expected) {
  return matchAt(actual, expected, "");
}

/** 取值路径：点号分隔，数组下标直接写数字（messages.0.role）。 */
export function getPath(value, path) {
  if (path === null || path === undefined || path === "") return { found: true, value };
  let current = value;
  for (const part of String(path).split(".")) {
    if (!part) continue; // "a..b" / 首尾点容错
    if (current === null || typeof current !== "object") return { found: false, value: undefined };
    if (!(part in current)) return { found: false, value: undefined };
    current = current[part];
  }
  return { found: true, value: current };
}

function preview(value) {
  let text;
  if (typeof value === "string") text = value;
  else if (Number.isNaN(value)) text = "NaN";
  else if (value === undefined) text = "undefined";
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
}

/** 一行可读的失配描述：path + 期望 + 实际（长值截断）。 */
export function describeMismatch(result) {
  const at = result?.path ? ` at "${result.path}"` : "";
  if (result?.reason === "length") {
    return `mismatch${at}: expected length ${result.expected}, actual length ${result.actual}`;
  }
  return `mismatch${at}: expected ${preview(result.expected)}, actual ${preview(result.actual)}`;
}
