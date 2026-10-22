/**
 * 模型夹具生成器：把「人写的一回合」翻译成服务端真实会发出的流式文本。
 *
 * 为什么需要它：`/api/roleplay`、`/api/assess`、`/api/reflect` 不是 JSON 接口。
 * - roleplay 回的是 `@@meta\n{...}\n@@<characterId>\n台词` 协议；
 * - assess 在协议文本后追加 `\n@@final\n<报告 JSON>`；
 * - reflect 只回纯文本。
 * 手写这些包装容易漏换行、把 `@@final` 写成双重 JSON，最后表现成「页面空白」。
 *
 * 用法（spec 文件见 app/debug/fixtures/specs/）：
 *   node scripts/debug.mjs fixture build debug/fixtures/specs/practice.json
 *   node scripts/debug.mjs fixture show practice-flow
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");
export const MODEL_FIXTURE_DIR = join(APP_ROOT, "debug", "fixtures", "models");

const RAW_TEXT = "text/plain; charset=utf-8";

function raw(text) {
  return { __raw: text, __contentType: RAW_TEXT };
}

/** roleplay 协议：meta 必须在最前，之后每个角色一段。 */
export function serializeRoleplay(turn) {
  const lines = [];
  if (turn.meta) lines.push("@@meta", JSON.stringify(turn.meta));
  for (const utterance of turn.utterances ?? []) {
    if (!utterance?.characterId) throw new Error("roleplay turn utterance needs characterId");
    lines.push(`@@${utterance.characterId}`, String(utterance.text ?? "").trim());
  }
  return `${lines.join("\n")}\n`;
}

/** assess 的 `@@final` 后面就是 JSON 文本本身，不能再 stringify 一次。 */
export function wrapAssess(report) {
  return raw(`\n@@final\n${JSON.stringify(report)}`);
}

export function wrapRoleplay(turn) {
  return raw(serializeRoleplay(turn));
}

/**
 * spec 形状：
 * {
 *   "name": "practice-flow",
 *   "routes": {
 *     "health": { "serverKey": true, "requireByok": false, "state": "available" },
 *     "roleplay": { "by": "learnerTurns", "turns": [{ "meta": {...}, "utterances": [...] }] },
 *     "assess": { "reports": [ {...Report} ] },
 *     "reflect": { "texts": ["..."] }
 *   }
 * }
 */
export function buildModelFixture(spec) {
  if (!spec || typeof spec !== "object") throw new Error("fixture spec must be an object");
  const routes = {};
  for (const [route, value] of Object.entries(spec.routes ?? {})) {
    if (value && typeof value === "object" && Array.isArray(value.turns)) {
      routes[route] = { by: value.by ?? "learnerTurns", responses: value.turns.map(wrapRoleplay) };
    } else if (value && typeof value === "object" && Array.isArray(value.reports)) {
      routes[route] = { by: value.by ?? "counter", responses: value.reports.map(wrapAssess) };
    } else if (value && typeof value === "object" && Array.isArray(value.texts)) {
      routes[route] = { by: value.by ?? "counter", responses: value.texts.map((text) => raw(String(text))) };
    } else {
      routes[route] = value;
    }
  }
  return { name: spec.name ?? "fixture", routes };
}

export function buildFromFile(file) {
  const path = resolve(APP_ROOT, file);
  const spec = JSON.parse(readFileSync(path, "utf8"));
  const fixture = buildModelFixture(spec);
  const out = join(MODEL_FIXTURE_DIR, `${fixture.name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  return { spec: path, out, name: fixture.name, routes: Object.keys(fixture.routes) };
}

export function loadFixture(name) {
  const path = name.includes("/") || name.endsWith(".json") ? resolve(APP_ROOT, name) : join(MODEL_FIXTURE_DIR, `${name}.json`);
  return { path, fixture: JSON.parse(readFileSync(path, "utf8")) };
}
