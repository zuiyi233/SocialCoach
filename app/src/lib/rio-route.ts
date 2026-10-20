import { L } from "@/data/taxonomy";
import type {
  RioAct,
  RioBoundary,
  RioBoundaryStatus,
  RioBoundaryTopic,
  RioConflict,
  RioConflictShape,
  RioConflictStatus,
  RioConflictTopic,
  RioEvidence,
  RioFlags,
  RioHarm,
  RioOutcome,
  RioPromise,
  RioPromiseKind,
  RioRelationshipState,
} from "./love-relationship-state";

/**
 * Rio 线的路线契约（spec-love-rio-route §3.5 / §6.2）。
 *
 * 这里只有作者写死的开场变体与第 4–6 幕状态拍点，不接 UI、不读写存储、不评分。
 * 第 5–6 幕按产品决定豁免了「3–5 人真人试玩」闸门后落地；验收记录明确标注
 * 未经玩家验证（wiki/specs/spec-love-rio-route.md §7）。
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

/** 已经写出语料的幕。 */
export const RIO_AUTHORED_ACTS = [1, 2, 3, 4, 5, 6] as const satisfies readonly RioAct[];

/** 接路线 UI（开场变体 + 作者拍点 + routes 账本）的幕：第 1–3 幕维持原路径。 */
export const RIO_ROUTE_PLAYABLE_ACTS = [4, 5, 6] as const satisfies readonly RioAct[];

/** 场景 id → 路线幕号；不在可玩幕里的场景返回 null。 */
export function rioRouteSceneAct(scenarioId: string): RioAct | null {
  for (const act of RIO_ROUTE_PLAYABLE_ACTS) {
    if (RIO_ROUTE_ACT_SCENES[act] === scenarioId) return act;
  }
  return null;
}

/**
 * 开场/选项允许读取的状态字段；不读会话内的 stance、投递计数或任何熟练度。
 * 每个字段都是「可选守卫」：只比较明确列出的字段。
 */
export interface RioStateRequires {
  legacy?: boolean;
  stale?: boolean;
  secondmentDisclosed?: boolean;
  secondmentPreference?: RioFlags["secondmentPreference"];
  secondmentDecision?: RioFlags["secondmentDecision"];
  familyHalfPromiseWithdrawn?: boolean;
  weddingTimeline?: RioFlags["weddingTimeline"];
  unrepairedHarm?: boolean;
  finalDecisionMade?: boolean;
}

export interface RioOpeningVariant {
  id: string;
  /** 空对象 = 中性兜底，必须放在列表最后。 */
  requires: RioStateRequires;
  text: L;
}

