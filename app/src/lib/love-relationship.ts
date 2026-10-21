import { z } from "zod";

/**
 * 恋爱半教练的关系状态（spec-love-semi-coach §3）。
 *
 * `LoveRelationshipState` 这个名字被 Rio 路线账本 `love-relationship-state.ts`
 * （`RioRelationshipState`）占用，所以本模块独立成 `love-relationship.ts`；这里
 * 类型上的 `v: 1` 是关系子形状**自身**的版本号，与 story store 的 v2/v3 无关
 * （spec §3.2「实现命名」）。
 *
 * 纪律（spec §3、§7）：
 * - 三个维度只在场景结束的固定节点变化，每场每维最多 +1，上限 3；
 * - 不因缺席、失约（promise-broken）或关闭主动关心而扣任何档；
 * - signals 只留最近 20 条；用户原话逐字保存，不翻译、不裁剪；
 * - 主动关心有预算（每场 1 次 / 全局 24h 1 次 / 夜间静音），开关由上层传给
 *   `shouldOfferCare`，本模块不读 localStorage、不碰 `/api/assess` 的能力分。
 */

export type LoveRelationshipTier = 0 | 1 | 2 | 3;

export type LoveRelationshipSignalKind =
  | "promise-kept"
  | "promise-broken"
  | "boundary-respected"
  | "free-text"
  | "return"
  | "scene-end";

export interface LoveRelationshipSignal {
  kind: LoveRelationshipSignalKind;
  /** 事件发生的本地时间戳（ms）。 */
  at: number;
  /** 用户自由输入的逐字原话（free-text / 触碰承诺时才有）。 */
  quote?: string;
  /** 产生这条 signal 的场景 id（scene-end 必带）。 */
  sceneId?: string;
}

export interface LoveRelationshipState {
  v: 1;
  /** seriesId:characterId 或 scenarioId:characterId；同一角色跨幕连续。 */
  characterKey: string;
  /** 共同经历与相处时间。 */
  familiarity: LoveRelationshipTier;
  /** 对方是否觉得你可预期、可依靠。 */
  trust: LoveRelationshipTier;
  /** 恋爱张力与相互回应。 */
  attraction: LoveRelationshipTier;
  /** 只留最近 20 条；新信号追加在末尾。 */
  signals: LoveRelationshipSignal[];
  updatedAt: number;
  /** 显示用快照，避免 /love 页反查角色。 */
  characterName?: { zh: string; en: string };
  /** 上一次主动关心的时间戳（ms）；没有则从未主动过。 */
  lastCareAt?: number;
  /** 上一次主动关心所在的场景；同场景不再重复触发。 */
  lastCareSceneId?: string;
}

const TIER_SCHEMA = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const NAME_SCHEMA = z.object({ zh: z.string(), en: z.string() });
const SIGNAL_KINDS = [
  "promise-kept",
  "promise-broken",
  "boundary-respected",
  "free-text",
  "return",
  "scene-end",
] as const;

export const LoveRelationshipSignalSchema = z.object({
  kind: z.enum(SIGNAL_KINDS),
  at: z.number().int().nonnegative(),
  quote: z.string().optional(),
  sceneId: z.string().optional(),
});

/**
 * 关系状态的存档 schema。严格校验身份与三个维度（0–3）与 signals 上限；
 * zod 对象默认 strip 未知字段，所以任何「好感/熟练度/星级」类字段都不会落盘。
 * 恢复备份时复用同一个 schema，绝不 mint 出 store 自己写不出的形状。
 */
export const LoveRelationshipStateSchema: z.ZodType<LoveRelationshipState> = z.object({
  v: z.literal(1),
  characterKey: z.string().min(1),
  familiarity: TIER_SCHEMA,
  trust: TIER_SCHEMA,
  attraction: TIER_SCHEMA,
  signals: z.array(LoveRelationshipSignalSchema).max(20),
  updatedAt: z.number().int().nonnegative(),
  characterName: NAME_SCHEMA.optional(),
  lastCareAt: z.number().int().nonnegative().optional(),
  lastCareSceneId: z.string().optional(),
});

/** 场景结束的推进结果。 */
export type LoveSceneOutcome = "success" | "partial" | "failure";

