/** Run from app/: npx tsx scripts/check-corpus.ts */
import assert from "node:assert/strict";
import { retrieveKnowledge, retrieveScenario } from "../src/lib/retrieval";
import { buildSession } from "../src/lib/session-utils";
import { SCENARIOS, THEORIES, CASES } from "../src/data/corpus";
import { SCENARIOS_C } from "../src/data/corpus/scenarios-c";
import { SCENARIOS_D } from "../src/data/corpus/scenarios-d";
import { SCENARIOS_WF } from "../src/data/corpus/scenarios-wf";
import { SCENARIOS_FRIENDSHIP } from "../src/data/corpus/scenarios-friendship";
import { THEORIES_C } from "../src/data/corpus/theories-c";
import { CASES_C } from "../src/data/corpus/cases-c";
import { LOVE_SCENARIOS } from "../src/data/corpus/love-scenarios";
import { LOVE_SCENARIOS_DEEP_APPROACH } from "../src/data/corpus/love-scenarios-deep-approach";
import { LOVE_SCENARIOS_DEEP_DEFINE } from "../src/data/corpus/love-scenarios-deep-define";
import { LOVE_SCENARIOS_DEEP_REJECTION } from "../src/data/corpus/love-scenarios-deep-rejection";
import { LOVE_SCENARIOS_DEEP_BREAKUP } from "../src/data/corpus/love-scenarios-deep-breakup";
import { LOVE_SCENARIOS_DEEP_BOUNDARY } from "../src/data/corpus/love-scenarios-deep-boundary";
import { LOVE_SCENARIOS_DEEP_TRUST } from "../src/data/corpus/love-scenarios-deep-trust";
import { LOVE_SCENARIOS_DEEP_LONG_DISTANCE } from "../src/data/corpus/love-scenarios-deep-long-distance";
import { LOVE_SCENARIOS_DEEP_FAMILY } from "../src/data/corpus/love-scenarios-deep-family";
import { LOVE_SCENARIOS_DEEP_RIO_ROUTE } from "../src/data/corpus/love-scenarios-deep-rio-route";
import { LOVE_THEORIES } from "../src/data/corpus/love-theories";
import { LOVE_CASES } from "../src/data/corpus/love-cases";
import { SKILLS, COMPETENCIES, CONTEXTS, RELATIONSHIPS } from "../src/data/taxonomy";
import { SCENARIO_ICONS } from "../src/data/scenario-icons";

