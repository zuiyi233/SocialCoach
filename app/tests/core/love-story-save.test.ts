/** 恋爱 Galgame story slot 的离线回归：损坏保留 raw、revision 冲突、上限拒绝、保留策略与回想投影。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LovePlaySaveSchema,
  LOVE_STORY_KEY,
  appendLovePlayRecord,
  buildLovePlayTranscript,
  clearLoveStorySlot,
  deleteLovePlayScene,
  emptyLoveStoryStore,
  hasLovePlaySave,
  latestPlayingSaveForSeries,
  readLovePlayRoute,
  readLovePlaySave,
  readLoveStoryStore,
  saveLovePlayScene,
  writeLovePlayRoute,
  writeLoveStoryStore,
  type LovePlayRecord,
  type LovePlaySave,
  type LovePlaySaveMessage,
} from "../../src/lib/love-story";

const KEY = LOVE_STORY_KEY;
const slots = new Map<string, string>();
let quota = false;
let blockedRead = false;
let blockedWrite = false;

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
const stubStorage = () =>
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => {
        if (blockedRead) throw new Error("blocked");
        return slots.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (quota) throw new DOMException("quota", "QuotaExceededError");
        if (blockedWrite) throw new Error("blocked");
        slots.set(key, value);
      },
      removeItem: (key: string) => {
        slots.delete(key);
      },
    },
    configurable: true,
  });
stubStorage();

const reset = () => {
  slots.clear();
  quota = false;
  blockedRead = false;
  blockedWrite = false;
};
const putRaw = (value: unknown) => slots.set(KEY, JSON.stringify(value));
const stored = (): Record<string, unknown> => JSON.parse(slots.get(KEY) ?? "{}");

const npcLine = (over: Partial<LovePlaySaveMessage> = {}): LovePlaySaveMessage => ({
  id: "m-npc-1",
  role: "npc",
  characterId: "rio",
  text: "你终于来了。",
  lang: "zh",
  ts: 1,
  ...over,
});

const learnerLine = (over: Partial<LovePlaySaveMessage> = {}): LovePlaySaveMessage => ({
  id: "m-learner-1",
  role: "learner",
  text: "路上堵车，我跑过来的。",
  lang: "zh",
  ts: 2,
  ...over,
});

const sceneSave = (over: Partial<LovePlaySave> = {}): LovePlaySave => ({
  v: 1,
  scenarioId: "love-arc-rio-clarify-1",
  seriesId: "love-arc-rio-clarify",
  lang: "zh",
  status: "playing",
  history: [npcLine(), learnerLine(), npcLine({ id: "m-npc-2", text: "先喝口水吧。", ts: 3 })],
  currentLineId: "m-npc-2",
  options: [
    { zh: "谢谢。", en: "Thanks." },
    { zh: "我不渴。", en: "I'm not thirsty." },
  ],
  emotion: "smile",
  stance: 55,
  carryover: true,
  learnerLines: [{ via: "type", text: "路上堵车，我跑过来的。" }],
  outcome: null,
  endingId: null,
  recorded: false,
  startedAt: 1_000,
  updatedAt: 2_000,
  ...over,
});

const endedSave = (scenarioId: string, updatedAt: number): LovePlaySave =>
  sceneSave({
    scenarioId,
    status: "ended",
    options: null,
    outcome: "success",
    recorded: true,
    endingId: "rio-said-it",
    updatedAt,
  });

const record = (id: string, endedAt: number): LovePlayRecord => ({
  id,
  scenarioId: `scene-${id}`,
  seriesId: null,
  outcome: "success",
  endedAt,
  startedAt: 0,
  lang: "zh",
});

const okRead = () => {
  const read = readLoveStoryStore();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") throw new Error("expected an ok store");
  return read;
};

test("an empty slot reads empty and a saved scene round-trips with its raw bytes", () => {
  reset();
  assert.deepEqual(readLoveStoryStore(), { status: "empty" });
  assert.deepEqual(emptyLoveStoryStore(), { v: 2, revision: 0, saves: {}, slots: {}, records: [], routes: {}, updatedAt: 0 });

  const save = sceneSave({ routeState: { act: 2, asked: true } });
  const written = saveLovePlayScene(save);
  assert.equal(written.ok, true);
  if (!written.ok) throw new Error("write failed");

  const read = okRead();
  assert.equal(read.store.revision, 1);
  assert.ok(read.store.updatedAt > 0);
  assert.equal(read.raw, slots.get(KEY));
  assert.deepEqual(read.store.saves[save.scenarioId], save);
  assert.deepEqual(readLovePlaySave(save.scenarioId), { status: "ok", save, raw: read.raw });
  assert.equal(hasLovePlaySave(save.scenarioId), true);
  assert.equal(hasLovePlaySave("another-scene"), false);
});

test("a stale expectedRevision is a conflict and leaves the disk untouched", () => {
  reset();
  assert.equal(saveLovePlayScene(sceneSave()).ok, true);
  const before = slots.get(KEY);

  assert.deepEqual(saveLovePlayScene(sceneSave({ updatedAt: 3_000 }), 0), {
    ok: false,
    reason: "conflict",
    diskRevision: 1,
  });
  assert.equal(slots.get(KEY), before, "no silent last-writer-wins");

  const retried = saveLovePlayScene(sceneSave({ updatedAt: 3_000 }), 1);
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.store.revision, 2);
});

test("bad JSON reads as corrupt/json with the original bytes preserved", () => {
  reset();
  slots.set(KEY, '{"v":1,"saves":');
  assert.deepEqual(readLoveStoryStore(), { status: "corrupt", raw: '{"v":1,"saves":', reason: "json" });
  assert.deepEqual(readLovePlaySave("love-arc-rio-clarify-1"), { status: "corrupt", raw: '{"v":1,"saves":' });
  assert.equal(hasLovePlaySave("love-arc-rio-clarify-1"), false);
});

test("a wrong shape or a save keyed by another scenario reads as corrupt/shape", () => {
  reset();
  const wrongShape = { v: 1, revision: 0, saves: {}, records: "nope", routes: {}, updatedAt: 1 };
  putRaw(wrongShape);
  const read = readLoveStoryStore();
  assert.equal(read.status, "corrupt");
  if (read.status === "corrupt") {
    assert.equal(read.reason, "shape");
    assert.equal(read.raw, JSON.stringify(wrongShape));
  }

  reset();
  const mismatch = {
    v: 1,
    revision: 0,
    saves: { "scene-a": sceneSave({ scenarioId: "scene-b" }) },
    records: [],
    routes: {},
    updatedAt: 1,
  };
  putRaw(mismatch);
  const mismatchRead = readLoveStoryStore();
  assert.equal(mismatchRead.status, "corrupt");
  if (mismatchRead.status === "corrupt") assert.equal(mismatchRead.reason, "shape");

  // 坏字节上的正常回合写入必须拒绝，不能覆盖恢复线索。
  const before = slots.get(KEY);
  assert.deepEqual(saveLovePlayScene(sceneSave()), { ok: false, reason: "invalid" });
  assert.equal(slots.get(KEY), before);
});

test("a future store version reads as incompatible instead of corrupt", () => {
  reset();
  const v3 = { v: 3, revision: 7, saves: {}, records: [], routes: {}, updatedAt: 99 };
  putRaw(v3);
  assert.deepEqual(readLoveStoryStore(), { status: "incompatible", raw: JSON.stringify(v3) });
  assert.deepEqual(readLovePlaySave("love-arc-rio-clarify-1"), {
    status: "incompatible",
    raw: JSON.stringify(v3),
  });
});

test("quota and disabled storage degrade to explicit failures without touching the last valid store", () => {
  reset();
  assert.equal(saveLovePlayScene(sceneSave()).ok, true);
  const before = slots.get(KEY);

  quota = true;
  assert.deepEqual(saveLovePlayScene(sceneSave({ updatedAt: 3_000 })), { ok: false, reason: "quota" });
  assert.equal(slots.get(KEY), before, "the previous valid store survives a quota failure");
  quota = false;

  blockedWrite = true;
  assert.deepEqual(saveLovePlayScene(sceneSave({ updatedAt: 3_000 })), { ok: false, reason: "unavailable" });
  assert.equal(slots.get(KEY), before);
  blockedWrite = false;

  blockedRead = true;
  assert.deepEqual(readLoveStoryStore(), { status: "unavailable" });
  assert.deepEqual(readLovePlaySave("love-arc-rio-clarify-1"), { status: "unavailable" });
  assert.equal(latestPlayingSaveForSeries("love-arc-rio-clarify"), null);
  blockedRead = false;
});

test("every structural cap refuses the write instead of truncating dialogue", () => {
  reset();
  const history = Array.from({ length: 41 }, (_, i) => npcLine({ id: `h${i}`, text: `line ${i}` }));
  assert.deepEqual(saveLovePlayScene(sceneSave({ history, currentLineId: "h40" })), { ok: false, reason: "invalid" });

  const long = sceneSave({
    history: [npcLine({ text: "字".repeat(4_001) })],
    currentLineId: "m-npc-1",
    learnerLines: [],
  });
  assert.deepEqual(saveLovePlayScene(long), { ok: false, reason: "invalid" });

  const fiveOptions = sceneSave({
    options: Array.from({ length: 5 }, (_, i) => ({ zh: `选项${i}`, en: `option ${i}` })),
  });
  assert.deepEqual(saveLovePlayScene(fiveOptions), { ok: false, reason: "invalid" });
  assert.deepEqual(saveLovePlayScene(sceneSave({ options: [{ zh: "只有一个", en: "only one" }] })), {
    ok: false,
    reason: "invalid",
  });

  const heavySave = sceneSave({ routeState: "x".repeat(600 * 1024) });
  assert.deepEqual(saveLovePlayScene(heavySave), { ok: false, reason: "invalid" });

  const saves: Record<string, LovePlaySave> = {};
  for (let i = 0; i < 5; i++) {
    saves[`huge-${i}`] = sceneSave({ scenarioId: `huge-${i}`, routeState: "x".repeat(500 * 1024) });
  }
  assert.deepEqual(writeLoveStoryStore({ ...emptyLoveStoryStore(), saves }), { ok: false, reason: "invalid" });
  assert.equal(slots.has(KEY), false, "nothing was persisted by any rejected write");
});

test("pruning keeps every playing save and only the 12 most recently updated ended saves", () => {
  reset();
  assert.equal(saveLovePlayScene(sceneSave({ scenarioId: "scene-playing", updatedAt: 1 })).ok, true);
  for (let i = 0; i < 13; i++) {
    assert.equal(saveLovePlayScene(endedSave(`scene-ended-${i}`, 100 + i)).ok, true);
  }

  const read = okRead();
  const keys = Object.keys(read.store.saves);
  assert.equal(keys.length, 13, "1 playing + 12 ended");
  assert.ok(keys.includes("scene-playing"), "a playing save is never pruned");
  assert.ok(!keys.includes("scene-ended-0"), "the oldest ended save made room");
  assert.ok(keys.includes("scene-ended-12"), "the newest ended save stays");
  assert.equal(read.store.saves["scene-ended-12"].status, "ended");
});

test("records keep the latest 100 and a replayed id does not grow the list", () => {
  reset();
  for (let i = 0; i <= 100; i++) {
    assert.equal(appendLovePlayRecord(record(`r${i}`, i)).ok, true);
  }

  const read = okRead();
  assert.equal(read.store.records.length, 100);
  assert.equal(read.store.records[0].id, "r1", "the oldest record was dropped");
  assert.equal(read.store.records[99].id, "r100");

  assert.equal(appendLovePlayRecord(record("r100", 100)).ok, true);
  assert.equal(okRead().store.records.length, 100, "double-submitting the same record is idempotent");
});

test("the transcript projects only confirmed lines and never leaks options, outcomes or routes", () => {
  const save = sceneSave({
    options: [
      { zh: "SECRET-OPTION", en: "SECRET-OPTION" },
      { zh: "另一个选项", en: "another option" },
    ],
    routeState: { hidden: "SECRET-ROUTE" },
  });

  const transcript = buildLovePlayTranscript(save);
  assert.deepEqual(transcript, [
    { id: "m-npc-1", role: "npc", characterId: "rio", text: "你终于来了。" },
    { id: "m-learner-1", role: "learner", text: "路上堵车，我跑过来的。" },
    { id: "m-npc-2", role: "npc", characterId: "rio", text: "先喝口水吧。" },
  ]);
  assert.deepEqual(Object.keys(transcript[0]).sort(), ["characterId", "id", "role", "text"]);
  assert.ok(!JSON.stringify(transcript).includes("SECRET"), "no option/route/hidden text");
  assert.ok(!JSON.stringify(transcript).includes("success"), "no ending copy");
});

test("latestPlayingSaveForSeries picks the newest playing save of the series and skips bad slots", () => {
  reset();
  const store: Record<string, unknown> = {
    ...emptyLoveStoryStore(),
    saves: {
      sceneOld: sceneSave({ scenarioId: "sceneOld", updatedAt: 5 }),
      sceneNew: sceneSave({ scenarioId: "sceneNew", updatedAt: 9 }),
      sceneEnded: endedSave("sceneEnded", 20),
      sceneOther: sceneSave({ scenarioId: "sceneOther", seriesId: "love-arc-eve-after-no", updatedAt: 30 }),
    },
  };
  putRaw(store);
  assert.equal(latestPlayingSaveForSeries("love-arc-rio-clarify")?.scenarioId, "sceneNew");
  assert.equal(latestPlayingSaveForSeries("love-arc-missing"), null);

  slots.set(KEY, "not json");
  assert.equal(latestPlayingSaveForSeries("love-arc-rio-clarify"), null, "a corrupt slot is skipped, not thrown");
});

test("delete removes one scene, respects the revision check and is idempotent", () => {
  reset();
  const sceneId = sceneSave().scenarioId;
  assert.equal(saveLovePlayScene(sceneSave()).ok, true);
  assert.equal(saveLovePlayScene(endedSave("scene-ended", 3_000)).ok, true);
  const revision = okRead().store.revision;

  assert.deepEqual(deleteLovePlayScene(sceneId, revision - 1), {
    ok: false,
    reason: "conflict",
    diskRevision: revision,
  });
  assert.equal(readLovePlaySave(sceneId).status, "ok");

  assert.equal(deleteLovePlayScene(sceneId, revision).ok, true);
  assert.deepEqual(readLovePlaySave(sceneId), { status: "empty" });
  assert.equal(hasLovePlaySave(sceneId), false);
  assert.equal(readLovePlaySave("scene-ended").status, "ok", "other scenes are untouched");

  assert.equal(deleteLovePlayScene(sceneId).ok, true, "deleting a missing scene is a no-op success");
});

test("unknown score fields are stripped by the schema and never reach the slot", () => {
  reset();
  const dirty = {
    ...sceneSave(),
    proficiency: 91,
    loveProficiency: 77,
    stars: 5,
    practiceDays: 30,
    report: "must not persist",
    history: [
      { ...npcLine(), hidden: "SECRET-HIDDEN" },
      learnerLine(),
      npcLine({ id: "m-npc-2", text: "先喝口水吧。", ts: 3 }),
    ],
  } as unknown as LovePlaySave;

  assert.equal(saveLovePlayScene(dirty).ok, true);
  const raw = slots.get(KEY) ?? "";
  for (const field of ["proficiency", "loveProficiency", "stars", "practiceDays", "report", "hidden"]) {
    assert.ok(!raw.includes(`"${field}"`), `${field} must be stripped`);
  }
  assert.equal(readLovePlaySave(dirty.scenarioId).status, "ok");
  const parsed = LovePlaySaveSchema.parse(dirty) as unknown as Record<string, unknown>;
  assert.ok(!("proficiency" in parsed));
});

test("save invariants reject inconsistent states at write time", () => {
  reset();
  assert.deepEqual(saveLovePlayScene(sceneSave({ outcome: "success" })), { ok: false, reason: "invalid" });
  assert.deepEqual(saveLovePlayScene(sceneSave({ options: null })), { ok: false, reason: "invalid" });
  assert.deepEqual(saveLovePlayScene(sceneSave({ recorded: true })), { ok: false, reason: "invalid" });
  assert.deepEqual(saveLovePlayScene(sceneSave({ currentLineId: "m-learner-1" })), { ok: false, reason: "invalid" });
  assert.deepEqual(
    saveLovePlayScene(sceneSave({ learnerLines: [{ via: "pick", text: "这句我没说过" }] })),
    { ok: false, reason: "invalid" },
  );
  assert.deepEqual(saveLovePlayScene(sceneSave({ status: "ended" })), {
    ok: false,
    reason: "invalid",
  });
  assert.equal(saveLovePlayScene(endedSave("scene-ended", 3_000)).ok, true);
});

test("an invalid store passed to writeLoveStoryStore is rejected without persisting", () => {
  reset();
  const broken = {
    ...emptyLoveStoryStore(),
    saves: { "scene-a": sceneSave({ scenarioId: "scene-b" }) },
  };
  assert.deepEqual(writeLoveStoryStore(broken), { ok: false, reason: "invalid" });
  assert.equal(slots.has(KEY), false);

  const store = { ...emptyLoveStoryStore(), routes: { "love-arc-rio-clarify": { act: 2 } } };
  const res = writeLoveStoryStore(store);
  assert.equal(res.ok, true);
  assert.deepEqual(stored().routes, { "love-arc-rio-clarify": { act: 2 } });
});

test("route state round-trips through the same story slot and respects revision", () => {
  reset();
  assert.equal(readLovePlayRoute("love-arc-rio-clarify"), null, "no route yet");

  const first = writeLovePlayRoute("love-arc-rio-clarify", { v: 1, lastAct: 4 });
  assert.equal(first.ok, true);
  assert.deepEqual(readLovePlayRoute("love-arc-rio-clarify"), { v: 1, lastAct: 4 });
  const revision = first.ok ? first.store.revision : 0;

  assert.deepEqual(writeLovePlayRoute("love-arc-rio-clarify", { v: 9 }, revision - 1), {
    ok: false,
    reason: "conflict",
    diskRevision: revision,
  });
  assert.deepEqual(readLovePlayRoute("love-arc-rio-clarify"), { v: 1, lastAct: 4 }, "a conflict does not overwrite");

  const second = writeLovePlayRoute("love-arc-rio-clarify", { v: 2 }, revision);
  assert.equal(second.ok, true);
  assert.deepEqual(readLovePlayRoute("love-arc-rio-clarify"), { v: 2 });
});

test("a corrupt story slot exposes no route and is never silently overwritten", () => {
  reset();
  slots.set(KEY, "{broken");
  assert.equal(readLovePlayRoute("love-arc-rio-clarify"), null);
  assert.deepEqual(writeLovePlayRoute("love-arc-rio-clarify", { v: 1 }), { ok: false, reason: "invalid" });
  assert.equal(slots.get(KEY), "{broken");
});

test("the explicit clear removes the slot and reads as empty again", () => {
  reset();
  assert.equal(saveLovePlayScene(sceneSave()).ok, true);
  assert.equal(readLoveStoryStore().status, "ok");
  clearLoveStorySlot();
  assert.deepEqual(readLoveStoryStore(), { status: "empty" });
  assert.equal(slots.has(KEY), false);

  // 坏档也能被显式清掉（只有用户确认后的恢复入口会调它）。
  slots.set(KEY, "{broken");
  clearLoveStorySlot();
  assert.deepEqual(readLoveStoryStore(), { status: "empty" });
});
