import { L } from "@/data/taxonomy";
import type {
  RioAct,
  RioBoundary,
  RioBoundaryStatus,
  RioConflict,
  RioConflictShape,
  RioConflictStatus,
  RioEvidence,
  RioFlags,
  RioHarm,
  RioOutcome,
  RioPromise,
  RioRelationshipState,
} from "./love-relationship-state";

/**
 * Rio 线的路线契约（spec-love-rio-route §3.5 / §6.2）。
 *
 * 这里只有作者写死的开场变体与第 4 幕状态拍点，不接 UI、不读写存储、不评分。
 * 第 5–6 幕的 id 只作为映射占位保留；在 3–5 人真人试玩闸门通过前，语料里
 * 不允许出现这两幕的场景。
 */

/** 每一幕对应的场景 id；与 love-relationship-state.ts 的私有 ACT_SCENES 保持一致。 */
export const RIO_ROUTE_ACT_SCENES: Record<RioAct, string> = {
  1: "love-approach-soft-decline-reinvite",
  2: "love-define-rio-pace-talk",
  3: "love-family-expectation-clash",
  4: "love-rio-secondment-deadline",
  5: "love-rio-family-settled",
  6: "love-rio-deadline-night",
};

/** 第 4 幕的场景 id：外派期限落地。 */
export const RIO_ACT4_SCENE_ID = RIO_ROUTE_ACT_SCENES[4];

/** 已经写出语料的幕。第 5–6 幕要等试玩闸门，不在这里。 */
export const RIO_AUTHORED_ACTS = [1, 2, 3, 4] as const satisfies readonly RioAct[];

/** 开场/选项允许读取的状态字段；不读会话内的 stance、投递计数或任何熟练度。 */
export interface RioStateRequires {
  legacy?: boolean;
  stale?: boolean;
  secondmentDisclosed?: boolean;
  secondmentPreference?: RioFlags["secondmentPreference"];
}

export interface RioOpeningVariant {
  id: string;
  /** 空对象 = 中性兜底，必须放在列表最后。 */
  requires: RioStateRequires;
  text: L;
}

/**
 * 第 4 幕开场变体，按「具体 → 一般」排列。
 *
 * 变体只陈述已经发生的事实（邮件见没见过、外派是否披露过），不声称学习者
 * 上次说过或没说过什么。legacy / stale / 未知状态全部落到最后一条中性变体。
 */
export const RIO_OPENING_VARIANTS: Readonly<
  Partial<Record<RioAct, readonly RioOpeningVariant[]>>
> = {
  4: [
    {
      id: "rio-act4-email-seen",
      requires: { legacy: false, stale: false, secondmentDisclosed: true },
      text: L(
        "（她把那封你见过的邮件又推过来，这次翻到期限那页）HR 的最后期限下来了：十天。你先别急着说「你去吧」。",
        "(She pushes the email you have seen before across the table again, this time open to the deadline page.) HR's final deadline is in: ten days. Don't rush to say 'you should go'.",
      ),
    },
    {
      id: "rio-act4-email-new",
      requires: { legacy: false, stale: false, secondmentDisclosed: false },
      text: L(
        "（手机在桌上第三次亮起。她把屏幕转过来）一封你还没见过的邮件：外派意向书，十天之内答复。你先别急着说「你去吧」。",
        "(Her phone lights up a third time on the table. She turns the screen toward you.) An email you have not seen before: a secondment intent form, ten days to answer. Don't rush to say 'you should go'.",
      ),
    },
    {
      id: "rio-act4-neutral",
      requires: {},
      text: L(
        "（她把手机推过来，屏幕上是一封外派意向书）十天之内答复。她停了一下，说：这件事我一直没跟你讲全。",
        "(She slides her phone over; on the screen is a secondment intent form.) Ten days to answer. She pauses, then says: I have never told you the whole of this.",
      ),
    },
  ],
};

/** 字段级匹配：只比较 requires 里明确列出的字段。 */
export function matchRioRequires(
  requires: RioStateRequires,
  state: RioRelationshipState | null | undefined,
): boolean {
  if (!state) return Object.keys(requires).length === 0;
  if (requires.legacy !== undefined && state.legacy !== requires.legacy) return false;
  if (requires.stale !== undefined && state.stale !== requires.stale) return false;
  if (
    requires.secondmentDisclosed !== undefined &&
    state.flags.secondmentDisclosed !== requires.secondmentDisclosed
  ) {
    return false;
  }
  if (
    requires.secondmentPreference !== undefined &&
    state.flags.secondmentPreference !== requires.secondmentPreference
  ) {
    return false;
  }
  return true;
}

