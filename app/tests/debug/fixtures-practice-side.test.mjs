import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 练习侧 5 条路由的模型夹具结构自检（离线回放前先验形状）。
// 形状依据（勿按记忆改，改契约先改这里）：
// - hint        { hint: string }                    src/app/api/hint/route.ts + lib/tasks/hint.ts + lib/client-api.ts
// - feedback    GET { available } / POST { ok, id }  src/app/api/feedback/route.ts + components/Feedback.tsx
// - pattern     PatternResult                        lib/tasks/pattern.ts + lib/tasks/types.ts
// - reflect     { reply: string }                    src/app/api/reflect/route.ts + lib/client-api.ts (客户端固定 responseFormat:'json')
// - debrief-chat DebriefReply                        lib/tasks/debrief-chat.ts + lib/types.ts
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, "../../debug/fixtures/models/practice-side.json");
const ROUTES = ["debrief-chat", "feedback", "hint", "pattern", "reflect"];

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const entry = (route) => {
  const value = fixture.routes[route];
  assert.ok(value, `fixture missing route: ${route}`);
  const responses = Array.isArray(value) ? value : value.responses;
  assert.ok(Array.isArray(responses) && responses.length > 0, `${route}: responses must be a non-empty array`);
  return { by: Array.isArray(value) ? "counter" : (value.by ?? "counter"), responses };
};
const jsonOf = (route, i) => {
  const { responses } = entry(route);
  const response = responses[i];
  assert.ok(response?.__contentType?.startsWith("application/json"), `${route}[${i}]: expected application/json response`);
  return JSON.parse(response.__raw);
};
const str = (v, label) => {
  assert.equal(typeof v, "string", `${label}: expected string`);
  return v;
};
const obj = (v, label) => {
  assert.ok(v && typeof v === "object" && !Array.isArray(v), `${label}: expected object`);
  return v;
};

test("fixture 顶层结构：name / routes / probes", () => {
  assert.equal(typeof fixture.name, "string");
  assert.ok(fixture.routes && typeof fixture.routes === "object");
  assert.ok(fixture.probes && typeof fixture.probes === "object");
});

test("5 条路由都在，responses 非空且每条含 __raw 与 __contentType，by 合法", () => {
  assert.deepEqual(Object.keys(fixture.routes).sort(), [...ROUTES].sort());
  for (const route of ROUTES) {
    const { by, responses } = entry(route);
    assert.ok(["counter", "learnerTurns"].includes(by), `${route}: invalid by "${by}"`);
    for (const [i, response] of responses.entries()) {
      assert.equal(typeof response.__raw, "string", `${route}[${i}]: __raw must be a string`);
      assert.equal(typeof response.__contentType, "string", `${route}[${i}]: __contentType must be a string`);
    }
  }
});

test("hint：JSON 载荷为 { hint: string }，按 learnerTurns 推进多条", () => {
  const { by, responses } = entry("hint");
  assert.equal(by, "learnerTurns");
  assert.ok(responses.length >= 2, "hint: at least two responses across turns");
  for (let i = 0; i < responses.length; i++) {
    const payload = jsonOf("hint", i);
    const hint = str(payload.hint, `hint[${i}].hint`);
    assert.ok(hint.trim().length > 0, `hint[${i}]: hint must be non-empty`);
  }
});

test("feedback：GET 返回 { available: true }，POST 返回 { ok: true, id }", () => {
  const { by } = entry("feedback");
  assert.equal(by, "counter");
  const available = jsonOf("feedback", 0);
  assert.equal(available.available, true, "feedback GET: available must be true (else the send button is disabled)");
  const posted = jsonOf("feedback", 1);
  assert.equal(posted.ok, true, "feedback POST: ok must be true");
  assert.ok(typeof posted.id === "string" && posted.id.length > 0, "feedback POST: id must be a non-empty string");
});

