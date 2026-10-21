/** 关系档案（spec-love-bridge §3）的离线回归：empty→round-trip、revision 冲突、幂等、上限 quota、损坏保留 raw、导出/恢复覆盖。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LOVE_ARCHIVE_KEY,
  addUnlocks,
  appendStoryRecord,
  deleteCharacterArchive,
  deleteStoryRecord,
  deriveNarrativeStage,
  emptyLoveArchive,
  readLoveArchive,
  setCanonicalStory,
  upsertCharacterArchive,
  writeLoveArchive,
  type CharacterArchive,
  type LoveArchive,
  type StoryRecord,
} from "../../src/lib/love-archive";
import { emptyRelationship } from "../../src/lib/love-relationship";
import { emptyLoveStoryStore, readLoveStoryStore, writeLoveStoryStore } from "../../src/lib/love-story";
import { clearLovePlaySlots, LOVE_PLAY_PREFIX } from "../../src/lib/love-carry-store";
import { decodeBackup, lovePlayBackup } from "../../src/lib/backup";

const KEY = LOVE_ARCHIVE_KEY;
const slots = new Map<string, string>();
let quota = false;
let blockedRead = false;
let blockedWrite = false;

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
const stubStorage = () =>
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      get length() { return slots.size; },
      key: (index: number) => [...slots.keys()][index] ?? null,
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

const storyRecord = (id: string, over: Partial<StoryRecord> = {}): StoryRecord => ({
  id,
  origin: "love",
  title: { zh: `标题${id}`, en: `Title ${id}` },
  summary: { zh: `摘要${id}`, en: `Summary ${id}` },
  keyChoices: [{ at: 1, choice: { zh: "先问她想要什么", en: "Ask what she wants" } }],
  characterPackIds: ["rio"],
  canonical: false,
  createdAt: 1_000,
  ...over,
});

const characterEntry = (characterPackId: string, over: Partial<CharacterArchive> = {}): CharacterArchive => ({
  characterPackId,
  branchId: "main",
  personaSnapshot: {
    name: { zh: "Rio", en: "Rio" },
    bio: { zh: "慢热", en: "Reserved" },
    source: "builtin",
  },
  relationship: emptyRelationship(characterPackId, 1_000, { zh: "Rio", en: "Rio" }),
  memoryIds: [],
  ...over,
});

const okRead = () => {
  const read = readLoveArchive();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") throw new Error("expected an ok archive");
  return read;
};

test("an empty slot reads empty and a written archive round-trips with defaults and no unknown keys", () => {
  reset();
  assert.deepEqual(readLoveArchive(), { status: "empty" });
  assert.deepEqual(emptyLoveArchive("player-1", 0), {
    v: 1,
    revision: 0,
    playerPersonaId: "player-1",
    characters: {},
    stories: [],
    unlocks: { endings: [], characters: [], scenes: [], cgs: [] },
    updatedAt: 0,
  });

  const archive = {
    ...emptyLoveArchive("player-1"),
    stories: [storyRecord("s1")],
    characters: { "rio:main": characterEntry("rio") },
    unlocks: { endings: ["e1"], characters: ["rio"], scenes: [], cgs: [] },
  };
  const written = writeLoveArchive(archive);
  assert.equal(written.ok, true);
  if (!written.ok) throw new Error("write failed");
  assert.equal(written.archive.revision, 1);
  assert.ok(written.archive.updatedAt > 0);

  const read = okRead();
  assert.equal(read.archive.revision, 1);
  assert.deepEqual(read.archive.characters, archive.characters);
  assert.deepEqual(read.archive.stories, archive.stories);
  assert.deepEqual(read.archive.unlocks, archive.unlocks);
  assert.equal(read.raw, slots.get(KEY));
});

test("a partial v1 archive gets its defaults and unknown keys are stripped from read and from disk on the next write", () => {
  reset();
  const partial = {
    v: 1,
    revision: 0,
    playerPersonaId: "player-1",
    characters: {},
    stories: [],
    updatedAt: 1,
    proficiency: 91,
    loveProficiency: { charm: 5 },
    stars: 4,
    practiceDays: ["2026-10-13"],
    assess: "must not persist",
    x_custom: { note: "strip me" },
  };
  putRaw(partial);

  const read = readLoveArchive();
  assert.equal(read.status, "ok");
  if (read.status === "ok") {
    assert.deepEqual(read.archive.unlocks, { endings: [], characters: [], scenes: [], cgs: [] }, "missing unlocks get defaults");
    assert.equal(read.archive.playerPersonaId, "player-1");
    assert.ok(!("proficiency" in read.archive));
    assert.ok(!("loveProficiency" in read.archive));
    assert.ok(!("stars" in read.archive));
    assert.ok(!("practiceDays" in read.archive));
    assert.ok(!("assess" in read.archive));
    assert.ok(!("x_custom" in read.archive));
  }

  // 读取不改磁盘；下一次正常写入才把干净形状落盘。
  assert.equal(writeLoveArchive({ ...emptyLoveArchive("player-1"), revision: read.status === "ok" ? read.archive.revision : 0 }).ok, true);
  const raw = slots.get(KEY) ?? "";
  for (const field of ["proficiency", "loveProficiency", "stars", "practiceDays", "assess", "x_custom"]) {
    assert.ok(!raw.includes(`"${field}"`), `${field} must never reach the slot`);
  }
});

test("a stale expectedRevision is a conflict and leaves the disk untouched; the archive and story keys do not interfere", () => {
  reset();
  assert.equal(writeLoveArchive(emptyLoveArchive("player-1")).ok, true);
  const before = slots.get(KEY);

  assert.deepEqual(writeLoveArchive({ ...emptyLoveArchive("player-2"), revision: 5 }, 0), {
    ok: false,
    reason: "conflict",
    diskRevision: 1,
  });
  assert.equal(slots.get(KEY), before, "no silent last-writer-wins");

  const retried = writeLoveArchive({ ...emptyLoveArchive("player-2") }, 1);
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.archive.revision, 2);

  // story slot 是另一个 key：写 story 不碰 archive，反之亦然。
  assert.equal(writeLoveStoryStore({ ...emptyLoveStoryStore(), routes: { rio: { act: 1 } } }).ok, true);
  const readArchive = okRead();
  assert.equal(readArchive.archive.playerPersonaId, "player-2");
  const readStory = readLoveStoryStore();
  assert.equal(readStory.status, "ok");
  if (readStory.status === "ok") assert.deepEqual(readStory.store.routes, { rio: { act: 1 } });
});

test("appendStoryRecord is idempotent by id, canonical flips only the same branch, deletes are idempotent and unlocks dedupe", () => {
  reset();
  assert.equal(appendStoryRecord(storyRecord("s1", { canonical: true })).ok, true);
  assert.equal(appendStoryRecord(storyRecord("s1")).ok, true, "same id is an idempotent success");
  let read = okRead();
  assert.equal(read.archive.stories.length, 1, "the same id does not grow the list");
  assert.equal(read.archive.revision, 1, "the idempotent replay did not bump the revision");
  assert.equal(read.archive.stories[0].canonical, true, "the first record is not overwritten");

  // s2 = 同角色同分支的续写；s3 = what-if 分支；s4 = 另一个角色。
  assert.equal(appendStoryRecord(storyRecord("s2", { canonical: false })).ok, true);
  assert.equal(appendStoryRecord(storyRecord("s3", { id: "s3", characterPackIds: ["rio"], branchId: "what-if-1", canonical: false })).ok, true);
  assert.equal(appendStoryRecord(storyRecord("s4", { id: "s4", characterPackIds: ["eve"], canonical: true })).ok, true);

  const set = setCanonicalStory("s2", true);
  assert.equal(set.ok, true);
  read = okRead();
  const byId = Object.fromEntries(read.archive.stories.map((s) => [s.id, s]));
  assert.equal(byId.s2.canonical, true);
  assert.equal(byId.s1.canonical, false, "the same character + same branch loses the mainline flag");
  assert.equal(byId.s3.canonical, false, "a what-if branch is untouched");
  assert.equal(byId.s4.canonical, true, "another character's mainline is untouched");
  assert.equal(read.archive.stories.length, 4, "canonical switching never deletes a branch");

  assert.deepEqual(setCanonicalStory("missing-story", true), { ok: false, reason: "invalid" });

  // 删除角色 / 故事：幂等，且只删自己的键。
  assert.equal(upsertCharacterArchive(characterEntry("rio")).ok, true);
  assert.equal(deleteCharacterArchive("rio").ok, true);
  read = okRead();
  assert.ok(!("rio:main" in read.archive.characters));
  assert.equal(deleteCharacterArchive("rio").ok, true, "deleting a missing character is a no-op success");

  const storiesBefore = read.archive.stories.length;
  assert.equal(deleteStoryRecord("s1").ok, true);
  read = okRead();
  assert.equal(read.archive.stories.length, storiesBefore - 1);
  assert.equal(deleteStoryRecord("s1").ok, true, "deleting a missing story is a no-op success");

  // unlocks 去重：重复写入不产生重复条目。
  assert.equal(addUnlocks({ endings: ["e1", "e1", "e2"] }).ok, true);
  assert.equal(addUnlocks({ endings: ["e2"] }).ok, true);
  read = okRead();
  assert.deepEqual(read.archive.unlocks.endings, ["e1", "e2"]);
});

test("exceeding the story cap returns quota and never truncates existing stories", () => {
  reset();
  for (let i = 0; i < 200; i++) {
    const res = appendStoryRecord(storyRecord(`s${i}`, { createdAt: 1_000 + i }));
    assert.equal(res.ok, true);
  }
  const before = slots.get(KEY);
  assert.deepEqual(appendStoryRecord(storyRecord("s-over", { createdAt: 9_999 })), { ok: false, reason: "quota" });
  assert.equal(slots.get(KEY), before, "an over-cap write leaves the disk untouched");
  const read = okRead();
  assert.equal(read.archive.stories.length, 200, "nothing was truncated");
});

test("the character and unlock caps also refuse with quota", () => {
  reset();
  for (let i = 0; i < 100; i++) {
    assert.equal(upsertCharacterArchive(characterEntry(`char-${i}`)).ok, true);
  }
  const before = slots.get(KEY);
  assert.deepEqual(upsertCharacterArchive(characterEntry("char-100")), { ok: false, reason: "quota" });
  assert.equal(slots.get(KEY), before);

  reset();
  assert.deepEqual(addUnlocks({ endings: Array.from({ length: 501 }, (_, i) => `e${i}`) }), { ok: false, reason: "quota" });
  assert.equal(readLoveArchive().status, "empty", "a refused unlock write persists nothing");
});

test("a damaged archive reads as corrupt with the original bytes preserved and is never auto-cleared", () => {
  reset();
  slots.set(KEY, '{"v":1,"stories":');
  assert.deepEqual(readLoveArchive(), { status: "corrupt", raw: '{"v":1,"stories":', reason: "json" });
  assert.deepEqual(writeLoveArchive(emptyLoveArchive()), { ok: false, reason: "corrupt" });
  assert.equal(slots.get(KEY), '{"v":1,"stories":', "bad bytes survive every write attempt");

  reset();
  const wrongShape = { v: 1, revision: 0, playerPersonaId: "p", characters: {}, stories: "nope", unlocks: {}, updatedAt: 1 };
  putRaw(wrongShape);
  const shapeRead = readLoveArchive();
  assert.equal(shapeRead.status, "corrupt");
  if (shapeRead.status === "corrupt") {
    assert.equal(shapeRead.reason, "shape");
    assert.equal(shapeRead.raw, JSON.stringify(wrongShape));
  }
  assert.deepEqual(writeLoveArchive(emptyLoveArchive()), { ok: false, reason: "corrupt" });
  assert.equal(slots.get(KEY), JSON.stringify(wrongShape));

  reset();
  const future = { v: 2, revision: 3, playerPersonaId: "p", characters: {}, stories: [], unlocks: {}, updatedAt: 1 };
  putRaw(future);
  assert.deepEqual(readLoveArchive(), { status: "incompatible", raw: JSON.stringify(future) });
  assert.deepEqual(writeLoveArchive(emptyLoveArchive()), { ok: false, reason: "incompatible" });
  assert.equal(slots.get(KEY), JSON.stringify(future), "a future version is preserved, not reset");
});

test("quota and disabled storage degrade to explicit failures without touching the last valid archive", () => {
  reset();
  assert.equal(writeLoveArchive(emptyLoveArchive("player-1")).ok, true);
  const before = slots.get(KEY);

  quota = true;
  assert.deepEqual(writeLoveArchive({ ...emptyLoveArchive("player-1") }), { ok: false, reason: "quota" });
  assert.equal(slots.get(KEY), before);
  quota = false;

  blockedWrite = true;
  assert.deepEqual(writeLoveArchive({ ...emptyLoveArchive("player-1") }), { ok: false, reason: "unavailable" });
  assert.equal(slots.get(KEY), before);
  blockedWrite = false;

  blockedRead = true;
  assert.deepEqual(readLoveArchive(), { status: "unavailable" });
  blockedRead = false;
});

test("the archive module and its objects never carry score fields", () => {
  const source = readFileSync(new URL("../../src/lib/love-archive.ts", import.meta.url), "utf8");
  for (const forbidden of ["proficiency", "loveProficiency", "practiceDays", "stars", "assess"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} must not appear in love-archive.ts`);
  }

  reset();
  const dirty = {
    ...emptyLoveArchive("player-1"),
    proficiency: 91,
    loveProficiency: { charm: 5 },
    stars: 3,
    practiceDays: ["2026-10-13"],
    assess: { x: 1 },
  } as unknown as LoveArchive;
  assert.equal(writeLoveArchive(dirty).ok, true);
  const raw = slots.get(KEY) ?? "";
  for (const forbidden of ["proficiency", "loveProficiency", "practiceDays", "stars", "assess"]) {
    assert.ok(!raw.includes(`"${forbidden}"`), `${forbidden} must be stripped from the slot`);
  }
  const read = okRead();
  assert.deepEqual(read.archive.stories, []);
});

test("the narrative stage is derived from familiarity and trust only", () => {
  const base = emptyRelationship("rio:main");
  assert.equal(deriveNarrativeStage({ ...base, familiarity: 0, trust: 3, attraction: 3 }), 0);
  assert.equal(deriveNarrativeStage({ ...base, familiarity: 1, trust: 1 }), 1);
  assert.equal(deriveNarrativeStage({ ...base, familiarity: 2, trust: 3, attraction: 0 }), 2);
  assert.equal(deriveNarrativeStage({ ...base, familiarity: 3, trust: 3 }), 3);
});

test("the archive slot travels with the backup envelope, restores verbatim and the wipe clears it", async () => {
  reset();
  const archive = {
    ...emptyLoveArchive("player-1"),
    stories: [storyRecord("s1")],
    characters: { "rio:main": characterEntry("rio") },
    unlocks: { endings: ["e1"], characters: [], scenes: [], cgs: [] },
  };
  assert.equal(writeLoveArchive(archive).ok, true);

  const snapshot = lovePlayBackup();
  assert.ok(snapshot);
  assert.ok(LOVE_ARCHIVE_KEY in snapshot, "the archive is collected by the prefix scan");

  const decoded = await decodeBackup(JSON.stringify({ state: { sessions: [] }, version: 0, lovePlay: snapshot }));
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.equal(decoded.lovePlayOriginal, undefined);
  assert.ok(decoded.lovePlay && LOVE_ARCHIVE_KEY in decoded.lovePlay, "the archive comes back through the envelope");

  // 写回一台「擦干净」的设备后仍能原样读回。
  slots.clear();
  for (const [key, json] of Object.entries(decoded.lovePlay!)) slots.set(key, json);
  const reread = okRead();
  assert.equal(reread.archive.playerPersonaId, "player-1");
  assert.deepEqual(reread.archive.unlocks.endings, ["e1"]);
  assert.equal(reread.archive.stories[0].id, "s1");

  // 「重置全部数据」按前缀清 → archive 跟着一起没了。
  slots.clear();
  slots.set(LOVE_ARCHIVE_KEY, JSON.stringify(emptyLoveArchive("player-1")));
  assert.equal(clearLovePlaySlots(), 1);
  assert.equal(slots.get(LOVE_ARCHIVE_KEY), undefined);
  assert.deepEqual(readLoveArchive(), { status: "empty" });
});

test("the archive key lives inside the prefix the exporter scans", () => {
  assert.ok(LOVE_ARCHIVE_KEY.startsWith(LOVE_PLAY_PREFIX), "the archive key must be under the scanned prefix");
});
