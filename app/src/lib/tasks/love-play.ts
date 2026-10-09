/**
 * 恋爱 Galgame 游戏模式引擎（POST /api/love-play 的后端核心）。
 *
 * 每个回合调用一次非流式 LLM（llm.chatText），拿到一次完整 JSON：
 * NPC 台词（双语）+ 2-4 个选项 + 表情 + 立场 + 结局判定。
 * 复用 roleplay 的 LLM 契约（taskLLM 预算/取消、系统提示、隐藏动机口径、
 * roleplaySpeechGuard 事实守卫），但输出结构简化为纯 JSON，不做流式逐字投影。
 */

import { pick } from "@/lib/i18n";
import { z } from "zod";
import { roleplaySystem } from "@/lib/prompts";
import { extractJSON, LLMError, type ChatOpts, type LLM, type SystemPart } from "@/lib/llm-core";
import { practiceTurnLimit } from "@/lib/practice-policy";
import { RoleplayFactError } from "@/lib/roleplay-output";
import { roleplaySpeechGuard } from "@/lib/roleplay-facts";
import type { ChatMessage } from "@/lib/types";
import type { Lang } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";

/** 回合上限默认逻辑：直接复用 roleplay 的 practiceTurnLimit（场景 maxTurns / turnLimit）。 */
export const LOVE_PLAY_TURN_LIMIT = practiceTurnLimit;

/**
 * 游戏模式对话历史里的简化消息：前端只带 role / characterId? / text / ts，
 * 不携带 roleplay 的 meta / id / kind 等教练会话字段。
 */
export interface LovePlayMessage {
  role: "learner" | "npc" | "event";
  characterId?: string;
  text: string;
  ts: number;
}

export interface LovePlayInput {
  /** 完整场景对象（复用 ScenarioSchema；cast/objectives/success/failure 是剧情约束）。 */
  scenario: Scenario;
  /** 用户扮演的角色 id。 */
  learnerCharacterId: string;
  /** 对话/界面语言。 */
  language: Lang;
  learnerName?: string;
  /** 对话历史（简化消息）。 */
  messages: LovePlayMessage[];
  /** 可选回合上限；缺省按场景 maxTurns 推断。 */
  turnLimit?: number;
}

export type LovePlayEmotion = "neutral" | "smile" | "tight" | "teary";
export type LovePlayTerminal = "success" | "partial" | "failure";

export interface LovePlayOutput {
  /** NPC 台词（双语；对话语言那一键是实际对白，另一键是忠实翻译）。 */
  line: { zh: string; en: string };
  /** 2-4 个双语选项，各代表一个真实可行的反应方向。 */
  options: { zh: string; en: string }[];
  /** 驱动立绘表情。 */
  emotion: LovePlayEmotion;
  /** 0-100 对方立场（口径与 roleplay 的 THE OTHER SIDE'S POSITION 相同）。 */
  stance: number;
  /** 是否在当句揭示了 hidden 动机（只在事件真正发生时标记）。 */
  revealed: boolean;
  /** 场景是否已按 success/failure 收束；对话仍开放时为 null。 */
  terminal: LovePlayTerminal | null;
  /** 会话是否已到显示复盘入口的自然收尾。 */
  ended: boolean;
}

/** 台词/选项共用的双语文本约束：两个键都非空。 */
const localizedText = z.object({ zh: z.string().trim().min(1), en: z.string().trim().min(1) });

/** LLM 输出契约：一次完整 JSON，safeParse 通过后才算有效回复。 */
const lovePlayOutputSchema = z.object({
  line: localizedText,
  options: z.array(localizedText).min(2).max(4),
  emotion: z.enum(["neutral", "smile", "tight", "teary"]),
  stance: z.number().int().min(0).max(100),
  revealed: z.boolean(),
  terminal: z.enum(["success", "partial", "failure"]).nullable(),
  ended: z.boolean(),
});

/** 本回合专职配音的角色：优先场景开场人，否则取第一个非学习者角色。 */
function leadingNpc(s: Scenario, learnerCharacterId: string) {
  const npcs = s.characters.filter((c) => c.id !== learnerCharacterId);
  return npcs.find((c) => c.id === s.opening.characterId) ?? npcs[0];
}