export interface LoveSceneEndInput {
  at: number;
  sceneId: string;
  outcome: LoveSceneOutcome;
  /** 明确结局 / 互认节点；非空且 outcome=success 才推进心动。 */
  endingId?: string | null;
  /** 单独的 reveal 不推进任何维度。 */
  revealed?: boolean;
  /** 只允许自由输入（via=type）的逐字文本，最多取 3 条。 */
  freeTextQuotes?: string[];
  promiseKept?: boolean;
  promiseBroken?: boolean;
  boundaryRespected?: boolean;
}

export interface LoveRelationshipChange {
  dimension: "familiarity" | "trust" | "attraction";
  from: LoveRelationshipTier;
  to: LoveRelationshipTier;
}

export interface LoveRelationshipApplyResult {
  state: LoveRelationshipState;
  changes: LoveRelationshipChange[];
  /** false = 状态没变（同场景已结算，或这一场什么都没发生）。 */
  applied: boolean;
}

/** signals 只留最近 20 条。 */
const SIGNALS_MAX = 20;
/** 主动关心的预算：全局 24 小时内最多 1 次。 */
const CARE_24H_MS = 24 * 60 * 60 * 1000;
/** 默认只有在「熟络」及以上（familiarity/trust 的最小值 ≥ 2）才主动。 */
const CARE_STAGE_MIN = 2;
/** 免打扰窗口：22:00–08:00（本地小时 22–23 与 0–7）不主动。 */
const CARE_QUIET_FROM_HOUR = 22;
const CARE_QUIET_TO_HOUR = 8;

const STAGE_KEYS = [
  "love_stage_stranger",
  "love_stage_acquaintance",
  "love_stage_close",
  "love_stage_intimate",
] as const;

type Localized = { zh: string; en: string };

/** 角色归属键：同一场景换一个 NPC 就是另一个人；有系列线时按线记。 */
export function relationshipKey(
  seriesId: string | null | undefined,
  scenarioId: string,
  characterId: string,
): string {
  return seriesId ? `${seriesId}:${characterId}` : `${scenarioId}:${characterId}`;
}

/** 空关系状态：三维都是陌生，没有任何 signal。 */
export function emptyRelationship(
  characterKey: string,
  now: number = Date.now(),
  characterName?: { zh: string; en: string },
): LoveRelationshipState {
  return {
    v: 1,
    characterKey,
    familiarity: 0,
    trust: 0,
    attraction: 0,
    signals: [],
    updatedAt: now,
    ...(characterName ? { characterName } : {}),
  };
}

/** 叙事阶段 = familiarity 与 trust 的最小值；心动不参与阶段判定。 */
export function deriveStage(
  state: Pick<LoveRelationshipState, "familiarity" | "trust">,
): LoveRelationshipTier {
  return Math.min(state.familiarity, state.trust) as LoveRelationshipTier;
}

/** 阶段对应的 i18n key：陌生 / 认识 / 熟络 / 亲近。 */
export function stageKey(
  stage: LoveRelationshipTier,
): (typeof STAGE_KEYS)[number] {
  return STAGE_KEYS[stage];
}

/** 裁剪 signals 到最近 20 条：追加在末尾，丢掉最旧的。 */
function withSignals(state: LoveRelationshipState, next: LoveRelationshipSignal[]): LoveRelationshipState {
  const signals = next.length > SIGNALS_MAX ? next.slice(-SIGNALS_MAX) : next;
  return { ...state, signals };
}

/**
 * 场景结束结算（纯函数 reducer）。
 *
 * - 同一 sceneId 已有 `scene-end` signal → 幂等返回 `applied:false`，状态原样；
 * - familiarity：outcome 为 success/partial（场景完成）时 +1；failure 不推进；
 * - trust：outcome==="success"，或 promiseKept，或 boundaryRespected 时 +1；
 *   promiseBroken 不推进（**不扣档**）；
 * - attraction：只有 `endingId` 非空且 outcome==="success" 时 +1；`revealed` 单独不推进；
 * - 每个推进的维度写一条 `scene-end`（带 sceneId）；free-text / promise-* /
 *   boundary-respected 各按其 kind 写一条。
 */
