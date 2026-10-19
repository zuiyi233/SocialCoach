/** Rio 第 4 幕接线：作者拍点分组、逐字选项、账本快照与 ended-only 进度口径。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RIO_ACT4_BEATS,
  RIO_ACT4_BEAT_GROUPS,
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
  isRioStateCurrent,
  migrateLegacyRioState,
  parseRioState,
  type RioEvidence,
  type RioOutcome,
  type RioRelationshipState,
} from "../../src/lib/love-relationship-state";
import {
  nextRioBeatGroup,
  planRioRouteEntry,
  readRioRouteSnapshot,
  rioBeatForOption,
  rioRouteSnapshot,
  seriesOutcomeFor,
  type RioProgressLike,
} from "../../src/lib/love-play-save-view";

const beatById = (id: string): RioBeat => {
  const found = RIO_ACT4_BEATS.find((beat) => beat.id === id);
  assert.ok(found, `missing beat ${id}`);
  return found;
};

/** 作者写死的选项就是证据：id 与双语原文都必须逐字一致。 */
const optionEvidence = (beat: RioBeat): RioEvidence => ({
  kind: "option",
  optionId: beat.id,
  text: beat.text,
});

const apply = (state: RioRelationshipState, id: string): RioRelationshipState =>
  applyRioBeat(state, id, optionEvidence(beatById(id)));

const collectKeys = (value: unknown): Set<string> => {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node && typeof node === "object") {
      for (const [key, inner] of Object.entries(node)) {
        keys.add(key);
        walk(inner);
      }
    }
  };
  walk(value);
  return keys;
};

const acts123 = [1, 2, 3].map((act) => RIO_ROUTE_ACT_SCENES[act as 1 | 2 | 3]);
const act4Scene = RIO_ROUTE_ACT_SCENES[4];

const legacyProgress: RioProgressLike = {
  completed: acts123,
  lastScene: acts123[2],
  outcome: {
    [acts123[0]]: "success",
    [acts123[1]]: "success",
    [acts123[2]]: "partial",
  },
};

const progressWithAct4: RioProgressLike = {
  completed: [...acts123, act4Scene],
  lastScene: act4Scene,
  outcome: { ...legacyProgress.outcome, [act4Scene]: "success" },
};

test("state beats appear stance → next-step once per group, then fall back to model options", () => {
  const empty = emptyRioState();
  const first = nextRioBeatGroup(empty, []);
  assert.equal(first?.id, "stance");
  assert.deepEqual(first?.title, RIO_ACT4_BEAT_GROUPS[0].title);
  assert.deepEqual(
    first?.beats.map((beat) => beat.id),
    ["ask-without-me", "ask-what-she-wants", "decide-for-her"],
  );

  // 任意一条 stance 拍点被选中，就说明「她想要什么」问过了，组不再重复。
  for (const id of ["ask-without-me", "ask-what-she-wants", "decide-for-her"]) {
    const answered = apply(empty, id);
    const second = nextRioBeatGroup(answered, [id]);
    assert.equal(second?.id, "next-step", `${id} must move on to the next step group`);
    assert.deepEqual(
      second?.beats.map((beat) => beat.id),
      ["state-conditions", "agree-next-talk", "leave-it-open"],
    );
  }

  assert.equal(
    nextRioBeatGroup(empty, ["ask-what-she-wants", "agree-next-talk"]),
    null,
    "both groups answered → the model gets its options back",
  );
});

test("beat requires filter out questions whose answer the ledger already holds", () => {
  const known: RioRelationshipState = {
    ...emptyRioState(),
    lastAct: 4,
    lastOutcome: "success",
    flags: { ...emptyRioState().flags, secondmentDisclosed: true, secondmentPreference: "stay" },
  };
  const stance = nextRioBeatGroup(known, []);
  assert.ok(stance);
  assert.equal(stance.id, "stance");
  assert.equal(
    stance.beats.some((beat) => beat.id === "ask-without-me"),
    false,
    "a known preference must not be asked again",
  );
  assert.equal(stance.beats.some((beat) => beat.id === "ask-what-she-wants"), false);
  assert.deepEqual(stance.beats.map((beat) => beat.id), ["decide-for-her"]);

  // 写死的失败路径不依赖未知事实，仍然可达。
  const empty = emptyRioState();
  assert.equal(nextRioBeatGroup(empty, [])?.beats.length, 3);
});

test("option text resolves to the authored beat by exact zh/en text only", () => {
  const stance = RIO_ACT4_BEAT_GROUPS[0];
  const beat = beatById("ask-without-me");
  assert.equal(rioBeatForOption(stance, beat.text.zh, "zh")?.id, beat.id);
  assert.equal(rioBeatForOption(stance, beat.text.en, "en")?.id, beat.id);

  assert.equal(rioBeatForOption(stance, beat.text.zh, "en"), null, "the other language is not a hit");
  assert.equal(rioBeatForOption(stance, `${beat.text.zh}？`, "zh"), null, "punctuation changes the text");
  assert.equal(rioBeatForOption(stance, ` ${beat.text.zh}`, "zh"), null);
  assert.equal(
    rioBeatForOption(stance, "如果我不在场，你会怎么选？", "zh"),
    null,
    "a model paraphrase is not authored evidence",
  );
  assert.equal(rioBeatForOption(null, beat.text.zh, "zh"), null);
  assert.equal(rioBeatForOption(undefined, beat.text.zh, "zh"), null);
});

