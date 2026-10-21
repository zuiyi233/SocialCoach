/** 用户卡存储（spec-love-user-cards §2.2）的离线回归：空槽、往返、revision 冲突、配额、损坏保留、备份、擦除不越界。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOVE_CARDS_KEY,
  LOVE_CARDS_MAX,
  LOVE_CARDS_MAX_CHARS,
  addLoveCard,
  clearLoveCards,
  loveCardBackup,
  readLoveCards,
  removeLoveCard,
  updateLoveCard,
} from "../../src/lib/love-card-store";
import type { LoveCard } from "../../src/lib/love-card";

const KEY = LOVE_CARDS_KEY;
const slots = new Map<string, string>();
let quota = false;
let blockedRead = false;
let blockedWrite = false;

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
const stubStorage = () =>
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
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
  });
stubStorage();

const reset = () => {
  slots.clear();
  quota = false;
  blockedRead = false;
  blockedWrite = false;
};

const card = (id: string, over: Partial<LoveCard> = {}): LoveCard => ({
  id,
  name: `Name ${id}`,
  description: `desc ${id}`,
  personality: "",
  scenario: "",
  firstMes: `hi ${id}`,
  mesExample: "",
  alternateGreetings: [],
  tags: [],
  source: "tavern-json",
  spec: "chara_card_v2",
  importedAt: 1,
  updatedAt: 1,
  ...over,
});

const okRead = () => {
  const read = readLoveCards();
  assert.equal(read.status, "ok");
  if (read.status !== "ok") throw new Error("expected an ok read");
  return read;
};

test("an empty slot reads empty, an add round-trips and bumps the revision", () => {
  reset();
  assert.deepEqual(readLoveCards(), { status: "empty", cards: [], revision: 0 });

  assert.deepEqual(addLoveCard(card("c1"), 0), { ok: true, revision: 1 });
  const read = okRead();
  assert.equal(read.cards.length, 1);
  assert.equal(read.revision, 1);
  assert.equal(read.cards[0].name, "Name c1");
});

test("a stale expectedRevision is a conflict and never touches the disk", () => {
  reset();
  assert.equal(addLoveCard(card("c1")).ok, true);
  const before = slots.get(KEY);

  assert.deepEqual(addLoveCard(card("c2"), 0), { ok: false, code: "conflict" });
  assert.equal(slots.get(KEY), before, "no silent last-writer-wins");
  assert.equal(okRead().cards.length, 1);

  assert.deepEqual(addLoveCard(card("c2"), 1), { ok: true, revision: 2 });
});

test("the 51st card is refused with quota and nothing already stored is lost", () => {
  reset();
  for (let i = 0; i < LOVE_CARDS_MAX; i++) {
    const res = addLoveCard(card(`c${i}`));
    assert.equal(res.ok, true);
  }
  const before = slots.get(KEY);
  assert.deepEqual(addLoveCard(card("over")), { ok: false, code: "quota" });
  assert.equal(slots.get(KEY), before, "an over-cap write leaves the disk untouched");
  assert.equal(okRead().cards.length, LOVE_CARDS_MAX, "nothing was truncated");
});

test("a single card whose serialized size crosses 1 MiB is refused with quota", () => {
  reset();
  const huge = card("huge", { description: "x".repeat(LOVE_CARDS_MAX_CHARS) });
  assert.deepEqual(addLoveCard(huge), { ok: false, code: "quota" });
  assert.deepEqual(readLoveCards(), { status: "empty", cards: [], revision: 0 }, "a refused write persists nothing");
});

test("a corrupt slot reads corrupt, refuses writes and keeps the original bytes", () => {
  reset();
  slots.set(KEY, '{"version":1,"cards":');
  assert.deepEqual(readLoveCards(), { status: "corrupt", cards: [], revision: 0 });
  assert.deepEqual(addLoveCard(card("c1")), { ok: false, code: "corrupt" });
  assert.equal(slots.get(KEY), '{"version":1,"cards":', "bad bytes survive every write attempt");

  reset();
  const future = { version: 2, revision: 0, cards: [] };
  slots.set(KEY, JSON.stringify(future));
  assert.deepEqual(readLoveCards(), { status: "corrupt", cards: [], revision: 0 }, "an unknown version is corrupt, not empty");
  assert.deepEqual(addLoveCard(card("c1")), { ok: false, code: "corrupt" });
  assert.equal(slots.get(KEY), JSON.stringify(future));

  reset();
  const oneBadCard = { version: 1, revision: 0, cards: [{ id: "x" }] };
  slots.set(KEY, JSON.stringify(oneBadCard));
  assert.deepEqual(readLoveCards(), { status: "corrupt", cards: [], revision: 0 }, "one unrecognized card corrupts the whole slot");
  assert.deepEqual(updateLoveCard(card("x")), { ok: false, code: "corrupt" });
  assert.equal(slots.get(KEY), JSON.stringify(oneBadCard), "the original bytes are preserved");
});

test("update replaces by id and remove deletes by id; missing ids are not-found", () => {
  reset();
  assert.equal(addLoveCard(card("c1")).ok, true);
  assert.deepEqual(updateLoveCard(card("c1", { name: "Renamed" }), 1), { ok: true, revision: 2 });
  assert.equal(okRead().cards[0].name, "Renamed");
  assert.deepEqual(updateLoveCard(card("nope")), { ok: false, code: "not-found" });

  assert.deepEqual(removeLoveCard("nope"), { ok: false, code: "not-found" });
  assert.deepEqual(removeLoveCard("c1", 2), { ok: true, revision: 3 });
  assert.deepEqual(readLoveCards(), { status: "ok", cards: [], revision: 3 });
});

test("card writes and clearLoveCards never touch any other device key", () => {
  reset();
  const other = "socialcoach.love-carry.track";
  const coach = '{ "json": "socialcoach.v1" }';
  slots.set("socialcoach.v1", coach);
  slots.set(other, '[{"id":"c1"}]');

  assert.equal(addLoveCard(card("c1")).ok, true);
  assert.equal(slots.get("socialcoach.v1"), coach, "the coach profile is untouched");
  assert.equal(slots.get(other), '[{"id":"c1"}]');

  const rawBeforeClear = slots.get(KEY);
  assert.ok(rawBeforeClear, "the card slot is written before the clear");
  clearLoveCards();
  assert.equal(slots.get(KEY), undefined, "clear removes only the card slot");
  assert.equal(slots.get("socialcoach.v1"), coach, "other keys survive the clear");
  assert.equal(slots.get(other), '[{"id":"c1"}]');
  clearLoveCards(); // 幂等
  assert.deepEqual(readLoveCards(), { status: "empty", cards: [], revision: 0 });
});

test("loveCardBackup mirrors the readable store and stays empty on corrupt slots", () => {
  reset();
  assert.deepEqual(loveCardBackup(), { version: 1, cards: [], revision: 0 });
  assert.equal(addLoveCard(card("c1")).ok, true);
  assert.equal(addLoveCard(card("c2")).ok, true);
  const backup = loveCardBackup();
  assert.equal(backup.revision, okRead().revision);
  assert.deepEqual(backup.cards.map((c) => c.id), ["c1", "c2"]);

  reset();
  slots.set(KEY, "broken{");
  assert.deepEqual(loveCardBackup(), { version: 1, cards: [], revision: 0 }, "a corrupt slot backs up empty; the raw bytes stay in storage");
  assert.equal(slots.get(KEY), "broken{");
});

test("quota and disabled storage degrade to explicit failures without touching the slot", () => {
  reset();
  assert.equal(addLoveCard(card("c1")).ok, true);
  const before = slots.get(KEY);

  quota = true;
  assert.deepEqual(addLoveCard(card("c2")), { ok: false, code: "quota" });
  assert.equal(slots.get(KEY), before);
  quota = false;

  blockedWrite = true;
  assert.deepEqual(addLoveCard(card("c2")), { ok: false, code: "corrupt" }, "a non-quota storage failure maps to corrupt");
  assert.equal(slots.get(KEY), before);
  blockedWrite = false;

  blockedRead = true;
  assert.deepEqual(readLoveCards(), { status: "corrupt", cards: [], revision: 0 });
  blockedRead = false;
});