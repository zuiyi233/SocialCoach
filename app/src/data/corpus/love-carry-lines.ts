import { L } from "../taxonomy";

/**
 * 台词库（carry lines）——「她回头问你那一句话」的全部可能输出。
 *
 * 背景见 `wiki/reviews/review-2026-10-13-love-companionship.md` §1 / §5 / §6 / §10：
 * 异地语料的成功函数里显式含着「时间流逝 + 约定是否兑现」（`love-th-ld-presence-substitute`、
 * `love-th-ld-joint-arrangement`、`love-theory-long-distance`），但练完就关掉，学习者永远拿不到
 * 语料自己承诺的那半反馈。补法是：场景结束时记下**一句承诺**，下一次来访时**同一个 NPC** 问起它。
 *
 * 关键纪律（§6：用可控编剧台词代替当场生成）：提问时**不调用任何模型**。
 * 每一句可能出现在屏幕上的 NPC 话都必须已经写在这个文件里。所以矩阵必须闭合：
 * 3 类承诺 × 4 种说法 = 12 句，加上学习者没选类别时的兜底 4 句 = **16 句**，一格不多一格不少。
 * 答法里的第四种 `dropped`（学习者直接跳过、不作答）**没有台词**——它就是沉默。
 *
 * `ask` 与 `askAgain` 为什么必须分成两格：`love-carry-store.ts` 的节流表允许同一条承诺一辈子
 * 被问满 3 次（`LOVE_CARRY_ASK.perCarryMax`），`askCount` 就是那个硬计数。所以第一次之后的
 * 任何一句都不能宣称「这是我头一回提」，也不能反过来宣称「我从没拿出来催过你」——
 * 那句话在第 2、3 次浮现时是一条可被代码证伪的假话。`ask`（`askCount === 0`）里不许出现
 * 任何关于「问过没问过」的说法；`askAgain`（`askCount > 0`）则明说这是重复问，这才配得上
 * 一个不讨好的人。分派在 `loveCarryAskLine` / `loveCarryCardLine` 里，只有这一条规则。
 *
 * 停止判据（§10.1 P4）：若将来某个组合需要「现编」才能说得通，那就是**停下来讨论**的信号，
 * 不是补一个模型调用的许可，也不是把两句现成的硬拼成一句的许可。矩阵闭合本身就是这个功能的刹车。
 *
 * 红线（`AGENTS.md` 项目专有约束 + `wiki/specs/spec-love-visual-novel.md`）：
 * - **不讨好**：`kept` 只承认事实然后转向下一件真事，不给评价、不加好感、不升温亲昵。
 * - **不制造过去**：只允许引用 ①学习者自己录下的原话（`{{quote}}`）②承诺的抽象类别
 *   ③这条承诺自己的记录状态（问过一次、答过一次「还没」）。绝不虚构学习者没说过的具体时间、
 *   地点、事件。需要这种细节才成立的话，一律改写成问句。
 * - **不布置作业**：NPC 不在这些句子里给学习者派新任务。`kept` 尤其不许以「那下一个…」收尾——
 *   兑现一件事换来的不是下一件作业。场景本身的难度可以抬，新的承诺不能要。
 * - **不做情绪关怀**：不问「你最近还好吗」，不监测情绪，不用临床口径；只问学习者自己说过的那个动作。
 * - 双语硬要求；`source` 硬要求（无语料出处的策略/案例不允许存在，出处必须是被打开读过的那一句）。
 *
 * `{{quote}}` 由学习者亲手打的一句话**逐字**替换，长度与句式不可控（可能是「周三打给你」
 * 这样的从句，也可能是「我这周一定打给你。」这样自带句号的一整句）。所以：
 * - 引用一律放在引号里，其后再以「这句 / 这个 / 它」或破折号回指；
 * - 「」 或 ” 后面**只跟逗号、破折号或空格外的小写延续**，绝不跟句号、问号、感叹号——
 *   否则自带句号的原话会渲染成 `。」。` / `”.` 这种双标点；
 * - 不许用「你留过一句…」「撂下一句…」这类把原话框成「一句话」的说法，多句原话会当场破形。
 */

/** 学习者录承诺时自己点的类别——不是我们猜的。三类直接来自异地语料的可兑现项。 */
export type CarryPromiseClass = "call" | "visit" | "ritual";

/**
 * 学习者回来时这一句所处的状态。
 * `ask` = 一次都没问过的第一次开口；`askAgain` = `askCount > 0`，重复问；
 * `open` = 学习者自己答过「还没」；`kept` = 学习者自己答过「做了」。
 * `dropped`（不作答 / 喊停）是沉默，不是台词，所以不在这里。
 */
export type CarryResolution = "ask" | "askAgain" | "kept" | "open";

