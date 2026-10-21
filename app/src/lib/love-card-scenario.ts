import { L, contextById } from "@/data/taxonomy";
import type { Character, Scenario } from "@/data/corpus/types";
import type { LoveCard } from "./love-card";

/**
 * 用户卡 → Scenario 壳（spec-love-user-cards §2.3）：给现有 PlayScene 渲染用。
 *
 * 卡是单语原文，这里**不翻译**：所有 `L` 的两个语言槽位放进同一段原文，只求满足
 * `ScenarioSchema` 的「双语非空」，不为凑双语做机器翻译（§2.1「所有文本按原样保存，
 * 不翻译」）。
 *
 * 必须能被 `ScenarioSchema.safeParse` 通过，因此对这些必填字段给出中性合法值，逐条
 * 说明（G3 的提示词分叉会忽略教程特有的字段，详见 §2.3）：
 *
 * - `competencies: ["relationship-skills"]`、`skills: ["communication"]` —— schema
 *   `min(1)` 不给空数组；选恋爱对话最通用的一个能力/一项技能，卡不携带这类信息。
 * - `relationship: ["partner"]` —— schema `min(1)`；恋爱语境下最通用的关系假设，
 *   卡无法推断双方关系。
 * - `difficulty: 1`、`minutes: 15` —— schema 必填且卡不带；取最低压力 / 一次常规会话。
 * - `objectives: [一条中性的]` —— **规格写 `objectives = []`，但 schema `min(1)` 不放**
 *   空数组，所以放一条中性目标占位；G3 会把 objectives 相关 UI 隐藏（§2.4）。
 * - `success/failure` —— 中性收束文案（卡模式 terminal 恒 null，这只是回退标签）。
 * - `characters = [you（可玩）, npc（不可玩）]` —— schema `min(2)`，且 `custom=true`
 *   的 superRefine 要求：id 为 `you` 的可玩角色 + 开场说话人不是 `you` + 非 `you`
 *   角色全不可玩；`npc` 正好照 §2.3 的 `{ id:"npc", name: card.name, … }`。
 */

export interface LoveCardScenarioOptions {
  /** 默认 12（§2.3）。会在 [1, 200]（schema 允许范围）内收敛。 */
  maxTurns?: number;
  learnerName?: string;
}

/** schema 要求 `character.hue` 是有限数字；用户卡不带颜色信息，用中性回退值。 */
const YOU_HUE = 40; // 与 corpus `withLearner` 给学习者的值一致
const NPC_HUE = 30;

const END_OF_SENTENCE = /[。！？!?…\n]/;

/** hook = description 首句（§2.3）；拿不到就退回名字。 */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const at = trimmed.search(END_OF_SENTENCE);
  const head = at >= 0 ? trimmed.slice(0, at + 1) : trimmed;
  return head.trim();
}

export function scenarioFromCard(card: LoveCard, opts: LoveCardScenarioOptions = {}): Scenario {
  const name = card.name.trim();
  const description = card.description.trim();
  const scenarioText = card.scenario.trim();
  const firstMes = card.firstMes.trim();
  // parse + store 都保证 name 非空；空 scenario/desc/first_mes 用下一个可用字段兜底，
  // 确保 title / background / opening.text 满足 schema 的「双语非空」。
  const hookText = firstSentence(description) || name;
  const backgroundText = scenarioText || description || name;
  const openingText = firstMes || description || name;

  const learnerName = opts.learnerName?.trim();
  const maxTurns = Math.min(200, Math.max(1, Math.trunc(opts.maxTurns ?? 12)));

  const you: Character = {
    id: "you",
    name: learnerName ? L(learnerName, learnerName) : L("你", "You"),
    role: L("你自己", "Yourself"),
    personality: L("", ""),
    stance: L("", ""),
    playable: true,
    hue: YOU_HUE,
  };
  const npc: Character = {
    id: "npc",
    name: L(name, name),
    role: L("角色卡里的角色", "The character from your card"),
    personality: L(card.personality, card.personality),
    stance: L("自然地和对方聊下去。", "Conversation, at a natural pace."),
    playable: false,
    hue: NPC_HUE,
  };

  return {
    id: `card:${card.id}`,
    title: L(name, name),
    hook: L(hookText, hookText),
    background: L(backgroundText, backgroundText),
    context: "romantic",
    contextType: contextById("romantic").name,
    competencies: ["relationship-skills"],
    skills: ["communication"],
    relationship: ["partner"],
    difficulty: 1,
    minutes: 15,
    characters: [you, npc],
    objectives: [L("把这段对话自然地聊下去。", "Keep this conversation going naturally.")],
    success: L("这段对话自然地走到了收尾。", "The conversation came to a natural close."),
    failure: L("这段对话停在了这里，随时可以从头再来。", "This conversation ended here — you can pick it up any time."),
    maxTurns,
    opening: { characterId: "npc", text: L(openingText, openingText) },
    source: "user-card",
    keywords: [...card.tags],
    custom: true,
  };
}