const skills = new Map(SKILLS.map((s) => [s.id, s.competency]));
const competencies = new Set(COMPETENCIES.map((c) => c.id));
const contexts = new Set(CONTEXTS.map((c) => c.id));
const items = [...SCENARIOS, ...THEORIES, ...CASES];
const ids = new Set<string>();
function bilingual(value: unknown, path: string) {
  if (!value || typeof value !== "object") return;
  if ("zh" in value || "en" in value) {
    for (const lang of ["zh", "en"] as const) {
      const text = (value as Record<string, unknown>)[lang];
      assert(typeof text === "string" && text.trim(), `${path}.${lang} missing`);
    }
  }
  for (const [key, child] of Object.entries(value)) bilingual(child, `${path}.${key}`);
}
for (const item of items) {
  assert(!ids.has(item.id), `Duplicate id: ${item.id}`);
  ids.add(item.id);
  assert(item.skills.length, `${item.id}: no skill`);
  for (const skill of item.skills) assert(skills.has(skill), `${item.id}: invalid skill ${skill}`);
  for (const c of item.competencies) assert(competencies.has(c), `${item.id}: invalid competency ${c}`);
  if ("context" in item && item.context) assert(contexts.has(item.context), `${item.id}: invalid context`);
  assert(item.source, `${item.id}: no source`);
  bilingual(item.title, `${item.id}.title`);
}
for (const s of SCENARIOS) {
  const characterIds = s.characters.map((c) => c.id);
  assert.equal(new Set(characterIds).size, characterIds.length, `${s.id}: duplicate character`);
  assert.equal(characterIds.filter((id) => id === "you").length, 1, `${s.id}: missing learner`);
  assert(s.characters.find((c) => c.id === "you")?.playable, `${s.id}: learner not playable`);
  assert(characterIds.includes(s.opening.characterId) && s.opening.characterId !== "you", `${s.id}: invalid opening`);
  assert(s.objectives.length >= 2 && s.objectives.length <= 3, `${s.id}: objective count`);
  assert(s.maxTurns > 0 && [1, 2, 3].includes(s.difficulty), `${s.id}: invalid limits`);
  for (const relationship of s.relationship) assert(relationship in RELATIONSHIPS, `${s.id}: relationship`);
  for (const skill of s.relatedSkills ?? []) assert(skills.has(skill), `${s.id}: related skill`);
}
for (const item of [...SCENARIOS_C, ...SCENARIOS_D, ...SCENARIOS_WF, ...SCENARIOS_FRIENDSHIP, ...THEORIES_C, ...CASES_C, ...LOVE_SCENARIOS, ...LOVE_THEORIES, ...LOVE_CASES, ...LOVE_SCENARIOS_DEEP_APPROACH, ...LOVE_SCENARIOS_DEEP_DEFINE, ...LOVE_SCENARIOS_DEEP_REJECTION, ...LOVE_SCENARIOS_DEEP_BREAKUP, ...LOVE_SCENARIOS_DEEP_BOUNDARY, ...LOVE_SCENARIOS_DEEP_TRUST, ...LOVE_SCENARIOS_DEEP_LONG_DISTANCE, ...LOVE_SCENARIOS_DEEP_FAMILY, ...LOVE_SCENARIOS_DEEP_RIO_ROUTE]) {
  bilingual(item, item.id);
  for (const skill of item.skills) assert(item.competencies.includes(skills.get(skill)!), `${item.id}: missing competency for ${skill}`);
  assert(
    item.keywords.some((k) => /[\u4e00-\u9fff]/u.test(k)),
    `${item.id}: missing Chinese keywords`,
  );
  if (typeof item.source !== "string") {
    if (item.source.url) assert.equal(new URL(item.source.url).protocol, "https:");
    else assert(item.source.book && item.source.author, `${item.id}: source without url needs book + author`);
  }
}
// C/D 与 2026-10-10 的两个 practical 分桶批次共用同一条验收线：自己的图标、
// 每个 NPC 都有 hidden/stance/personality 的阻力，以及原创练习出处标签。
for (const s of [...SCENARIOS_C, ...SCENARIOS_D, ...SCENARIOS_WF, ...SCENARIOS_FRIENDSHIP]) {
  assert(s.icon && s.icon in SCENARIO_ICONS, `${s.id}: unknown icon`);
  assert(
    s.characters.every((c) => c.hidden && c.stance.en && c.personality.en),
    `${s.id}: missing resistance`,
  );
  assert(s.source.includes("Original fictional practice"), `${s.id}: missing provenance label`);
}
// Deep love-module scenarios (practical 场景化批次): original fictional
// practices with an authored facts/unknowns brief, visible NPC resistance and
// their own icon — the same bar as the C/D batches.
for (const s of [...LOVE_SCENARIOS_DEEP_APPROACH, ...LOVE_SCENARIOS_DEEP_DEFINE, ...LOVE_SCENARIOS_DEEP_REJECTION, ...LOVE_SCENARIOS_DEEP_BREAKUP, ...LOVE_SCENARIOS_DEEP_BOUNDARY, ...LOVE_SCENARIOS_DEEP_TRUST, ...LOVE_SCENARIOS_DEEP_LONG_DISTANCE, ...LOVE_SCENARIOS_DEEP_FAMILY, ...LOVE_SCENARIOS_DEEP_RIO_ROUTE]) {
  assert(s.icon && s.icon in SCENARIO_ICONS, `${s.id}: unknown icon`);
  assert(s.simulationFacts?.zh && s.simulationFacts.en, `${s.id}: missing simulationFacts`);
  assert(
    s.characters.every((c) => c.hidden && c.stance.en && c.personality.en),
    `${s.id}: missing resistance`,
  );
  assert(s.source.includes("Original fictional practice"), `${s.id}: missing provenance label`);
}
for (const s of LOVE_SCENARIOS) {
  assert(s.loveTopic, `${s.id}: missing loveTopic`);
}
// Every romantic-context scene must carry a love topic, or it is invisible to
// the love page, the arena topic filter and the love proficiency track.
for (const s of SCENARIOS) {
  if (s.context === "romantic") assert(s.loveTopic, `${s.id}: romantic scene missing loveTopic`);
  // 学习者身份必须在 LEARNER_ROLE 登记：漏登记会静默退化成「你自己」，而 arena、
  // 自定义排练与报告共用同一份角色文本。
  const you = s.characters.find((c) => c.id === "you");
  assert(you && you.role.zh !== "你自己" && you.role.en !== "Yourself", `${s.id}: learner role not registered`);
}
for (const t of THEORIES) {
  // Every theory on the romance track must be pinned to the romantic context,
  // or context-weighted retrieval could surface it for the wrong domain.
  if (t.loveTopic) assert.equal(t.context, "romantic", `${t.id}: love theory must carry context romantic`);
}
// Storyline series: the same series id must always carry the same bilingual name.
const seriesNames = new Map<string, string>();
for (const s of SCENARIOS) {
  if (!s.series) continue;
  const key = JSON.stringify([s.series.id, s.series.name.zh, s.series.name.en]);
  const seen = seriesNames.get(s.series.id);
  assert(!seen || seen === key, `${s.id}: series ${s.series.id} name mismatch`);
  seriesNames.set(s.series.id, key);
}
/** 最长公共子串长度（中文按字、英文按字符）；用来判断 hidden 是否漏进 opening。 */
function longestSharedRun(a: string, b: string): number {
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  for (let len = short.length; len > 0; len -= 1) {
    for (let start = 0; start + len <= short.length; start += 1) {
      if (long.includes(short.slice(start, start + len))) return len;
    }
  }
  return 0;
}
// Rio 六幕线（spec-love-rio-route §6.1）：第 1–4 幕 order 连续、同一 seriesId、
// 每幕只挂 Rio 一个 NPC；第 5–6 幕在 3–5 人真人试玩闸门通过前不得出现。
const rioLine = SCENARIOS
  .filter((s) => s.series?.id === "love-arc-rio-clarify")
  .sort((a, b) => (a.series?.order ?? 0) - (b.series?.order ?? 0));
