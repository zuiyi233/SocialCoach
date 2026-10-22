import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * coach-side.json 结构自检：3 条 coach 侧路由（rehearse / schedule / track）
 * 的模型夹具必须严格对得上客户端解析代码与 Zod schema。
 *
 * 三条路由都是 JSON 契约（非流式）：
 * - rehearse / schedule 由 client-api.ts 的 post() 走 `res.json()`；
 * - track 的 GET 由 analytics/track.ts probe() 走 `r.json()`；
 * - track 的 POST 是 fire-and-forget beacon，客户端不解析响应体。
 * 因此本夹具不使用 text/plain 流式协议，所有响应都以 application/json 回放。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "../../debug/fixtures/models/coach-side.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

const ROUTES = ["rehearse", "schedule", "track"];
const CONTENT_JSON = "application/json; charset=utf-8";

test("顶层结构：name 与 routes 覆盖 3 条路由", () => {
  assert.equal(fixture.name, "coach-side");
  assert.ok(fixture.routes, "fixture 必须有 routes");
  for (const route of ROUTES) assert.ok(fixture.routes[route], `缺少路由: ${route}`);
});

test("每条路由：by 为 counter（请求体无 messages 字段，learnerTurns 恒为 0）", () => {
  // engine.mjs #fixtureIndex 的 learnerTurns 从 request.postData.messages 数
  // role === "learner"（engine.mjs:952-962）。rehearse/schedule 的请求体是
  // description/profile 与 profile/history，track 的 GET 无 body、POST 是
  // {id,device,lang,events}——都没有 messages，learnerTurns 永远取第 0 条，
  // 多轮语义只能用 counter。
  for (const route of ROUTES) {
    const entry = fixture.routes[route];
    assert.equal(entry.by, "counter", `${route} 应使用 counter`);
    assert.ok(Array.isArray(entry.responses) && entry.responses.length > 0, `${route}.responses 必须非空`);
  }
});

test("每条响应：__raw / __contentType 齐全且为 JSON 契约", () => {
  for (const route of ROUTES) {
    for (const [i, response] of fixture.routes[route].responses.entries()) {
      assert.equal(typeof response.__raw, "string", `${route}[${i}] 缺 __raw`);
      assert.equal(response.__contentType, CONTENT_JSON, `${route}[${i}] 应为 ${CONTENT_JSON}`);
    }
  }
});

test("所有 application/json 响应 JSON.parse 成功", () => {
  for (const route of ROUTES) {
    for (const [i, response] of fixture.routes[route].responses.entries()) {
      assert.doesNotThrow(() => JSON.parse(response.__raw), `${route}[${i}] 不是合法 JSON`);
    }
  }
});

test("rehearse：{scenario} 严格符合 ScenarioSchema（runtime-contracts.ts:16-28）", () => {
  const body = JSON.parse(fixture.routes.rehearse.responses[0].__raw);
  assert.ok(body && typeof body === "object", "响应应为对象");
  // 客户端解构：rehearse/page.tsx:67 `const { scenario } = await rehearse(...)`
  const scenario = body.scenario;
  assert.ok(scenario, "缺少 scenario");
  for (const key of ["id", "title", "hook", "background", "context", "contextType", "competencies", "skills", "relationship", "difficulty", "minutes", "characters", "objectives", "success", "failure", "maxTurns", "opening", "source", "keywords"]) {
    assert.ok(key in scenario, `scenario 缺字段: ${key}`);
  }
  // LocalizedSchema：title/hook/background/objectives 等都是双语非空
  assert.equal(typeof scenario.title.zh, "string");
  assert.ok(scenario.title.zh.length > 0 && scenario.title.en.length > 0, "title 双语非空");
  assert.ok(Array.isArray(scenario.skills) && scenario.skills.length > 0, "skills 非空");
  assert.ok(Array.isArray(scenario.competencies) && scenario.competencies.length > 0, "competencies 非空");
  assert.ok(Array.isArray(scenario.relationship) && scenario.relationship.length > 0, "relationship 非空");
  // runRehearse refine：2-3 角色（you + 1-2 NPC）、2-3 目标、6-10 回合
  assert.equal(scenario.characters.length >= 2 && scenario.characters.length <= 3, true, "角色数 2-3");
  assert.ok(scenario.characters.some((c) => c.id === "you" && c.playable), "必须含可玩的 you");
  assert.equal(scenario.objectives.length >= 2 && scenario.objectives.length <= 3, true, "目标数 2-3");
  assert.ok(scenario.maxTurns >= 6 && scenario.maxTurns <= 10, "maxTurns 6-10");
  // superRefine：开场人必须属于角色表
  assert.ok(scenario.characters.some((c) => c.id === scenario.opening.characterId), "opening.characterId 必须属于角色表");
  assert.ok(typeof scenario.opening.text.zh === "string" && scenario.opening.text.zh.length > 0, "opening 文本非空");
  assert.equal(typeof scenario.difficulty, "number");
  assert.equal(typeof scenario.minutes, "number");
  assert.ok(scenario.minutes > 0, "minutes 必须为正");
  assert.ok(Array.isArray(scenario.keywords), "keywords 必须为数组");
});