/**
 * 第 4–6 幕开场变体，按「具体 → 一般」排列。
 *
 * 变体只陈述已经发生的事实，不声称学习者上次说过或没说过什么。
 * legacy / stale / 未知状态全部落到最后一条中性变体。
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
  5: [
    {
      id: "rio-act5-family-after-pressed",
      requires: { legacy: false, stale: false, unrepairedHarm: true },
      text: L(
        "（她坐在你对面，隔着一个杯子的距离）家里来电话了——他们听说了外派的事，还替我们把「按规矩走」说出了口。我还没接这个话。你也先别接。",
        "(She sits across from you, a cup's width of distance between you.) My family called — they heard about the secondment, and they've already said the words 'we'll follow the rules' for both of us. I haven't answered them. Don't you answer yet either.",
      ),
    },
    {
      id: "rio-act5-family-after-answer",
      requires: { legacy: false, stale: false, secondmentPreference: "stay" },
      text: L(
        "（她把手机屏幕朝下扣在桌上）我把想说的话跟你说了，家里却先一步开了口：两边长辈把日子的话题提了。今天得把这句话接住，还是退回去——我们得商量。",
        "(She sets her phone face-down on the table.) I told you what I wanted to say, but my family got there first: the elders brought up dates. Today we have to decide together whether to take that on or hand it back.",
      ),
    },
    {
      id: "rio-act5-family-neutral",
      requires: {},
      text: L(
        "（她的对话框停在你昨晚的留言上）家里听说了外派的事。我妈说「那就按规矩把日子定下来吧」。她把手机推过来——这句话怎么回，她想做主，但想先听你的。",
        "(Her chat app rests on your message from last night.) My family heard about the secondment. My mother said, 'then let's set a date and do this properly.' She slides the phone over — she wants to answer it herself, but she wants to hear you first.",
      ),
    },
  ],
  6: [
    {
      id: "rio-act6-deadline-after-withdrawn",
      requires: { legacy: false, stale: false, weddingTimeline: "withdrawn" },
      text: L(
        "（期限的最后一晚。她把手机放在你们中间，屏幕亮着，是给 HR 的回复框）家里的那句话我们已经收回去了。今晚只剩这一封答复。我说，你听着——然后我们一起把日子定下来，或者好好地说清楚。",
        "(The last night of the deadline. She puts her phone between you, screen up: the reply box for HR.) The words our family put in our mouths are already taken back. Tonight there is only this one answer. I'll say it, you listen — then we put a date on what comes next, or we say this cleanly.",
      ),
    },
    {
      id: "rio-act6-deadline-after-date-set",
      requires: { legacy: false, stale: false, weddingTimeline: "set-by-family" },
      text: L(
        "（期限的最后一晚。她把手机放在你们中间，屏幕亮着，是给 HR 的回复框；旁边还压着一张家里写来的日期条）家里定的日子还在桌上。今晚我先答复公司——但那句话怎么处理，得我们先说好。",
        "(The last night of the deadline. She puts her phone between you, screen up: the reply box for HR; beside it, a note with the date her family picked.) The family's date is still on the table. Tonight I answer the company first — but what to do about that note is something we have to settle between us.",
      ),
    },
    {
      id: "rio-act6-deadline-neutral",
      requires: {},
      text: L(
        "（期限的最后一晚。她把手机放在你们中间，屏幕亮着，是给 HR 的回复框）十天的期限到今晚为止。我说，你听着。听完你再决定怎么接。",
        "(The last night of the deadline. She puts her phone between you, screen up: the reply box for HR.) The ten days end tonight. I'll say it, you listen. Then you decide how to take it.",
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
  if (
    requires.secondmentDecision !== undefined &&
    state.flags.secondmentDecision !== requires.secondmentDecision
  ) {
    return false;
  }
  if (
    requires.familyHalfPromiseWithdrawn !== undefined &&
    state.flags.familyHalfPromiseWithdrawn !== requires.familyHalfPromiseWithdrawn
  ) {
    return false;
  }
  if (requires.weddingTimeline !== undefined && state.flags.weddingTimeline !== requires.weddingTimeline) {
    return false;
  }
  if (
    requires.unrepairedHarm !== undefined &&
    (state.flags.unrepairedHarm.length > 0) !== requires.unrepairedHarm
  ) {
    return false;
  }
  if (
    requires.finalDecisionMade !== undefined &&
    state.flags.finalDecisionMade !== requires.finalDecisionMade
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
  // 第 4 幕
  | "ask-without-me"
  | "ask-what-she-wants"
  | "decide-for-her"
  | "state-conditions"
  | "agree-next-talk"
  | "leave-it-open"
  // 第 5 幕：家里的半承诺 / 决定权
  | "withdraw-half-promise"
  | "shelve-family-talk"
  | "accept-for-her"
  | "reclaim-decision"
  | "defer-to-family"
  // 第 6 幕：她的答复 / 把关系说定
  | "receive-her-answer"
  | "date-the-defer"
  | "push-her-to-go"
  | "name-and-date"
  | "pause-with-revisit"
  | "end-with-thanks";

/** 本幕允许写的 flags 子集；`unrepairedHarm` 与 `finalDecisionMade` 由其它效果推导。 */
export type RioFlagPatch = Partial<
  Omit<RioFlags, "unrepairedHarm" | "finalDecisionMade">