export function applySceneEnd(
  state: LoveRelationshipState,
  input: LoveSceneEndInput,
): LoveRelationshipApplyResult {
  // 幂等：同一幕已经结算过（无论推进了哪个维度，scene-end 都会被写进 signals）。
  if (state.signals.some((s) => s.kind === "scene-end" && s.sceneId === input.sceneId)) {
    return { state, changes: [], applied: false };
  }

  const changes: LoveRelationshipChange[] = [];
  let familiarity = state.familiarity;
  let trust = state.trust;
  let attraction = state.attraction;

  if ((input.outcome === "success" || input.outcome === "partial") && familiarity < 3) {
    changes.push({ dimension: "familiarity", from: familiarity, to: (familiarity + 1) as LoveRelationshipTier });
    familiarity = (familiarity + 1) as LoveRelationshipTier;
  }
  if ((input.outcome === "success" || input.promiseKept === true || input.boundaryRespected === true) && trust < 3) {
    changes.push({ dimension: "trust", from: trust, to: (trust + 1) as LoveRelationshipTier });
    trust = (trust + 1) as LoveRelationshipTier;
  }
  if (input.endingId && input.outcome === "success" && attraction < 3) {
    changes.push({ dimension: "attraction", from: attraction, to: (attraction + 1) as LoveRelationshipTier });
    attraction = (attraction + 1) as LoveRelationshipTier;
  }

  const newSignals: LoveRelationshipSignal[] = [];
  // 每个推进的维度一条 scene-end（带 sceneId），幂等判定也靠它。
  for (let i = 0; i < changes.length; i++) {
    newSignals.push({ kind: "scene-end", at: input.at, sceneId: input.sceneId });
  }
  if (input.promiseKept === true) newSignals.push({ kind: "promise-kept", at: input.at });
  if (input.promiseBroken === true) newSignals.push({ kind: "promise-broken", at: input.at });
  if (input.boundaryRespected === true) newSignals.push({ kind: "boundary-respected", at: input.at });
  // 逐字、不去重、不改写；接口上限之外的多余引文直接丢弃。
  for (const quote of (input.freeTextQuotes ?? []).slice(0, 3)) {
    if (typeof quote === "string" && quote.length > 0) {
      newSignals.push({ kind: "free-text", at: input.at, quote });
    }
  }

  // 什么都没发生：状态逐字段不变，identity 也保持不变，让调用方好判断「没涨」。
  if (changes.length === 0 && newSignals.length === 0) {
    return { state, changes: [], applied: false };
  }

  const signals = [...state.signals, ...newSignals].slice(-SIGNALS_MAX);
  const next: LoveRelationshipState = {
    ...state,
    familiarity,
    trust,
    attraction,
    signals,
    updatedAt: Math.max(state.updatedAt, input.at),
  };
  return { state: next, changes, applied: true };
}

/** 记录一条自由输入的原话（逐字，不去重）；其余字段不动。 */
export function recordFreeText(state: LoveRelationshipState, quote: string, at: number): LoveRelationshipState {
  if (typeof quote !== "string" || quote.length === 0) return state;
  return withSignals(
    { ...state, updatedAt: Math.max(state.updatedAt, at) },
    [...state.signals, { kind: "free-text", at, quote }],
  );
}

/** 记下这次主动关心：同场景不再重复触发，也喂给 24h 预算。 */
export function markCareShown(state: LoveRelationshipState, sceneId: string, at: number): LoveRelationshipState {
  return {
    ...state,
    lastCareAt: at,
    lastCareSceneId: sceneId,
    updatedAt: Math.max(state.updatedAt, at),
  };
}

/**
 * 这一趟值不值得主动关心。
 *
 * 顺序是短路闸门：开关 → 阶段阈值 → 同一场景不重复 → 24 小时预算 → 夜间静音。
 * `opts.hour` 供测试/服务端显式传本地小时；不传时按 `new Date(now).getHours()`。
 */
