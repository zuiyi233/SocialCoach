/**
 * 恋爱半教练 F1 引擎集成（spec-love-semi-coach §3/§4）：
 * - lovePlaySystem / runLovePlay 把关系状态注入系统提示（没有 state 时不注入）；
 * - TaskInputSchemas["love-play"] 接受合法 relationship、拒绝越界 tier；
 * - rioSceneSignals 从幕前/幕后签名推导本幕的结算信号；
 * - 关系结算路径不写 proficiency / loveProficiency / practiceDays / stars / assess。
 * 不联网：假 LLM 记录请求。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { scenarioById } from "../../src/data/corpus";
import { runLovePlay } from "../../src/lib/tasks/love-play";
import { systemParts, type ChatOpts, type LLM } from "../../src/lib/llm-core";
import { TaskInputSchemas } from "../../src/lib/task-input";
import {
  LoveRelationshipStateSchema,
  applySceneEnd,
  emptyRelationship,
  type LoveRelationshipState,
} from "../../src/lib/love-relationship";
import { rioSceneSignature, rioSceneSignals } from "../../src/lib/love-rio-signals";
import { emptyRioState, type RioBoundary, type RioPromise, type RioRelationshipState } from "../../src/lib/love-relationship-state";

const scenario = scenarioById("love-trust-eve-what-you-told")!;
const learnerId = scenario.characters.find((c) => c.playable)!.id;
const npcId = scenario.opening.characterId;

const VALID = {
  line: { zh: "那句是你加的，还是我的原话？", en: "Was that line yours or mine?" },
  options: [
    { zh: "是我加的。", en: "I added it." },
    { zh: "我不记得了。", en: "I do not remember." },
  ],
  emotion: "tight",
  stance: 20,
  revealed: false,
  terminal: null,
  ended: false,
};

/** 按顺序吐出 replies 的假 LLM，并留下每次收到的请求。 */
function recorder(...replies: string[]): { llm: LLM; seen: ChatOpts[] } {
  const seen: ChatOpts[] = [];
  let n = 0;
  const llm: LLM = {
    chatText: async (opts: ChatOpts) => {
      seen.push(opts);
      return replies[Math.min(n++, replies.length - 1)];
    },
    chatStream: () => {
      throw Error("not used");
    },
  };
  return { llm, seen };
}

const systemText = (o: ChatOpts) => systemParts(o.system).map((part) => part.text).join("\n");

const opening = { role: "npc" as const, characterId: npcId, text: scenario.opening.text.zh, ts: 1 };

/** 熟络阶段的关系状态：relationshipPromptBlock 里有「熟络 / 信任」的定性文案。 */
const closeRelationship: LoveRelationshipState = {
  ...emptyRelationship("love-trust-eve-what-you-told:eve", 1_000, { zh: "伊芙", en: "Eve" }),
  familiarity: 2,
  trust: 2,
  attraction: 1,
};

test("the system prompt carries the relationship block, placed after the base prompt and before the output contract", async () => {
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay(
    {
      scenario,
      learnerCharacterId: learnerId,
      language: "zh",
      messages: [opening],
      relationship: closeRelationship,
    },
    llm,
    "fake",
  );
  const system = systemText(seen[0]!);
  assert.match(system, /RELATIONSHIP SO FAR（只影响语气与主动程度，不是评分，也不许说出档位\/数值）/);
  assert.match(system, /熟络/, "the qualitative familiarity line rides along");
  assert.match(system, /先问问学习者的近况/, "the once-per-scene care rule is appended");
  assert.match(system, /不许用愧疚/, "the no-guilt-trip prohibition is part of the care rule");

  const baseAt = system.indexOf("Write every user-facing string");
  const relAt = system.indexOf("RELATIONSHIP SO FAR");
  const contractAt = system.indexOf("LOVE-PLAY GALGAME 输出契约");
  assert.ok(baseAt >= 0 && relAt > baseAt && contractAt > relAt, "the block sits between the base prompt and the output contract");
});

test("the relationship block lands before the goal/redLine block on a card that has both", async () => {
  const act4 = scenarioById("love-rio-secondment-deadline")!;
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay(
    {
      scenario: act4,
      learnerCharacterId: "you",
      language: "zh",
      messages: [{ role: "npc", characterId: act4.opening.characterId, text: act4.opening.text.zh, ts: 1 }],
      relationship: closeRelationship,
    },
    llm,
    "fake",
  );
  const system = systemText(seen[0]!);
  const relAt = system.indexOf("RELATIONSHIP SO FAR");
  const boundaryAt = system.indexOf("ROLE GOAL & BOUNDARY");
  const contractAt = system.indexOf("LOVE-PLAY GALGAME 输出契约");
  assert.ok(relAt >= 0 && boundaryAt > relAt && contractAt > boundaryAt, "relationship is injected before goal/redLine");
});