/**
 * 返回该幕命中的开场变体（保持列表形状，方便后续一幕多条变体扩展）。
 * 列表按优先级排列，第一条命中即返回；最后一条的 `requires` 为空，负责兜底。
 */
export function rioOpeningVariants(
  state: RioRelationshipState | null | undefined,
  act: RioAct,
): RioOpeningVariant[] {
  const variants = RIO_OPENING_VARIANTS[act];
  if (!variants?.length) return [];
  const hit = variants.find((variant) => matchRioRequires(variant.requires, state));
  return hit ? [hit] : [];
}

/** 开场文案的便捷取值；没有写变体的幕返回 null，由调用方回退到 Scenario.opening。 */
export function resolveRioOpening(
  state: RioRelationshipState | null | undefined,
  act: RioAct,
): L | null {
  return rioOpeningVariants(state, act)[0]?.text ?? null;
}

export type RioBeatId =
  | "ask-without-me"
  | "ask-what-she-wants"
  | "decide-for-her"
  | "state-conditions"
  | "agree-next-talk"
  | "leave-it-open";

export interface RioBeatEffects {
  flags?: Partial<Pick<RioFlags, "secondmentDisclosed" | "secondmentPreference">>;
  conflict?: {
    topic: "secondment";
    shape: RioConflictShape;
    status: RioConflictStatus;
    hasMutualNextStep: boolean;
  };
  boundary?: {
    topic: "secondment" | "contact";
    status: RioBoundaryStatus;
    by: "learner" | "rio";
  };
  promise?: {
    kind: "secondment-answer";
    by: "learner" | "rio";
    dueByAct: RioAct;
  };
  harm?: RioHarm;
}

export interface RioBeat {
  id: RioBeatId;
  act: 4;
  /** 作者写死的选项文案；选项 id 就是拍点 id。 */
  text: L;
  /** 这个拍点对应的本幕结局；不是好感分，也不参与结局判定。 */
  outcome: RioOutcome;
  requires: RioStateRequires;
  effects: RioBeatEffects;
}

export interface RioBeatGroup {
  id: "stance" | "next-step";
  title: L;
  beats: RioBeat[];
}

/**
 * 第 4 幕的两个状态拍点组：先问她想要什么，再给答复前的下一步。
 * 只写本幕允许的字段；`finalDecision`、婚期与修复都留给后续幕。
 */
export const RIO_ACT4_BEAT_GROUPS: RioBeatGroup[] = [
  {
    id: "stance",
    title: L("先问她想要什么", "Ask what she wants first"),
    beats: [
      {
        id: "ask-without-me",
        act: 4,
        text: L(
          "如果我不在这里，你会怎么选？",
          "If I weren't here, what would you choose?",
        ),
        outcome: "success",
        requires: { secondmentPreference: "unknown" },
        effects: {
          flags: { secondmentDisclosed: true, secondmentPreference: "stay" },
          conflict: {
            topic: "secondment",
            shape: "secondment-undecided",
            status: "narrowed",
            hasMutualNextStep: false,
          },
        },
      },
      {
        id: "ask-what-she-wants",
        act: 4,
        text: L("先别想我。你自己想要什么？", "Leave me out of it for a second. What do you want?"),
        outcome: "partial",
        requires: { secondmentPreference: "unknown" },
        effects: {
          flags: { secondmentDisclosed: true, secondmentPreference: "undecided" },
          conflict: {
            topic: "secondment",
            shape: "secondment-undecided",
            status: "narrowed",
            hasMutualNextStep: false,
          },
        },
      },
      {
        id: "decide-for-her",
        act: 4,
        text: L(
          "你别去了，留下来。我们的事比外派重要。",
          "Don't go. Stay. What we have matters more than the secondment.",
        ),
        outcome: "failure",
        requires: {},
        effects: {
          flags: { secondmentDisclosed: true },
          conflict: {
            topic: "secondment",
            shape: "secondment-undecided",
            status: "open",
            hasMutualNextStep: false,
          },
          boundary: { topic: "secondment", status: "crossed", by: "learner" },
          harm: "pressed-secondment",
        },
      },
    ],
  },
  {
    id: "next-step",
    title: L("答复前的下一步", "A next step before the answer"),
    beats: [
      {
        id: "state-conditions",
        act: 4,
        text: L(
          "我能接受异地，但只到明年三月；中间我们至少每两周谈一次。做不到，我会退出，不拖着。",
          "I can do distance, but only until March; we talk at least every two weeks. If that stops, I step back instead of dragging it out.",
        ),
        outcome: "partial",
        requires: {},
        effects: {
          flags: { secondmentDisclosed: true },
          conflict: {
            topic: "secondment",
            shape: "secondment-undecided",
            status: "narrowed",
            hasMutualNextStep: true,
          },
          boundary: { topic: "secondment", status: "proposed", by: "learner" },
        },
      },
      {
        id: "agree-next-talk",
        act: 4,
        text: L(
          "答复之前我们再谈一次，就定这周六晚上。你可以说不。",
          "Let's talk once more before you answer — this Saturday night. You can say no.",
        ),
        outcome: "success",
        requires: {},
        effects: {
          flags: { secondmentDisclosed: true },
          conflict: {
            topic: "secondment",
            shape: "secondment-undecided",
            status: "narrowed",
            hasMutualNextStep: true,
          },
          promise: { kind: "secondment-answer", by: "rio", dueByAct: 6 },
        },
      },
      {
        id: "leave-it-open",
        act: 4,
        text: L("那你自己想清楚再说吧。", "Then think it through on your own and get back to me."),
        outcome: "failure",
        requires: {},
        effects: {
          flags: { secondmentDisclosed: true },
          conflict: {
            topic: "secondment",
            shape: "secondment-undecided",
            status: "open",
            hasMutualNextStep: false,
          },
        },
      },
    ],
  },
];