export function shouldOfferCare(
  state: LoveRelationshipState | null | undefined,
  opts: {
    now: number;
    enabled: boolean;
    sceneId?: string;
    stageMin?: LoveRelationshipTier;
    hour?: number;
  },
): boolean {
  if (!state || !opts.enabled) return false;
  const stageMin = opts.stageMin ?? CARE_STAGE_MIN;
  if (deriveStage(state) < stageMin) return false;
  if (opts.sceneId !== undefined && state.lastCareSceneId === opts.sceneId) return false;
  if (state.lastCareAt !== undefined && opts.now - state.lastCareAt < CARE_24H_MS) return false;
  const hour = opts.hour ?? new Date(opts.now).getHours();
  if (hour >= CARE_QUIET_FROM_HOUR || hour < CARE_QUIET_TO_HOUR) return false;
  return true;
}

/** 各阶段的内置台词库：只引用「上次 / 最近」这类不具体的记忆，不编造 persona 偏好。 */
const CARE_LINES: Record<LoveRelationshipTier, Localized[]> = {
  0: [
    {
      zh: "要是有空，我想多和你聊聊。",
      en: "If you have a moment, I'd like to talk a little more.",
    },
    {
      zh: "你要是愿意，我们可以约个时间再见面。",
      en: "If you'd like, we could set another time to meet.",
    },
  ],
  1: [
    {
      zh: "最近怎么样？上次之后我一直想问问你。",
      en: "How have you been? I've been meaning to ask since last time.",
    },
    {
      zh: "这几天想起你，就想来跟你说句话。",
      en: "You crossed my mind these past few days, so I wanted to say hello.",
    },
  ],
  2: [
    {
      zh: "最近怎么样？我先问问你的近况，别的事都可以放一放。",
      en: "How have you been lately? Let me start with how you're doing — everything else can wait.",
    },
    {
      zh: "这两天常想起你，来看看你还好不好。",
      en: "I've thought about you a lot these past two days — wanted to check you're doing okay.",
    },
    {
      zh: "要是最近有想聊的事，我都在。",
      en: "If anything's been on your mind lately, I'm here.",
    },
  ],
  3: [
    {
      zh: "最近有没有什么想先跟我说的？我听着。",
      en: "Is there anything you'd like to tell me first? I'm listening.",
    },
    {
      zh: "我最近常想到你，想知道你这两天过得怎么样。",
      en: "You've been on my mind a lot — I want to know how your last couple of days went.",
    },
    {
      zh: "想聊就聊，不想说也没关系，我在。",
      en: "Talk if you want; if you'd rather not, that's fine too. I'm here.",
    },
  ],
};

/** 内置台词：零模型调用。确定性选择，不做随机；只在没有舞台状态时返回 null。 */
export function careLine(state: LoveRelationshipState, lang: "zh" | "en"): string {
  const lines = CARE_LINES[deriveStage(state)];
  const index = state.signals.filter((s) => s.kind === "scene-end").length % lines.length;
  return lines[index][lang];
}

export interface LoveRelationshipReview {
  stage: LoveRelationshipTier;
  changes: LoveRelationshipChange[];
  /** 只来自 after 里 kind=free-text 的原话，最多 3 条，保持出现顺序。 */
  quotes: string[];
  hasFreeText: boolean;
  /** 只基于自由输入；没有自由输入时为空数组。 */
  advice: string[];
}

/**
 * 关系回顾（spec §4）：只引用自由输入的原话；全程点选项时只描述剧情。
 * `before` 可为空（此前没有记录）——那时候无从知道「从哪儿来」，一场都不猜。
 */
export function buildRelationshipReview(
  before: LoveRelationshipState | null,
  after: LoveRelationshipState,
  lang: "zh" | "en",
): LoveRelationshipReview {
  const changes: LoveRelationshipChange[] = [];
  if (before) {
    const dims = ["familiarity", "trust", "attraction"] as const;
    for (const dimension of dims) {
      if (after[dimension] !== before[dimension]) {
        changes.push({ dimension, from: before[dimension], to: after[dimension] });
      }
    }
  }

  const quotes = after.signals
    .filter((s): s is LoveRelationshipSignal & { quote: string } => s.kind === "free-text" && !!s.quote)
    .map((s) => s.quote)
    .slice(-3);
  const hasFreeText = quotes.length > 0;
  return {
    stage: deriveStage(after),
    changes,
    quotes,
    hasFreeText,
    advice: hasFreeText ? buildAdvice(quotes, lang) : [],
  };
}

