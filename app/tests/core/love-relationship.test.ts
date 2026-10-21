/** 恋爱半教练 F1 数据层（spec-love-semi-coach §3/§4/§6）：reducer、主动关心预算、回顾、v3 store 集成与导出。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LovePlaySchema, parseLovePlaySlot } from "../../src/lib/archive";
import { decodeBackup, lovePlayBackup } from "../../src/lib/backup";
import {
  LOVE_STORY_KEY,
  deleteLoveRelationship,
  readAllLoveRelationships,
  readLoveRelationship,
  readLoveStoryStore,
  writeLoveRelationship,
} from "../../src/lib/love-story";
import {
  LoveRelationshipStateSchema,
  applySceneEnd,
  buildRelationshipReview,
  careLine,
  deriveStage,
  emptyRelationship,
  markCareShown,
  recordFreeText,
  relationshipKey,
  relationshipPromptBlock,
  shouldOfferCare,
  stageKey,
  type LoveRelationshipState,
  type LoveSceneEndInput,
} from "../../src/lib/love-relationship";

const slots = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() { return slots.size; },
    key: (index: number) => [...slots.keys()][index] ?? null,
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => { slots.set(key, value); },
    removeItem: (key: string) => { slots.delete(key); },
  },
});

const reset = () => slots.clear();
const putRaw = (value: unknown) => slots.set(LOVE_STORY_KEY, JSON.stringify(value));

const NOW = 1_700_000_000_000;
const rel = (over: Partial<LoveRelationshipState> = {}): LoveRelationshipState => ({
  v: 1,
  characterKey: "love-arc-rio-clarify:rio",
  familiarity: 1,
  trust: 1,
  attraction: 0,
  signals: [],
  updatedAt: NOW,
  ...over,
});

const sceneEnd = (over: Partial<LoveSceneEndInput> = {}): LoveSceneEndInput => ({
  at: NOW + 1,
  sceneId: "love-arc-rio-clarify-1",
  outcome: "success",
  endingId: "rio-said-it",
  ...over,
});

test("relationshipKey mixes series or scenario with characterId and emptyRelationship starts at zero", () => {
  assert.equal(relationshipKey("love-arc-rio-clarify", "love-arc-rio-clarify-1", "rio"), "love-arc-rio-clarify:rio");
  assert.equal(relationshipKey(null, "love-approach-hobby-event", "tess"), "love-approach-hobby-event:tess");
  assert.equal(relationshipKey(undefined, "love-approach-hobby-event", "tess"), "love-approach-hobby-event:tess");
  assert.equal(relationshipKey("", "love-approach-hobby-event", "tess"), "love-approach-hobby-event:tess");

  const empty = emptyRelationship("s:r", 100, { zh: "里奥", en: "Rio" });
  assert.deepEqual(empty, {
    v: 1,
    characterKey: "s:r",
    familiarity: 0,
    trust: 0,
    attraction: 0,
    signals: [],
    updatedAt: 100,
    characterName: { zh: "里奥", en: "Rio" },
  });
  assert.deepEqual(deriveStage(empty), 0);
  assert.equal(deriveStage({ familiarity: 3, trust: 1 }), 1, "stage is the min of familiarity and trust");
  assert.deepEqual([0, 1, 2, 3].map((t) => stageKey(t as 0 | 1 | 2 | 3)), [
    "love_stage_stranger",
    "love_stage_acquaintance",
    "love_stage_close",
    "love_stage_intimate",
  ]);
});

test("LoveRelationshipStateSchema accepts a valid state, rejects out-of-range tiers and strips unknown score fields", () => {
  assert.equal(LoveRelationshipStateSchema.safeParse(rel()).success, true);
  assert.equal(LoveRelationshipStateSchema.safeParse(rel({ characterName: { zh: "里奥", en: "Rio" } })).success, true);

  for (const tier of [4, -1, 2.5]) {
    const result = LoveRelationshipStateSchema.safeParse({ ...rel(), familiarity: tier });
    assert.equal(result.success, false, `tier ${tier} must be rejected`);
  }
  const tooMany = LoveRelationshipStateSchema.safeParse({
    ...rel(),
    signals: Array.from({ length: 21 }, (_, i) => ({ kind: "free-text" as const, at: i, quote: `q${i}` })),
  });
  assert.equal(tooMany.success, false, "more than 20 signals are rejected");

  const polluted = LoveRelationshipStateSchema.parse({
    ...rel(),
    proficiency: 91,
    loveProficiency: { charm: 5 },
    stars: 3,
  } as unknown as LoveRelationshipState);
  for (const field of ["proficiency", "loveProficiency", "stars"]) {
    assert.ok(!(field in polluted), `${field} must be stripped`);
  }
});

test("a v2 store reads as v3 with empty relationships; a valid v3 round-trips; a broken v3 is not silently fixed", () => {
  reset();
  putRaw({ v: 2, revision: 1, saves: {}, slots: {}, records: [], routes: {}, updatedAt: 1 });
  const migrated = readLoveStoryStore();
  assert.equal(migrated.status, "ok");
  if (migrated.status !== "ok") return;
  assert.equal(migrated.store.v, 3);
  assert.deepEqual(migrated.store.relationships, {}, "v2 reads are backfilled with an empty relationships map");

  reset();
  assert.equal(writeLoveRelationship(rel()).ok, true);
  const read = readLoveStoryStore();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") return;
  assert.deepEqual(read.store.relationships["love-arc-rio-clarify:rio"], rel());

  reset();
  const broken = { v: 3, revision: 1, saves: {}, slots: {}, records: [], routes: {}, relationships: { "s:r": { ...rel(), familiarity: 9 } }, updatedAt: 1 };
  putRaw(broken);
  const refused = readLoveStoryStore();
  assert.equal(refused.status, "corrupt");
  if (refused.status === "corrupt") assert.equal(refused.reason, "shape", "a broken v3 store is corrupt, not silently repaired");
});

test("applySceneEnd is idempotent per scene and advances each dimension at most one per scene", () => {
  const applied = applySceneEnd(rel({ familiarity: 0, trust: 0, attraction: 0 }), sceneEnd());
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.changes, [
    { dimension: "familiarity", from: 0, to: 1 },
    { dimension: "trust", from: 0, to: 1 },
    { dimension: "attraction", from: 0, to: 1 },
  ]);
  assert.equal(applied.state.familiarity, 1);
  assert.equal(applied.state.trust, 1);
  assert.equal(applied.state.attraction, 1);
  assert.ok(applied.state.signals.every((s) => s.kind === "scene-end" && s.sceneId === "love-arc-rio-clarify-1"));
  assert.equal(applied.state.signals.length, 3, "one scene-end signal per advanced dimension");

  const replay = applySceneEnd(applied.state, sceneEnd());
  assert.equal(replay.applied, false, "the same sceneId does not advance twice");
  assert.deepEqual(replay.changes, []);
  assert.equal(replay.state, applied.state, "a replay returns the very same state object, unchanged");
  assert.deepEqual(replay.state, applied.state);
});

test("applySceneEnd caps each dimension at 3 and never deducts", () => {
  let state = rel({ familiarity: 0, trust: 0, attraction: 0 });
  for (let i = 0; i < 4; i++) {
    const result = applySceneEnd(state, sceneEnd({ sceneId: `scene-${i}`, at: NOW + i }));
    state = result.state;
  }
  assert.equal(state.familiarity, 3, "familiarity caps at 3");
  assert.equal(state.trust, 3, "trust caps at 3");
  assert.equal(state.attraction, 3, "attraction caps at 3");
  assert.equal(state.signals.filter((s) => s.kind === "scene-end").length, 9, "the capped scene wrote no extra scene-end");

  const capBlocked = applySceneEnd(state, sceneEnd({ sceneId: "scene-extra", at: NOW + 99 }));
  assert.equal(capBlocked.applied, false, "a scene with nothing left to advance is a no-op");
  assert.deepEqual(capBlocked.changes, []);
  assert.equal(state.signals.length, 9);
});

test("failure does not advance familiarity; promiseBroken never deducts trust; no endingId never advances attraction", () => {
  const afterFailure = applySceneEnd(
    rel({ familiarity: 2, trust: 2, attraction: 2 }),
    sceneEnd({ outcome: "failure", endingId: null, promiseBroken: true }),
  );
  assert.equal(afterFailure.applied, true, "a promise-broken record is still written");
  assert.deepEqual(afterFailure.changes, []);
  assert.equal(afterFailure.state.familiarity, 2, "failure does not push familiarity");
  assert.equal(afterFailure.state.trust, 2, "promiseBroken does not deduct trust");
  assert.equal(afterFailure.state.attraction, 2);
  assert.ok(afterFailure.state.signals.some((s) => s.kind === "promise-broken"));

  const noEnding = applySceneEnd(
    rel({ familiarity: 1, trust: 1, attraction: 0 }),
    sceneEnd({ endingId: null, revealed: true }),
  );
  assert.deepEqual(noEnding.changes, [
    { dimension: "familiarity", from: 1, to: 2 },
    { dimension: "trust", from: 1, to: 2 },
  ]);
  assert.equal(noEnding.state.attraction, 0, "revealed alone does not advance attraction");
});

test("signals are capped at 20 and pruning keeps the newest; free text stays verbatim and is never deduped", () => {
  const seeded = rel({
    signals: Array.from({ length: 18 }, (_, i) => ({ kind: "free-text" as const, at: i, quote: `q${i}` })),
  });
  const result = applySceneEnd(
    seeded,
    sceneEnd({ freeTextQuotes: [" 我 说的原话  ", "周三晚上打给你，就这次。"] }),
  );
  assert.equal(result.state.signals.length, 20, "18 + 3 scene-end + 2 free-text = 23, pruned to the newest 20");
  assert.ok(!result.state.signals.some((s) => s.quote === "q0"), "the oldest signals are dropped");
  assert.ok(!result.state.signals.some((s) => s.quote === "q1"));
  assert.ok(result.state.signals.some((s) => s.quote === "q17"), "the newest old signals survive");
  const free = result.state.signals.filter((s) => s.kind === "free-text");
  assert.deepEqual(
    free.slice(-2).map((s) => s.quote),
    [" 我 说的原话  ", "周三晚上打给你，就这次。"],
    "the newest free text stays verbatim and in order, no dedup",
  );
  assert.ok(result.state.signals.some((s) => s.quote === " 我 说的原话  "));

  const dupe = applySceneEnd(rel(), sceneEnd({ freeTextQuotes: ["同一句", "同一句"] }));
  assert.equal(dupe.state.signals.filter((s) => s.kind === "free-text").length, 2, "the same quote twice stays twice");
});

test("recordFreeText and markCareShown mutate only their own fields", () => {
  const r = recordFreeText(rel({ updatedAt: 100 }), " 带空格  的原话 ", 200);
  assert.deepEqual(r.signals, [{ kind: "free-text", at: 200, quote: " 带空格  的原话 " }]);
  assert.equal(r.updatedAt, 200, "updatedAt moves forward with the event");
  assert.equal(r.familiarity, rel().familiarity);

  const cared = markCareShown(rel({ updatedAt: 100 }), "scene-care", 300);
  assert.equal(cared.lastCareAt, 300);
  assert.equal(cared.lastCareSceneId, "scene-care");
  assert.equal(cared.updatedAt, 300);
  assert.equal(cared.familiarity, rel().familiarity);
});

test("shouldOfferCare gates on the switch, stage threshold, same-scene budget, 24h window and quiet hours", () => {
  const eligible = rel({ familiarity: 2, trust: 2 });
  // hour 传给固定值，避免测试运行所在时区的「当前小时」落到免打扰窗口里。
  const opts = { now: NOW + 60_000, enabled: true, hour: 10 };
  assert.equal(shouldOfferCare(eligible, opts), true, "stage 2 and no history offers care");
  assert.equal(shouldOfferCare(rel({ familiarity: 1, trust: 2 }), opts), false, "below the default stageMin is silent");
  assert.equal(
    shouldOfferCare(rel({ familiarity: 1, trust: 2 }), { ...opts, stageMin: 1 }),
    true,
    "a lowered stageMin lets stage 1 through",
  );
  assert.equal(shouldOfferCare(null, opts), false);
  assert.equal(shouldOfferCare(eligible, { ...opts, enabled: false }), false, "the off switch wins over everything");

  assert.equal(
    shouldOfferCare(markCareShown(eligible, "scene-care", NOW), { ...opts, sceneId: "scene-care" }),
    false,
    "the same scene never gets a second care in one visit",
  );
  assert.equal(
    shouldOfferCare(markCareShown(eligible, "scene-other", NOW - 2 * 60 * 60 * 1000), opts),
    false,
    "less than 24h since the last care is silent",
  );
  assert.equal(
    shouldOfferCare(markCareShown(eligible, "scene-other", NOW - 24 * 60 * 60 * 1000), opts),
    true,
    "a care older than 24h releases the budget",
  );

  for (const hour of [22, 23, 0, 7]) {
    assert.equal(shouldOfferCare(eligible, { ...opts, hour }), false, `hour ${hour} is quiet`);
  }
  for (const hour of [10, 13, 21]) {
    assert.equal(shouldOfferCare(eligible, { ...opts, hour }), true, `hour ${hour} may offer care`);
  }
});

test("careLine is deterministic, stage-aware and gender-neutral", () => {
  const a = rel({ familiarity: 2, trust: 2 });
  const b = rel({ familiarity: 2, trust: 2, signals: [{ kind: "scene-end", at: 1, sceneId: "s1" }] });
  assert.equal(careLine(a, "zh"), careLine(a, "zh"), "the same state picks the same line");
  assert.ok(careLine(a, "zh").length > 0 && careLine(a, "en").length > 0);
  assert.ok(careLine(a, "zh") !== careLine(b, "zh"), "different histories pick a different line within the pool");
  assert.ok(!/[她他]/.test(careLine(a, "zh")), "built-in lines never assume a gender");
});

test("buildRelationshipReview quotes only free input, and advice stays empty without it", () => {
  const before = rel({ familiarity: 1, trust: 1 });
  const after = applySceneEnd(before, sceneEnd({ freeTextQuotes: ["我想先把话说清楚"] })).state;
  const review = buildRelationshipReview(before, after, "zh");
  assert.equal(review.stage, 2);
  assert.deepEqual(review.changes, [
    { dimension: "familiarity", from: 1, to: 2 },
    { dimension: "trust", from: 1, to: 2 },
    { dimension: "attraction", from: 0, to: 1 },
  ]);
  assert.deepEqual(review.quotes, ["我想先把话说清楚"]);
  assert.equal(review.hasFreeText, true);
  assert.ok(review.advice.length >= 1 && review.advice.length <= 2);
  assert.ok(review.advice[0].includes("我想先把话说清楚"), "advice cites the user's own words");
  for (const field of ["stars", "score", "proficiency", "loveProficiency"]) {
    assert.ok(!(field in review), `${field} never appears in a review`);
  }

  const noInput = applySceneEnd(rel({ familiarity: 2, trust: 2 }), sceneEnd({ sceneId: "scene-pick-only" })).state;
  const pickOnly = buildRelationshipReview(null, noInput, "zh");
  assert.equal(pickOnly.hasFreeText, false);
  assert.deepEqual(pickOnly.quotes, []);
  assert.deepEqual(pickOnly.advice, [], "no free input means no advice, even though the stage changed");
  assert.deepEqual(pickOnly.changes, [], "a missing before never fabricates a 'from' tier");
});

test("relationshipPromptBlock is qualitative, gender-neutral and empty without a state", () => {
  assert.equal(relationshipPromptBlock(null, "zh"), "");
  assert.equal(relationshipPromptBlock(undefined, "en"), "");
  const block = relationshipPromptBlock(rel({ familiarity: 2, trust: 2, attraction: 2 }), "zh");
  assert.ok(block.includes("熟络"));
  assert.ok(block.includes("信任"));
  assert.ok(block.includes("心动在升温"));
  assert.ok(!/[0-3]/.test(block), "no tier numbers leak into the prompt");
  assert.ok(!/[她他]/.test(block), "the prompt never assumes a gender");
  assert.ok(block.includes("goal") && block.includes("redLine"));
});

test("writeLoveRelationship is conflict-safe, key-isolated and delete only removes its own key", () => {
  reset();
  const a = rel({ characterKey: "k:a", updatedAt: NOW });
  const b = rel({ characterKey: "k:b", updatedAt: NOW + 1 });
  assert.equal(writeLoveRelationship(a).ok, true);
  assert.equal(writeLoveRelationship(b).ok, true);

  const conflict = writeLoveRelationship(rel({ characterKey: "k:a", updatedAt: NOW + 2 }), 0);
  assert.deepEqual(conflict, { ok: false, reason: "conflict", diskRevision: 2 });
  assert.equal(readLoveRelationship("k:a")?.updatedAt, NOW, "a stale revision never silently overwrites");

  assert.equal(writeLoveRelationship(rel({ characterKey: "k:a", updatedAt: NOW + 2 }), 2).ok, true);
  assert.equal(readLoveRelationship("k:a")?.updatedAt, NOW + 2);
  assert.equal(readLoveRelationship("k:b")?.updatedAt, NOW + 1, "writing one key leaves the other untouched");
  assert.deepEqual(Object.keys(readAllLoveRelationships()).sort(), ["k:a", "k:b"]);

  assert.equal(writeLoveRelationship({ ...rel(), familiarity: 9 } as unknown as LoveRelationshipState).ok, false);
  assert.deepEqual(writeLoveRelationship(rel({ characterKey: "" } as unknown as LoveRelationshipState)).ok, false, "an empty characterKey is invalid");

  const removed = deleteLoveRelationship("k:a", 3);
  assert.equal(removed.ok, true);
  assert.equal(readLoveRelationship("k:a"), null);
  assert.equal(readLoveRelationship("k:b")?.updatedAt, NOW + 1);
  assert.equal(deleteLoveRelationship("k:a").ok, true, "deleting a missing key is an idempotent success");
});

test("a corrupt story slot exposes no relationship and refuses relationship writes", () => {
  reset();
  slots.set(LOVE_STORY_KEY, "{broken");
  assert.equal(readLoveRelationship("k:a"), null);
  assert.deepEqual(writeLoveRelationship(rel({ characterKey: "k:a" })), { ok: false, reason: "corrupt" });
  assert.equal(slots.get(LOVE_STORY_KEY), "{broken");
  assert.deepEqual(deleteLoveRelationship("k:a"), { ok: false, reason: "corrupt" });
});

test("archive export and restore keep relationships on a v3 story slot", async () => {
  reset();
  const withRels = {
    v: 3,
    revision: 4,
    saves: {},
    slots: {},
    records: [],
    routes: {},
    relationships: {
      "love-arc-rio-clarify:rio": rel({ familiarity: 2, trust: 2, attraction: 1, signals: [{ kind: "scene-end", at: NOW, sceneId: "s1" }] }),
    },
    updatedAt: NOW + 5,
  };
  slots.set(LOVE_STORY_KEY, JSON.stringify(withRels));

  const snapshot = lovePlayBackup();
  assert.ok(snapshot);
  const decoded = await decodeBackup(JSON.stringify({ state: { sessions: [] }, version: 0, lovePlay: snapshot }));
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.deepEqual(JSON.parse(decoded.lovePlay![LOVE_STORY_KEY]), withRels, "relationships survive the export → decode round trip");

  const whole = LovePlaySchema.safeParse({ [LOVE_STORY_KEY]: withRels });
  assert.equal(whole.success, true);
  assert.equal(parseLovePlaySlot(LOVE_STORY_KEY, withRels).success, true);
});