test("schedule：{scenario, prescription, adaptation, retrieval} 符合 ScheduleResult（client-api.ts:104-109）", () => {
  const body = JSON.parse(fixture.routes.schedule.responses[0].__raw);
  const scenario = body.scenario;
  assert.ok(scenario && typeof scenario === "object", "缺少 scenario");
  assert.ok(scenario.characters.some((c) => c.id === "you" && c.playable), "schedule 场景必须含可玩的 you");
  // prescription（types.ts:39-45）
  const prescription = body.prescription;
  assert.ok(prescription, "缺少 prescription");
  assert.equal(typeof prescription.query, "string");
  assert.equal(typeof prescription.rationale, "string");
  assert.ok(prescription.rationale.length > 0, "rationale 必须写给学员看");
  assert.ok(Array.isArray(prescription.core_constraints.target_skills) && prescription.core_constraints.target_skills.length > 0, "core_constraints.target_skills 非空");
  assert.ok(Array.isArray(prescription.core_constraints.contexts), "core_constraints.contexts 必须为数组");
  assert.ok(Array.isArray(prescription.optional_constraints.related_skills), "optional_constraints.related_skills 必须为数组");
  assert.ok(Array.isArray(prescription.optional_constraints.relationship_types), "optional_constraints.relationship_types 必须为数组");
  assert.ok([1, 2, 3].includes(prescription.optional_constraints.difficulty), "optional_constraints.difficulty 1|2|3");
  // adaptation（runtime-contracts.ts:34 AdaptationSchema）
  const adaptation = body.adaptation;
  assert.ok(adaptation, "缺少 adaptation");
  assert.equal(typeof adaptation.learnerCharacterId, "string");
  assert.ok(adaptation.learnerCharacterId.length > 0, "learnerCharacterId 非空");
  assert.equal(typeof adaptation.briefing, "string");
  assert.ok(adaptation.briefing.length > 0, "briefing 非空");
  assert.ok(Array.isArray(adaptation.objectives) && adaptation.objectives.length > 0, "objectives 非空");
  // 服务端 refine：每条目标对应场景原始目标（runSchedule:87）
  assert.equal(adaptation.objectives.length, scenario.objectives.length, "adaptation.objectives 数量必须与 scenario.objectives 一致");
  assert.equal(typeof adaptation.focus, "string");
  assert.ok(adaptation.focus.length > 0, "focus 非空");
  assert.equal(typeof adaptation.why, "string");
  assert.ok(adaptation.why.length > 0, "why 非空（首页展示 session.adaptation.why）");
  // learnerCharacterId 必须对应一个可玩角色（buildSession:28）
  assert.ok(scenario.characters.some((c) => c.id === adaptation.learnerCharacterId && c.playable), "learnerCharacterId 必须对应可玩角色");
  // retrieval（types.ts:59-64）
  const retrieval = body.retrieval;
  assert.ok(retrieval, "缺少 retrieval");
  assert.ok(Array.isArray(retrieval.relaxed), "retrieval.relaxed 必须为数组");
  assert.equal(typeof retrieval.candidates, "number");
  assert.equal(retrieval.chosen, scenario.id, "retrieval.chosen 必须等于所选场景 id");
  assert.equal(retrieval.roleFit.characterId, adaptation.learnerCharacterId, "roleFit.characterId 与 adaptation 一致");
  assert.ok(["compatible", "uncertain"].includes(retrieval.roleFit.fit), "roleFit.fit 合法");
  assert.equal(typeof retrieval.roleFit.reason, "string");
});