/**
 * 1–2 条基于用户原话的温和建议。不做临床诊断、不评分：
 * 只按文本的浅层特征挑一个更具体的说法，再加一条「把话说完后留给对方接话空间」。
 */
function buildAdvice(quotes: readonly string[], lang: "zh" | "en"): string[] {
  const quote = quotes[0];
  const hasQuestion = /[?？]/.test(quote);
  const hasBoundary = /不要|别|不想|不愿意|拒绝|不希望|有点介意/u.test(quote);

  const first =
    lang === "zh"
      ? hasQuestion
        ? `你在那句“${quote}”里问得很具体，但还没有说出自己为什么在意这个答案；把这一点补上，对方更容易认真回答。`
        : hasBoundary
          ? `“${quote}”——这句话已经在划定边界。可以再补一句温和的收尾，比如“我不是要推开你，只是这一步我想慢一点”。`
          : `“${quote}”已经说出了你的意思，可以再往前走一步，把希望对方怎么做也说出来。`
      : hasQuestion
        ? `In “${quote}” you asked something very concrete, but not why the answer matters to you — adding that makes it much easier for the other person to take it seriously.`
        : hasBoundary
          ? `“${quote}” already draws a line. Try adding a gentle close, like “I'm not pushing you away — I just want to take this step slowly.”`
          : `“${quote}” already says what you mean; you can take it one step further and say what you'd like the other person to do.`;

  const second =
    lang === "zh"
      ? `说完自己的感受之后，给对面留一个接话的空间——问一句“你觉得呢”，会更像对话，而不是表态。`
      : `After you say how you feel, leave the other person room to respond — a simple “what do you think?” turns it into a conversation instead of a statement.`;

  return [first, second];
}

const FAMILIARITY_LINES: Record<LoveRelationshipTier, Localized> = {
  0: { zh: "你们还谈不上熟", en: "you barely know each other yet" },
  1: { zh: "你们开始积累一些共同的经历", en: "you're starting to share some experiences" },
  2: { zh: "你们已经熟络", en: "you're close and easy with each other" },
  3: { zh: "你们很亲近，有共同的过去", en: "you're very close, with shared history" },
};
const TRUST_LINES: Record<LoveRelationshipTier, Localized> = {
  0: { zh: "对方还在观察你是否值得托付", en: "they're still figuring out whether they can rely on you" },
  1: { zh: "对方开始愿意相信你许下的小事", en: "they're starting to believe the small things you promise" },
  2: { zh: "对方信任你，愿意先问你的近况", en: "they trust you enough to ask about your life first" },
  3: { zh: "对方把你当成可以托付的人", en: "they treat you as someone they can depend on" },
};
const ATTRACTION_LINES: Record<LoveRelationshipTier, Localized> = {
  0: { zh: "心动还不明朗", en: "the attraction isn't clear yet" },
  1: { zh: "你们之间开始有一点暧昧的张力", en: "a little romantic tension is growing between you" },
  2: { zh: "心动在升温，彼此都在试探", en: "the spark is warming up and you're both testing the waters" },
  3: { zh: "对方明确地朝你走来，心里有你", en: "they're clearly drawn to you and have you in their heart" },
};

/**
 * 给 LLM 的定性关系提示：只有叙事语言，不出现档位/数值；并明确约束
 * 「关系好也不能放弃 goal / redLine」。没有 state 时返回空串。
 */
export function relationshipPromptBlock(
  state: LoveRelationshipState | null | undefined,
  lang: "zh" | "en",
): string {
  if (!state) return "";
  const body = [
    FAMILIARITY_LINES[state.familiarity],
    TRUST_LINES[state.trust],
    ATTRACTION_LINES[state.attraction],
  ]
    .map((line) => line[lang])
    .join("；");
  const rule =
    lang === "zh"
      ? "不要说出关系档位或具体数值，也不要以关系好为由放弃 goal 或 redLine。"
      : "Never name a relationship tier or any numbers, and don't abandon goals or red lines because the relationship is good.";
  return `${body}。\n${rule}`;
}