test("without a relationship the system prompt keeps the old shape and injects nothing", async () => {
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay({ scenario, learnerCharacterId: learnerId, language: "zh", messages: [opening] }, llm, "fake");
  const system = systemText(seen[0]!);
  assert.doesNotMatch(system, /RELATIONSHIP SO FAR/);
  assert.doesNotMatch(system, /先问问学习者的近况/);
  assert.match(system, /LOVE-PLAY GALGAME 输出契约/, "the rest of the prompt is untouched");
  assert.equal(seen[0]!.messages.length, 1, "the turn shape is unchanged");
});

test("runLovePlay sends the relationship on every turn request (mock LLM captures ChatOpts)", async () => {
  const { llm, seen } = recorder(JSON.stringify(VALID));
  await runLovePlay(
    {
      scenario,
      learnerCharacterId: learnerId,
      language: "zh",
      messages: [opening, { role: "learner", text: "我想先把话说清楚。", ts: 2 }],
      relationship: closeRelationship,
    },
    llm,
    "fake",
  );
  assert.equal(seen.length, 1);
  assert.match(systemText(seen[0]!), /熟络/);
});

test("the love-play input schema accepts a valid relationship and null, and rejects out-of-range tiers", () => {
  const rel = LoveRelationshipStateSchema.parse(closeRelationship);
  const base = { scenario, learnerCharacterId: learnerId, language: "zh", messages: [] };

  assert.equal(TaskInputSchemas["love-play"].safeParse(base).success, true, "no relationship stays valid (nullish)");
  assert.equal(TaskInputSchemas["love-play"].safeParse({ ...base, relationship: null }).success, true, "null relationship is accepted");
  assert.equal(TaskInputSchemas["love-play"].safeParse({ ...base, relationship: rel }).success, true, "a valid relationship passes the input gate");

  const outOfRange = TaskInputSchemas["love-play"].safeParse({ ...base, relationship: { ...rel, familiarity: 7 } });
  assert.equal(outOfRange.success, false, "a tier above 3 is rejected by the shared LoveRelationshipStateSchema");
});

/* ───────────────────────── 结算信号：rioSceneSignals ───────────────────────── */

const promise = (over: Partial<RioPromise> = {}): RioPromise => ({
  id: "p1",
  kind: "call",
  by: "learner",
  madeAtAct: 1,
  dueByAct: 2,
  status: "open",
  evidence: { kind: "quote", quoteId: "q1" },
  ...over,
});
const boundary = (over: Partial<RioBoundary> = {}): RioBoundary => ({
  id: "b1",
  topic: "pace",
  by: "learner",
  atAct: 1,
  status: "proposed",
  evidence: { kind: "quote", quoteId: "q1" },
  acceptedBy: ["learner", "rio"],
  ...over,
});
const ledger = (promises: RioPromise[], boundaries: RioBoundary[]): RioRelationshipState =>
  ({ ...emptyRioState(), promises, boundaries });

test("rioSceneSignals flags a new kept promise, a new broken promise and an agreed / repaired boundary", () => {
  const before = ledger([promise()], [boundary({ status: "crossed" })]);
  const after = ledger([promise({ status: "kept" })], [boundary({ status: "repaired" })]);
  assert.deepEqual(
    rioSceneSignals(rioSceneSignature(before), rioSceneSignature(after)),
    { promiseKept: true, promiseBroken: false, boundaryRespected: true },
  );

  assert.deepEqual(
    rioSceneSignals(rioSceneSignature(before), rioSceneSignature(ledger([promise({ status: "broken" })], [boundary({ status: "proposed" })]))),
    { promiseKept: false, promiseBroken: true, boundaryRespected: false },
  );

  assert.deepEqual(
    rioSceneSignals(rioSceneSignature(before), rioSceneSignature(ledger([promise({ status: "open" })], [boundary({ status: "agreed" })]))),
    { promiseKept: false, promiseBroken: false, boundaryRespected: true },
  );
});

test("rioSceneSignals never double-counts a status that was already settled before this scene", () => {
  const already = ledger([promise({ status: "kept" })], [boundary({ status: "agreed" })]);
  const unchanged = ledger([promise({ status: "kept" })], [boundary({ status: "agreed" })]);
  assert.deepEqual(
    rioSceneSignals(rioSceneSignature(already), rioSceneSignature(unchanged)),
    { promiseKept: false, promiseBroken: false, boundaryRespected: false },
    "a promise already kept before the scene is not a new signal",
  );
  // crossed → crossed（还没修复）不算「边界被尊重」。
  assert.deepEqual(
    rioSceneSignals(
      rioSceneSignature(ledger([], [boundary({ status: "crossed" })])),
      rioSceneSignature(ledger([], [boundary({ status: "crossed" })])),
    ),
    { promiseKept: false, promiseBroken: false, boundaryRespected: false },
  );
});

