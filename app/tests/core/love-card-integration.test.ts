/** G3 接线回归（spec-love-user-cards §2.2/§2.3）：导出载荷含卡、重置后卡 slot 不存在且其它 key 还在、卡模式 UI 层纯函数组合。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOVE_CARDS_KEY, addLoveCard, clearLoveCards, loveCardBackup, readLoveCards } from "../../src/lib/love-card-store";
import { loveCardPayload, loveCardToJson, parseLoveCardJson, type LoveCard } from "../../src/lib/love-card";
import { scenarioFromCard } from "../../src/lib/love-card-scenario";
import { matchCardWorldEntries } from "../../src/lib/tasks/love-play";
import { ScenarioSchema } from "../../src/lib/runtime-contracts";
import { buildBackupPayload, decodeBackup } from "../../src/lib/backup";
import { parseArchive } from "../../src/lib/archive";

const KEY = LOVE_CARDS_KEY;
const slots = new Map<string, string>();

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
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

const card = (over: Partial<LoveCard> = {}): LoveCard => ({
  id: "card-integration-01",
  name: "林晚",
  description: "老城区便利店夜班店员，戴细框眼镜。",
  personality: "慢热，认死理，被认真对待时会松口。",
  scenario: "凌晨两点的便利店，只有你和她。",
  firstMes: "要什么，我去拿。",
  mesExample: "玩家：今天人少。\n林晚：嗯，雨天都这样。",
  alternateGreetings: [],
  tags: ["便利店", "夜班"],
  // 存储域不变量：库里只存在 enabled 的世界书条目（解析时已过滤，store 校验强制）。
  characterBook: {
    entries: [{ keys: ["手稿"], content: "她随身带着一本没写完的手稿。", enabled: true, insertionOrder: 100 }],
  },
  source: "tavern-json",
  spec: "chara_card_v2",
  importedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...over,
});

test("the export envelope carries the cards and decodeBackup does not choke on the new key", async () => {
  reset();
  assert.equal(addLoveCard(card()).ok, true);

  const payload = buildBackupPayload(parseArchive({ sessions: [] }));
  const envelope = payload as { loveCards?: { cards: LoveCard[]; revision: number } };
  assert.ok(envelope.loveCards, "loveCards is part of the export payload");
  assert.equal(envelope.loveCards!.cards.length, 1);
  assert.equal(envelope.loveCards!.cards[0].name, "林晚");
  assert.equal(envelope.loveCards!.revision, readLoveCards().revision);

  // 恢复路径不认识 loveCards 也要照常解出档案，不能因为多了一个顶层键崩掉。
  const decoded = await decodeBackup(JSON.stringify(payload));
  assert.equal(decoded.archive.sessions.length, 0);
});

test("clearing cards removes only the card slot and the export then contains no cards", async () => {
  reset();
  const coach = '{ "json": "socialcoach.v1" }';
  const carry = '[{"id":"c1","npcId":"rio"}]';
  slots.set("socialcoach.v1", coach);
  slots.set("socialcoach.love-carry.track", carry);
  assert.equal(addLoveCard(card()).ok, true);
  assert.ok(slots.get(KEY), "the card slot is written before the clear");

  clearLoveCards();
  assert.equal(slots.get(KEY), undefined, "the card slot is gone after the reset");
  assert.equal(slots.get("socialcoach.v1"), coach, "the coach profile survives the reset");
  assert.equal(slots.get("socialcoach.love-carry.track"), carry, "carry lines survive the reset");

  const payload = buildBackupPayload(parseArchive({ sessions: [] }));
  assert.deepEqual((payload as { loveCards: { cards: LoveCard[] } }).loveCards.cards, [], "a cleared library exports no cards");
  assert.deepEqual(loveCardBackup(), { version: 1, cards: [], revision: 0 });
});

test("after a card is removed the play resolution path finds nothing (the UI shows the missing state)", () => {
  reset();
  assert.equal(addLoveCard(card()).ok, true);
  const before = readLoveCards();
  assert.equal(before.cards.find((c) => c.id === "card-integration-01")?.name, "林晚");

  assert.equal(clearLoveCards(), undefined);
  const after = readLoveCards();
  // PlayScene 的卡解析逻辑就是「按 id 从 readLoveCards().cards 找」：
  // 找不到时进入用户可读的「这张卡不在这台设备上」，而不是 notFound。
  assert.equal(after.cards.find((c) => c.id === "card-integration-01"), undefined);
});

test("a backup restores the cards into the slot; a broken card slot is quarantined instead", async () => {
  reset();
  assert.equal(addLoveCard(card()).ok, true);
  const payload = buildBackupPayload(parseArchive({ sessions: [] }));

  // 正常恢复：decode 给出可直接写回的 JSON，写回后卡库读得到。
  const decoded = await decodeBackup(JSON.stringify(payload));
  assert.ok(decoded.loveCards, "the card slot is decoded");
  slots.set(KEY, decoded.loveCards!);
  const restored = readLoveCards();
  assert.equal(restored.status, "ok");
  assert.equal(restored.cards[0]?.name, "林晚");

  // 坏卡槽：保留原文供下载，且不拖垮整份备份的档案恢复。
  const broken = { ...payload, loveCards: { version: 1, revision: 0, cards: [{ id: "", name: "" }] } };
  const fallback = await decodeBackup(JSON.stringify(broken));
  assert.equal(fallback.archive.sessions.length, 0);
  assert.equal(fallback.loveCards, undefined);
  assert.equal(fallback.loveCardsIssue, "invalid");
  assert.ok(fallback.loveCardsOriginal?.includes('"cards"'));
});

test("the card-mode UI composition works offline: scenario shell + payload + world matching", () => {
  reset();
  // 带一条 disabled 世界书条目：payload 只保留 enabled 的（这是 loveCardPayload 的职责）。
  const c = card({
    characterBook: {
      entries: [
        { keys: ["手稿"], content: "她随身带着一本没写完的手稿。", enabled: true, insertionOrder: 100 },
        { keys: ["前男友"], content: "这条是关掉的，不该进提示词。", enabled: false, insertionOrder: 110 },
      ],
    },
  });
  const scene = scenarioFromCard(c);
  assert.ok(ScenarioSchema.safeParse(scene).success, "the card shell must satisfy the scenario contract");
  assert.equal(scene.id, "card:card-integration-01");
  assert.equal(scene.title.zh, "林晚");
  assert.equal(scene.custom, true);
  assert.equal(scene.source, "user-card");
  assert.equal(scene.opening.characterId, "npc");
  assert.equal(scene.opening.text.zh, "要什么，我去拿。");

  const payload = loveCardPayload(c);
  assert.equal(payload.name, "林晚");
  assert.match(payload.personality, /慢热/);
  assert.deepEqual(payload.worldEntries.map((e) => e.keys[0]), ["手稿"], "only enabled world-book entries reach the prompt");

  // 与 runLovePlay 里同一份匹配逻辑：命中的世界书才进提示词。
  const hit = matchCardWorldEntries(payload, [{ role: "learner", text: "你那个手稿是什么？", ts: 2 }]);
  assert.equal(hit.length, 1);
  const miss = matchCardWorldEntries(payload, [{ role: "learner", text: "今天雨真大。", ts: 2 }]);
  assert.equal(miss.length, 0);

  // 导出 → 重新导入内容不丢；disabled 条目重复解析时仍被过滤（本地元数据由导入时重新生成）。
  const reimported = parseLoveCardJson(loveCardToJson(c));
  assert.equal(reimported.ok, true);
  if (reimported.ok) {
    assert.equal(reimported.card.name, "林晚");
    assert.equal(reimported.card.firstMes, "要什么，我去拿。");
    assert.deepEqual(reimported.card.characterBook, {
      entries: [{ keys: ["手稿"], content: "她随身带着一本没写完的手稿。", enabled: true, insertionOrder: 100 }],
    });
  }
});