>;

export interface RioConflictEffect {
  topic: RioConflictTopic;
  /** 缺省 = 沿用该冲突已有的 shape（第 6 幕收束不改写第 6 幕 A 组的形状）。 */
  shape?: RioConflictShape;
  status: RioConflictStatus;
  hasMutualNextStep: boolean;
}

export interface RioBoundaryEffect {
  topic: RioBoundaryTopic;
  status: RioBoundaryStatus;
  by: "learner" | "rio";
}

export interface RioPromiseEffect {
  kind: RioPromiseKind;
  by: "learner" | "rio";
  dueByAct: RioAct | null;
  /** 缺省 "open"；第 6 幕兑现第 4 幕的答复承诺时写 "kept"。 */
  status?: "open" | "kept";
}

export interface RioFinalDecisionEffect {
  kind: "continue" | "pause" | "end";
  agreedBy: "both" | "one-sided";
  /** true = 本拍点同时写 Rio 的接受（agreedBy 提升为 both）。 */
  acceptance?: boolean;
  hasDatedNextStep: boolean;
  revisit: "two-weeks" | "after-secondment-answer" | null;
  reason: "secondment" | "pace" | "family" | null;
}

export interface RioBeatEffects {
  flags?: RioFlagPatch;
  conflicts?: RioConflictEffect[];
  boundaries?: RioBoundaryEffect[];
  promises?: RioPromiseEffect[];
  finalDecision?: RioFinalDecisionEffect;
  harm?: RioHarm;
}

export interface RioBeat {
  id: RioBeatId;
  act: RioAct;
  /** 作者写死的选项文案；选项 id 就是拍点 id。 */
  text: L;
  /** 这个拍点对应的本幕结局；不是好感分，也不参与结局判定。 */
  outcome: RioOutcome;
  requires: RioStateRequires;
  effects: RioBeatEffects;
}

export interface RioBeatGroup {
  id: string;
  title: L;
  beats: RioBeat[];
}

/**
 * 第 4 幕：先问她想要什么，再给答复前的下一步。
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
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-undecided",
              status: "narrowed",
              hasMutualNextStep: false,
            },
          ],
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
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-undecided",
              status: "narrowed",
              hasMutualNextStep: false,
            },
          ],
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
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-undecided",
              status: "open",
              hasMutualNextStep: false,
            },
          ],
          boundaries: [{ topic: "secondment", status: "crossed", by: "learner" }],
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
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-undecided",
              status: "narrowed",
              hasMutualNextStep: true,
            },
          ],
          boundaries: [{ topic: "secondment", status: "proposed", by: "learner" }],
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
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-undecided",
              status: "narrowed",
              hasMutualNextStep: true,
            },
          ],
          promises: [{ kind: "secondment-answer", by: "rio", dueByAct: 6 }],
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
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-undecided",
              status: "open",
              hasMutualNextStep: false,
            },
          ],
        },
      },
    ],
  },
];

/**
 * 第 5 幕：家里的半承诺与决定权。
 * 「收回来」是唯一同时解决 family-expectation 与 wedding-timeline 的拍点；
 * 敷衍搁置会让家里的日子继续压在桌上，把两个命名结局都挡在门外。
 */
