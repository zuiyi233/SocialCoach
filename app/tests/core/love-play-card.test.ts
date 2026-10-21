/**
 * 用户卡模式（spec-love-user-cards §2.3）：卡写的角色简报替代内置场景简报；
 * 卡没有 goal/redLine/secret，所以不许注入，也不许判 success/failure。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loveCardPayload, type LoveCard } from "../../src/lib/love-card";
import { scenarioFromCard } from "../../src/lib/love-card-scenario";
import { loveCardBlock, matchCardWorldEntries, runLovePlay } from "../../src/lib/tasks/love-play";
import { systemParts, type ChatOpts, type LLM } from "../../src/lib/llm-core";

function card(over: Partial<LoveCard> = {}): LoveCard {
  return {
    id: "card-abc12345",
    name: "林晚",
    description: "老城区便利店夜班店员，戴细框眼镜，说话轻但很坚定。",
    personality: "慢热，认死理，被认真对待时会松口。",
    scenario: "凌晨两点的便利店，只有你和她。",
    firstMes: "要什么，我去拿。",
    mesExample: "玩家：今天人少。\n林晚：嗯，雨天都这样。",
    alternateGreetings: [],
    tags: ["便利店", "夜班"],
    characterBook: {
      entries: [
        { keys: ["手稿"], content: "她随身带着一本没写完的手稿，从不给人看。", enabled: true, insertionOrder: 100 },
        { keys: ["前男友"], content: "这条是关掉的，不该进提示词。", enabled: false, insertionOrder: 110 },
      ],
    },
    source: "tavern-json",
    spec: "chara_card_v2",
    importedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const VALID_REPLY = JSON.stringify({
  line: { zh: "手稿？你从哪听来的。", en: "The manuscript? Where did you hear that?" },
  options: [
    { zh: "货架上看到的。", en: "I saw it on the shelf." },
    { zh: "不说也行。", en: "You don't have to say." },
  ],
  emotion: "tight",
  stance: 18,
  revealed: false,
  terminal: null,
  ended: false,
});

const systemText = (o: ChatOpts) => systemParts(o.system).map((p) => p.text).join("\n");

function recorder(reply: string) {
  const seen: ChatOpts[] = [];
  const llm: LLM = {
    chatText: async (opts: ChatOpts) => {
      seen.push(opts);
      return reply;
    },
    chatStream: () => {
      throw Error("not used");
    },
  };
  return { llm, seen };
}

test("payload keeps enabled world-book entries only", () => {
  const payload = loveCardPayload(card());
  assert.equal(payload.name, "林晚");
  assert.deepEqual(payload.worldEntries.map((e) => e.keys[0]), ["手稿"]);
});

test("world-book matching only looks at the recent exchange and respects the caps", () => {
  const payload = loveCardPayload(card());
  const hit = matchCardWorldEntries(payload, [
    { role: "learner", text: "你手里那个是手稿吗？", ts: 2 },
  ]);
  assert.equal(hit.length, 1);
  const miss = matchCardWorldEntries(payload, [{ role: "learner", text: "今天雨真大。", ts: 2 }]);
  assert.equal(miss.length, 0);

  const many = loveCardPayload(
    card({
      characterBook: {
        entries: Array.from({ length: 10 }, (_, i) => ({
          keys: ["手稿"],
          content: `第 ${i} 条：${"字".repeat(900)}`,
          enabled: true,
          insertionOrder: i,
        })),
      },
    }),
  );
  const capped = matchCardWorldEntries(many, [{ role: "learner", text: "手稿", ts: 1 }]);
  assert.ok(capped.length > 0 && capped.length <= 4, "最多 4 条");
  assert.ok(capped.reduce((n, e) => n + e.content.length, 0) <= 2400, "总字数不超过 2400");
});

test("the card block states there is no author goal/red line/secret", () => {
  const block = loveCardBlock(loveCardPayload(card()), []);
  assert.match(block, /USER CARD/);
  assert.match(block, /林晚/);
  assert.match(block, /老城区便利店夜班店员/);
  assert.match(block, /NO author-written goal/);
});

test("card mode swaps the scenario brief and forbids terminal / revealed", async () => {
  const c = card();
  const scene = scenarioFromCard(c);
  const { llm, seen } = recorder(VALID_REPLY);
  const out = await runLovePlay(
    {
      scenario: scene,
      learnerCharacterId: "you",
      language: "zh",
      messages: [
        { role: "npc", characterId: "npc", text: c.firstMes, ts: 1 },
        { role: "learner", text: "你手里那个是手稿吗？", ts: 2 },
      ],
      card: loveCardPayload(c),
    },
    llm,
    "fake",
  );
  const system = systemText(seen[0]!);
  // 卡的内容进了提示词，内置场景简报与作者字段都不在
  assert.match(system, /USER CARD/);
  assert.match(system, /老城区便利店夜班店员/);
  assert.match(system, /没写完的手稿/, "命中的世界书条目被注入");
  assert.doesNotMatch(system, /ROLE GOAL & BOUNDARY/);
  assert.doesNotMatch(system, /关掉的，不该进提示词/);
  // 卡模式不许自己判结局
  assert.match(system, /revealed 恒为 false/);
  assert.match(system, /terminal 恒为 null/);
  assert.doesNotMatch(system, /learner 达成全部 objectives/);
  assert.equal(out.terminal, null);
});

test("scenario mode is unchanged when no card is passed", async () => {
  const scene = scenarioFromCard(card());
  const { llm, seen } = recorder(VALID_REPLY);
  await runLovePlay(
    {
      scenario: scene,
      learnerCharacterId: "you",
      language: "zh",
      messages: [{ role: "npc", characterId: "npc", text: "开场", ts: 1 }],
    },
    llm,
    "fake",
  );
  const system = systemText(seen[0]!);
  assert.doesNotMatch(system, /USER CARD/);
  assert.match(system, /learner 达成全部 objectives/);
});
