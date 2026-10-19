/** 恋爱 PlayScene 存档/恢复/下一幕/记录幂等的纯逻辑回归（不碰 React 与真实存储）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scenario } from "../../src/data/corpus/types";
import { L } from "../../src/data/taxonomy";
import type { ChatMessage } from "../../src/lib/types";
import { LovePlaySaveSchema } from "../../src/lib/love-story";
import {
  buildLovePlaySave,
  canSubmitLovePlayRecord,
  lovePlaySaveSignature,
  pickNextLoveScene,
  planLovePlayRestore,
  restoreNeedsModelRequest,
  trimLovePlayHistory,
} from "../../src/lib/love-play-save-view";

const scenario = {
  id: "love-arc-rio-clarify-2",
  series: { id: "love-arc-rio-clarify", name: L("暧昧到说清楚", "From Ambiguous to Explicit"), order: 2 },
} as unknown as Scenario;

const history: ChatMessage[] = [
  { id: "opening", role: "npc", characterId: "rio", text: "你终于来了。", ts: 1 },
  { id: "learner-1", role: "learner", text: "路上堵车，我跑过来的。", ts: 2 },
  { id: "npc-2", role: "npc", characterId: "rio", text: "先喝口水吧。", ts: 3 },
];

const options = [
  L("谢谢。", "Thanks."),
  L("我不渴。", "I’m not thirsty."),
];

const playing = () =>
  buildLovePlaySave({
    scenario,
    lang: "zh",
    history,
    currentLineKey: "npc-2",
    options,
    emotion: "smile",
    stance: 55,
    carryover: true,
    learnerLines: [{ via: "type", text: "路上堵车，我跑过来的。" }],
    outcome: null,
    endingId: null,
    recorded: false,
    startedAt: 1_000,
    updatedAt: 2_000,
  });

test("a stable playing snapshot satisfies the save schema and keeps the current line", () => {
  const save = playing();
  assert.ok(save);
  assert.equal(LovePlaySaveSchema.safeParse(save).success, true);
  assert.equal(save.status, "playing");
  assert.equal(save.currentLineId, "npc-2");
  assert.equal(save.options?.length, 2);
  assert.deepEqual(save.learnerLines, [{ via: "type", text: "路上堵车，我跑过来的。" }]);
  assert.equal(save.recorded, false);
  assert.equal(save.outcome, null);
});

test("an ended snapshot drops options and round-trips recorded/outcome", () => {
  const save = buildLovePlaySave({
    scenario,
    lang: "zh",
    history,
    currentLineKey: "npc-2",
    options: null,
    emotion: "teary",
    stance: 71,
    carryover: false,
    learnerLines: [],
    outcome: "success",
    endingId: "said-it-plain",
    recorded: true,
    startedAt: 1_000,
    updatedAt: 3_000,
  });
  assert.ok(save);
  assert.equal(LovePlaySaveSchema.safeParse(save).success, true);
  assert.equal(save.status, "ended");
  assert.equal(save.options, null);
  assert.equal(save.outcome, "success");
  assert.equal(save.endingId, "said-it-plain");
  assert.equal(save.recorded, true);
});

test("unstable states never become a save", () => {
  const base = {
    scenario,
    lang: "zh" as const,
    history,
    currentLineKey: "npc-2",
    emotion: "neutral" as const,
    stance: null,
    carryover: false,
    learnerLines: [],
    outcome: null,
    recorded: false,
    startedAt: 1,
    updatedAt: 2,
  };
  assert.equal(buildLovePlaySave({ ...base, options: null }), null, "playing needs 2-4 options");
  assert.equal(buildLovePlaySave({ ...base, options: [options[0]] }), null, "one option is not stable");
  assert.equal(buildLovePlaySave({ ...base, options, currentLineKey: "missing" }), null, "the current line must be in history");
});

test("history trimming keeps the current line and stays within the schema cap", () => {
  const long: ChatMessage[] = Array.from({ length: 45 }, (_, i) => ({
    id: `npc-${i}`,
    role: "npc" as const,
    characterId: "rio",
    text: `line ${i}`,
    ts: i,
  }));
  const trimmed = trimLovePlayHistory(long, "npc-44");
  assert.ok(trimmed);
  assert.equal(trimmed.length, 40);
  assert.equal(trimmed.at(-1)?.id, "npc-44");
  assert.equal(trimmed[0].id, "npc-5");
});

test("a valid save resumes without constructing a model request", () => {
  const save = playing();
  assert.ok(save);
  const plan = planLovePlayRestore({ status: "ok", save });
  assert.equal(plan.mode, "resume");
  if (plan.mode !== "resume") throw new Error("expected resume");
  assert.equal(restoreNeedsModelRequest(plan), false);
  assert.equal(plan.autosave, true);
  assert.equal(plan.notice, "resumed");
  assert.equal(plan.view.npcLine.key, "npc-2");
  assert.equal(plan.view.learnerTurns, 1);
  assert.deepEqual(plan.view.spokenKeys, ["opening", "npc-2"]);
  assert.equal(plan.view.options?.length, 2);
  assert.equal(plan.view.carryover, true);
});

test("corrupt, incompatible and unavailable saves keep autosave off but the scene playable", () => {
  for (const status of ["corrupt", "incompatible", "unavailable"] as const) {
    const plan = planLovePlayRestore({ status });
    assert.equal(plan.mode, "fresh", `${status} starts a playable run`);
    assert.equal(plan.autosave, false, `${status} must not overwrite the original`);
    assert.equal(restoreNeedsModelRequest(plan), true);
    assert.equal(plan.notice, status);
  }
  const empty = planLovePlayRestore({ status: "empty" });
  assert.equal(empty.mode, "fresh");
  assert.equal(empty.autosave, true);
  assert.equal(empty.notice, null);
});

test("the next scene follows series order, not the corpus/lastScene order", () => {
  const unordered = [
    { id: "act-3", series: { order: 3 } },
    { id: "act-1", series: { order: 1 } },
    { id: "act-2", series: { order: 2 } },
  ];
  assert.equal(pickNextLoveScene(unordered, [], [])?.scene.id, "act-1");
  assert.equal(pickNextLoveScene(unordered, ["act-1"], [])?.scene.id, "act-2");
  assert.equal(pickNextLoveScene(unordered, ["act-1", "act-2"], [])?.scene.id, "act-3");

  const allDone = pickNextLoveScene(unordered, ["act-1", "act-2", "act-3"], []);
  assert.equal(allDone?.scene.id, "act-1");
  assert.equal(allDone?.mode, "replay");

  // 没有 order 时按数组下标；不依赖 lastScene。
  assert.equal(pickNextLoveScene([{ id: "x" }, { id: "y" }], ["x"], [])?.scene.id, "y");
});

test("an in-progress scene wins over a completed list", () => {
  const scenes = [
    { id: "act-1", series: { order: 1 } },
    { id: "act-2", series: { order: 2 } },
  ];
  const choice = pickNextLoveScene(scenes, ["act-1", "act-2"], [{ id: "act-2", updatedAt: 9 }]);
  assert.equal(choice?.scene.id, "act-2");
  assert.equal(choice?.mode, "playing");

  const older = pickNextLoveScene(
    scenes,
    [],
    [
      { id: "act-1", updatedAt: 1 },
      { id: "act-2", updatedAt: 5 },
    ],
  );
  assert.equal(older?.scene.id, "act-2", "the most recently updated save is the landing point");
});

test("record is submitted once even when clicked twice or restored as recorded", () => {
  let recorded = false;
  let records = 0;
  const submit = () => {
    if (!canSubmitLovePlayRecord(recorded)) return;
    recorded = true;
    records += 1;
  };
  submit();
  submit();
  assert.equal(records, 1);
  assert.equal(canSubmitLovePlayRecord(recorded), false);

  const save = playing();
  assert.ok(save);
  const ended = buildLovePlaySave({
    scenario,
    lang: "zh",
    history,
    currentLineKey: "npc-2",
    options: null,
    emotion: "neutral",
    stance: null,
    carryover: false,
    learnerLines: [],
    outcome: "partial",
    recorded: true,
    startedAt: 1,
    updatedAt: 2,
  });
  assert.ok(ended);
  const plan = planLovePlayRestore({ status: "ok", save: ended });
  assert.equal(plan.mode, "resume");
  if (plan.mode === "resume") assert.equal(plan.view.recorded, true);
});

test("the autosave signature ignores updatedAt so an unchanged restore does not rewrite", () => {
  const save = playing();
  assert.ok(save);
  assert.equal(lovePlaySaveSignature(save), lovePlaySaveSignature({ ...save, updatedAt: 99_999 }));
});
