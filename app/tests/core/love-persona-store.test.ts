/** 人设库设备端 slot 的离线回归：往返、revision 冲突、配额、坏档保留、分表、草稿、备份往返。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { localizedFromSingle, type Persona } from "../../src/lib/love-persona";
import {
  LOVE_PERSONA_DRAFT_KEY,
  LOVE_PERSONA_KEY,
  LOVE_PERSONA_STORE_ASSET_MAX_BYTES,
  buildCoachProfilePatch,
  clearPersonaDraft,
  copyLovePersonaToCoachProfile,
  deleteLovePersona,
  getLovePersona,
  listLovePersonas,
  readLovePersonaStore,
  readPersonaDraft,
  savePersonaDraft,
  setActivePlayer,
  upsertLovePersona,
} from "../../src/lib/love-persona-store";
import { lovePlayBackup, decodeBackup } from "../../src/lib/backup";
import { parseLovePlaySlot } from "../../src/lib/archive";
import { LOVE_STORY_KEY } from "../../src/lib/love-story";

const KEY = LOVE_PERSONA_KEY;
const STORY_KEY = LOVE_STORY_KEY;
const slots = new Map<string, string>();
const session = new Map<string, string>();

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
const stub = () => {
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
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => { session.set(key, value); },
      removeItem: (key: string) => { session.delete(key); },
    },
  });
};
stub();

const persona = (over: Partial<Persona> = {}): Persona => ({
  v: 1,
  id: "p1",
  revision: 1,
  kind: "npc",
  name: localizedFromSingle("Rio"),
  source: "love-created",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

test("an empty library writes and reads back a versioned store", () => {
  slots.clear();
  assert.deepEqual(readLovePersonaStore(), { status: "empty" });
  const w = upsertLovePersona(persona({ id: "p1" }));
  assert.equal(w.ok, true);
  assert.deepEqual(w.warnings, []);
  const read = readLovePersonaStore();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") return;
  assert.equal(read.store.v, 1);
  assert.equal(read.store.revision, 1);
  assert.equal(read.store.personas.p1.name.zh, "Rio");
  assert.ok(read.store.updatedAt > 0);
});

test("re-upserting the same id bumps the persona revision and keeps createdAt", () => {
  slots.clear();
  assert.ok(upsertLovePersona(persona({ id: "p1", createdAt: 100 })).ok);
  const second = upsertLovePersona(persona({ id: "p1", createdAt: 999, name: localizedFromSingle("里奥") }));
  assert.ok(second.ok);
  const stored = second.store.personas.p1;
  assert.equal(stored.revision, 2, "the content revision moved");
  assert.equal(stored.createdAt, 100, "createdAt is preserved across edits");
  assert.equal(stored.name.zh, "里奥");
});

test("a stale expectedRevision is a conflict, not a silent overwrite", () => {
  slots.clear();
  assert.ok(upsertLovePersona(persona({ id: "p1" })).ok);
  const conflicted = upsertLovePersona(persona({ id: "p2" }), { expectedRevision: 0 });
  assert.deepEqual(conflicted, { ok: false, reason: "conflict", diskRevision: 1 });
  const read = readLovePersonaStore();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") return;
  assert.deepEqual(Object.keys(read.store.personas), ["p1"], "the refused write left the library untouched");
});

test("a corrupt or future slot is preserved and refuses writes", () => {
  slots.clear();
  slots.set(KEY, '{"personas":');
  assert.equal(readLovePersonaStore().status, "corrupt");
  const before = slots.get(KEY);
  assert.deepEqual(upsertLovePersona(persona({ id: "p1" })), { ok: false, reason: "invalid" });
  assert.equal(slots.get(KEY), before, "the original bytes survive a refused write");

  slots.set(KEY, JSON.stringify({ v: 1, revision: 0, personas: { p1: { id: "p1", kind: "npc" } }, updatedAt: 0 }));
  assert.equal(readLovePersonaStore().status, "corrupt", "an unreadable persona is corrupt, not empty");

  slots.set(KEY, JSON.stringify({ v: 2, revision: 0, personas: {}, updatedAt: 0 }));
  assert.equal(readLovePersonaStore().status, "incompatible");
  assert.deepEqual(upsertLovePersona(persona({ id: "p1" })), { ok: false, reason: "invalid" });
  slots.clear();
});

test("a quota failure is reported instead of claiming a save", () => {
  slots.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => slots.get(key) ?? null,
      setItem: () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; },
      removeItem: (key: string) => { slots.delete(key); },
    },
  });
  assert.deepEqual(upsertLovePersona(persona({ id: "p1" })), { ok: false, reason: "quota" });
  stub();
});

test("a persona write never touches any other device key", () => {
  slots.clear();
  slots.set("socialcoach.v1", '{"sessions":[]}');
  slots.set("socialcoach.love-play.carry", '[{"id":"c1"}]');
  const coach = slots.get("socialcoach.v1");
  const carry = slots.get("socialcoach.love-play.carry");
  const w = upsertLovePersona(persona({ id: "p1" }));
  assert.ok(w.ok);
  assert.equal(slots.get("socialcoach.v1"), coach, "the coach profile is untouched");
  assert.equal(slots.get("socialcoach.love-play.carry"), carry);
  assert.ok(slots.has(KEY), "and the persona slot is written");
});

test("over-budget assets are dropped with a warning that names them", () => {
  slots.clear();
  const small = "data:image/png;base64," + "A".repeat(10);
  const huge = "data:image/png;base64," + "A".repeat(LOVE_PERSONA_STORE_ASSET_MAX_BYTES + 10);
  const w = upsertLovePersona(persona({ id: "p1" }), { assets: { smile: small, ref: huge } });
  assert.ok(w.ok);
  assert.deepEqual(w.warnings, [{ code: "assets-dropped", dropped: ["ref"] }], "the dropped asset is named, never silent");
  const read = readLovePersonaStore();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") return;
  assert.deepEqual(Object.keys(read.store.assets?.p1 ?? {}), ["smile"]);
});

test("deleting a persona reports linked progress but removes nothing else", () => {
  slots.clear();
  const scenarioId = "love-arc-rio-clarify-1";
  const save = {
    v: 1, scenarioId, seriesId: "love-arc-rio-clarify", lang: "zh", status: "ended",
    history: [{ id: "m1", role: "npc", characterId: "rio", text: "x", lang: "zh", ts: 1 }],
    currentLineId: "m1", options: null, emotion: "neutral", stance: null, carryover: false,
    learnerLines: [], outcome: "success", recorded: true, startedAt: 1, updatedAt: 2,
  };
  slots.set(STORY_KEY, JSON.stringify({ v: 2, revision: 1, saves: { [scenarioId]: save }, slots: {}, records: [{ id: "r1", scenarioId, seriesId: "love-arc-rio-clarify", outcome: "success", startedAt: 1, endedAt: 2, lang: "zh" }], routes: {}, updatedAt: 2 }));
  slots.set("socialcoach.love-play.series.love-arc-rio-clarify", JSON.stringify({ v: 2, completed: [scenarioId], lastScene: scenarioId, outcome: {} }));

  assert.ok(upsertLovePersona(persona({ id: "p1", characterKey: "love-arc-rio-clarify:rio" })).ok);
  const del = deleteLovePersona("p1");
  assert.ok(del.ok);
  assert.deepEqual(del.links, { seriesIds: ["love-arc-rio-clarify"], scenarioIds: [] });
  assert.equal(del.store.personas.p1, undefined);
  assert.ok(slots.has(STORY_KEY), "the linked story is untouched — the caller decides");
  assert.ok(slots.has("socialcoach.love-play.series.love-arc-rio-clarify"));
});

test("the active player must point at a player persona, and deleting it clears the pointer", () => {
  slots.clear();
  assert.ok(upsertLovePersona(persona({ id: "npc1", kind: "npc" })).ok);
  assert.deepEqual(setActivePlayer("npc1"), { ok: false, reason: "invalid" });
  assert.ok(upsertLovePersona(persona({ id: "pl1", kind: "player" })).ok);
  const w = setActivePlayer("pl1");
  assert.ok(w.ok);
  assert.equal(w.store.activePlayerId, "pl1");
  const del = deleteLovePersona("pl1");
  assert.ok(del.ok);
  assert.equal(del.store.activePlayerId, undefined, "the pointer does not dangle");
});

test("list filters by kind and get returns a single persona", () => {
  slots.clear();
  assert.ok(upsertLovePersona(persona({ id: "n1", kind: "npc" })).ok);
  assert.ok(upsertLovePersona(persona({ id: "n2", kind: "npc" })).ok);
  assert.ok(upsertLovePersona(persona({ id: "pl1", kind: "player" })).ok);
  assert.deepEqual(listLovePersonas("npc").map((p) => p.id).sort(), ["n1", "n2"]);
  assert.equal(listLovePersonas().length, 3);
  assert.equal(getLovePersona("n1")?.id, "n1");
  assert.equal(getLovePersona("missing"), null);
});

test("a draft survives a refresh and clears on demand", () => {
  session.clear();
  assert.equal(readPersonaDraft(), null);
  assert.equal(savePersonaDraft({ kind: "npc", persona: persona({ id: "d1" }), editor: { step: 2 }, updatedAt: 7 }), true);
  const draft = readPersonaDraft();
  assert.equal(draft?.persona.id, "d1");
  assert.deepEqual(draft?.editor, { step: 2 });
  assert.equal(session.has(LOVE_PERSONA_DRAFT_KEY), true);
  clearPersonaDraft();
  assert.equal(readPersonaDraft(), null);
  session.set(LOVE_PERSONA_DRAFT_KEY, "{bad");
  assert.equal(readPersonaDraft(), null, "a corrupt draft reads as no draft, never throws");
});

test("copy-to-coach-profile is a pure patch and requires explicit confirmation", () => {
  slots.clear();
  slots.set("socialcoach.v1", '{"profile":{"name":"old"}}');
  const player = persona({ id: "pl1", kind: "player", language: "en", name: { zh: "你", en: "You" }, bio: localizedFromSingle("a product manager") });
  assert.deepEqual(buildCoachProfilePatch(player), { name: "You", bio: "a product manager", lang: "en" });
  assert.deepEqual(buildCoachProfilePatch(persona({ id: "n1", kind: "npc" })), {}, "an NPC has no coach-profile counterpart");

  const applied: unknown[] = [];
  const capture = (patch: unknown): void => {
    applied.push(patch);
  };
  assert.deepEqual(copyLovePersonaToCoachProfile(player, { confirmed: false, apply: capture }), { ok: false, code: "not-confirmed" });
  assert.deepEqual(applied, [], "nothing is written without confirmation");
  assert.deepEqual(copyLovePersonaToCoachProfile(player, { confirmed: true, apply: capture }), {
    ok: true,
    patch: { name: "You", bio: "a product manager", lang: "en" },
  });
  assert.equal(applied.length, 1);
  assert.equal(slots.get("socialcoach.v1"), '{"profile":{"name":"old"}}', "the module itself never writes the coach profile");
});

test("the persona slot survives a full export→restore round trip and rejects a mismatched shape", async () => {
  slots.clear();
  assert.ok(upsertLovePersona(persona({ id: "p1", name: { zh: "里奥", en: "Rio" } })).ok);
  const snapshot = lovePlayBackup();
  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot), [KEY]);
  const decoded = await decodeBackup(JSON.stringify({ state: { sessions: [] }, version: 0, lovePlay: snapshot }));
  assert.equal(decoded.lovePlayIssue, undefined);
  const restored = JSON.parse(decoded.lovePlay![KEY]) as { v: number; personas: Record<string, { name: { zh: string } }> };
  assert.equal(restored.v, 1);
  assert.equal(restored.personas.p1.name.zh, "里奥");

  // key decides shape: a story store under the persona key is refused, exactly like the other slots.
  const storyLike = { v: 2, revision: 1, saves: {}, slots: {}, records: [], routes: {}, updatedAt: 1 };
  assert.equal(parseLovePlaySlot(KEY, storyLike).success, false);
  assert.equal(parseLovePlaySlot(KEY, restored).success, true);
  assert.equal(parseLovePlaySlot(STORY_KEY, restored).success, false, "persona bytes under the story key are refused");
  const bad = await decodeBackup(JSON.stringify({ state: { sessions: [] }, version: 0, lovePlay: { [KEY]: storyLike } }));
  assert.equal(bad.lovePlayIssue, "invalid");
  assert.equal(bad.lovePlay, undefined);
});