/**
 * 场景覆盖分析（纯分析模块，不做任何执行；接线由调用方负责）。
 *
 * 统计口径：
 * - 锚点 = 代码里 data-debug="x" / data-debug='x' 的字面量属性（只认字面量，
 *   不认 data-debug={`...`} 模板值或 data-debug={cond ? 'x' : undefined} 条件值），
 *   跳过注释与字符串里的伪锚点。
 * - 场景引用锚点 = 步骤里 target / submit 字段（`[data-debug="x"]` 完整选择器归一成 x）。
 *   ui.click 的 text（可见文字）不算锚点覆盖，单独记 textClicks。
 * - 路由 = model.use 引用的夹具文件里 routes 键的并集；「未用路由」= 夹具目录里
 *   存在、但没有场景通过 model.use 用到的路由。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** 场景里 target / submit 可能是完整选择器（[data-debug="x"]），归一成锚点名。 */
const SELECTOR_RE = /^\[data-debug=(?:"([^"]+)"|'([^']+)')\]$/;

const SOURCE_RE = /\.(tsx|ts)$/;

/** 单遍扫描：字符串/注释状态机 + data-debug 属性形态匹配，一个函数完成。 */
function extractAnchors(text) {
  const found = [];
  let i = 0;
  const n = text.length;
  let quote = null; // 处于字符串（" ' `）内
  let inLine = false; // 行注释 //
  let inBlock = false; // 块注释 /* */
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (c === "\\") i += 2;
      else {
        if (c === quote) quote = null;
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "d" && text.startsWith("data-debug", i)) {
      let j = i + "data-debug".length;
      while (j < n && /\s/.test(text[j])) j += 1;
      if (text[j] === "=") {
        j += 1;
        while (j < n && /\s/.test(text[j])) j += 1;
        const q = text[j];
        if (q === '"' || q === "'") {
          let k = j + 1;
          let name = "";
          while (k < n && text[k] !== q) {
            name += text[k];
            k += 1;
          }
          if (k < n) {
            found.push(name);
            i = k + 1;
            continue;
          }
        }
      }
    }
    i += 1;
  }
  return found;
}

