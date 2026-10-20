/**
 * 陪伴层记忆的离线回归：作用域隔离（跨线/跨 NPC 绝不共享）、invalid 失效与恢复、
 * locked 不被整理覆盖、提示装配的两层结构、回归开场只引用已确认事实、
 * 承诺在 Rio 第 5/6 幕开场被点名。全部零模型调用。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../../src/lib/types";
import {
  LOVE_MEMORY_KEY,
  buildLoveMemoryArchive,
  buildLoveMemoryCore,
  collectLoveMemoryDrafts,
  integrateLoveMemories,
  loveMemoryBoundaryTexts,
  loveMemoryQuoteSources,
  loveReturnOpening,
  resolveLoveMemoriesForScope,
  setLoveMemoryLocked,
  updateLoveMemoryText,
  withLoveMemoryTurnMessages,
  type LoveMemoryEntry,
} from "../../src/lib/love-memory";
import { peekLoveCarryPromiseForScene } from "../../src/lib/love-carryover";
import {
  LOVE_CARRY_KEY,
  answerLoveCarry,
  readLoveCarries,
  saveLoveCarry,
} from "../../src/lib/love-carry-store";
import { LOVE_STORY_KEY } from "../../src/lib/love-story";
import { emptyRioState } from "../../src/lib/love-relationship-state";

const slots = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() {
      return slots.size;
    },
    key: (index: number) => [...slots.keys()][index] ?? null,
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => {
      slots.set(key, value);
    },
    removeItem: (key: string) => {
      slots.delete(key);
    },
  },
});
const reset = () => slots.clear();

const SERIES = "series-mem";
const RIO = "love-arc-rio-clarify";
const ACT1 = "love-approach-soft-decline-reinvite";
const ACT4 = "love-rio-secondment-deadline";
const ACT5 = "love-rio-family-settled";
const ACT6 = "love-rio-deadline-night";
const QUOTE = "周五之前给你答复";
const DAY = 24 * 60 * 60 * 1000;

/** 按 `love-story.ts` 的 LovePlaySave 字面写（顺序匹配 learnerLines），写入方只走 JSON。 */
const storySave = (learnerText: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  scenarioId: "scene-a",
  seriesId: SERIES,
  lang: "zh",
  status: "playing",
  history: [
    { id: "npc-1", role: "npc", characterId: "rio", text: "你来了。", lang: "zh", ts: 1 },
    { id: "learner-1", role: "learner", text: learnerText, lang: "zh", ts: 2 },
    { id: "npc-2", role: "npc", characterId: "rio", text: "好，我记住了。", lang: "zh", ts: 3 },
  ],
  currentLineId: "npc-2",
  options: [
    { zh: "嗯。", en: "Yes." },
    { zh: "先坐。", en: "Sit first." },
  ],
  emotion: "neutral",
  stance: 50,
  carryover: false,
  learnerLines: [{ via: "type", text: learnerText }],
  outcome: null,
  recorded: false,
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_100,
  ...over,
});
const seedStory = (learnerText: string) => {
  slots.set(
    LOVE_STORY_KEY,
    JSON.stringify({
      v: 2,
      revision: 1,
      saves: { "scene-a": storySave(learnerText) },
      slots: {},
      records: [],
      routes: {},
      updatedAt: 1_700_000_000_101,
    }),
  );
};
const history = (): ChatMessage[] => [
  { id: "m1", role: "npc", characterId: "rio", text: "开场。", ts: 1 },
  { id: "m2", role: "learner", text: QUOTE, ts: 2 },
];
const saveRioCarry = (text: string, scenarioId: string = ACT4, npcId = "rio") => {
  const res = saveLoveCarry({
    text,
    lang: "zh",
    cls: "call",
    npcId,
    npcName: { zh: "Rio", en: "Rio" },
    scenarioId,
    seriesId: RIO,
  });
  assert.equal(res.ok, true);
  return res.ok ? res.carry : null;
};