test("applied beats survive the wrapped snapshot and never carry stance or scores", () => {
  let state = emptyRioState();
  state = apply(state, "ask-without-me");
  state = apply(state, "agree-next-talk");
  assert.equal(state.flags.secondmentPreference, "stay");
  assert.equal(state.promises.some((promise) => promise.kind === "secondment-answer"), true);

  const appliedBeats = ["ask-without-me", "agree-next-talk"];
  const snapshot = rioRouteSnapshot(state, appliedBeats);
  const onDisk = JSON.parse(JSON.stringify(snapshot)) as unknown;

  const restored = readRioRouteSnapshot(onDisk);
  assert.ok(restored);
  assert.deepEqual(restored.appliedBeats, appliedBeats);
  assert.deepEqual(restored.rio, state);

  const parsed = parseRioState((onDisk as { rio: unknown }).rio);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.state, state);

  const wrapperAsState = parseRioState(onDisk);
  assert.equal(wrapperAsState.ok, false, "the wrapper is not a bare relationship state");

  assert.doesNotThrow(() => assertRioStateNoScores(restored!.rio));
  const keys = collectKeys(onDisk);
  for (const forbidden of RIO_FORBIDDEN_STATE_KEYS) {
    assert.equal(keys.has(forbidden), false, `snapshot leaked ${forbidden}`);
  }
  for (const forbidden of ["score", "affinity", "stance", "proficiency", "loveProficiency"]) {
    assert.equal(keys.has(forbidden), false, `snapshot leaked ${forbidden}`);
  }

  // 旧档只有裸 state：appliedBeats 从空开始，而不是猜。
  const bare = readRioRouteSnapshot(JSON.parse(JSON.stringify(state)) as unknown);
  assert.ok(bare);
  assert.deepEqual(bare.appliedBeats, []);
  assert.deepEqual(bare.rio, state);

  assert.equal(readRioRouteSnapshot(null), null);
  assert.equal(readRioRouteSnapshot({ hi: 1 }), null);
  assert.equal(readRioRouteSnapshot({ rio: { v: 9 }, appliedBeats: ["x"] }), null);
});

test("legacy progress migrates to the neutral opening; a state behind progress is marked stale", () => {
  const migrated = migrateLegacyRioState({
    completed: legacyProgress.completed,
    lastScene: legacyProgress.lastScene ?? "",
    outcome: legacyProgress.outcome,
  });
  assert.equal(migrated.legacy, true);
  assert.equal(migrated.stale, false);
  assert.deepEqual(resolveRioOpening(migrated, 4), RIO_OPENING_VARIANTS[4]![2]!.text);
  assert.equal(rioOpeningVariants(migrated, 4)[0]?.id, "rio-act4-neutral");

  const planned = planRioRouteEntry({ progress: legacyProgress });
  assert.equal(planned.rio.legacy, true);
  assert.equal(planned.rio.stale, false);
  assert.deepEqual(planned.appliedBeats, []);
  assert.equal(rioOpeningVariants(planned.rio, 4)[0]?.id, "rio-act4-neutral");

  // 新玩家：没有进度、没有账本 → 「你没见过的邮件」，不是中性变体。
  const fresh = planRioRouteEntry({ progress: { completed: [], outcome: {} } });
  assert.equal(fresh.rio.legacy, false);
  assert.equal(fresh.rio.stale, false);
  assert.equal(rioOpeningVariants(fresh.rio, 4)[0]?.id, "rio-act4-email-new");

  // 账本停在第三幕，进度已经完成第四幕 → 落后，克隆一份 stale，不丢原始事实。
  const behind: RioRelationshipState = {
    ...emptyRioState(),
    lastAct: 3,
    lastOutcome: "success",
    flags: { ...emptyRioState().flags, secondmentDisclosed: true },
  };
  assert.equal(isRioStateCurrent(behind, progressWithAct4), false);
  const stalePlan = planRioRouteEntry({ committed: behind, progress: progressWithAct4 });
  assert.equal(stalePlan.rio.stale, true);
  assert.equal(stalePlan.rio.lastAct, 3, "stale is a flag, not a rewrite of the facts");
  assert.equal(stalePlan.rio.flags.secondmentDisclosed, true);
  assert.equal(behind.stale, false, "planning never mutates the ledger it read");
  assert.equal(rioOpeningVariants(stalePlan.rio, 4)[0]?.id, "rio-act4-neutral");
});

test("an in-progress save snapshot wins over committed routes and is not stale", () => {
  const midAct = apply(emptyRioState(), "ask-what-she-wants");
  const saved = rioRouteSnapshot(midAct, ["ask-what-she-wants"]);
  const committed: RioRelationshipState = {
    ...emptyRioState(),
    lastAct: 3,
    lastOutcome: "partial",
  };

  const planned = planRioRouteEntry({ saved, committed, progress: legacyProgress });
  assert.equal(planned.rio.flags.secondmentPreference, "undecided");
  assert.deepEqual(planned.appliedBeats, ["ask-what-she-wants"]);
  assert.equal(planned.rio.stale, false, "the current act has not been settled yet — not behind");
  assert.equal(planned.rio.lastAct, 4);
});

test("ended-only scenes still complete the act as partial", () => {
  assert.equal(seriesOutcomeFor("success", true), "success");
  assert.equal(seriesOutcomeFor("failure", false), "failure");
  assert.equal(seriesOutcomeFor(null, true), "partial");
  assert.equal(seriesOutcomeFor(undefined, true), "partial");
  assert.equal(seriesOutcomeFor(null, false), null);
  assert.equal(seriesOutcomeFor(undefined, undefined), null);

  // 写进进度的值只能是三种结局之一，不能是 undefined。
  const outcomes: RioOutcome[] = ["success", "partial", "failure"];
  assert.ok(outcomes.includes(seriesOutcomeFor(null, true) as RioOutcome));
});