export const RIO_ACT5_BEAT_GROUPS: RioBeatGroup[] = [
  {
    id: "family-answer",
    title: L("接住家里那句话", "Answer what the family said"),
    beats: [
      {
        id: "withdraw-half-promise",
        act: 5,
        text: L(
          "这句「按规矩走」我们先替自己收回来：日子是我们两个人的事，什么时候定、怎么定，由我们来。",
          "Let's take back that 'we'll follow the rules' for ourselves: the date is ours to set — when and how is up to us.",
        ),
        outcome: "success",
        requires: {},
        effects: {
          flags: {
            familyHalfPromiseDisclosed: true,
            familyHalfPromiseWithdrawn: true,
            weddingTimeline: "withdrawn",
          },
          conflicts: [
            {
              topic: "family-expectation",
              shape: "family-half-promise-withdrawn",
              status: "resolved",
              hasMutualNextStep: true,
            },
            {
              topic: "wedding-timeline",
              shape: "wedding-date-withdrawn",
              status: "resolved",
              hasMutualNextStep: true,
            },
          ],
          boundaries: [{ topic: "family", status: "proposed", by: "learner" }],
        },
      },
      {
        id: "shelve-family-talk",
        act: 5,
        text: L(
          "先别接这个话，也先别拒绝——拖着吧。",
          "Don't take it on, don't refuse it — just let it sit for now.",
        ),
        outcome: "partial",
        requires: {},
        effects: {
          flags: {
            familyHalfPromiseDisclosed: true,
            weddingTimeline: "set-by-family",
          },
          conflicts: [
            {
              topic: "family-expectation",
              shape: "family-half-promise-open",
              status: "shelved",
              hasMutualNextStep: false,
            },
            {
              topic: "wedding-timeline",
              shape: "wedding-date-set-by-family",
              status: "shelved",
              hasMutualNextStep: false,
            },
          ],
        },
      },
      {
        id: "accept-for-her",
        act: 5,
        text: L(
          "那就按家里说的办，省得再吵。",
          "Then let's do what the family said, and skip the fight.",
        ),
        outcome: "failure",
        requires: {},
        effects: {
          flags: {
            familyDecisionAnnounced: true,
            weddingTimeline: "set-by-family",
          },
          conflicts: [
            {
              topic: "family-expectation",
              shape: "family-half-promise-open",
              status: "open",
              hasMutualNextStep: false,
            },
            {
              topic: "wedding-timeline",
              shape: "wedding-date-set-by-family",
              status: "open",
              hasMutualNextStep: false,
            },
          ],
          harm: "committed-for-rio",
        },
      },
    ],
  },
  {
    id: "decision-ownership",
    title: L("决定权归谁", "Who owns the decision"),
    beats: [
      {
        id: "reclaim-decision",
        act: 5,
        text: L(
          "外派也好，日子也好，最后都得是我们两个人点头才算数。",
          "The secondment, the date — neither counts until the two of us both say yes.",
        ),
        outcome: "success",
        requires: {},
        effects: {
          flags: { decisionReclaimed: true },
          conflicts: [
            {
              topic: "decision-ownership",
              shape: "decision-shared",
              // 决定权问题本身在本幕就算有了答案；结局判定要求该冲突 closed。
              status: "resolved",
              hasMutualNextStep: true,
            },
          ],
        },
      },
      {
        id: "defer-to-family",
        act: 5,
        text: L(
          "这种事让长辈先拿主意也行。",
          "Maybe it's fine to let the elders decide first.",
        ),
        outcome: "failure",
        requires: {},
        effects: {
          conflicts: [
            {
              topic: "decision-ownership",
              shape: "decision-open",
              status: "open",
              hasMutualNextStep: false,
            },
          ],
        },
      },
    ],
  },
];

/**
 * 第 6 幕：她把答复说出口，你把关系说定。
 * 两组缺一不可：只接住答复而「说定」一组没点，命名结局不会出现——
 * 「说清楚」在这条线里是一个动作，不是一个默认状态。
 */