test("memories stay inside their own series and character, in store and in the request", () => {
  reset();
  seedStory(QUOTE);
  const result = integrateLoveMemories({
    seriesId: SERIES,
    scenarioId: "scene-a",
    characterKey: "rio",
    quotes: [{ id: "learner-1", text: QUOTE }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.added, 1);
  assert.equal(resolveLoveMemoriesForScope(SERIES, "rio").length, 1);
  assert.equal(resolveLoveMemoriesForScope(SERIES, "tess").length, 0, "another NPC in the same series sees nothing");
  assert.equal(resolveLoveMemoriesForScope("series-other", "rio").length, 0, "another series sees nothing");

  const base = history();
  const injected = withLoveMemoryTurnMessages({
    seriesId: SERIES,
    characterKey: "rio",
    lang: "zh",
    history: base,
  });
  assert.equal(injected.length, 3, "the digest is one extra event line after the opening");
  assert.equal(injected[0], base[0], "the opening line is untouched");
  assert.equal(injected[1]?.role, "event");
  assert.ok(injected[1]?.text.includes(QUOTE), "the digest quotes the learner's own words");
  assert.ok(injected[1]?.text.includes("不许编造新事实"), "the digest tells the model not to invent");

  const other = withLoveMemoryTurnMessages({ seriesId: "series-other", characterKey: "rio", lang: "zh", history: base });
  assert.deepEqual(other, base, "another series gets the exact same messages");
  const noSeries = withLoveMemoryTurnMessages({ seriesId: null, characterKey: null, lang: "zh", history: base });
  assert.equal(noSeries, base, "no scope means the request body is returned untouched");
  reset();
});

test("a memory whose source text is gone turns invalid, stops feeding prompts and stays auditable", () => {
  reset();
  const result = integrateLoveMemories({
    seriesId: SERIES,
    scenarioId: "scene-a",
    characterKey: "rio",
    quotes: [{ id: "q1", text: "我会早点到" }],
  });
  assert.equal(result.ok, true);
  const entries = resolveLoveMemoriesForScope(SERIES, "rio");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.invalid, true, "no source anywhere yet");

  const base = history();
  assert.equal(
    withLoveMemoryTurnMessages({ seriesId: SERIES, characterKey: "rio", lang: "zh", history: base }),
    base,
    "invalid memories never reach the prompt",
  );
  const raw = JSON.parse(slots.get(LOVE_MEMORY_KEY)!);
  assert.equal(raw.entries[`${SERIES}:rio`].length, 1, "the entry is kept for audit, not deleted");

  seedStory("我会早点到");
  const again = resolveLoveMemoriesForScope(SERIES, "rio");
  assert.equal(again[0]?.invalid, undefined, "the source came back, the memory is valid again");
  assert.equal(
    withLoveMemoryTurnMessages({ seriesId: SERIES, characterKey: "rio", lang: "zh", history: base }).length,
    3,
  );
  reset();
});

test("locked and user-edited memories survive tidying; the same source is never recorded twice", () => {
  reset();
  seedStory(QUOTE);
  integrateLoveMemories({
    seriesId: SERIES,
    scenarioId: "scene-a",
    characterKey: "rio",
    quotes: [{ id: "learner-1", text: QUOTE }],
  });
  const entry = resolveLoveMemoriesForScope(SERIES, "rio")[0]!;
  assert.equal(setLoveMemoryLocked({ seriesId: SERIES, characterKey: "rio", id: entry.id, locked: true }).ok, true);
  assert.equal(updateLoveMemoryText({ seriesId: SERIES, characterKey: "rio", id: entry.id, text: "改成我自己的说法" }).ok, true);

  const before = JSON.parse(slots.get(LOVE_MEMORY_KEY)!);
  const again = integrateLoveMemories({
    seriesId: SERIES,
    scenarioId: "scene-a",
    characterKey: "rio",
    quotes: [{ id: "learner-2", text: QUOTE }],
  });
  assert.equal(again.ok, true);
  assert.equal(again.ok && again.added, 0, "the same source text is not recorded twice");
  const after = JSON.parse(slots.get(LOVE_MEMORY_KEY)!);
  assert.deepEqual(
    after.entries[`${SERIES}:rio`],
    before.entries[`${SERIES}:rio`],
    "locked/edited entry untouched by tidying",
  );
  reset();
});

test("tidying keeps the scope bounded and never drops locked entries", () => {
  reset();
  seedStory("占位，让第一条可以被锁定");
  integrateLoveMemories({
    seriesId: SERIES,
    scenarioId: "scene-a",
    characterKey: "rio",
    quotes: [{ id: "learner-1", text: QUOTE }],
  });
  const first = resolveLoveMemoriesForScope(SERIES, "rio")[0]!;
  setLoveMemoryLocked({ seriesId: SERIES, characterKey: "rio", id: first.id, locked: true });
  for (let i = 0; i < 45; i++) {
    const res = integrateLoveMemories({
      seriesId: SERIES,
      scenarioId: "scene-a",
      characterKey: "rio",
      quotes: [{ id: `q${i}`, text: `第${i}件我想说的话` }],
    });
    assert.equal(res.ok, true, `write ${i} succeeds`);
  }
  const entries = resolveLoveMemoriesForScope(SERIES, "rio");
  assert.ok(entries.length <= 40, "the scope stays bounded");
  assert.ok(entries.some((e) => e.id === first.id), "the locked entry is never squeezed out");
  reset();
});

test("a corrupt memory slot refuses writes and keeps the original bytes; revisions still conflict", () => {
  reset();
  const raw = '{"v":1,"revision":1,';
  slots.set(LOVE_MEMORY_KEY, raw);
  assert.deepEqual(
    integrateLoveMemories({
      seriesId: SERIES,
      scenarioId: "scene-a",
      characterKey: "rio",
      quotes: [{ id: "q1", text: QUOTE }],
    }),
    { ok: false, reason: "invalid" },
  );
  assert.equal(slots.get(LOVE_MEMORY_KEY), raw, "bad bytes are never overwritten");

  slots.clear();
  assert.equal(
    integrateLoveMemories({
      seriesId: SERIES,
      scenarioId: "scene-a",
      characterKey: "rio",
      quotes: [{ id: "q1", text: QUOTE }],
    }).ok,
    true,
  );
  const conflict = integrateLoveMemories({
    seriesId: SERIES,
    scenarioId: "scene-a",
    characterKey: "rio",
    quotes: [{ id: "q2", text: "另一句" }],
    expectedRevision: 0,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, "conflict");
  reset();
});

test("drafts come from promises, learner quotes and boundaries — never from picked options", () => {
  const drafts = collectLoveMemoryDrafts({
    seriesId: SERIES,
    characterKey: "rio",
    quotes: [{ id: "q1", text: QUOTE }],
    boundaries: [{ id: "b1", text: "别替我答复" }],
    carries: [{ id: "c1", text: "周三打给你", seriesId: SERIES, npcId: "rio", state: "pending" }],
  });
  assert.deepEqual(drafts.map((d) => d.kind), ["promise", "boundary", "fact"]);
  assert.deepEqual(drafts[0]?.sourceMessageIds, ["carry:c1"]);
  assert.deepEqual(drafts[2]?.sourceMessageIds, ["q1"]);
  assert.equal(drafts.filter((d) => d.sourceText === "周三打给你").length, 1, "a carried promise is not re-recorded as a fact");

  const filtered = collectLoveMemoryDrafts({
    seriesId: SERIES,
    characterKey: "rio",
    quotes: [],
    carries: [
      { id: "c2", text: "喊停的那句", seriesId: SERIES, npcId: "rio", state: "dropped" },
      { id: "c3", text: "别人的承诺", seriesId: SERIES, npcId: "tess", state: "pending" },
      { id: "c4", text: "别条线的承诺", seriesId: "series-b", npcId: "rio", state: "pending" },
    ],
  });
  assert.deepEqual(filtered, [], "dropped, other-NPC and other-series promises are all out of scope");
});

test("quote sources take typed lines in order with their message ids", () => {
  const messages: ChatMessage[] = [
    { id: "n1", role: "npc", text: "开场", ts: 1 },
    { id: "l1", role: "learner", text: "第一句", ts: 2 },
    { id: "n2", role: "npc", text: "嗯", ts: 3 },
    { id: "l2", role: "learner", text: "第二句", ts: 4 },
  ];
  assert.deepEqual(
    loveMemoryQuoteSources(messages, [
      { via: "type", text: "第二句" },
      { via: "pick", text: "第一句" },
    ]),
    [{ id: "l2", text: "第二句" }],
    "picked options are never quoted as the learner's own words",
  );
});

test("boundary texts come from learner-side, non-withdrawn Rio boundaries only", () => {
  const rio = {
    ...emptyRioState(),
    boundaries: [
      {
        id: "rio-secondment-boundary",
        topic: "secondment" as const,
        by: "learner" as const,
        atAct: 4 as const,
        status: "proposed" as const,
        evidence: { kind: "option" as const, optionId: "state-conditions", text: { zh: "只到明年三月", en: "Only until March" } },
        acceptedBy: ["learner" as const],
      },
      {
        id: "rio-npc-boundary",
        topic: "pace" as const,
        by: "rio" as const,
        atAct: 4 as const,
        status: "proposed" as const,
        evidence: { kind: "option" as const, optionId: "x", text: { zh: "她的话", en: "Her line" } },
        acceptedBy: ["rio" as const],
      },
    ],
  };
  assert.deepEqual(loveMemoryBoundaryTexts({ rio }, "zh"), [{ id: "rio-secondment-boundary", text: "只到明年三月" }]);
  assert.deepEqual(loveMemoryBoundaryTexts(null, "zh"), []);
});

test("core prefers unfulfilled promises, then boundaries; kept promises step back", () => {
  const mk = (id: string, kind: LoveMemoryEntry["kind"], text: string, sourceMessageIds: string[] = [], locked = false): LoveMemoryEntry => ({
    id,
    kind,
    text,
    sourceText: text,
    sourceMessageIds,
    seriesId: SERIES,
    characterKey: "rio",
    createdAt: 1,
    updatedAt: 1,
    locked,
  });
  const entries = [
    mk("f", "fact", "一句事实"),
    mk("p-kept", "promise", "办完的那句", ["carry:c2"]),
    mk("p-open", "promise", "还欠着的那句", ["carry:c1"]),
    mk("b", "boundary", "一条边界"),
  ];
  const core = buildLoveMemoryCore(entries, new Set(["c1"]));
  assert.deepEqual(core.map((e) => e.id), ["p-open", "b", "f", "p-kept"]);
  assert.deepEqual(buildLoveMemoryCore(entries).map((e) => e.id), ["p-kept", "p-open", "b", "f"], "no ledger, no demotion");
});

test("the archive layer matches by keyword and never returns more than six", () => {
  const mk = (id: string, text: string, locked = false): LoveMemoryEntry => ({
    id,
    kind: "fact",
    text,
    sourceText: text,
    sourceMessageIds: [],
    seriesId: SERIES,
    characterKey: "rio",
    createdAt: 1,
    updatedAt: Number(id.slice(1)),
    locked,
  });
  const entries = Array.from({ length: 8 }, (_, i) => mk(`e${i}`, `关于早点的那件事 ${i}`));
  const hits = buildLoveMemoryArchive(entries, "明天要早点出发");
  assert.equal(hits.length, 6, "archive is capped at six");
  const locked = buildLoveMemoryArchive([mk("l1", "早点", true), mk("l2", "早点")], "早点");
  assert.deepEqual(locked.map((e) => e.id), ["l1", "l2"], "locked entries surface first");
  assert.deepEqual(buildLoveMemoryArchive(entries, "!!!"), [], "no keywords, no archive rows");
});

test("the return opening quotes only confirmed facts after a real absence", () => {
  reset();
  assert.equal(loveReturnOpening(SERIES, Date.now() + 2 * DAY), null, "no facts, no return line");
  seedStory(QUOTE);
  assert.equal(loveReturnOpening(SERIES, Date.now()), null, "no citable fact yet, so nothing shows");

  const saved = saveRioCarry("周六前给你答复");
  assert.ok(saved, "the carry promise is stored");
  const opening = loveReturnOpening(RIO, Date.now() + DAY + 60_000);
  assert.ok(opening, "a day later the return line appears");
  assert.equal(opening?.quote, "周六前给你答复", "the slot is filled with the learner's verbatim promise");

  answerLoveCarry(saved.id, "kept");
  assert.equal(loveReturnOpening(RIO, Date.now() + DAY + 60_000), null, "a kept promise is no longer quoted as outstanding");
  reset();

  // 记忆兜底：没有 carry 时，最近一条仍有效的学习者原话也可以接住回归。
  seedStory(QUOTE);
  integrateLoveMemories({
    seriesId: SERIES,
    scenarioId: "scene-a",
    characterKey: "rio",
    quotes: [{ id: "learner-1", text: QUOTE }],
  });
  const fallback = loveReturnOpening(SERIES, Date.now() + DAY + 60_000);
  assert.ok(fallback);
  assert.equal(fallback?.quote, QUOTE);
  assert.equal(loveReturnOpening(SERIES, Date.now()), null, "fresh activity suppresses the return line");
  reset();
});

test("an open promise is named when entering Rio acts 5 and 6, and stops once settled", () => {
  reset();
  const saved = saveRioCarry("周六前给你答复");
  assert.ok(saved, "the carry promise is stored");

  const act5 = peekLoveCarryPromiseForScene(RIO, ACT5, "zh");
  assert.ok(act5.text, "act 5 names the promise");
  assert.ok(act5.text!.includes("周六前给你答复"), "in the learner's own words");
  assert.equal(act5.carryId, readLoveCarries()[0]?.id);
  const act6 = peekLoveCarryPromiseForScene(RIO, ACT6, "zh");
  assert.ok(act6.text, "act 6 names it too");
  assert.equal(readLoveCarries()[0]?.askCount, 0, "peeking spends no ask budget");

  answerLoveCarry(saved.id, "kept");
  assert.equal(peekLoveCarryPromiseForScene(RIO, ACT5, "zh").text, null, "a kept promise is not called out again");

  slots.delete(LOVE_CARRY_KEY);
  saveRioCarry("给别人的答复", ACT4, "tess");
  assert.equal(peekLoveCarryPromiseForScene(RIO, ACT5, "zh").text, null, "another NPC's promise is not Rio's to name");

  assert.equal(peekLoveCarryPromiseForScene(RIO, ACT1, "zh").text, null, "act 1 has no previous act to call back");
  assert.equal(peekLoveCarryPromiseForScene("no-such-series", ACT5, "zh").text, null, "unknown series, no callout");
  reset();
});