function walkSources(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(path, out);
    else if (entry.isFile() && SOURCE_RE.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * 扫代码里的 data-debug 字面量锚点。
 * @param {string[]} roots 绝对路径数组（主站 src + Studio src）
 * @returns {{anchor: string[]}} 锚点名 → 所在文件（相对各自 root）
 */
export function scanAnchors(roots) {
  const result = {};
  for (const root of roots) {
    if (!existsSync(root)) throw new Error(`anchor root not found: ${root}`);
    const files = walkSources(root, []);
    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");
      for (const name of extractAnchors(text)) {
        (result[name] ??= []).push(rel);
      }
    }
  }
  for (const name of Object.keys(result)) result[name].sort();
  return result;
}

/** `[data-debug="x"]` / `[data-debug='x']` 归一成 x；裸锚点名原样返回。 */
export function normalizeAnchorRef(value) {
  const text = String(value ?? "").trim();
  const m = SELECTOR_RE.exec(text);
  if (m) return m[1] ?? m[2];
  return text;
}

function uniq(values) {
  return [...new Set(values)].sort();
}

/**
 * 读场景目录 + 夹具目录，抽出每个场景用到的锚点 / 文字点击 / 路由。
 * @returns {{scenarios: Array, fixtureRoutes: Object, missingFixtures: Array}}
 *   scenarios[i] = {name, file, requires, steps, anchors, textClicks, routes}
 *   fixtureRoutes = 夹具名 → routes 键数组（含未被任何场景引用的夹具，供「未用路由」用）
 */
export function scanScenarios({ scenarioDir, fixtureDir }) {
  if (!existsSync(scenarioDir)) throw new Error(`scenario dir not found: ${scenarioDir}`);
  if (!existsSync(fixtureDir)) throw new Error(`fixture dir not found: ${fixtureDir}`);
  const scenarioFiles = readdirSync(scenarioDir).filter((f) => f.endsWith(".json")).sort();
  const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).sort();
  const scenarios = [];
  const missingFixtures = [];
  for (const file of scenarioFiles) {
    const scenario = JSON.parse(readFileSync(join(scenarioDir, file), "utf8"));
    const anchors = [];
    const textClicks = [];
    const routes = [];
    const asserted = [];
    for (const step of scenario.steps ?? []) {
      for (const key of ["target", "submit"]) {
        if (typeof step[key] === "string" && step[key]) {
          const name = normalizeAnchorRef(step[key]);
          if (name) anchors.push(name);
        }
      }
      if (step.cmd === "ui.click" && typeof step.text === "string" && step.text) {
        textClicks.push(step.text);
      }
      if (step.cmd === "assert.api" && typeof step.route === "string" && step.route) {
        // 断言过 = 场景真的把这条路由打到过（比 model.use 加载更硬的证据）。
        asserted.push(step.route.replace(/^\/?api\//, ""));
      }
      if (step.cmd === "model.use") {
        for (const fixtureName of step.fixtures ?? []) {
          const path = join(fixtureDir, `${fixtureName}.json`);
          if (!existsSync(path)) {
            missingFixtures.push({ scenario: file, fixture: fixtureName });
            continue;
          }
          const fixture = JSON.parse(readFileSync(path, "utf8"));
          routes.push(...Object.keys(fixture.routes ?? {}));
        }
      }
    }
    scenarios.push({
      name: scenario.name ?? file.replace(/\.json$/, ""),
      file,
      requires: scenario.requires ?? null,
      steps: scenario.steps ?? [],
      anchors: uniq(anchors),
      textClicks: uniq(textClicks),
      routes: uniq(routes),
      asserted: uniq(asserted),
    });
  }
  const fixtureRoutes = {};
  for (const file of fixtureFiles) {
    try {
      const fixture = JSON.parse(readFileSync(join(fixtureDir, file), "utf8"));
      fixtureRoutes[fixture.name ?? file.replace(/\.json$/, "")] = Object.keys(fixture.routes ?? {}).sort();
    } catch {
      // 夹具目录里解析失败的文件跳过，不打断扫描。
    }
  }
  return { scenarios, fixtureRoutes, missingFixtures };
}

/**
 * 汇总覆盖情况。
 * @param {{scenarios: Array, anchors: Object}} input
 *   scenarios 可为 scanScenarios 的返回值（含 fixtureRoutes），也可以是裸场景数组。
 * @returns {{anchorsUsed: string[], anchorsUnused: string[], anchorsUnknown: string[],
 *            routesUsed: string[], routesUnused: string[], perScenario: Object}}
 *   anchorsUnused = 代码里有、但没有任何场景引用的锚点；
 *   anchorsUnknown = 场景引用了、但代码字面量里没有的锚点（单独列出）；
 *   routesUnused = 夹具里有、但没有场景通过 model.use 用到的路由。
 */
export function aggregateCoverage({ scenarios, anchors }) {
  const list = Array.isArray(scenarios) ? scenarios : (scenarios?.scenarios ?? []);
  const fixtureRoutes = Array.isArray(scenarios) ? {} : (scenarios?.fixtureRoutes ?? {});
  const used = new Set();
  const unknown = new Set();
  for (const sc of list) {
    for (const anchor of sc.anchors ?? []) {
      if (Object.prototype.hasOwnProperty.call(anchors, anchor)) used.add(anchor);
      else unknown.add(anchor);
    }
  }
  const routesUsed = new Set();
  for (const sc of list) for (const route of sc.routes ?? []) routesUsed.add(route);
  const routesAsserted = new Set();
  for (const sc of list) for (const route of sc.asserted ?? []) routesAsserted.add(route);
  const allRoutes = new Set();
  for (const routes of Object.values(fixtureRoutes)) for (const route of routes) allRoutes.add(route);
  const perScenario = {};
  for (const sc of list) {
    perScenario[sc.name] = {
      anchors: [...new Set(sc.anchors ?? [])].sort(),
      textClicks: [...new Set(sc.textClicks ?? [])].sort(),
      routes: [...new Set(sc.routes ?? [])].sort(),
      asserted: [...new Set(sc.asserted ?? [])].sort(),
      anchorCount: new Set(sc.anchors ?? []).size,
      textClickCount: new Set(sc.textClicks ?? []).size,
      routeCount: new Set(sc.routes ?? []).size,
      assertedCount: new Set(sc.asserted ?? []).size,
    };
  }
  return {
    anchorsUsed: [...used].sort(),
    anchorsUnused: Object.keys(anchors).filter((a) => !used.has(a)).sort(),
    anchorsUnknown: [...unknown].sort(),
    routesUsed: [...routesUsed].sort(),
    routesUnused: [...allRoutes].filter((r) => !routesUsed.has(r)).sort(),
    routesAsserted: [...routesAsserted].sort(),
    // 只算「场景加载过、但没有 assert.api」的路由；从未加载的归 routesUnused。
    routesUnasserted: [...allRoutes].filter((r) => routesUsed.has(r) && !routesAsserted.has(r)).sort(),
    perScenario,
  };
}

/** 按前缀分组：love.* / practice.* / studio.* / 其他。 */
function groupByPrefix(names) {
  const groups = { "love.*": [], "practice.*": [], "studio.*": [], 其他: [] };
  for (const name of names) {
    const m = /^([a-z]+)\./.exec(name);
    const key = m && groups[m[1] + ".*"] ? m[1] + ".*" : "其他";
    groups[key].push(name);
  }
  return groups;
}

/** 列表按行宽换行，行首缩进 indent，返回行数组。 */
function wrapList(items, indent, width = 96) {
  const lines = [];
  let line = "";
  for (const item of items) {
    const piece = `${line ? ", " : ""}${item}`;
    if (line && line.length + piece.length > width) {
      lines.push(line);
      line = `${" ".repeat(indent)}${item}`;
    } else {
      line = `${line}${piece}`;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 终端可读的覆盖报告（≤ 50 行）。 */
export function formatCoverage(cov) {
  const lines = [
    "场景覆盖报告（debug scenarios vs data-debug 锚点 / 夹具路由）",
    `  场景文件          ${Object.keys(cov.perScenario).length} 个`,
    `  代码锚点          共 ${cov.anchorsUsed.length + cov.anchorsUnused.length} 个（已用 ${cov.anchorsUsed.length} / 未用 ${cov.anchorsUnused.length}）`,
    `  未知锚点          ${cov.anchorsUnknown.length} 个（场景引用但代码字面量里没有）`,
    `  夹具路由          共 ${cov.routesUsed.length + cov.routesUnused.length} 条（已用 ${cov.routesUsed.length} / 未用 ${cov.routesUnused.length}；被 assert.api 断言 ${cov.routesAsserted.length} / 未断言 ${cov.routesUnasserted.length}）`,
    "",
    "未覆盖锚点（代码里有、无任何场景引用；按前缀分组）",
  ];
  const groups = groupByPrefix(cov.anchorsUnused);
  let groupLineCount = 0;
  for (const key of ["love.*", "practice.*", "studio.*", "其他"]) {
    const items = groups[key];
    if (items.length === 0) continue;
    lines.push(`  ${key.padEnd(11)} ${items.length} 个`);
    lines.push(...wrapList(items, 4).map((l) => `  ${l}`));
    groupLineCount += 1;
  }
  if (groupLineCount === 0) lines.push("  （无）");
  lines.push("");
  lines.push("未用路由（夹具里有、但没有场景 model.use 用到）");
  if (cov.routesUnused.length) lines.push(...wrapList(cov.routesUnused, 2).map((l) => `  ${l}`));
  else lines.push("  （无）");
  lines.push("");
  lines.push("未断言路由（夹具加载了、但没有 assert.api；UI 可能没真调用它）");
  if (cov.routesUnasserted.length) lines.push(...wrapList(cov.routesUnasserted, 2).map((l) => `  ${l}`));
  else lines.push("  （无）");
  lines.push("");
  lines.push("未知锚点（场景引用了、但代码 data-debug 字面量里不存在）");
  if (cov.anchorsUnknown.length) lines.push(...wrapList(cov.anchorsUnknown, 2).map((l) => `  ${l}`));
  else lines.push("  （无）");
  lines.push("");
  lines.push("每个场景的锚点 / 文字点击 / 路由数");
  for (const [name, sc] of Object.entries(cov.perScenario)) {
    lines.push(
      `  ${name.padEnd(20)} ${String(sc.anchorCount).padStart(3)} 锚点  ${String(sc.textClickCount).padStart(3)} 文字点击  ${String(sc.routeCount).padStart(2)} 路由  ${String(sc.assertedCount).padStart(2)} 断言`,
    );
  }
  return lines.join("\n");
}