/**
 * 把简化历史组装成非流式对话序列：
 * learner 消息原文、event 消息转沉默标注、npc 消息转 JSON（roleplay 22-52 行同口径）。
 */
function buildTurns(messages: LovePlayMessage[], learnerName: string): { turns: ChatOpts["messages"]; learnerTurns: number } {
  const turns: ChatOpts["messages"] = [];
  let learnerTurns = 0;
  for (const m of messages) {
    if (m.role === "learner") {
      learnerTurns++;
      turns.push({ role: "user", content: m.text });
    } else if (m.role === "npc") {
      turns.push({ role: "assistant", content: JSON.stringify({ characterId: m.characterId, text: m.text }) });
    } else {
      turns.push({ role: "user", content: m.text.trim() ? m.text : `(${learnerName} says nothing.)` });
    }
  }
  // 开场若是助手回合，补一个起始 user 轮，满足消息序列必须以 user 开头的 API 约定。
  if (turns[0]?.role === "assistant") turns.unshift({ role: "user", content: "(The scene begins.)" });
  // 收尾保持 user 轮，让模型知道现在轮到学习者。
  if (turns[turns.length - 1]?.role !== "user") turns.push({ role: "user", content: "(…)" });
  return { turns, learnerTurns };
}

/** Galgame 每回合的 system prompt：复用 roleplaySystem，追加本模式的输出契约覆盖。 */
function lovePlaySystem(s: Scenario, learnerId: string, lang: Lang, learnerName: string, learnerTurns: number, limit: number): string {
  const npc = leadingNpc(s, learnerId);
  const remaining = Math.max(0, limit - learnerTurns);
  const quoteRule =
    lang === "zh"
      ? "zh 键用简体中文口语书写，引号用「」或“”；en 键用英文口语书写，使用弯引号。"
      : "en 键用英文口语书写，使用弯引号；zh 键用简体中文口语书写，引号用「」或“”。";
  const nearEnd =
    remaining === 0
      ? "这是练习段的最后一个学习者回合：把当前的张力自然收束到结局方向，给出真诚的结束语，并保留一条可被接受的修复/拒绝路径。不要突然换题，也不要重复施压。"
      : `还剩 ${remaining} 个回合，不要急着收尾，让对话自然展开。`;
  return `${roleplaySystem(s, learnerId, lang, learnerName)}
LOVE-PLAY GALGAME 输出契约（优先于上面的 OUTPUT FORMAT 一节，本契约覆盖它）
- 你本轮只配音一个角色：${npc.id}（${pick(npc.name, lang)}）。只回应学习者，不让其他角色开口。
- line：1-3 句口语化短句，先回应学习者最近的原话（自然引用或复述），再推进本回合的转折。
- options：2-4 个，每个是学习者下一句的一个不同方向的真实可行表达——至少一条通向成功的方向、一条可能受挫/失败的方向、一条保持对话开放的方向。不要全是对的选项，答案不是好感度选择题。
- 双语：line 与每个 option 都必须同时填 zh、en 两键。${lang === "zh" ? "zh 键是实际对白，en 键是忠实翻译。" : "en 键是实际对白，zh 键是忠实翻译。"}${quoteRule}JSON 字符串内部禁止出现裸 ASCII 双引号。
- emotion 驱动立绘表情，四选一："neutral" | "smile" | "tight" | "teary"。
- stance 是对方立场 0-100，口径与上面 THE OTHER SIDE'S POSITION 一节相同；只有真的同意才报到 100，可能因学习者失礼/忽视而回落。
- revealed 只有在本句完整说出 hidden 动机、且满足其揭示条件时才为 true；提示、模糊、只说一半都是 false。已揭示的事实后续回合保持已知，但 revealed 标记只在当句为 true。
- terminal 对照场景 success/failure：learner 达成全部 objectives → "success"；明显搞砸 → "failure"；两者之间 → "partial"；对话仍开放 → null。
- ended 只有在会话真的收束时才为 true：双方达成一致并收尾、边界被确认并收尾、双方明确暂停、或 NPC 明确退出。仍在对话或只是部分进展则为 false，问答与邀请继续让对方有开口机会。
- 回合：已用 ${learnerTurns} / ${limit}。${nearEnd}
- 历史里的 NPC 回合是简写（只有 characterId 和 text），不是可照抄的输出格式。本轮必须返回下面契约的完整 JSON，不要遗漏任何字段。
Return ONLY one JSON object（no markdown, no prose）:
{"line":{"zh":"…","en":"…"},"options":[{"zh":"…","en":"…"},{"zh":"…","en":"…"}],"emotion":"neutral","stance":20,"revealed":false,"terminal":null,"ended":false}`;
}