export const RIO_ACT6_BEAT_GROUPS: RioBeatGroup[] = [
  {
    id: "her-answer",
    title: L("她把答复说出口", "She gives her answer"),
    beats: [
      {
        id: "receive-her-answer",
        act: 6,
        text: L(
          "这是你的答复，我接住了。不用为了我解释。",
          "That's your answer, and I'm taking it as it is. You don't have to explain it for my sake.",
        ),
        outcome: "success",
        requires: {},
        effects: {
          flags: { secondmentDecision: "decline" },
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-declined",
              status: "narrowed",
              hasMutualNextStep: false,
            },
          ],
          promises: [{ kind: "secondment-answer", by: "rio", dueByAct: 6, status: "kept" }],
          finalDecision: {
            kind: "continue",
            agreedBy: "one-sided",
            hasDatedNextStep: false,
            revisit: null,
            reason: null,
          },
        },
      },
      {
        id: "date-the-defer",
        act: 6,
        text: L(
          "可以再宽限，但把日期写下来：哪天之前给公司答复。",
          "You can have more time — but write down the date: when you'll answer the company by.",
        ),
        outcome: "partial",
        requires: {},
        effects: {
          flags: { secondmentDecision: "defer-with-date" },
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-undecided",
              status: "narrowed",
              hasMutualNextStep: true,
            },
          ],
          promises: [{ kind: "secondment-answer", by: "rio", dueByAct: 6 }],
          finalDecision: {
            kind: "pause",
            agreedBy: "one-sided",
            hasDatedNextStep: false,
            revisit: "after-secondment-answer",
            reason: "secondment",
          },
        },
      },
      {
        id: "push-her-to-go",
        act: 6,
        text: L(
          "去吧，工作重要，我没事的。",
          "Go. Work matters. I'll be fine.",
        ),
        outcome: "failure",
        requires: {},
        effects: {
          flags: { secondmentDecision: "accept" },
          conflicts: [
            {
              topic: "secondment",
              shape: "secondment-accepted-no-plan",
              status: "open",
              hasMutualNextStep: false,
            },
          ],
          promises: [{ kind: "secondment-answer", by: "rio", dueByAct: 6, status: "kept" }],
          finalDecision: {
            kind: "continue",
            agreedBy: "one-sided",
            hasDatedNextStep: false,
            revisit: null,
            reason: null,
          },
          harm: "rio-committed-for-you",
        },
      },
    ],
  },
  {
    id: "name-it",
    title: L("把关系说定", "Say what you are"),
    beats: [
      {
        id: "name-and-date",
        act: 6,
        text: L(
          "那我们把话说定：下周三晚上视频，之后每周一次；三个月后我们坐下来，把日子的事自己谈一次。",
          "Then let's say it plainly: video call Wednesday, then weekly; in three months we sit down and talk the date through ourselves.",
        ),
        outcome: "success",
        requires: { finalDecisionMade: true },
        effects: {
          flags: { exclusivity: "agreed", pace: "dated" },
          conflicts: [
            {
              topic: "exclusivity",
              shape: "exclusivity-agreed",
              status: "resolved",
              hasMutualNextStep: true,
            },
            {
              topic: "pace",
              shape: "pace-dated",
              status: "resolved",
              hasMutualNextStep: true,
            },
            {
              topic: "secondment",
              shape: "secondment-declined",
              status: "resolved",
              hasMutualNextStep: true,
            },
          ],
          boundaries: [{ topic: "pace", status: "agreed", by: "learner" }],
          finalDecision: {
            kind: "continue",
            agreedBy: "both",
            acceptance: true,
            hasDatedNextStep: true,
            revisit: null,
            reason: null,
          },
        },
      },
      {
        id: "pause-with-revisit",
        act: 6,
        text: L(
          "我们先停一停：两周后视频一次，只谈我们俩的事，不谈家里，也不谈公司。",
          "Let's pause: one video call in two weeks, about us only — not the family, not the company.",
        ),
        outcome: "partial",
        requires: { finalDecisionMade: true },
        effects: {
          flags: { pace: "dated" },
          conflicts: [
            {
              topic: "exclusivity",
              shape: "exclusivity-undefined",
              status: "shelved",
              hasMutualNextStep: true,
            },
            {
              topic: "pace",
              shape: "pace-dated",
              status: "shelved",
              hasMutualNextStep: true,
            },
            {
              // 暂停同样要把外派冲突收进搁置，否则 closed(secondment) 挡住 clean-parting。
              topic: "secondment",
              status: "shelved",
              hasMutualNextStep: true,
            },
          ],
          finalDecision: {
            kind: "pause",
            agreedBy: "both",
            acceptance: true,
            hasDatedNextStep: true,
            revisit: "two-weeks",
            reason: "secondment",
          },
        },
      },
      {
        id: "end-with-thanks",
        act: 6,
        text: L(
          "谢谢你把话说完。我们到这里就好，好好告别。",
          "Thank you for saying it all the way through. This is where we stop — a clean goodbye.",
        ),
        outcome: "partial",
        requires: { finalDecisionMade: true },
        effects: {
          flags: { exclusivity: "declined" },
          conflicts: [
            {
              topic: "exclusivity",
              shape: "exclusivity-declined",
              status: "resolved",
              hasMutualNextStep: false,
            },
            {
              topic: "pace",
              shape: "pace-undefined",
              status: "resolved",
              hasMutualNextStep: false,
            },
            {
              // 告别也要关上外派冲突；shape 缺省沿用她答复时的形状。
              topic: "secondment",
              status: "resolved",
              hasMutualNextStep: false,
            },
          ],
          finalDecision: {
            kind: "end",
            agreedBy: "both",
            acceptance: true,
            hasDatedNextStep: false,
            revisit: null,
            reason: "secondment",
          },
        },
      },
    ],
  },
];