test("rioSceneSignals ignores Rio's own promises and empty ledgers stay all-false", () => {
  const rioKept = ledger([promise({ by: "rio", status: "kept" })], []);
  assert.deepEqual(
    rioSceneSignals(rioSceneSignature(emptyRioState()), rioSceneSignature(rioKept)),
    { promiseKept: false, promiseBroken: false, boundaryRespected: false },
    "a promise made by the NPC never counts as the learner keeping one",
  );

  assert.deepEqual(
    rioSceneSignals("", ""),
    { promiseKept: false, promiseBroken: false, boundaryRespected: false },
    "non-Rio scenes (empty signatures on both sides) are all-false",
  );
  assert.deepEqual(
    rioSceneSignals(rioSceneSignature(emptyRioState()), rioSceneSignature(emptyRioState())),
    { promiseKept: false, promiseBroken: false, boundaryRespected: false },
  );
});

test("the settlement pipeline never writes score-like fields", () => {
  const sources = [
    readFileSync(new URL("../../src/lib/tasks/love-play.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../src/components/love/PlayScene.tsx", import.meta.url), "utf8"),
  ];
  for (const src of sources) {
    const code = src.replace(/\/\/[^\n]*/g, ""); // 注释可以说明这些字段，代码里不得引用。
    for (const field of ["proficiency", "loveProficiency", "practiceDays", "stars", "assess"]) {
      assert.ok(!code.includes(field), `${field} must not appear in the relationship code path`);
    }
  }
});

test("the relationship settlement reducer keeps out-of-range and score fields out of the stored state", () => {
  const before = emptyRelationship("love-arc-rio-clarify:rio", 1_000, { zh: "里奥", en: "Rio" });
  const settled = applySceneEnd(before, {
    at: 1_001,
    sceneId: "love-rio-secondment-deadline",
    outcome: "success",
    freeTextQuotes: ["我想先把话说清楚"],
  });
  assert.equal(settled.applied, true);
  const stored = LoveRelationshipStateSchema.parse(settled.state);
  for (const field of ["proficiency", "loveProficiency", "practiceDays", "stars"] as const) {
    assert.ok(!(field in stored), `${field} never lands in a stored relationship`);
  }
});

test("runLovePlay asks for beats only when the caller enables them", async () => {
  const withBeats = recorder(JSON.stringify(VALID));
  await runLovePlay(
    { scenario, learnerCharacterId: learnerId, language: "zh", messages: [opening], beats: true },
    withBeats.llm,
    "fake",
  );
  assert.match(systemText(withBeats.seen[0]!), /- beats：把本回合的 line 拆成 2–4 句/);

  const without = recorder(JSON.stringify(VALID));
  await runLovePlay(
    { scenario, learnerCharacterId: learnerId, language: "zh", messages: [opening], beats: false },
    without.llm,
    "fake",
  );
  const system = systemText(without.seen[0]!);
  assert.match(system, /本回合不要输出 beats 字段/);
  assert.doesNotMatch(system, /"beats":\[/);
});

test("valid beats are returned and line is rebuilt from them", async () => {
  const reply = {
    ...VALID,
    beats: [
      { text: { zh: "第一句。", en: "First line." }, emotion: "neutral" },
      { text: { zh: "第二句。", en: "Second line." }, emotion: "smile" },
    ],
  };
  const { llm } = recorder(JSON.stringify(reply));
  const out = await runLovePlay(
    { scenario, learnerCharacterId: learnerId, language: "zh", messages: [opening], beats: true },
    llm,
    "fake",
  );
  assert.equal(out.beats?.length, 2);
  assert.equal(out.line.zh, "第一句。第二句。");
  assert.equal(out.line.en, "First line. Second line.");
  assert.equal(out.emotion, "tight", "the turn-level emotion is untouched");
});

test("bad beats are dropped without failing the whole turn", async () => {
  const reply = {
    ...VALID,
    beats: [{ text: { zh: "只有一句。", en: "Only one." }, emotion: "neutral" }],
  };
  const { llm } = recorder(JSON.stringify(reply));
  const out = await runLovePlay(
    { scenario, learnerCharacterId: learnerId, language: "zh", messages: [opening], beats: true },
    llm,
    "fake",
  );
  assert.equal(out.beats, undefined);
  assert.deepEqual(out.line, VALID.line);
});

test("the love-play input schema accepts a beats flag and rejects non-boolean values", () => {
  const base = {
    scenario,
    learnerCharacterId: learnerId,
    language: "zh" as const,
    messages: [opening],
  };
  assert.equal(TaskInputSchemas["love-play"].safeParse({ ...base, beats: true }).success, true);
  assert.equal(TaskInputSchemas["love-play"].safeParse({ ...base, beats: false }).success, true);
  assert.equal(TaskInputSchemas["love-play"].safeParse({ ...base, beats: "yes" }).success, false);
});
