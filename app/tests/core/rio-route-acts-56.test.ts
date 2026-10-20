import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RIO_ALL_BEATS,
  applyRioBeat,
  assertRioStateNoScores,
  type RioBeat,
} from "../../src/lib/rio-route";
import {
  emptyRioState,
  parseRioState,
  resolveRioEnding,
  type RioEvidence,
  type RioRelationshipState,
} from "../../src/lib/love-relationship-state";

const beatById = (id: string): RioBeat => {
  const found = RIO_ALL_BEATS.find((beat) => beat.id === id);
  assert.ok(found, `missing beat ${id}`);
  return found;
};

/** 用逐字选项证据应用拍点；应用失败（原样返回）时让测试立刻失败。 */
const applyOption = (state: RioRelationshipState, id: string): RioRelationshipState => {
  const beat = beatById(id);
  const evidence: RioEvidence = { kind: "option", optionId: beat.id, text: beat.text };
  const next = applyRioBeat(state, beat.id, evidence);
  assert.notEqual(next, state, `beat ${id} must apply`);
  return next;
};

const runChain = (ids: string[]): RioRelationshipState =>
  ids.reduce<RioRelationshipState>((state, id) => applyOption(state, id), emptyRioState());

test("said-it-plain: act4 问她想 + act5 收回与决定权 + act6 接住答复并说定", () => {
  const state = runChain([
    "ask-what-she-wants",
    "agree-next-talk",
    "withdraw-half-promise",
    "reclaim-decision",
    "receive-her-answer",
    "name-and-date",
  ]);

  assert.equal(state.lastAct, 6);
  assert.equal(state.lastOutcome, "success");
  assert.equal(state.flags.finalDecisionMade, true);
  assert.equal(resolveRioEnding(state), "said-it-plain");
  assertRioStateNoScores(state);
});

test("clean-parting: act6 带日期的宽限 + 两周后回访的暂停", () => {
  const state = runChain([
    "ask-what-she-wants",
    "state-conditions",
    "withdraw-half-promise",
    "reclaim-decision",
    "date-the-defer",
    "pause-with-revisit",
  ]);

  assert.equal(state.lastOutcome, "partial");
  assert.equal(state.flags.secondmentDecision, "defer-with-date");
  assert.equal(resolveRioEnding(state), "clean-parting");
  assertRioStateNoScores(state);
});

test("clean-parting: act6 好好告别（end，无下一步）", () => {
  const state = runChain([
    "ask-without-me",
    "agree-next-talk",
    "withdraw-half-promise",
    "reclaim-decision",
    "receive-her-answer",
    "end-with-thanks",
  ]);

  assert.equal(state.flags.exclusivity, "declined");
  assert.equal(resolveRioEnding(state), "clean-parting");
  assertRioStateNoScores(state);
});

test("没走到第 6 幕 B 组之前，命名结局不出现", () => {
  const afterAct5 = runChain([
    "ask-what-she-wants",
    "agree-next-talk",
    "withdraw-half-promise",
    "reclaim-decision",
  ]);
  assert.equal(resolveRioEnding(afterAct5), null, "finalDecisionMade 仍未置位");

  const act6GroupAOnly = runChain([
    "ask-what-she-wants",
    "agree-next-talk",
    "withdraw-half-promise",
    "reclaim-decision",
    "receive-her-answer",
  ]);
  assert.equal(resolveRioEnding(act6GroupAOnly), null, "one-sided 的决定不构成命名结局");
});

test("第 4 幕施压后：本幕记 failure，两个结局都被 unrepairedHarm 挡住", () => {
  const act4 = runChain(["decide-for-her", "agree-next-talk"]);
  assert.equal(act4.lastAct, 4);
  assert.equal(act4.lastOutcome, "failure");
  assert.ok(act4.flags.unrepairedHarm.includes("pressed-secondment"));

  const state = runChain([
    "decide-for-her",
    "agree-next-talk",
    "withdraw-half-promise",
    "reclaim-decision",
    "receive-her-answer",
    "name-and-date",
  ]);
  assert.equal(resolveRioEnding(state), null);
});

test("第 5 幕敷衍搁置：家里的日子压在桌上，结局被 weddingTimeline 挡住", () => {
  const state = runChain([
    "ask-what-she-wants",
    "agree-next-talk",
    "shelve-family-talk",
    "reclaim-decision",
    "receive-her-answer",
    "name-and-date",
  ]);
  assert.equal(state.flags.weddingTimeline, "set-by-family");
  assert.equal(resolveRioEnding(state), null);
});

test("第 5 幕把决定权交给长辈：decision-ownership 未 closed，结局为空", () => {
  const state = runChain([
    "ask-what-she-wants",
    "agree-next-talk",
    "withdraw-half-promise",
    "defer-to-family",
    "receive-her-answer",
    "name-and-date",
  ]);
  assert.equal(resolveRioEnding(state), null);
});

test("said-it-plain 状态经 JSON 序列化后仍判定为同一结局", () => {
  const state = runChain([
    "ask-what-she-wants",
    "agree-next-talk",
    "withdraw-half-promise",
    "reclaim-decision",
    "receive-her-answer",
    "name-and-date",
  ]);

  const raw = JSON.parse(JSON.stringify(state)) as unknown;
  const parsed = parseRioState(raw);
  assert.ok(parsed.ok, "ledger round-trips through the save schema");
  assert.equal(resolveRioEnding(parsed.state), "said-it-plain");
});