test("track：GET probe 响应 {available:true}（analytics/track.ts:44-53 probe() 语义）", () => {
  const body = JSON.parse(fixture.routes.track.responses[0].__raw);
  // probe() 读 `!!h.available`：为 false 时客户端不会再发 POST（flushTracking:80）
  assert.equal(body.available, true);
  // 同一条响应同时喂给 POST（beacon 不解析响应体，track/route.ts 202 {ok:true} 的
  // 等价语义由回放引擎固定 200 + 该 JSON 承担，engine.mjs:1039-1047）
});

test("probes：覆盖全部路由且结构正确", () => {
  assert.ok(fixture.probes && typeof fixture.probes === "object", "必须有顶层 probes");
  for (const route of ROUTES) {
    const list = fixture.probes[route];
    assert.ok(Array.isArray(list) && list.length > 0, `${route} 至少一个 probe`);
    for (const probe of list) {
      assert.ok(["GET", "POST"].includes(probe.method), `${route} probe.method 必须为 GET|POST`);
      if (probe.method === "POST") {
        assert.ok(probe.body && typeof probe.body === "object", `${route} POST probe 必须有 body`);
      } else {
        assert.equal(probe.body, undefined, `${route} GET probe 不应有 body`);
      }
    }
  }
});

test("probes：字段名对得上 route.ts 实际读取的输入（task-input.ts:26-27 / analytics/schema.ts:86-94）", () => {
  const rehearse = fixture.probes.rehearse[0].body;
  assert.equal(typeof rehearse.description, "string");
  assert.ok(rehearse.description.length >= 8, "rehearse.description 至少 8 字（RehearsalDescriptionSchema）");
  assert.ok(["zh", "en"].includes(rehearse.lang), "rehearse.lang 必须为 zh|en");
  assert.equal(typeof rehearse.profile.name, "string");
  assert.ok(Array.isArray(rehearse.profile.goals), "rehearse.profile.goals 必须为数组");

  const schedule = fixture.probes.schedule[0].body;
  assert.equal(typeof schedule.profile.name, "string");
  assert.equal(typeof schedule.profile.bio, "string");
  assert.ok(Array.isArray(schedule.profile.goals), "schedule.profile.goals 必须为数组");
  assert.ok(Array.isArray(schedule.profile.contexts), "schedule.profile.contexts 必须为数组");
  assert.ok(["zh", "en"].includes(schedule.profile.lang), "schedule.profile.lang 必须为 zh|en");
  assert.equal(typeof schedule.profile.createdAt, "number", "ProfileSchema 需要 createdAt");
  assert.equal(typeof schedule.proficiency.communication, "number", "proficiency 按技能打分 1-5");
  assert.ok(Array.isArray(schedule.history), "schedule.history 必须为数组");
  assert.ok(["zh", "en"].includes(schedule.lang), "schedule.lang 必须为 zh|en");

  const trackGet = fixture.probes.track.find((p) => p.method === "GET");
  assert.ok(trackGet, "track 必须有 GET probe（probe() 先探活）");
  const trackPost = fixture.probes.track.find((p) => p.method === "POST");
  assert.ok(trackPost, "track 必须有 POST probe（flushTracking beacon）");
  const batch = trackPost.body;
  assert.equal(typeof batch.id, "string", "batch.id 是 uuid 幂等键");
  assert.equal(typeof batch.device, "string", "batch.device 是设备 uuid");
  assert.ok(["zh", "en"].includes(batch.lang), "batch.lang 必须为 zh|en");
  assert.ok(Array.isArray(batch.events) && batch.events.length >= 1 && batch.events.length <= 20, "events 1-20 条");
  assert.equal(batch.events[0].name, "app_open", "事件名必须来自 eventSchema 判别联合");
});
