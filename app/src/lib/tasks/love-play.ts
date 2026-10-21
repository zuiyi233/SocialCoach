/**
 * 恋爱 Galgame 游戏模式引擎（POST /api/love-play 的后端核心）。
 *
 * 每个回合调用一次非流式 LLM（llm.chatText），拿到一次完整 JSON：
 * NPC 台词（双语）+ 2-4 个选项 + 表情 + 立场 + 结局判定。
 * 复用 roleplay 的 LLM 契约（taskLLM 预算/取消、系统提示、隐藏动机口径、
 * roleplaySpeechGuard 事实守卫），但输出结构简化为纯 JSON，不做流式逐字投影。
 * 解析走唯一哨兵（G17）：模型把 JSON 包在 ⟦LOVEPLAY⟧…⟦/LOVEPLAY⟧ 里，
 * 服务端按最后一对标记截取，不再依赖「取第一个 `{`」的宽容扫描。
 */

import { pick } from "@/lib/i18n";
import { z } from "zod";
import { roleplaySystem } from "@/lib/prompts";
import { extractJSON, LLMError, type ChatOpts, type LLM, type SystemPart } from "@/lib/llm-core";
import { speakerOf } from "../session-utils";
import { ReplyRejected, RoleplayFactError, RoleplayBoundaryError, replyBoundaryProblem } from "@/lib/roleplay-output";
import { roleplaySpeechGuard } from "@/lib/roleplay-facts";
import { relationshipPromptBlock, type LoveRelationshipState } from "@/lib/love-relationship";
import type { ChatMessage } from "@/lib/types";
import type { Lang } from "@/data/taxonomy";
import type { Character, Scenario } from "@/data/corpus/types";

/**
 * 回合上限：尊重场景自己的 maxTurns（六幕就是六回合），不再套用练习段的 12 回合下限；
 * 显式 turnLimit 只要不越界就优先，上下限 4–24。
 */
export function lovePlayTurnLimit(input: { scenario: Scenario; turnLimit?: number }): number {
  const scenarioMax = Math.trunc(input.scenario.maxTurns) || 12;
  const base = Math.min(24, Math.max(4, scenarioMax));
  return Number.isSafeInteger(input.turnLimit) && input.turnLimit! >= 4
    ? Math.min(24, input.turnLimit!)
    : base;
}

/** 兼容旧名字：内部统一走 lovePlayTurnLimit。 */
export const LOVE_PLAY_TURN_LIMIT = lovePlayTurnLimit;

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
  /** 恋爱半教练的关系状态（spec-love-semi-coach §3）：只影响语气与主动程度，不评分；缺省不注入。 */
  relationship?: LoveRelationshipState | null;
  /** 逐句 beat（spec-love-scripted-art §3）：只有 Rio / 自定义场景打开；缺省不要求模型输出。 */
  beats?: boolean;
}

export type LovePlayEmotion = "neutral" | "smile" | "tight" | "teary";
export type LovePlayTerminal = "success" | "partial" | "failure";

/** 一句台词 + 这一句的表情；`line` 仍是完整拼接文本。 */
export interface LovePlayBeat {
  text: { zh: string; en: string };
  emotion: LovePlayEmotion;
}