/** 扁平化的拍点列表；`applyRioBeat` 与契约测试共用。 */
export const RIO_ACT4_BEATS: RioBeat[] = RIO_ACT4_BEAT_GROUPS.flatMap((group) => group.beats);

/** 这个拍点在当前状态是否可用；`requires` 只看事实字段，不看会话内的开放程度。 */
export function rioBeatAvailable(
  state: RioRelationshipState | null | undefined,
  beat: RioBeat,
): boolean {
  return matchRioRequires(beat.requires, state);
}

function cloneState(state: RioRelationshipState): RioRelationshipState {
  return {
    ...state,
    unknown: [...state.unknown],
    promises: state.promises.map((promise) => ({ ...promise })),
    boundaries: state.boundaries.map((boundary) => ({
      ...boundary,
      acceptedBy: [...boundary.acceptedBy],
    })),
    conflicts: state.conflicts.map((conflict) => ({ ...conflict })),
    rituals: state.rituals.map((ritual) => ({
      ...ritual,
      acceptedBy: [...ritual.acceptedBy],
    })),
    flags: { ...state.flags, unrepairedHarm: [...state.flags.unrepairedHarm] },
    quotes: [...state.quotes],
  };
}

function evidenceMatchesBeat(
  state: RioRelationshipState,
  beat: RioBeat,
  evidence: RioEvidence,
): boolean {
  if (evidence.kind === "option") {
    return (
      evidence.optionId === beat.id &&
      evidence.text.zh === beat.text.zh &&
      evidence.text.en === beat.text.en
    );
  }
  if (evidence.kind === "quote") {
    const quote = state.quotes.find((item) => item.id === evidence.quoteId);
    return (
      !!quote &&
      quote.speaker === "learner" &&
      quote.via === "type" &&
      quote.text.trim().length > 0
    );
  }
  // NPC 原句不能作为学习者做过的动作证据；要写状态必须由学习者选项或逐字输入触发。
  return false;
}

function withSecondmentConflict(
  conflicts: RioConflict[],
  effect: NonNullable<RioBeatEffects["conflict"]>,
  evidence: RioEvidence,
): RioConflict[] {
  const index = conflicts.findIndex((conflict) => conflict.topic === "secondment");
  const previous = index >= 0 ? conflicts[index] : undefined;
  const row: RioConflict = {
    id: previous?.id ?? "rio-secondment",
    topic: "secondment",
    shape: effect.shape,
    status: effect.status,
    openedAtAct: previous?.openedAtAct ?? 4,
    lastTouchedAtAct: 4,
    hasMutualNextStep: effect.hasMutualNextStep,
    evidence,
  };
  if (index < 0) return [...conflicts, row];
  return conflicts.map((conflict, i) => (i === index ? row : conflict));
}

function withSecondmentBoundary(
  boundaries: RioBoundary[],
  effect: NonNullable<RioBeatEffects["boundary"]>,
  evidence: RioEvidence,
): RioBoundary[] {
  const index = boundaries.findIndex(
    (boundary) => boundary.topic === "secondment" && boundary.by === effect.by,
  );
  const previous = index >= 0 ? boundaries[index] : undefined;
  // 越界只能靠带修复证据的拍点收回；「补充条件」不能把 crossed 覆盖成 proposed。
  if (previous?.status === "crossed" && effect.status !== "repaired" && effect.status !== "withdrawn") {
    return boundaries;
  }
  const row: RioBoundary = {
    id: previous?.id ?? "rio-secondment-boundary",
    topic: effect.topic,
    by: effect.by,
    atAct: 4,
    status: effect.status,
    evidence,
    acceptedBy:
      effect.status === "proposed"
        ? [effect.by]
        : previous
          ? [...previous.acceptedBy]
          : [effect.by],
  };
  if (index < 0) return [...boundaries, row];
  return boundaries.map((boundary, i) => (i === index ? row : boundary));
}

