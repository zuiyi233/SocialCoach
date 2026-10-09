import { L } from "../taxonomy";
import type { Theory } from "./types";

/**
 * Rejection-track theories (loveTopic: "rejection"), added 2026-10-09 by the
 * love-retrieval baseline (quality gate C): the topic had a single theory, so
 * off-topic neighbors were surfacing in the top 3. Material drawn from the
 * Goutoujunshi extraction maps: knowledge 20 (process goals, stop signals) and
 * practical 主动表达 / 实战话术编排器 (graceful close, feedback branches).
 */
export const THEORIES_DEEP_REJECTION: Theory[] = [
  {
    id: "love-th-rejection-process-goal",
    title: L("把成功改写为过程，而不是「被接受」", "Reframe Success as Process, Not 'They Said Yes'"),
    source: { book: "Goutoujunshi skill, knowledge 20 (teaching framework)", author: "Goutoujunshi skill" },
    principle: L(
      "把一次表白或表达的结果灾难化，是拒绝之后最重的那块石头。把「成功」的定义从「对方接受了」改成三件自己可控的事——把心意表达清楚、给出一个可退出的下一步、尊重反馈并复盘——单次结果就不再是价值终审。过程目标不会让拒绝消失，但会让拒绝之后仍然有一份完整的自我评价可以落地。",
      "Catastrophizing one confession's outcome is the heaviest stone after a no. Redefine success away from 'the other person accepted' and onto three things you control — stating your feelings clearly, offering a next step that is easy to decline, and respecting the feedback while reviewing — and a single outcome stops being a verdict on your worth. Process goals don't erase rejection; they give you a complete self-assessment to land on afterwards.",
    ),
    howTo: [
      L("表白或表达前，先写下自己的三条成功标准，全部是你能控制的动作。", "Before confessing or expressing interest, write your own three success criteria — all actions you control."),
      L("收尾时用复盘句代替判决句：「我把话说清楚了，下一步也给了，剩下的不是我能决定的。」", "Close with a review sentence instead of a verdict: 'I said it clearly and offered a next step; the rest isn't mine to decide.'"),
      L("不被「如果当时换一种说法就好了」的假设反刍困住——复盘适配，不重审自我价值。", "Don't let 'if only I'd phrased it differently' rumination take over — review your fit and delivery, not your worth."),
    ],
    competencies: ["self-awareness", "self-management"],
    skills: ["self-efficacy", "perseverance", "goal-setting"],
    keywords: ["process goal", "self-worth", "review", "after a no", "过程目标", "复盘"],
    context: "romantic",
    loveTopic: "rejection",
  },
  {
    id: "love-th-rejection-graceful-close",
    title: L("被婉拒后的体面收尾：接住好意，不问为什么", "The Graceful Close: Receive the Kindness, Skip the 'Why'"),
    source: { book: "Goutoujunshi skill, practical 主动表达 & 实战话术编排器 (community practice)", author: "Goutoujunshi skill" },
    principle: L(
      "拒绝之后的对话怎么收尾，往往比拒绝本身更影响两个人之后的位置。体面的收尾有三步：接住对方拒绝时的善意（「谢谢你愿意跟我说清楚」），不追问「为什么」——理由常常是对方在保护你或自己，追问只会把收尾变成审讯；然后给出你自己需要的下一步（做朋友、需要空间、各自安好）。纠缠、自我否定和「证明我值得」都是把一次拒绝拖成反复的伤口。",
      "How the conversation closes after a no often matters more than the no itself. A graceful close has three moves: receive the kindness in how they declined ('thank you for telling me clearly'), don't interrogate the 'why' — the reason is often them protecting you or themselves, and pressing turns the ending into an interrogation — then name the next step you need (friendship, space, a clean break). Clinging, self-reproach, and 'let me prove I'm worthy' are how one rejection becomes a reopened wound.",
    ),
    howTo: [
      L("先接住拒绝时的善意，再表达你的感受，顺序不要反。", "Receive the kindness in their no first, then say how you feel — don't reverse the order."),
      L("不追问「到底为什么」。一句「我尊重你的决定」就是把收尾权交还给双方。", "Don't press for 'exactly why'. A single 'I respect your decision' hands the closing back to both of you."),
      L("给自己选一个下一步并说出来：做朋友、需要空间、还是各自安好。", "Choose your next step and say it: friendship, space, or a clean goodbye."),
    ],
    competencies: ["self-management", "relationship-skills"],
    skills: ["emotion-regulation", "communication", "self-efficacy"],
    keywords: ["graceful", "closure", "receive", "dignity", "体面", "收尾"],
    context: "romantic",
    loveTopic: "rejection",
  },
  {
    id: "love-th-rejection-clear-no",
    title: L("拒绝的一方：清楚不是伤害，拖着才是", "The One Saying No: Clarity Isn't Cruel, Stalling Is"),
    source: { book: "Goutoujunshi skill, practical 高情商拒绝他人 & 场景感·社交校准 (community practice)", author: "Goutoujunshi skill" },
    principle: L(
      "被表白的一方同样需要练习：把「说清楚」当成尊重，而不是伤害。对方鼓起勇气说出口，最怕的不是被拒，而是被吊着——「再说吧」「也许以后」把一次拒绝拖成反复的猜测。清楚的回答带一句对勇气的肯定（「谢谢你愿意告诉我」），再给一个不含糊的结论或明确的时间线。拖延不是因为更温柔，而是因为把收尾的责任推给了对方。",
      "The one receiving a confession needs practice too: treat clarity as respect, not cruelty. Someone who worked up the courage to speak fears being left hanging far more than being declined — 'let's see', 'maybe someday' stretches a no into a guessing game. A clear answer opens with acknowledgment of their courage ('thank you for telling me') and closes with an unambiguous conclusion or an explicit timeline. Stalling isn't gentler; it's handing the job of ending the wait back to them.",
    ),
    howTo: [
      L("先肯定对方的勇气和信任，再给出你的结论，不把顺序吞掉。", "Acknowledge their courage and trust first, then give your answer — don't skip the first half."),
      L("结论要清楚：行、不行，或一个对方能等的明确时间线。", "Make the answer unambiguous: yes, no, or an explicit timeline they can actually wait on."),
      L("不用「以后也许会」缓解当下的内疚——那只是把今天的难过推迟。", "Don't reach for 'maybe someday' to ease your guilt today — it only postpones the hurt."),
    ],
    competencies: ["relationship-skills", "social-awareness"],
    skills: ["communication", "empathy", "identifying-emotions"],
    keywords: ["clarity", "receive confession", "honesty", "not stalling", "清楚拒绝", "不吊着"],
    context: "romantic",
    loveTopic: "rejection",
  },
];