export interface LovePlayOutput {
  /** NPC 台词（双语；对话语言那一键是实际对白，另一键是忠实翻译）。 */
  line: { zh: string; en: string };
  /** 可选逐句拍点（2–4 句）；缺失时客户端按 line + emotion 渲染。 */
  beats?: LovePlayBeat[];
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

/** 台词/选项共用的双语文本约束：两个键都非空，且不是契约示例里的占位符本身。 */
const realSpokenText = z
  .string()
  .trim()
  .min(1)
  .refine((v) => v !== "…" && v !== "...", "placeholder text from the contract example");
const localizedText = z.object({ zh: realSpokenText, en: realSpokenText });

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

/** 逐句 beat 的独立契约：坏 beats 只丢 beats，不让整回合 502（spec §3.1）。 */
const lovePlayBeatSchema = z.object({
  text: localizedText,
  emotion: z.enum(["neutral", "smile", "tight", "teary"]),
});
const lovePlayBeatsSchema = z.array(lovePlayBeatSchema).min(2).max(4);

/**
 * G17：回合 JSON 的唯一哨兵。
 *
 * 债务：extractJSON 取模型输出里的**第一个** `{`，而提示词里带着 JSON 形状示例——
 * 模型先复述示例（或台词里出现花括号）时，解析到的不是真回合；示例本身七键俱全，
 * 能通过 zod，假回合会一路透传到玩家屏幕上。
 *
 * 选了简报的「唯一哨兵」方案而不是 jsonCall：llm-core 的 jsonCall 并不是 tool-call，
 * 它内部仍然走 extractJSON（第一个 `{`），而哨兵切分必须拿到**原始文本**，jsonCall 只回
 * 解析产物；另外 love-play 的 taskLLM 预算只有 2 次调用（task-runtime 的 TASK_LIMITS），
 * jsonCall 的内置重试会在硬垃圾输出上把预算吃掉，让下面的 roleplay 式有界修复永远轮不到，
 * 用户看到的会从友好文案变成通用的「调用上限」。哨兵由提示词要求、服务端按最后一对完整
 * 标记截取；未带标记的回复回退到 extractJSON 的宽容路径，不遵守新契约的模型不会比改前更差。
 */
export const LOVE_PLAY_SENTINEL_OPEN = "⟦LOVEPLAY⟧";
export const LOVE_PLAY_SENTINEL_CLOSE = "⟦/LOVEPLAY⟧";

/** 取**最后一对**完整哨兵之间的内容：模型若先复述了示例再给真回合，最后一对才是答案。 */
export function sliceLovePlaySentinel(raw: string): string | null {
  const open = raw.lastIndexOf(LOVE_PLAY_SENTINEL_OPEN);
  if (open === -1) return null;
  const close = raw.indexOf(LOVE_PLAY_SENTINEL_CLOSE, open + LOVE_PLAY_SENTINEL_OPEN.length);
  if (close === -1) return null;
  return raw.slice(open + LOVE_PLAY_SENTINEL_OPEN.length, close).trim();
}

/** 哨兵优先；截出的载荷先走严格 JSON.parse，坏 JSON 退到 extractJSON 的修复启发式。 */
function extractLovePlayJSON(raw: string): unknown {
  const sliced = sliceLovePlaySentinel(raw);
  if (sliced !== null) {
    try {
      return JSON.parse(sliced);
    } catch {
      return extractJSON(sliced);
    }
  }
  return extractJSON(raw);
}

/**
 * 把简化历史组装成本轮的唯一 user 消息（剧本块 + 收束提示）。
 *
 * NPC 台词不放进 assistant 槽：前端只回传 role/characterId/text，字段凑不齐本契约，
 * 而 assistant 历史是模型最强的格式范例——一旦放进出过缺字段的 JSON（或「id: 台词」），
 * 它会从第 2 回合起照抄那个缺字段的形状，有界修复也重复同样的非法输出，对话就地死掉。
 * roleplay.ts:21-28 能让 assistant 历史巩固契约，是因为它回传完整 meta+utterances；
 * 本模式的简化历史没有这个条件，所以把台词降级为纯记录，让契约模板成为唯一范例。
 */
function buildTurns(
  messages: LovePlayMessage[],
  learnerName: string,
  npcId: string,
): { turns: ChatOpts["messages"]; learnerTurns: number } {
  const lines: string[] = [];
  let learnerTurns = 0;
  for (const m of messages) {
    if (m.role === "learner") {
      learnerTurns++;
      lines.push(`${learnerName}: ${m.text}`);
    } else if (m.role === "npc") {
      lines.push(`${m.characterId ?? npcId}: ${m.text}`);
    } else {
      lines.push(`(${m.text.trim() || `${learnerName} says nothing.`})`);
    }
  }
  const script = lines.length ? lines.join("\n") : "(The scene begins.)";
  return {
    turns: [
      {
        role: "user",
        content: `SCRIPT SO FAR（已发生的记录，只用于剧情连续性；行首是说话者，不是你的输出格式）\n${script}\n\n现在轮到你配音 ${npcId}：回应学习者最后一句，按 LOVE-PLAY 契约返回本轮完整 JSON。`,
      },
    ],
    learnerTurns,
  };
}

/**
 * 角色目标与边界（spec-love-interactive-story §4.4「角色目标与边界」）：
 * 作者写死的 goal / redLine / secret，作为「不可让步」的约束注入系统提示。
 *
 * - goal / redLine：玩家态度再好、再会讨好，NPC 也不放弃 goal、不越过 redLine、
 *   不因被讨好而让步——让步只能来自 goal 本身的理由被真实动摇，而不是礼貌的回报。
 * - secret：对齐 hidden 的既有口径——不主动吐露，只有玩家提问真正满足它写明的
 *   条件时才可能揭示；揭示后同样受 revealed 的当句标记规则约束。
 * - 三个字段都缺省（或当前语言键为空）时返回空串：没有这些字段的场景，提示与
 *   既有行为完全一致。
 */
export function loveGoalBoundaryBlock(npc: Character, lang: Lang): string {
  const goal = npc.goal ? pick(npc.goal, lang).trim() : "";
  const redLine = npc.redLine ? pick(npc.redLine, lang).trim() : "";
  const secret = npc.secret ? pick(npc.secret, lang).trim() : "";
  if (!goal && !redLine && !secret) return "";
  const lines = [
    `ROLE GOAL & BOUNDARY — ${pick(npc.name, lang)}（${npc.id}），作者写死、优先于上面一切关于让步的弹性表述`,
    "玩家态度再好、话再周到、再会讨好，这个角色也不放弃 goal、不越过 redLine、不因被讨好而让步；礼貌、道歉、示好永远换不来立场。",
  ];
  if (goal) lines.push(`- goal（她自己要什么，不可让步的动机）：${goal}`);
  if (redLine) lines.push(`- redLine（不可被越过的边界，不可让步）：${redLine}`);
  if (secret)
    lines.push(
      `- secret（她没说出口的信息）：${secret}\n  secret 与 hidden 同一口径：不主动吐露、不提示、不打哑谜，只有玩家的提问真正满足它写明的条件时才可能揭示；揭示后按上面 revealed 的规则只在当句标记 true。`,
    );
  return lines.join("\n");
}

/** Galgame 每回合的 system prompt：复用 roleplaySystem，追加本模式的输出契约覆盖。 */
function lovePlaySystem(
  s: Scenario,
  learnerId: string,
  lang: Lang,
  learnerName: string,
  learnerTurns: number,
  limit: number,
  relationship?: LoveRelationshipState | null,
  beatsEnabled = false,
): string {
  const npc = speakerOf(s, learnerId);
  const remaining = Math.max(0, limit - learnerTurns);
  const quoteRule =
    lang === "zh"
      ? "zh 键用简体中文口语书写，引号用「」或“”；en 键用英文口语书写，使用弯引号。"
      : "en 键用英文口语书写，使用弯引号；zh 键用简体中文口语书写，引号用「」或“”。";
  const nearEnd =
    remaining === 0
      ? "这是练习段的最后一个学习者回合：把当前的张力自然收束到结局方向，给出真诚的结束语，并保留一条可被接受的修复/拒绝路径。不要突然换题，也不要重复施压。"
      : `还剩 ${remaining} 个回合，不要急着收尾，让对话自然展开。`;
  // 角色目标与边界：带 goal/redLine/secret 的角色卡才注入；没有时保持原提示。
  const goalBoundary = loveGoalBoundaryBlock(npc, lang);
  // 关系状态（spec-love-semi-coach §3）：在 base prompt 之后、goal/redLine 之前注入，
  // 只影响语气与主动程度；没有 state 时完全不插。附加一条主动关心纪律：不施压、不连续追问。
  const relationshipBlock = relationship ? relationshipPromptBlock(relationship, lang) : "";
  const relationshipPrompt = relationshipBlock
    ? `RELATIONSHIP SO FAR（只影响语气与主动程度，不是评分，也不许说出档位/数值）\n${relationshipBlock}\n${
        lang === "zh"
          ? "若你们已经熟络，NPC 可以在这一句里先问问学习者的近况（每场最多主动一次，不要连续追问）；不许用愧疚或「你不回我就难过」施压，也不许因为关系好而放弃 goal 或 redLine。"
          : "If you two are close, the NPC may open this reply by asking how the learner is doing (once per scene at most — don't keep following up); never guilt-trip or say 'you'll be sad if I don't hear back', and never drop a goal or red line because the relationship is good."
      }`
    : "";
  // 逐句 beat：只有调用方（Rio / 自定义场景）打开时才要求；其余场景不多付 token。
  const beatsRule = beatsEnabled
    ? "- beats：把本回合的 line 拆成 2–4 句，每句一个 emotion（同上四选一）。line 仍然是这些句子按顺序拼接后的完整台词：zh 直接相连，en 用单个空格相连。JSON 必须包含 beats 数组，顺序就是演出顺序。"
    : "- 本回合不要输出 beats 字段（只保留 line 与 emotion）。";
  const beatsShape = beatsEnabled
    ? ',"beats":[{"text":{"zh":"…","en":"…"},"emotion":"neutral"},{"text":{"zh":"…","en":"…"},"emotion":"smile"}]'
    : "";
  return `${roleplaySystem(s, learnerId, lang, learnerName)}
${relationshipPrompt ? `${relationshipPrompt}\n` : ""}${goalBoundary ? `${goalBoundary}\n` : ""}LOVE-PLAY GALGAME 输出契约（优先于上面的 OUTPUT FORMAT 一节，本契约覆盖它）
- 你本轮只配音一个角色：${npc.id}（${pick(npc.name, lang)}）。只回应学习者，不让其他角色开口。
- line：1-3 句口语化短句，先回应学习者最近的原话（自然引用或复述），再推进本回合的转折。
${beatsRule}
- options：2-4 个，每个是学习者下一句的一个不同方向的真实可行表达——至少一条通向成功的方向、一条可能受挫/失败的方向、一条保持对话开放的方向。不要全是对的选项，答案不是好感度选择题。
- 双语：line 与每个 option 都必须同时填 zh、en 两键。${lang === "zh" ? "zh 键是实际对白，en 键是忠实翻译。" : "en 键是实际对白，zh 键是忠实翻译。"}${quoteRule}JSON 字符串内部禁止出现裸 ASCII 双引号。
- emotion 驱动立绘表情，四选一："neutral" | "smile" | "tight" | "teary"。
- stance 是对方立场 0-100，口径与上面 THE OTHER SIDE'S POSITION 一节相同；只有真的同意才报到 100，可能因学习者失礼/忽视而回落。
- revealed 只有在本句完整说出 hidden 动机、且满足其揭示条件时才为 true；提示、模糊、只说一半都是 false。已揭示的事实后续回合保持已知，但 revealed 标记只在当句为 true。
- terminal 对照场景 success/failure：learner 达成全部 objectives → "success"；明显搞砸 → "failure"；两者之间 → "partial"；对话仍开放 → null。
- ended 只有在会话真的收束时才为 true：双方达成一致并收尾、边界被确认并收尾、双方明确暂停、或 NPC 明确退出。仍在对话或只是部分进展则为 false，问答与邀请继续让对方有开口机会。
- 回合：已用 ${learnerTurns} / ${limit}。${nearEnd}
- 上面的 SCRIPT SO FAR 是已发生剧情的文字记录（行首是说话者 id 或学习者名字），它只是记录谁说过什么，绝不是你的输出格式。本轮必须返回下面契约的完整 JSON：line、options、emotion、stance、revealed、terminal、ended 七个键一个都不能少${beatsEnabled ? "，并且必须带 beats" : ""}，哪怕对话已经很长。line 只写 ${npc.id} 这一句台词本身，不要把「${npc.id}:」这样的行首前缀写进台词。
- 输出包装：把那个 JSON 对象包在唯一哨兵里返回——⟦LOVEPLAY⟧ 紧挨 JSON 的开头，⟦/LOVEPLAY⟧ 紧挨 JSON 的结尾，两个标记之外不许有任何文字（不写 markdown、不写说明、不写第二个 JSON）。下面只是形状示例，"…" 处必须换成真实台词：
⟦LOVEPLAY⟧{"line":{"zh":"…","en":"…"}${beatsShape},"options":[{"zh":"…","en":"…"},{"zh":"…","en":"…"}],"emotion":"neutral","stance":20,"revealed":false,"terminal":null,"ended":false}⟦/LOVEPLAY⟧`;
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
    value = extractLovePlayJSON(raw);
  } catch {
    throw new LLMError(pick({ zh: "这次回复的场景信息不完整，你的话已保留，请重试。", en: "This reply has incomplete scene information. Your words are saved; please retry." }, lang), 502);
  }
  const parsed = lovePlayOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new LLMError(pick({ zh: "这次回复的场景信息不完整，你的话已保留，请重试。", en: "This reply has incomplete scene information. Your words are saved; please retry." }, lang), 502);
  }
  const reply: LovePlayOutput = parsed.data;
  // beats 是可选扩展：坏 beats 只丢 beats，整回合仍按 line + emotion 渲染（spec §3.1）。
  // line 统一由 beats 重新拼接，保证存档/回忆/TTS 与逐句演出是同一段文本。
  const rawBeats = value && typeof value === "object" ? (value as { beats?: unknown }).beats : undefined;
  if (rawBeats !== undefined) {
    const parsedBeats = lovePlayBeatsSchema.safeParse(rawBeats);
    if (parsedBeats.success) {
      reply.beats = parsedBeats.data;
      reply.line = {
        zh: parsedBeats.data.map((b) => b.text.zh).join(""),
        en: parsedBeats.data.map((b) => b.text.en).join(" "),
      };
    }
  }
  const npcId = speakerOf(scenario, learnerId).id;
  // 边界检查覆盖两个语言键：泄底往往发生在「翻译」那一键上。
  const boundary = replyBoundaryProblem(scenario, learnerId, [{ characterId: npcId, text: reply.line.zh }, { characterId: npcId, text: reply.line.en }], reply.revealed ? [npcId] : []);
  if (boundary) throw new RoleplayBoundaryError(boundary, lang);
  // 用对话语言那一版的台词跑事实守卫，防止把未确认的安排讲成既成事实。
  const line = lang === "zh" ? reply.line.zh : reply.line.en;
  const problem = roleplaySpeechGuard(scenario.id, toChatHistory(messages))?.([{ characterId: npcId, text: line }]);
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
  const { turns, learnerTurns } = buildTurns(messages, learnerName, speakerOf(scenario, learnerCharacterId).id);
  const limit = lovePlayTurnLimit({ scenario, turnLimit: input.turnLimit });
  const options: ChatOpts = {
    model: fastModel,
    maxTokens: 2000,
    thinking: false,
    system: [
      {
        text: lovePlaySystem(scenario, learnerCharacterId, language, learnerName, learnerTurns, limit, input.relationship, input.beats === true),
        cache: true,
      },
    ],
    messages: turns,
  };
  try {
    return parseLovePlay(await llm.chatText(options), scenario, learnerCharacterId, messages, language);
  } catch (error) {
    // 拒绝 / 鉴权 / 限流 / 预算类错误不可修复，原样透出。
    if (!isRepairable(error)) throw error;
    const fix = error instanceof ReplyRejected ? error.correction : "Your previous draft had invalid JSON or missing required fields.";
    const repairSystem: SystemPart[] = [
      ...(Array.isArray(options.system) ? options.system : [{ text: options.system }]),
      { text: `${fix} No reply was accepted. Repair this SAME exchange, keeping the same facts, history and the learner's latest words, and return ONLY the LOVE-PLAY JSON contract above, wrapped in ${LOVE_PLAY_SENTINEL_OPEN} and ${LOVE_PLAY_SENTINEL_CLOSE} with nothing outside them. Do not count this as a new turn or invent a transition.` },
    ];
    return parseLovePlay(await llm.chatText({ ...options, system: repairSystem }), scenario, learnerCharacterId, messages, language);
  }
}