assert.deepEqual(
  rioLine.map((s) => s.series?.order),
  [1, 2, 3, 4],
  "Rio line: only acts 1-4 may be authored before the playtest gate, with contiguous orders",
);
for (const s of rioLine) {
  assert(s.source.trim(), `${s.id}: missing source`);
  assert.equal(s.series?.id, "love-arc-rio-clarify", `${s.id}: series id drift`);
  assert.deepEqual(
    s.characters.filter((c) => c.id !== "you").map((c) => c.id),
    ["rio"],
    `${s.id}: Rio line must stay single-NPC`,
  );
}
const rioAct4 = SCENARIOS.find((s) => s.id === "love-rio-secondment-deadline");
assert(rioAct4, "Rio act 4 is not registered in SCENARIOS");
assert.equal(rioAct4.series?.order, 4, "Rio act 4 must carry order 4");
const rioHidden = rioAct4.characters.find((c) => c.id === "rio")?.hidden;
assert(rioHidden?.zh && rioHidden.en, "Rio act 4 hidden must be bilingual");
// hidden 的开场探针：不是关键词黑名单，而是最长公共片段（zh ≥ 8 字 / en ≥ 20 字符即算泄露）。
assert(
  longestSharedRun(rioHidden.zh, rioAct4.opening.text.zh) < 8,
  "Rio act 4 opening leaks a fragment of hidden (zh)",
);
assert(
  longestSharedRun(rioHidden.en, rioAct4.opening.text.en) < 20,
  "Rio act 4 opening leaks a fragment of hidden (en)",
);
for (const c of CASES_C) {
  assert(c.title.zh.startsWith("示例") && c.title.en.startsWith("Illustration"), `${c.id}: fictional case not labelled`);
}
assert.equal(SCENARIOS_C.length, 12);
assert.equal(SCENARIOS_D.length, 12);
assert.equal(new Set(SCENARIOS_D.map((s) => s.context)).size, 7, "new scenes must span every existing context");
for (const s of SCENARIOS_D) {
  assert(s.source.endsWith(`scenarios-d.ts#${s.id}`), `${s.id}: original source must point to its authored record`);
  for (const lang of ["zh", "en"] as const) {
    const session = buildSession(SCENARIOS.find((item) => item.id === s.id)!, "arena", lang);
    assert.equal(session.learnerCharacterId, "you");
    assert.notEqual(session.scenario.characters[0].role[lang], lang === "zh" ? "你自己" : "Yourself");
  }
}
// 2026-10-10 的两个 practical 分桶批次：除 C/D 那条通用验收线之外，还锁两件事——
// 处境不得跨桶（职场线不许写成 friendship 场景，反之亦然），以及每条都要有自己的
// 事实/未知清单。
for (const [batch, file, context, count] of [
  [SCENARIOS_WF, "scenarios-wf.ts", "workplace", 6],
  [SCENARIOS_FRIENDSHIP, "scenarios-friendship.ts", "friendship", 12],
] as const) {
  assert.equal(batch.length, count, `${file}: scenario count`);
  for (const s of batch) {
    assert.equal(s.context, context, `${s.id}: must stay in its own bucket`);
    assert(!s.loveTopic, `${s.id}: non-romantic scene must not carry a loveTopic`);
    assert(s.source.endsWith(`${file}#${s.id}`), `${s.id}: original source must point to its authored record`);
    assert(s.simulationFacts?.zh && s.simulationFacts.en, `${s.id}: missing simulationFacts`);
  }
}
assert.equal(THEORIES_C.length, 8);
assert.equal(CASES_C.length, 6);
console.log(
  JSON.stringify(
    {
      scenarios: SCENARIOS.length,
      theories: THEORIES.length,
      cases: CASES.length,
      contexts: Object.fromEntries(CONTEXTS.map((c) => [c.id, SCENARIOS.filter((s) => s.context === c.id).length])),
      addedDifficulty: Object.fromEntries([1, 2, 3].map((d) => [d, SCENARIOS_D.filter((s) => s.difficulty === d).length])),
    },
    null,
    2,
  ),
);

