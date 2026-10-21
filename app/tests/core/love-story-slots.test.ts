/** story store v2：手动槽、v1 迁移、章节重玩清账与坏档保护。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOVE_STORY_KEY,
  deleteLovePlaySlot,
  emptyLoveStoryStore,
  readLovePlaySlots,
  readLoveStoryStore,
  resetLovePlayScenes,
  saveLovePlayScene,
  saveLovePlaySlot,
  writeLovePlayRoute,
  writeLoveStoryStore,
  type LovePlaySave,
} from "../../src/lib/love-story";

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
const stored = (): Record<string, unknown> => JSON.parse(slots.get(LOVE_STORY_KEY) ?? "{}");

const save = (over: Partial<LovePlaySave> = {}): LovePlaySave => ({
  v: 1,
  scenarioId: "scene-a",
  seriesId: "series-a",
  lang: "zh",
  status: "playing",
  history: [
    { id: "npc-1", role: "npc", characterId: "rio", text: "你来了。", lang: "zh", ts: 1 },
    { id: "learner-1", role: "learner", text: "路上堵车。", lang: "zh", ts: 2 },
    { id: "npc-2", role: "npc", characterId: "rio", text: "先坐。", lang: "zh", ts: 3 },
  ],
  currentLineId: "npc-2",
  options: [
    { zh: "谢谢。", en: "Thanks." },
    { zh: "你等很久了？", en: "Waited long?" },
  ],
  emotion: "neutral",
  stance: 48,
  carryover: false,
  learnerLines: [{ via: "type", text: "路上堵车。" }],
  outcome: null,
  recorded: false,
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_100,
  ...over,
});

test("a slot save round-trips without touching the autosave", () => {
  reset();
  assert.equal(saveLovePlayScene(save()).ok, true);
  const auto = readLoveStoryStore();
  assert.equal(auto.status, "ok");
  if (auto.status !== "ok") return;

  const result = saveLovePlaySlot("scene-a", "2", save({ updatedAt: 1_700_000_000_200 }), auto.store.revision);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const read = readLovePlaySlots("scene-a");
  assert.equal(read.status, "ok");
  assert.equal(read.slots["2"]?.updatedAt, 1_700_000_000_200);
  assert.equal(read.slots["1"], undefined);
  assert.equal(result.store.saves["scene-a"]?.updatedAt, 1_700_000_000_100, "autosave is untouched");
});

test("three slots coexist and deleting one keeps the others", () => {
  reset();
  for (const slot of ["1", "2", "3"] as const) {
    const result = saveLovePlaySlot("scene-a", slot, save({ updatedAt: 1_700_000_000_000 + Number(slot) }));
    assert.equal(result.ok, true);
  }
  assert.deepEqual(Object.keys(readLovePlaySlots("scene-a").slots).sort(), ["1", "2", "3"]);

  const removed = deleteLovePlaySlot("scene-a", "2");
  assert.equal(removed.ok, true);
  assert.deepEqual(Object.keys(readLovePlaySlots("scene-a").slots).sort(), ["1", "3"]);
  assert.equal(deleteLovePlaySlot("scene-a", "2").ok, true, "deleting an empty slot is idempotent");
});

test("deleting the last slot removes the scene key instead of leaving an empty object", () => {
  reset();
  assert.equal(saveLovePlaySlot("scene-a", "1", save()).ok, true);
  assert.equal(deleteLovePlaySlot("scene-a", "1").ok, true);
  const raw = stored() as { slots?: Record<string, unknown> };
  assert.deepEqual(raw.slots, {});
});

test("a slot must be keyed by the scenario it claims", () => {
  reset();
  const result = saveLovePlaySlot("scene-b", "1", save());
  assert.deepEqual(result, { ok: false, reason: "invalid" });
  assert.equal(readLoveStoryStore().status, "empty");
});

test("a v1 store migrates in memory and persists as v3 on the next write", () => {
  reset();
  const v1 = {
    v: 1,
    revision: 6,
    saves: { "scene-a": save() },
    records: [],
    routes: { "series-a": { lastAct: 2 } },
    updatedAt: 1,
  };
  slots.set(LOVE_STORY_KEY, JSON.stringify(v1));
  const read = readLoveStoryStore();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") return;
  assert.equal(read.store.v, 3);
  assert.deepEqual(read.store.slots, {});
  assert.deepEqual(read.store.relationships, {});
  assert.deepEqual(read.store.routes, { "series-a": { lastAct: 2 } });

  const written = saveLovePlaySlot("scene-a", "1", save(), read.store.revision);
  assert.equal(written.ok, true);
  assert.equal(stored().v, 3);
});

test("a corrupt store rejects slot writes and keeps the original bytes", () => {
  reset();
  const raw = '{"v":2,"revision":1,"saves":{},"slots":{},"records":[],"routes":{},"updatedAt":0';
  slots.set(LOVE_STORY_KEY, raw);
  assert.deepEqual(saveLovePlaySlot("scene-a", "1", save()), { ok: false, reason: "invalid" });
  assert.deepEqual(deleteLovePlaySlot("scene-a", "1"), { ok: false, reason: "invalid" });
  assert.equal(slots.get(LOVE_STORY_KEY), raw);
});

test("a stale revision cannot overwrite a slot", () => {
  reset();
  assert.equal(saveLovePlaySlot("scene-a", "1", save()).ok, true);
  const conflict = saveLovePlaySlot("scene-a", "1", save({ updatedAt: 9 }), 0);
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.reason, "conflict");
  assert.equal(readLovePlaySlots("scene-a").slots["1"]?.updatedAt, save().updatedAt);
});

test("chapter reset clears autosaves, slots and routes but keeps records", () => {
  reset();
  assert.equal(saveLovePlayScene(save()).ok, true);
  const withSlot = saveLovePlaySlot("scene-a", "1", save());
  assert.equal(withSlot.ok, true);
  assert.equal(saveLovePlayScene(save({ scenarioId: "scene-b" })).ok, true);
  assert.equal(writeLovePlayRoute("series-a", { lastAct: 3 }).ok, true);
  const store = readLoveStoryStore();
  assert.equal(store.status, "ok");
  if (store.status !== "ok") return;

  const result = resetLovePlayScenes(["scene-a", "scene-b"], {
    seriesId: "series-a",
    expectedRevision: store.store.revision,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.store.saves, {});
  assert.deepEqual(result.store.slots, {});
  assert.deepEqual(result.store.routes, {});
  assert.deepEqual(result.store.records, []);
});

test("writes reject a store whose slot save claims another scenario", () => {
  reset();
  const store = emptyLoveStoryStore();
  const broken = {
    ...store,
    slots: { "scene-a": { "1": save({ scenarioId: "scene-b" }) } },
  };
  assert.deepEqual(writeLoveStoryStore(broken), { ok: false, reason: "invalid" });
  assert.equal(slots.has(LOVE_STORY_KEY), false);
});