function withSecondmentPromise(
  promises: RioPromise[],
  effect: NonNullable<RioBeatEffects["promise"]>,
  evidence: RioEvidence,
): RioPromise[] {
  const index = promises.findIndex((promise) => promise.id === "rio-secondment-answer");
  if (index >= 0) {
    const previous = promises[index];
    // 承诺不能回退：已经兑现或已解除的那条不在第 4 幕被重新打开。
    if (previous.status !== "open") return promises;
    return promises.map((promise, i) =>
      i === index ? { ...promise, dueByAct: effect.dueByAct, evidence } : promise,
    );
  }
  return [
    ...promises,
    {
      id: "rio-secondment-answer",
      kind: effect.kind,
      by: effect.by,
      madeAtAct: 4,
      dueByAct: effect.dueByAct,
      status: "open",
      evidence,
    },
  ];
}

/**
 * 应用一个作者写死的第 4 幕状态拍点（纯函数）。
 *
 * - 未知 beatId、证据不是逐字选项文本、或引用的学习者原话不存在时，原样返回输入。
 * - 不评分、不写好感；只写 `flags.secondment*`、secondment 冲突、边界、承诺与
 *   `unrepairedHarm`，并把本幕的 `lastAct/lastOutcome` 记账。
 * - `updatedAt` 由持久层落盘时写入，这里不读时钟，保证同参数同输出。
 */
export function applyRioBeat(
  state: RioRelationshipState,
  beatId: string,
  evidence: RioEvidence,
): RioRelationshipState {
  const beat = RIO_ACT4_BEATS.find((item) => item.id === beatId);
  if (!beat) return state;
  if (!matchRioRequires(beat.requires, state)) return state;
  if (!evidenceMatchesBeat(state, beat, evidence)) return state;

  const next = cloneState(state);
  if (beat.effects.flags?.secondmentDisclosed !== undefined) {
    next.flags.secondmentDisclosed = beat.effects.flags.secondmentDisclosed;
  }
  if (beat.effects.flags?.secondmentPreference !== undefined) {
    next.flags.secondmentPreference = beat.effects.flags.secondmentPreference;
  }
  if (beat.effects.conflict) {
    next.conflicts = withSecondmentConflict(next.conflicts, beat.effects.conflict, evidence);
  }
  if (beat.effects.boundary) {
    next.boundaries = withSecondmentBoundary(next.boundaries, beat.effects.boundary, evidence);
  }
  if (beat.effects.promise) {
    next.promises = withSecondmentPromise(next.promises, beat.effects.promise, evidence);
  }
  if (beat.effects.harm && !next.flags.unrepairedHarm.includes(beat.effects.harm)) {
    next.flags.unrepairedHarm = [...next.flags.unrepairedHarm, beat.effects.harm];
  }
  if (next.flags.secondmentDisclosed) {
    next.unknown = next.unknown.filter((key) => key !== "secondmentDisclosed");
  }
  next.lastAct = 4;
  // 带着未修复的伤，这一幕不能记 success；后续修复拍点出现前，结果保持 failure。
  next.lastOutcome = next.flags.unrepairedHarm.length > 0 ? "failure" : beat.outcome;
  next.stale = false;
  return next;
}

/** 状态层禁止出现的分数/熟练度字段；序列化后再查，避免被 TS 类型绕过。 */
export const RIO_FORBIDDEN_STATE_KEYS = [
  "score",
  "affinity",
  "loveScore",
  "heart",
  "level",
  "exp",
  "stance",
  "proficiency",
  "loveProficiency",
  "stars",
  "practiceDays",
] as const;

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      out.add(key);
      collectKeys(inner, out);
    }
  }
  return out;
}

/**
 * 断言序列化后的状态没有好感度/熟练度一类字段。
 * 抛出 Error 而不是返回布尔值，避免调用方把失败当警告吞掉。
 */
export function assertRioStateNoScores(state: RioRelationshipState): void {
  const keys = collectKeys(JSON.parse(JSON.stringify(state)) as unknown);
  const leaked = RIO_FORBIDDEN_STATE_KEYS.filter((key) => keys.has(key));
  if (leaked.length) {
    throw new Error(`RioRelationshipState leaked score-like fields: ${leaked.join(", ")}`);
  }
}