const pick = retrieveScenario({ query: "accessibility wheelchair event", core_constraints: { target_skills: ["standing-up"], contexts: ["party"] }, rationale: "Corpus check" }, new Set());
assert.equal(pick.scenario?.id, "event-access-request", "new scene not reachable through scheduling retrieval");
for (const lang of ["zh", "en"] as const) {
  const session = buildSession(pick.scenario!, "arena", lang);
  assert.equal(session.learnerCharacterId, "you", "wrong learner in new practice");
}
const knowledge = retrieveKnowledge({ skills: ["empathy", "building-relationships"], context: "friendship", query: "good news celebration capitalization", acquisition: true, performance: true });
assert(knowledge.theories.some((t) => t.id === "active-constructive-response"), "new theory not retrievable");
assert(knowledge.cases.some((c) => c.id === "case-news-follow-up"), "new teaching illustration not retrievable");
// Love-topic weighting: the queries are deliberately topic-neutral (no overlap
// with theory keywords or titles) so only the +3 love-topic boost can surface a
// theory that shares no skill with the query.
const loveKb = retrieveKnowledge({ skills: ["communication"], context: "romantic", loveTopic: "breakup", query: "把这句很难讲出来的话好好说完", acquisition: true, performance: true });
assert(loveKb.theories.some((t) => t.loveTopic === "breakup"), "love topic weighting lost for breakup");
const ldKb = retrieveKnowledge({ skills: ["emotion-regulation"], context: "romantic", loveTopic: "long-distance", query: "在很远的夜里一个人想了很久", acquisition: true, performance: true });
assert(ldKb.theories.some((t) => t.loveTopic === "long-distance"), "love topic weighting lost for long-distance");
console.log("Scheduling, bilingual session creation, and debrief knowledge retrieval passed.");
