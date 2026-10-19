/** Rio 路线契约：第 4 幕注册、开场变体、状态拍点、逐字证据与无分数状态。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCENARIOS } from "../../src/data/corpus";
import { loveSeriesById } from "../../src/data/corpus/love-series";
import {
  RIO_ACT4_BEAT_GROUPS,
  RIO_ACT4_BEATS,
  RIO_ACT4_SCENE_ID,
  RIO_AUTHORED_ACTS,
  RIO_FORBIDDEN_STATE_KEYS,
  RIO_OPENING_VARIANTS,
  RIO_ROUTE_ACT_SCENES,
  applyRioBeat,
  assertRioStateNoScores,
  resolveRioOpening,
  rioOpeningVariants,
  type RioBeat,
} from "../../src/lib/rio-route";
import {
  emptyRioState,
  parseRioState,
  type RioEvidence,
  type RioRelationshipState,
} from "../../src/lib/love-relationship-state";

const scenarioById = (id: string) => SCENARIOS.find((scenario) => scenario.id === id);

const beatById = (id: string): RioBeat => {
  const found = RIO_ACT4_BEATS.find((beat) => beat.id === id);
  assert.ok(found, `missing beat ${id}`);
  return found;
};

const optionEvidence = (beat: RioBeat): RioEvidence => ({
  kind: "option",
  optionId: beat.id,
  text: beat.text,
});

const rioSeries = loveSeriesById("love-arc-rio-clarify");

test("act 4 is registered at order 4; acts 5-6 stay unwritten behind the playtest gate", () => {
  assert.equal(RIO_ACT4_SCENE_ID, "love-rio-secondment-deadline");
  assert.deepEqual(RIO_AUTHORED_ACTS, [1, 2, 3, 4]);

  assert.ok(rioSeries, "the Rio line must exist");
  assert.equal(rioSeries.continuous, true, "the Rio line must stay a continuous single-NPC series");
  assert.deepEqual(
    rioSeries.scenarios.map((scenario) => scenario.series?.order),
    [1, 2, 3, 4],
    "love-series must pick up act 4 by order",
  );

  for (const act of RIO_AUTHORED_ACTS) {
    const scenario = scenarioById(RIO_ROUTE_ACT_SCENES[act]);
    assert.ok(scenario, `act ${act} scene is not in the corpus`);
    assert.equal(scenario.series?.order, act, `act ${act} order drift`);
  }
  assert.equal(scenarioById(RIO_ROUTE_ACT_SCENES[5]), undefined, "act 5 must not be authored yet");
  assert.equal(scenarioById(RIO_ROUTE_ACT_SCENES[6]), undefined, "act 6 must not be authored yet");

  const act4 = scenarioById(RIO_ACT4_SCENE_ID);
  assert.ok(act4);
  assert.deepEqual(
    act4.characters.filter((character) => character.id !== "you").map((character) => character.id),
    ["rio"],
    "act 4 has no second voiced NPC; the father/HR stay off cast",
  );
  assert.ok(act4.source.trim(), "act 4 needs an authored source");
  assert.ok(!act4.opening.text.zh.includes("怕失去你"), "opening must not reveal the hidden lean");
  assert.ok(
    !act4.opening.text.en.toLowerCase().includes("afraid of losing you"),
    "opening must not reveal the hidden lean",
  );
});

test("opening variants match from specific to neutral, and never invent what the learner said", () => {
  const authored = RIO_OPENING_VARIANTS[4];
  assert.ok(authored && authored.length === 3, "act 4 keeps three authored opening variants");
  const allowed = new Set([
    "legacy",
    "stale",
    "secondmentDisclosed",
    "secondmentPreference",
  ]);
  for (const variant of authored) {
    assert.ok(variant.text.zh.trim() && variant.text.en.trim(), `${variant.id}: bilingual text`);
    for (const key of Object.keys(variant.requires)) {
      assert.ok(allowed.has(key), `${variant.id}: requires reads ${key}`);
    }
    assert.ok(
      !/你上次(说|问|答应)|you (said|asked|promised) last time/i.test(
        `${variant.text.zh} ${variant.text.en}`,
      ),
      `${variant.id}: variants state facts, not the learner's past lines`,
    );
  }

  const fresh = emptyRioState();
  const seen: RioRelationshipState = {
    ...fresh,
    flags: { ...fresh.flags, secondmentDisclosed: true },
  };
  const legacy: RioRelationshipState = { ...fresh, legacy: true };
  const stale: RioRelationshipState = {
    ...seen,
    stale: true,
  };

  assert.equal(rioOpeningVariants(fresh, 4)[0]?.id, "rio-act4-email-new");
  assert.equal(rioOpeningVariants(seen, 4)[0]?.id, "rio-act4-email-seen");
  assert.equal(rioOpeningVariants(legacy, 4)[0]?.id, "rio-act4-neutral");
  assert.equal(rioOpeningVariants(stale, 4)[0]?.id, "rio-act4-neutral");
  assert.equal(rioOpeningVariants(null, 4)[0]?.id, "rio-act4-neutral");
  assert.equal(rioOpeningVariants(undefined, 4)[0]?.id, "rio-act4-neutral");

  assert.deepEqual(resolveRioOpening(fresh, 4), authored[1].text);
  assert.equal(resolveRioOpening(fresh, 5), null, "acts without authored variants fall back to Scenario.opening");
  assert.deepEqual(rioOpeningVariants(fresh, 1), [], "only act 4 has authored opening variants in this batch");
});

test("act 4 beats only write the fields this act owns", () => {
  assert.deepEqual(
    RIO_ACT4_BEAT_GROUPS.map((group) => group.beats.length),
    [3, 3],
    "two state-beat groups, three authored options each",
  );
  const ids = new Set<string>();
  for (const beat of RIO_ACT4_BEATS) {
    assert.ok(!ids.has(beat.id), `duplicate beat ${beat.id}`);
    ids.add(beat.id);
    assert.equal(beat.act, 4);
    assert.ok(beat.text.zh.trim() && beat.text.en.trim(), `${beat.id}: bilingual option`);
    assert.ok(["success", "partial", "failure"].includes(beat.outcome));
    for (const key of Object.keys(beat.requires)) {
      assert.ok(
        ["legacy", "stale", "secondmentDisclosed", "secondmentPreference"].includes(key),
        `${beat.id}: requires reads ${key}`,
      );
    }
    for (const key of Object.keys(beat.effects)) {
      assert.ok(
        ["flags", "conflict", "boundary", "promise", "harm"].includes(key),
        `${beat.id}: effects writes ${key}`,
      );
    }
    assert.equal("finalDecision" in beat.effects, false, `${beat.id}: final decision belongs to act 6`);
    for (const key of Object.keys(beat.effects.flags ?? {})) {
      assert.ok(
        ["secondmentDisclosed", "secondmentPreference"].includes(key),
        `${beat.id}: flags.${key} is not an act-4 write`,
      );
    }
    if (beat.effects.conflict) {
      assert.equal(beat.effects.conflict.topic, "secondment");
      assert.equal(typeof beat.effects.conflict.hasMutualNextStep, "boolean");
    }
    if (beat.effects.boundary) {
      assert.ok(["secondment", "contact"].includes(beat.effects.boundary.topic));
      assert.equal(beat.effects.boundary.by, "learner");
    }
    if (beat.effects.promise) {
      assert.equal(beat.effects.promise.kind, "secondment-answer");
      assert.equal(beat.effects.promise.dueByAct, 6);
    }
    assert.ok(
      !/好感|affinity|score|proficiency/i.test(`${beat.text.zh} ${beat.text.en}`),
      `${beat.id}: no score language`,
    );
  }
});

test("the hidden-unlock beat writes preference and narrows the secondment conflict", () => {
  const before = emptyRioState();
  const beat = beatById("ask-without-me");
  const applied = applyRioBeat(before, beat.id, optionEvidence(beat));

  assert.notEqual(applied, before, "a valid beat returns a new state");
  assert.equal(before.flags.secondmentDisclosed, false, "the input state is not mutated");
  assert.equal(applied.flags.secondmentDisclosed, true);
  assert.equal(applied.flags.secondmentPreference, "stay");
  assert.equal(applied.lastAct, 4);
  assert.equal(applied.lastOutcome, "success");

  const conflict = applied.conflicts.find((row) => row.topic === "secondment");
  assert.ok(conflict, "the secondment conflict must be recorded");
  assert.equal(conflict.shape, "secondment-undecided");
  assert.equal(conflict.status, "narrowed");
  assert.equal(conflict.openedAtAct, 4);
  assert.equal(conflict.lastTouchedAtAct, 4);
  assert.equal(conflict.hasMutualNextStep, false);
  assert.deepEqual(conflict.evidence, optionEvidence(beat));
  assertRioStateNoScores(applied);

  // 旧档里「外派是否披露」原本是 unknown；拍点落地后这条未知被事实替换。
  const fromLegacy = applyRioBeat(
    { ...before, legacy: true, unknown: ["secondmentDisclosed", "familyHalfPromiseDisclosed"] },
    beat.id,
    optionEvidence(beat),
  );
  assert.deepEqual(fromLegacy.unknown, ["familyHalfPromiseDisclosed"]);
});

test("deciding for her crosses a boundary and records the harm once", () => {
  const beat = beatById("decide-for-her");
  let state = emptyRioState();
  state = applyRioBeat(state, beat.id, optionEvidence(beat));
  state = applyRioBeat(state, beat.id, optionEvidence(beat));

  const boundary = state.boundaries.find((row) => row.topic === "secondment");
  assert.ok(boundary);
  assert.equal(boundary.status, "crossed");
  assert.equal(boundary.by, "learner");
  assert.deepEqual(boundary.acceptedBy, ["learner"]);
  assert.deepEqual(state.flags.unrepairedHarm, ["pressed-secondment"]);

  const conflict = state.conflicts.find((row) => row.topic === "secondment");
  assert.ok(conflict);
  assert.equal(conflict.status, "open");
  assert.equal(conflict.hasMutualNextStep, false);
  assert.equal(state.lastOutcome, "failure");
  assertRioStateNoScores(state);
});

test("conditions and the dated next talk keep their own promises and boundaries", () => {
  const conditions = beatById("state-conditions");
  const withConditions = applyRioBeat(emptyRioState(), conditions.id, optionEvidence(conditions));
  const boundary = withConditions.boundaries.find((row) => row.topic === "secondment");
  assert.ok(boundary);
  assert.equal(boundary.status, "proposed");
  assert.deepEqual(boundary.acceptedBy, ["learner"]);
  assert.equal(
    withConditions.conflicts.find((row) => row.topic === "secondment")?.hasMutualNextStep,
    true,
  );

  const nextTalk = beatById("agree-next-talk");
  const withNextTalk = applyRioBeat(withConditions, nextTalk.id, optionEvidence(nextTalk));
  const promise = withNextTalk.promises.find((row) => row.id === "rio-secondment-answer");
  assert.ok(promise);
  assert.equal(promise.kind, "secondment-answer");
  assert.equal(promise.by, "rio");
  assert.equal(promise.madeAtAct, 4);
  assert.equal(promise.dueByAct, 6);
  assert.equal(promise.status, "open");
  assert.deepEqual(promise.evidence, optionEvidence(nextTalk));
  assert.equal(
    withNextTalk.conflicts.find((row) => row.topic === "secondment")?.hasMutualNextStep,
    true,
  );
  assertRioStateNoScores(withNextTalk);
});

test("unknown beats and non-verbatim evidence leave the state untouched", () => {
  const before = emptyRioState();
  const beat = beatById("ask-what-she-wants");

  assert.equal(
    applyRioBeat(before, "not-a-beat", optionEvidence(beat)),
    before,
    "an unknown beat id returns the input, not a crash or a partial write",
  );
  assert.equal(
    applyRioBeat(before, beat.id, {
      kind: "option",
      optionId: beat.id,
      text: { zh: "换个说法", en: beat.text.en },
    }),
    before,
    "paraphrased option text is not verbatim evidence",
  );
  assert.equal(
    applyRioBeat(before, beat.id, {
      kind: "option",
      optionId: "another-option",
      text: beat.text,
    }),
    before,
    "the option id must be the beat id",
  );
  assert.equal(
    applyRioBeat(before, beat.id, { kind: "quote", quoteId: "missing-quote" }),
    before,
    "a quote must exist in the learner's recorded quotes",
  );
  assert.equal(
    applyRioBeat(before, beat.id, { kind: "npc", quoteId: "missing-quote" }),
    before,
    "an NPC line cannot prove what the learner chose",
  );
  assert.equal(before.flags.secondmentDisclosed, false);
  assert.deepEqual(before.conflicts, []);
});

test("a recorded verbatim learner quote is accepted; a Rio quote is not", () => {
  const beat = beatById("ask-what-she-wants");
  const learnerQuote: RioRelationshipState = {
    ...emptyRioState(),
    quotes: [
      {
        id: "q-learner",
        atAct: 4,
        speaker: "learner",
        text: "先别想我。你自己想要什么？",
        lang: "zh",
        via: "type",
      },
      {
        id: "q-rio",
        atAct: 4,
        speaker: "rio",
        text: "我不知道。",
        lang: "zh",
        via: "npc",
      },
    ],
  };
  const applied = applyRioBeat(learnerQuote, beat.id, { kind: "quote", quoteId: "q-learner" });
  assert.notEqual(applied, learnerQuote);
  assert.equal(applied.flags.secondmentPreference, "undecided");

  const rejected = applyRioBeat(learnerQuote, beat.id, { kind: "quote", quoteId: "q-rio" });
  assert.equal(rejected, learnerQuote, "a Rio line is not learner evidence");
});

test("state round-trips through parse after every act-4 beat", () => {
  let state = emptyRioState();
  for (const beat of RIO_ACT4_BEATS) {
    state = applyRioBeat(state, beat.id, optionEvidence(beat));
  }
  const parsed = parseRioState(JSON.parse(JSON.stringify(state)) as unknown);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.state, state);

  const keys = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        keys.add(key);
        walk(inner);
      }
    }
  };
  walk(JSON.parse(JSON.stringify(state)) as unknown);
  for (const forbidden of RIO_FORBIDDEN_STATE_KEYS) {
    assert.equal(keys.has(forbidden), false, `serialized state leaked ${forbidden}`);
  }
  for (const forbidden of ["score", "affinity", "stance", "proficiency", "loveProficiency"]) {
    assert.equal(keys.has(forbidden), false, `serialized state leaked ${forbidden}`);
  }
});

test("assertRioStateNoScores rejects a polluted state instead of warning", () => {
  assert.doesNotThrow(() => assertRioStateNoScores(emptyRioState()));
  assert.throws(
    () => assertRioStateNoScores({ ...emptyRioState(), score: 1 } as never),
    /score/,
  );
  assert.throws(
    () =>
      assertRioStateNoScores({
        ...emptyRioState(),
        flags: { ...emptyRioState().flags, proficiency: 3 },
      } as never),
    /proficiency/,
  );
});