/** 一句可渲染的 NPC 台词：正文含 `{{quote}}` 占位符，外加它落地的是哪一条语料。 */
export interface CarryLine {
  text: L;
  /** 这句台词把哪一条语料变成可说出口的话。 */
  source: string;
}

/** 学习者录承诺时点的短标签。 */
export const CARRY_PROMISE_LABELS: Record<CarryPromiseClass, L> = {
  call: L("通话", "A call"),
  visit: L("见面", "A visit"),
  ritual: L("小仪式", "A small ritual"),
};

/** `{{quote}}` 的唯一占位符；运行时只做字符串替换。 */
export const CARRY_QUOTE_MARKER = "{{quote}}";

/**
 * 12 句主体台词：`CARRY_LINES[类别][说法]`。
 * 16 句读下来要像同一个人把话说完，不是四份表单换了名词：起手、长短、软硬都错开，
 * 引原话的动词也换着用（你说过 / 你说的 / 你许的是 / 你讲的 / 你给的 / 你自己讲的 /
 * 让引语直接当主语），英文不许整排 `You said “…” —`。
 */
export const CARRY_LINES: Record<CarryPromiseClass, Record<CarryResolution, CarryLine>> = {
  call: {
    ask: {
      text: L(
        "你说过「{{quote}}」——电话到底通没通，我今天想听你亲口讲。",
        "Did the call connect, or didn’t it? You told me “{{quote}}” — I want it from your own mouth today.",
      ),
      source:
        "app/src/data/corpus/love-theories-deep-long-distance.ts#love-th-ld-joint-arrangement（把判断基准列成可核对的项：通话频次…；共同安排是可兑现的证据，消息频率是噪声）",
    },
    askAgain: {
      text: L(
        "这句我不是头一回问了。你自己讲的——「{{quote}}」，通没通，给个准话。",
        "I’m asking the same thing again. Your line was “{{quote}}” — did the call connect, or not?",
      ),
      source:
        "app/src/data/corpus/love-scenarios-deep-long-distance.ts#love-ld-fight-over-phone（修复靠一个具体的重新连接点：时间与方式；隔空的话要落地成下一次通话）",
    },
    kept: {
      text: L(
        "电话接起来了。你说的「{{quote}}」，这一条算办完，不算成绩——我不会因为这一通对你另眼相看。",
        "The call came through. “{{quote}}” is what you gave me, and that’s one arrangement closed, not an achievement — I won’t treat you differently for one phone call.",
      ),
      source:
        "app/src/data/corpus/love-theories.ts#love-theory-long-distance（一起立一个可执行的小约定：到点报平安、固定通话时间）+ love-theories-deep-long-distance.ts#love-th-ld-joint-arrangement（共同维持的东西是可核对项，不是温度计）",
    },
    open: {
      text: L(
        "你许的是「{{quote}}」，还没做。我不替你把它说成已经安排好了——你自己讲，它什么时候开始算数？",
        "You promised “{{quote}}” and it still hasn’t happened. I won’t talk it into something already arranged, so you tell me when it starts counting.",
      ),
      source:
        "app/src/data/corpus/love-scenarios-deep-long-distance.ts#love-ld-milestone-remote（你提议的视频时段，要等 Ta 确认才算数；你寄出的东西要等 Ta 收到才算到达）",
    },
  },
  visit: {
    ask: {
      text: L(
        "那天你到底排不排得开？你说过「{{quote}}」，我要的是日子，不是感觉。",
        "Can you actually get that day free? “{{quote}}” was your answer — I want the date, not a feeling.",
      ),
      source:
        "app/src/data/corpus/love-theories-deep-long-distance.ts#love-th-ld-joint-arrangement（见面计划列进可核对项：先核共同安排，再决定要不要表达不安）",
    },
    askAgain: {
      text: L(
        "见面的事我不止一次摆上桌了：「{{quote}}」——日子到底定没定？",
        "I’ve put the visit on the table more than once. You said “{{quote}}” — is that day settled, yes or no?",
      ),
      source:
        "app/src/data/corpus/love-scenarios.ts#love-ld-visit-plan（找到一个交集日期不等于双方都已答应那几天——没两边点头就还没定）",
    },
    kept: {
      text: L(
        "人站到我跟前了，这比什么都算数。你说过「{{quote}}」，你也办了——往后看的还是接着往下排的那些安排，不是一次见面。",
        "You were standing right here, which counts for more than anything said. “{{quote}}” turned into you being here — and what this runs on is the arrangements still stacked behind one visit.",
      ),
      source:
        "app/src/data/corpus/love-theories-deep-long-distance.ts#love-th-ld-joint-arrangement（把判断基准从单次信号换到「我们共同维持了什么」：见面计划、缩短距离的行动）",
    },
    open: {
      text: L(
        "我不逼你当场再报一个日子——你当时讲的「{{quote}}」，现在是排不开，还是不想排了？",
        "I won’t make you name a fresh date on the spot. What you had was “{{quote}}” — is the calendar shut, or is it that you don’t want this?",
      ),
      source:
        "app/src/data/corpus/love-scenarios-deep-long-distance.ts#love-ld-visit-plan-hard（先接住累积的失望，再核实对方真实可动的时间；失败函数点名「逼他当场保证一个他自己都没把握的日期」）",
    },
  },
  ritual: {
    ask: {
      text: L(
        "你说要「{{quote}}」，我这边还没等到——是我会错了意，还是这事压根没开始？",
        "You said “{{quote}}” — nothing has reached me yet. Did I read it wrong, or did this never start?",
      ),
      source:
        "app/src/data/corpus/love-theories-deep-long-distance.ts#love-th-ld-presence-substitute（约定一个共同的小仪式；小仪式让这句承诺在距离里可以兑现）",
    },
    askAgain: {
      text: L(
        "这个小仪式我又不止提一次了——你讲的「{{quote}}」，它到底动过没有？",
        "I’m raising this little ritual again — your “{{quote}}” is still what’s on the table. Has any of it actually moved?",
      ),
      source:
        "app/src/data/corpus/love-scenarios.ts#love-ld-routine（每晚十点的视频已经成了例行公事：动作还在，不等于它真的在维持）",
    },
    kept: {
      text: L(
        "那条真的到我这边了，不是话而已。你给的「{{quote}}」，这事到这儿就算成了——我不把它当话题，也不需要你再向我保证什么。",
        "It really did arrive on my side, which is more than words. That “{{quote}}” of yours is closed — I’m not making it a topic, and I don’t need another promise out of you.",
      ),
      source:
        "app/src/data/corpus/love-cases.ts#love-case-long-distance-checkin（一个具体、可兑现的请求换来的东西比一句说法多：认下约定之后，每晚那条真的准时到）",
    },
    open: {
      text: L(
        "它要是不成立，咱俩就别装作它还立着。你说过「{{quote}}」——这个你到底还想要，还是不要了？",
        "If it isn’t going to happen, let’s not both keep pretending it’s standing. You said “{{quote}}” — do you actually still want it, or not?",
      ),
      source:
        "app/src/data/corpus/love-scenarios.ts#love-ld-routine（把「今晚可以不视频」也当成选项说出来，而不是硬撑到两个人都累；跳过一晚不是关系有问题的证据）",
    },
  },
};