test("pattern：载荷符合 PatternResult（found 为 true 时证据跨至少两个 session）", () => {
  const payload = jsonOf("pattern", 0);
  assert.equal(typeof payload.found, "boolean", "pattern.found must be boolean");
  str(payload.pattern, "pattern.pattern");
  str(payload.why, "pattern.why");
  str(payload.nextStep, "pattern.nextStep");
  if (payload.skill !== undefined) str(payload.skill, "pattern.skill");
  assert.ok(Array.isArray(payload.evidence), "pattern.evidence must be an array");
  if (payload.found === true) {
    assert.ok(payload.evidence.length >= 2, "pattern: found=true needs at least two evidence entries");
    const sessions = new Set(payload.evidence.map((e) => str(e.sessionId, "pattern.evidence.sessionId")));
    assert.ok(sessions.size >= 2, "pattern: evidence must come from at least two different sessions");
    for (const e of payload.evidence) {
      str(e.messageId, "pattern.evidence.messageId");
      str(e.title, "pattern.evidence.title");
      str(e.quote, "pattern.evidence.quote");
    }
  }
});

test("reflect：JSON 载荷为 { reply: string }（客户端固定 responseFormat: json）", () => {
  const { responses } = entry("reflect");
  for (let i = 0; i < responses.length; i++) {
    const payload = jsonOf("reflect", i);
    const reply = str(payload.reply, `reflect[${i}].reply`);
    assert.ok(reply.trim().length > 0, `reflect[${i}]: reply must be non-empty`);
  }
});

test("debrief-chat：载荷符合 DebriefReply（evidence/answer/example/sources）", () => {
  const { responses } = entry("debrief-chat");
  for (let i = 0; i < responses.length; i++) {
    const payload = jsonOf("debrief-chat", i);
    str(payload.evidence, `debrief-chat[${i}].evidence`);
    const answer = str(payload.answer, `debrief-chat[${i}].answer`);
    assert.ok(answer.trim().length > 0, `debrief-chat[${i}]: answer must be non-empty`);
    str(payload.example, `debrief-chat[${i}].example`);
    assert.ok(Array.isArray(payload.sources), `debrief-chat[${i}].sources must be an array`);
    for (const source of payload.sources) {
      assert.ok(["theory", "case"].includes(str(source.kind, "debrief-chat.sources.kind")), "debrief-chat.sources.kind must be theory|case");
      str(source.id, "debrief-chat.sources.id");
    }
  }
});

test("text/plain 响应（如有）必须含该路由协议要求的标记", () => {
  // 这 5 条路由当前全走 JSON（reflect 的流式分支客户端从不使用：
  // lib/client-api.ts reflectStream 固定传 responseFormat: 'json'），
  // 所以此分支目前为空；若将来有人加 text/plain 响应，必须在此登记标记。
  const STREAM_MARKERS = { "debrief-chat": [], feedback: [], hint: [], pattern: [], reflect: [] };
  let textPlainCount = 0;
  for (const route of ROUTES) {
    for (const [i, response] of entry(route).responses.entries()) {
      if (response.__contentType.includes("application/json")) continue;
      textPlainCount += 1;
      const markers = STREAM_MARKERS[route];
      assert.ok(markers.length > 0, `${route}[${i}]: text/plain response without registered protocol markers`);
      assert.ok(markers.some((m) => response.__raw.includes(m)), `${route}[${i}]: __raw must contain a protocol marker (${markers.join(", ")})`);
    }
  }
  assert.equal(textPlainCount, 0, "practice-side 当前不应有 text/plain 响应（5 条路由客户端契约均为 JSON）");
});

test("probes 覆盖全部 5 条路由，method 合法且 body 是对象", () => {
  assert.deepEqual(Object.keys(fixture.probes).sort(), [...ROUTES].sort());
  for (const route of ROUTES) {
    const probe = fixture.probes[route];
    assert.ok(probe && typeof probe === "object", `${route}: probe missing`);
    assert.ok(["GET", "POST"].includes(probe.method), `${route}: probe.method must be GET or POST`);
    const body = obj(probe.body, `${route}.probe.body`);
    assert.ok(Object.keys(body).length > 0, `${route}: probe body must not be empty`);
  }
});