/** 简化消息补全成守卫需要的 ChatMessage 形态（id 仅为占位，守卫不使用）。 */
function toChatHistory(messages: LovePlayMessage[]): ChatMessage[] {
  return messages.map((m, i) => ({
    id: `h${i}`,
    role: m.role,
    text: m.text,
    ts: m.ts,
    ...(m.characterId ? { characterId: m.characterId } : {}),
  }));
}

/** 解析 + zod 校验一次 LLM 回复，并通过 roleplaySpeechGuard 事实守卫。 */
function parseLovePlay(raw: string, scenario: Scenario, learnerId: string, messages: LovePlayMessage[], lang: Lang): LovePlayOutput {
  let value: unknown;
  try {
    value = extractJSON<unknown>(raw);
  } catch {
    throw new LLMError(pick({ zh: "这次回复的场景信息不完整，你的话已保留，请重试。", en: "This reply has incomplete scene information. Your words are saved; please retry." }, lang), 502);
  }
  const parsed = lovePlayOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new LLMError(pick({ zh: "这次回复的场景信息不完整，你的话已保留，请重试。", en: "This reply has incomplete scene information. Your words are saved; please retry." }, lang), 502);
  }
  const reply = parsed.data;
  // 用对话语言那一版的台词跑事实守卫，防止把未确认的安排讲成既成事实。
  const line = lang === "zh" ? reply.line.zh : reply.line.en;
  const problem = roleplaySpeechGuard(scenario.id, toChatHistory(messages))?.([{ characterId: leadingNpc(scenario, learnerId).id, text: line }]);
  if (problem) throw new RoleplayFactError(problem, lang);
  return reply;
}

/** 只在可再生错误上修复：guard 事实错或输出契约不合法（都是 502）。 */
function isRepairable(error: unknown): boolean {
  return error instanceof RoleplayFactError || (error instanceof LLMError && error.status === 502);
}

/**
 * 运行一个 Galgame 回合：一次非流式 JSON 输出，带一次有界修复（同 roleplay 95-99 行）。
 * 真正的 provider 调用经 taskLLM 包装，享有预算/取消/共享池限额。
 */
export async function runLovePlay(input: LovePlayInput, llm: LLM, fastModel: string): Promise<LovePlayOutput> {
  const { scenario, learnerCharacterId, messages, language } = input;
  const learnerName = input.learnerName || pick(scenario.characters.find((c) => c.id === learnerCharacterId)!.name, language);
  const { turns, learnerTurns } = buildTurns(messages, learnerName);
  const limit = LOVE_PLAY_TURN_LIMIT({ scenario, turnLimit: input.turnLimit });
  const options: ChatOpts = {
    model: fastModel,
    maxTokens: 2000,
    thinking: false,
    system: [{ text: lovePlaySystem(scenario, learnerCharacterId, language, learnerName, learnerTurns, limit), cache: true }],
    messages: turns,
  };
  try {
    return parseLovePlay(await llm.chatText(options), scenario, learnerCharacterId, messages, language);
  } catch (error) {
    // 拒绝 / 鉴权 / 限流 / 预算类错误不可修复，原样透出。
    if (!isRepairable(error)) throw error;
    const fix = error instanceof RoleplayFactError ? error.correction : "Your previous draft had invalid JSON or missing required fields.";
    const repairSystem: SystemPart[] = [
      ...(Array.isArray(options.system) ? options.system : [{ text: options.system }]),
      { text: `${fix} No reply was accepted. Repair this SAME exchange, keeping the same facts, history and the learner's latest words, and return ONLY the LOVE-PLAY JSON contract above. Do not count this as a new turn or invent a transition.` },
    ];
    return parseLovePlay(await llm.chatText({ ...options, system: repairSystem }), scenario, learnerCharacterId, messages, language);
  }
}