import { L } from "../taxonomy";
import type { Theory } from "./types";

/**
 * Long-distance theories (loveTopic: "long-distance"), added 2026-10-09 by the
 * love-retrieval baseline (quality gate C): the topic had a single theory, so
 * off-topic neighbors were surfacing in the top 3. Material drawn from the
 * Goutoujunshi extraction maps: practical 关系投入失衡 (joint arrangements over
 * message counts) and practical 情绪价值 (presence substitutes).
 */
export const THEORIES_DEEP_LONG_DISTANCE: Theory[] = [
  {
    id: "love-th-ld-joint-arrangement",
    title: L("异地看共同安排，不数消息", "Judge Long Distance by Shared Arrangements, Not Message Counts"),
    source: { book: "Goutoujunshi skill, practical 关系投入失衡 (community practice)", author: "Goutoujunshi skill" },
    principle: L(
      "异地的信号天然稀疏，最容易用「回消息的速度」当关系温度计。但更可靠的是共同安排：固定通话、见面计划、费用分担、缩短距离的行动——这些是可观察、可兑现的证据；消息频率是噪声。把判断基准从「他今天回了什么」换到「我们共同维持了什么」，既减少单次沉默的恐慌，也避免了用聊天频率误伤真正在投入的人。",
      "Long distance runs on thin signals, so reply speed easily becomes the relationship thermometer. The sturdier measure is shared arrangements: standing calls, visit plans, cost sharing, concrete steps to close the distance — observable, follow-through-able evidence. Message frequency is noise. Moving your yardstick from 'what did they reply today' to 'what are we jointly maintaining' cuts the panic around single silences and keeps you from punishing someone who is actually investing.",
    ),
    howTo: [
      L("把判断基准列成可核对的项：通话频次、见面计划、费用分担、缩短距离的行动。", "List checkable indicators: call cadence, visit plans, cost sharing, distance-closing actions."),
      L("消息变慢时先看共同安排的进度，再决定要不要表达不安。", "When replies slow, check the shared arrangements first, then decide whether to voice your unease."),
      L("不把「今天没回」单独当作投入的证据——它既不是证据，也不是背叛。", "Don't treat 'no reply today' as standalone evidence of investment — it's neither proof nor betrayal."),
    ],
    competencies: ["relationship-skills", "responsible-decision-making"],
    skills: ["communication", "perspective-taking", "analyzing-consequences"],
    keywords: ["long distance", "arrangements", "reliability", "evidence", "共同安排", "异地", "不数消息"],
    context: "romantic",
    loveTopic: "long-distance",
  },
  {
    id: "love-th-ld-presence-substitute",
    title: L("不在场时的陪伴：承接情绪，用小仪式替代在场", "Companionship at a Distance: Meet the Feeling, Replace Presence with Ritual"),
    source: { book: "Goutoujunshi skill, practical 情绪价值 (community practice)", author: "Goutoujunshi skill" },
    principle: L(
      "异地最难的时刻是对方情绪低谷而你无法在场。陪伴的核心不是「在场」，而是被接住：先确认对方的情绪（「听起来今天特别累」），不急着给方案或讲道理；然后用一个可及的小动作替代在场——固定时段的通话、一条具体的关心、约定一个共同的小仪式。真正的陪伴是让对方知道「此刻你不需要一个人」，而小仪式让这句承诺在距离里可以兑现。",
      "The hardest long-distance moment is their low point when you can't be there. Companionship isn't about physical presence — it's about being met: acknowledge the feeling first ('that sounds exhausting'), don't rush to solutions or lectures; then substitute presence with something reachable — a standing call slot, one concrete message of care, a small ritual you share. Real support tells them 'you don't have to be alone in this right now', and a ritual makes that promise payable across the distance.",
    ),
    howTo: [
      L("先命名对方的情绪，再问要不要聊聊或想先安静待会儿。", "Name their feeling first, then ask whether they want to talk or sit quietly."),
      L("不在场就用可及的替代：固定通话时段、一条具体关心的消息、约定好的小仪式。", "When you can't be there, reach with substitutes: a standing call slot, one specific caring message, an agreed ritual."),
      L("不把「给方案」当陪伴——对方低落时，被听见比被解决重要。", "Don't mistake problem-solving for companionship — in a low moment, being heard beats being fixed."),
    ],
    competencies: ["social-awareness", "relationship-skills"],
    skills: ["empathy", "communication", "identifying-emotions"],
    keywords: ["long distance", "companionship", "ritual", "support", "陪伴", "异地", "小仪式"],
    context: "romantic",
    loveTopic: "long-distance",
  },
];
