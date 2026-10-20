/**
 * 角色目标与边界（spec-love-interactive-story §4.4 / P1 陪伴层第 4 项）：
 * 语料契约（六幕 rio 卡必带双语 goal/redLine/secret）+ 恋爱引擎提示注入（不联网）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCENARIOS, scenarioById, type Scenario } from "../../src/data/corpus";
import { ScenarioSchema } from "../../src/lib/runtime-contracts";
import { loveGoalBoundaryBlock, runLovePlay } from "../../src/lib/tasks/love-play";
import { systemParts, type ChatOpts, type LLM } from "../../src/lib/llm-core";

const RIO_LINE = SCENARIOS.filter((s) => s.series?.id === "love-arc-rio-clarify").sort(
  (a, b) => (a.series?.order ?? 0) - (b.series?.order ?? 0),
);
const rioCardOf = (s: Scenario) => {
  const card = s.characters.find((c) => c.id === "rio");
  assert.ok(card, `${s.id}: rio card missing`);
  return card;
};

/* ───────────────────────── 语料契约 ───────────────────────── */

test("every Rio act card carries bilingual goal/redLine/secret", () => {
  assert.equal(RIO_LINE.length, 6, "corpus drift: the Rio line is six acts");
  for (const s of RIO_LINE) {
    const rio = rioCardOf(s);
    for (const field of ["goal", "redLine", "secret"] as const) {
      const value = rio[field];
      assert.ok(value, `${s.id}: rio card missing ${field}`);
      assert.ok(value.zh.trim() && value.en.trim(), `${s.id}: rio card missing bilingual ${field}`);
      // 具体、不给空话：一句话的口号撑不起「不可让步」的约束。
      assert.ok(value.zh.length >= 24 && value.en.length >= 60, `${s.id}: ${field} is too thin to constrain the model`);
    }
  }
});

test("the six secrets each carry their own disclosure condition instead of echoing hidden", () => {
  for (const s of RIO_LINE) {
    const rio = rioCardOf(s);
    assert.ok(rio.hidden && rio.secret, `${s.id}: the resistance bar requires hidden and the new secret`);
    // secret 不是 hidden 的复述：同一语言的整段文本不得相同。
    for (const lang of ["zh", "en"] as const) {
      assert.notEqual(rio.hidden[lang].trim(), rio.secret[lang].trim(), `${s.id}: secret must not repeat hidden (${lang})`);
    }
    // 不主动吐露的口径：每条 secret 都要写明「只有…才」级别的揭示条件。
    assert.ok(
      /(只有|才可能|才敢|may only|may surface|may bring|does she|may she)/.test(`${rio.secret.zh}${rio.secret.en}`),
      `${s.id}: secret lacks a disclosure condition`,
    );
  }
});

test("acts 1-3 goals stay compatible with the act 4-6 author beats", () => {
  // 前三幕的 goal/redLine 不得与第 4–6 幕拍点打架：节奏（act 2）要「另开一场谈」、
  // 家庭（act 3）要「先对齐两人」——这正是第 5–6 幕 success 拍点的形状。
  const act2Rio = rioCardOf(RIO_LINE[1]!);
  assert.ok(act2Rio.goal && act2Rio.goal.zh.match(/婚期/) && act2Rio.goal.en.match(/wedding date/i), "act 2 goal keeps the wedding date off tonight's agenda");
  const act3Rio = rioCardOf(RIO_LINE[2]!);
  assert.ok(act3Rio.goal && act3Rio.goal.zh.match(/对齐/) && act3Rio.goal.en.match(/draft/i), "act 3 goal aligns the couple first");
  // 第 4–6 幕自己的 goal/redLine 必须复述作者拍点的方向：不替她决定（act 4）、
  // 不替她答应家里（act 5）、答复不许被改写（act 6）。
  const act4Rio = rioCardOf(RIO_LINE[3]!);
  assert.ok(act4Rio.redLine && act4Rio.redLine.zh.includes("替她决定"), "act 4 redLine matches the decide-for-her failure beat");
  const act5Rio = rioCardOf(RIO_LINE[4]!);
  assert.ok(act5Rio.redLine && act5Rio.redLine.zh.includes("按家里说的办"), "act 5 redLine matches the accept-for-her failure beat");
  const act6Rio = rioCardOf(RIO_LINE[5]!);
  assert.ok(
    act6Rio.redLine && act6Rio.redLine.zh.includes("为我留下") && act6Rio.redLine.en.includes("stay for me"),
    "act 6 redLine matches the push-her-to-go harm beat",
  );
});

/* ───────────────────────── 运行时契约（zod） ───────────────────────── */

test("the runtime contract keeps goal/redLine/secret instead of stripping them", () => {
  const act4 = scenarioById("love-rio-secondment-deadline")!;
  const parsed = ScenarioSchema.safeParse(act4);
  assert.ok(parsed.success, "the Rio act scene must pass the API schema");
  if (parsed.success) {
    const rio = parsed.data.characters.find((c) => c.id === "rio");
    assert.ok(rio?.goal?.zh && rio?.redLine?.en && rio?.secret?.zh, "optional fields must survive the client→route boundary");
  }
});

test("characters without the fields still validate (optional, no default error)", () => {
  const plain = scenarioById("love-trust-eve-what-you-told")!;
  const parsed = ScenarioSchema.safeParse(plain);
  assert.ok(parsed.success, "a scene without goal/redLine/secret must keep parsing");
  if (parsed.success) {
    assert.ok(parsed.data.characters.every((c) => !c.goal && !c.redLine && !c.secret));
  }
});