/** 全部作者拍点组，按幕分组；`applyRioBeat` 与契约测试共用扁平列表。 */
export const RIO_BEAT_GROUPS_BY_ACT: Readonly<Record<number, readonly RioBeatGroup[]>> = {
  4: RIO_ACT4_BEAT_GROUPS,
  5: RIO_ACT5_BEAT_GROUPS,
  6: RIO_ACT6_BEAT_GROUPS,
};

/** 某一幕该出现的拍点组（扁平）；没有语料的幕返回空。 */
export function rioBeatGroupsForAct(act: RioAct): readonly RioBeatGroup[] {
  return RIO_BEAT_GROUPS_BY_ACT[act] ?? [];
}

/** 扁平化的拍点列表；`applyRioBeat` 与契约测试共用。 */
export const RIO_ACT4_BEATS: RioBeat[] = RIO_ACT4_BEAT_GROUPS.flatMap((group) => group.beats);
export const RIO_ALL_BEATS: RioBeat[] = Object.values(RIO_BEAT_GROUPS_BY_ACT)
  .flatMap((groups) => groups.map((group) => group.beats))
  .flat();

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

function withConflict(
  conflicts: RioConflict[],
  effect: RioConflictEffect,
  act: RioAct,
  evidence: RioEvidence,
): RioConflict[] {
  const index = conflicts.findIndex((conflict) => conflict.topic === effect.topic);
  const previous = index >= 0 ? conflicts[index] : undefined;
  const row: RioConflict = {
    id: previous?.id ?? `rio-${effect.topic}`,
    topic: effect.topic,
    shape: effect.shape ?? previous?.shape ?? "secondment-undecided",
    status: effect.status,
    openedAtAct: previous?.openedAtAct ?? act,
    lastTouchedAtAct: act,
    hasMutualNextStep: effect.hasMutualNextStep,
    evidence,
  };
  if (index < 0) return [...conflicts, row];
  return conflicts.map((conflict, i) => (i === index ? row : conflict));
}