/**
 * 兜底 4 句：学习者录承诺时拒绝标类别（`class` 为空）。
 * 仍然只引用原话本身与记录状态，不猜它是通话还是见面。
 */
export const CARRY_LINES_UNCLASSIFIED: Record<CarryResolution, CarryLine> = {
  ask: {
    text: L(
      "我不绕这句——你亲手打的「{{quote}}」，做了，还是没有？",
      "I’m not circling it: those were your words, “{{quote}}” — so did it happen, or didn’t it?",
    ),
    source:
      "app/src/data/corpus/love-theories.ts#love-theory-long-distance（分清「等待让我不安」与「对方真的不再可靠」：按长期是否兑现校准，不按单次回复速度）",
  },
  askAgain: {
    text: L(
      "同样的话我又问一遍——「{{quote}}」，这话是你自己讲的，做没做照实说。",
      "I’ve asked about this more than once: “{{quote}}” was yours. Kept or not, tell me straight — I don’t need it talked smooth.",
    ),
    source:
      "app/src/data/corpus/love-theories-deep-long-distance.ts#love-th-ld-joint-arrangement（把判断基准从「他今天回了什么」换到「我们共同维持了什么」——问的是那件东西，不是一时语气）",
  },
  kept: {
    text: L(
      "做实了的事不必再摆到嘴上——「{{quote}}」我听见了，也看见了。我不拿这一件证明什么，这事到此为止，下面还有别的日子要过。",
      "That one got made real, so I won’t keep it on the table. “{{quote}}” is not proof of anything else — there are other days to get through.",
    ),
    source:
      "app/src/data/corpus/love-theories-deep-long-distance.ts#love-th-ld-joint-arrangement（单项不升级成结论：「它既不是证据，也不是背叛」）+ love-cases.ts#love-case-long-distance-checkin（约定认下之后长在每天的那条里）",
  },
  open: {
    text: L(
      "我不把它写成罪名，可它也确实还悬着。你说过「{{quote}}」——还想要就说你想要什么，不想要也就直说。",
      "I’m not writing it up as a charge, but it is still hanging. You said “{{quote}}” — if you want it, say what wanting it looks like; if you don’t, one sentence is enough.",
    ),
    source:
      "app/src/data/corpus/love-theories.ts#love-theory-long-distance（把不安全感说成请求：「我是什么感受、我需要什么样的回应」，而不是指控）+ love-scenarios.ts#love-long-distance（把「消息变少」和「他不在乎我」分开，事实、解释、恐惧各自归位）",
  },
};