/* ───────────────────────── 提示注入（纯函数 + 装配） ───────────────────────── */

const plainNpc = {
  id: "npc",
  name: { zh: "路人", en: "Stranger" },
  role: { zh: "对手方", en: "Counterpart" },
  personality: { zh: "正常", en: "Normal" },
  stance: { zh: "想要个结果", en: "Wants an outcome" },
  hue: 1,
};

test("the boundary block states the non-negotiable rule with the picked values", () => {
  const act4Rio = rioCardOf(RIO_LINE[3]!);
  const zh = loveGoalBoundaryBlock(act4Rio, "zh");
  assert.ok(zh.includes("ROLE GOAL & BOUNDARY"), "the section must be labeled");
  assert.ok(zh.includes("不因被讨好而让步"), "the no-charm-concession rule must be explicit");
  assert.ok(zh.includes("不放弃 goal、不越过 redLine"), "goal and redLine must both be named non-negotiable");
  assert.ok(zh.includes("- goal（她自己要什么，不可让步的动机）："), "goal line present");
  assert.ok(zh.includes("被问的人，而不是被安排的人"), "the act-4 goal text rides along");
  assert.ok(zh.includes("- redLine（不可被越过的边界，不可让步）："), "redLine line present");
  assert.ok(zh.includes("替她决定"), "the act-4 redLine text rides along");
  assert.ok(zh.includes("- secret（她没说出口的信息）："), "secret line present");
  assert.ok(zh.includes("不主动吐露"), "secret follows the hidden discipline");
  assert.ok(zh.includes("revealed"), "secret disclosure reuses the revealed marking rule");

  const en = loveGoalBoundaryBlock(act4Rio, "en");
  assert.ok(en.includes("the one who is asked, not the one who is arranged"), "the en key is picked, not the zh one");
  assert.doesNotMatch(en, /被问的人/);
  // 指令行沿用 LOVE-PLAY 契约的中文口径（两种语言一致），只有字段值随 lang 取键。
  assert.ok(en.includes("不因被讨好而让步"));
  assert.ok(en.includes("- goal（她自己要什么，不可让步的动机）："));
});

test("a card without the fields injects nothing; a partial card injects only what exists", () => {
  assert.equal(loveGoalBoundaryBlock(plainNpc, "zh"), "", "no fields means no block and no stray whitespace");
  const goalOnly = { ...plainNpc, goal: { zh: "把事情办成。", en: "Get it done." } };
  const block = loveGoalBoundaryBlock(goalOnly, "zh");
  assert.ok(block.includes("- goal（她自己要什么，不可让步的动机）：把事情办成。"));
  assert.doesNotMatch(block, /redLine（/);
  assert.doesNotMatch(block, /secret（/);
});

/** 吐出固定 reply 的假 LLM，并留下收到的请求。 */
function recorder(reply: string): { llm: LLM; seen: ChatOpts[] } {
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

const VALID_REPLY = JSON.stringify({
  line: { zh: "我在听，你说完。", en: "I'm listening — go on." },
  options: [
    { zh: "嗯。", en: "Okay." },
    { zh: "那你打算怎么办？", en: "What will you do?" },
  ],
  emotion: "neutral",
  stance: 20,
  revealed: false,
  terminal: null,
  ended: false,
});

const systemText = (o: ChatOpts) => systemParts(o.system).map((part) => part.text).join("\n");

test("the Rio act system prompt carries the injected constraints", async () => {
  const act4 = scenarioById("love-rio-secondment-deadline")!;
  const { llm, seen } = recorder(VALID_REPLY);
  await runLovePlay(
    {
      scenario: act4,
      learnerCharacterId: "you",
      language: "zh",
      messages: [{ role: "npc", characterId: act4.opening.characterId, text: act4.opening.text.zh, ts: 1 }],
    },
    llm,
    "fake",
  );
  const system = systemText(seen[0]!);
  assert.match(system, /ROLE GOAL & BOUNDARY/);
  assert.match(system, /被问的人，而不是被安排的人/);
  assert.match(system, /不主动吐露/);
  // 注入位置：在 roleplaySystem 的语言规则之后、LOVE-PLAY 输出契约之前。
  const langRuleAt = system.indexOf("Write every user-facing string");
  const blockAt = system.indexOf("ROLE GOAL & BOUNDARY");
  const contractAt = system.indexOf("LOVE-PLAY GALGAME 输出契约");
  assert.ok(langRuleAt >= 0 && blockAt > langRuleAt && contractAt > blockAt, "the block sits between the base prompt and the output contract");
});

test("a scene without the fields keeps the old prompt shape", async () => {
  const scene = scenarioById("love-trust-eve-what-you-told")!;
  const learnerId = scene.characters.find((c) => c.playable)!.id;
  const { llm, seen } = recorder(VALID_REPLY);
  await runLovePlay(
    {
      scenario: scene,
      learnerCharacterId: learnerId,
      language: "zh",
      messages: [{ role: "npc", characterId: scene.opening.characterId, text: scene.opening.text.zh, ts: 1 }],
    },
    llm,
    "fake",
  );
  const system = systemText(seen[0]!);
  assert.doesNotMatch(system, /ROLE GOAL & BOUNDARY/);
  assert.match(system, /LOVE-PLAY GALGAME 输出契约/, "the rest of the prompt is untouched");
});