function withBoundary(
  boundaries: RioBoundary[],
  effect: RioBoundaryEffect,
  act: RioAct,
  evidence: RioEvidence,
): RioBoundary[] {
  const index = boundaries.findIndex(
    (boundary) => boundary.topic === effect.topic && boundary.by === effect.by,
  );
  const previous = index >= 0 ? boundaries[index] : undefined;
  // 越界只能靠带修复证据的拍点收回；「补充条件」不能把 crossed 覆盖成 proposed。
  if (previous?.status === "crossed" && effect.status !== "repaired" && effect.status !== "withdrawn") {
    return boundaries;
  }
  const row: RioBoundary = {
    id: previous?.id ?? `rio-${effect.topic}-boundary`,
    topic: effect.topic,
    by: effect.by,
    atAct: act,
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

function withPromise(
  promises: RioPromise[],
  effect: RioPromiseEffect,
  act: RioAct,
  evidence: RioEvidence,
): RioPromise[] {
  const index = promises.findIndex(
    (promise) => promise.kind === effect.kind && promise.by === effect.by,
  );
  const status = effect.status ?? "open";
  if (index >= 0) {
    const previous = promises[index];
    // 兑现/解除是终点：kept 之后不再回到 open，但 kept 可以被再次确认。
    if (previous.status !== "open" && !(previous.status === "kept" && status === "kept")) {
      return promises;
    }
    return promises.map((promise, i) =>
      i === index
        ? { ...promise, dueByAct: effect.dueByAct, status, evidence }
        : promise,
    );
  }
  return [
    ...promises,
    {
      id: `rio-${effect.kind}`,
      kind: effect.kind,
      by: effect.by,
      madeAtAct: act,
      dueByAct: effect.dueByAct,
      status,
      evidence,
    },
  ];
}

function withFinalDecision(
  previous: RioRelationshipState["finalDecision"],
  effect: RioFinalDecisionEffect,
  evidence: RioEvidence,
): RioRelationshipState["finalDecision"] {
  return {
    kind: effect.kind,
    agreedBy: effect.acceptance ? "both" : effect.agreedBy,
    atAct: 6,
    evidence,
    acceptance: effect.acceptance ? evidence : previous?.acceptance,
    hasDatedNextStep: effect.hasDatedNextStep,
    revisit: effect.revisit,
    reason: effect.reason,
  };
}

/**
 * 应用一个作者写死的状态拍点（第 4–6 幕，纯函数）。
 *
 * - 未知 beatId、证据不是逐字选项文本、或引用的学习者原话不存在时，原样返回输入。
 * - 不评分、不写好感；只写拍点声明的 flags、冲突、边界、承诺与 finalDecision，
 *   并把本幕的 `lastAct/lastOutcome` 记账。
 * - `updatedAt` 由持久层落盘时写入，这里不读时钟，保证同参数同输出。
 */
export function applyRioBeat(
  state: RioRelationshipState,
  beatId: string,
  evidence: RioEvidence,
): RioRelationshipState {
  const beat = RIO_ALL_BEATS.find((item) => item.id === beatId);
  if (!beat) return state;
  if (!matchRioRequires(beat.requires, state)) return state;
  if (!evidenceMatchesBeat(state, beat, evidence)) return state;

  const next = cloneState(state);
  if (beat.effects.flags) {
    const flags = next.flags as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(beat.effects.flags)) {
      flags[key] = value;
    }
  }
  for (const effect of beat.effects.conflicts ?? []) {
    next.conflicts = withConflict(next.conflicts, effect, beat.act, evidence);
  }
  for (const effect of beat.effects.boundaries ?? []) {
    next.boundaries = withBoundary(next.boundaries, effect, beat.act, evidence);
  }
  for (const effect of beat.effects.promises ?? []) {
    next.promises = withPromise(next.promises, effect, beat.act, evidence);
  }
  if (beat.effects.finalDecision) {
    next.finalDecision = withFinalDecision(next.finalDecision, beat.effects.finalDecision, evidence);
    next.flags.finalDecisionMade = true;
  }
  if (beat.effects.harm && !next.flags.unrepairedHarm.includes(beat.effects.harm)) {
    next.flags.unrepairedHarm = [...next.flags.unrepairedHarm, beat.effects.harm];
  }
  if (next.flags.secondmentDisclosed) {
    next.unknown = next.unknown.filter((key) => key !== "secondmentDisclosed");
  }
  next.lastAct = beat.act;
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
