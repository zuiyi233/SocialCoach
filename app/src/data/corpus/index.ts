import { SCENARIOS_A } from "./scenarios-a";
import { SCENARIOS_B } from "./scenarios-b";
import { THEORIES as THEORIES_BASE } from "./theories";
import { THEORIES_C } from "./theories-c";
import { SCENARIOS_C } from "./scenarios-c";
import { SCENARIOS_D } from "./scenarios-d";
import { SCENARIOS_JUNIOR } from "./scenarios-junior";
import { SCENARIOS_FAMILY } from "./scenarios-family";
import { CASES_C } from "./cases-c";
import { CASES as CASES_BASE } from "./cases";
import { LOVE_SCENARIOS } from "./love-scenarios";
import { LOVE_THEORIES } from "./love-theories";
import { LOVE_CASES } from "./love-cases";
import type { Case, Character, Scenario, Theory } from "./types";
import { L } from "../taxonomy";

/** Role the learner plays in each corpus scenario (they are always "you"). */
const LEARNER_ROLE: Record<string, { zh: string; en: string }> = {
  "elevator-confidential-question": L("协助安排面试的员工", "Employee assisting with interviews"),
  "office-quick-favor": L("正在赶报告的同事", "Colleague finishing a report"),
  "group-chat-blame": L("整理上线清单的成员", "Team member compiling a launch checklist"),
  "parent-unannounced-visit": L("马上参加考试的成年子女", "Adult child about to take an exam"),
  "sibling-surprise-bill": L("未同意酒店预算的手足", "Sibling who did not agree to the hotel budget"),
  "friend-advice-repair": L("过早给建议的朋友", "Friend who offered premature advice"),
  "friend-left-out": L("没被邀请的朋友", "Friend who was not invited"),
  "partner-location-pressure": L("被要求共享定位的伴侣", "Partner asked to share their location"),
  "partner-trip-change": L("需要改变出行计划的伴侣", "Partner who needs to change travel plans"),
  "class-chat-screenshot": L("私聊被转发的学生", "Student whose private message was shared"),
  "queue-just-a-question": L("已经排到窗口的办事人", "Customer who reached the front of the queue"),
  "party-live-camera": L("没有同意出镜的聚会来宾", "Guest who did not consent to being filmed"),
  "friend-good-news": L("也申请过驻留的朋友", "Friend who also applied for the residency"),
  "trip-budget-boundary": L("有旅行预算上限的朋友", "Friend with a travel budget ceiling"),
  "family-photo-permission": L("照片被公开的成年子女", "Adult child whose photo was posted"),
  "holiday-two-families": L("协调假期安排的成年子女", "Adult child coordinating holiday visits"),
  "class-name-correction": L("夜校新学员", "New evening-class student"),
  "language-club-space": L("第二语言练习者", "Second-language learner"),
  "event-access-request": L("使用轮椅的报名者", "Prospective participant who uses a wheelchair"),
  "party-alcohol-pressure": L("决定不喝酒的新邻居", "New neighbor choosing not to drink"),
  "community-room-sharing": L("社区读书会组织者", "Community reading-group organizer"),
  "friend-secret-apology": L("泄露秘密的朋友", "Friend who shared a confidence"),
  "partner-alone-evening": L("需要独处的伴侣", "Partner who needs solitude"),
  "async-message-misread": L("负责选择周报格式的同事", "Colleague choosing a report format"),
  "meeting-tension": L("产品团队成员", "Product team member"),
  "salary-raise": L("两年资历的员工", "Two-year employee"),
  "research-debate": L("研究者 Alex", "Researcher Alex"),
  "declining-extra-hours": L("团队成员", "Team member"),
  "promotion-passed-over": L("项目主力", "Project lead contributor"),
  "giving-hard-feedback": L("新晋组长", "Newly promoted team lead"),
  "credit-taken": L("方案的真正提出者", "The plan's real author"),
  "interview-weakness": L("候选人", "Candidate"),
  "new-hire-lunch": L("老同事", "Established colleague"),
  "client-angry-delay": L("项目负责人", "Project lead"),
  "teammate-not-pulling-weight": L("小组成员", "Group member"),
  "professor-grade-dispute": L("学生", "Student"),
  "classroom-speak-up": L("研讨课学生", "Seminar student"),
  "delegating-to-senior": L("新任项目负责人", "New project lead"),
  "asking-for-help-overloaded": L("负责三个项目的员工", "Employee juggling three projects"),
  "colleague-microaggression": L("与会同事", "Colleague in the meeting"),
  "parent-career-choice": L("准备辞职创业的子女", "Child about to quit for a startup"),
  "sibling-eldercare": L("住得近的妹妹/弟弟", "The sibling who lives nearby"),
  "teen-phone-rules": L("家长", "Parent"),
  "spouse-chores": L("伴侣", "Partner"),
  "friend-borrowed-money": L("借出钱的朋友", "The friend who lent the money"),
  "friend-going-through-breakup": L("好友", "Close friend"),
  "friend-cancel-plans": L("被放鸽子的朋友", "The friend who got cancelled on"),
  "first-date-silence": L("约会的一方", "One half of the date"),
  "partner-forgot-anniversary": L("伴侣", "Partner"),
  "saying-i-love-you": L("恋人", "Partner"),
  "neighbor-noise": L("楼下住户", "Downstairs resident"),
  "restaurant-wrong-order": L("顾客", "Customer"),
  "networking-event": L("与会者", "Attendee"),
  "birthday-toast": L("寿星最老的朋友", "The birthday girl's oldest friend"),
  "wine-party-disagreement": L("晚宴客人", "Dinner guest"),
  "public-transport-seat": L("乘客", "Passenger"),
  "gratitude-to-mentor": L("学员", "Mentee"),
  "roommate-guest-boundary": L("室友", "Roommate"),
  // love module (romantic)
  "love-approach-cafe": L("想搭话的人", "The one who wants to approach"),
  "love-define-relationship": L("想把关系说清楚的人", "The one asking where this is going"),
  "love-confession-declined": L("表白被拒的人", "The one who confessed and heard no"),
  "love-receive-confession": L("收到表白的人", "The one receiving a confession"),
  "love-breakup-talk": L("决定结束关系的人", "The one ending the relationship"),
  "love-boundary-with-ex": L("和前任划清边界的人", "The one drawing boundaries with an ex"),
  "love-long-distance": L("异地的伴侣", "The long-distance partner"),
  "love-meet-parents": L("第一次见家长的人", "The one meeting the family"),
  "love-uneven-investment": L("付出更多的一方", "The one investing more"),
  "love-trust-repair": L("隐瞒被揭穿的人", "The one whose secret came out"),
  "love-boundary-online-reply": L("想守住下线时间的伴侣", "The partner who logs off at night"),
  // love module deep-dive (2026-10-09)
  "love-ld-routine": L("每晚例行视频的异地伴侣", "The long-distance partner on a nightly call"),
  "love-ld-visit-plan": L("计划异地见面的伴侣", "The partner planning a visit"),
  "love-family-unhappy": L("见家长后得到糟心反馈的一方", "The one who got tough feedback from the family"),
  "love-family-holiday": L("商量春节去谁家的伴侣", "The partner deciding whose family for the holiday"),
  "love-approach-gym": L("在健身房被搭话的人", "The one approached at the gym"),
  "love-approach-followup": L("加了微信还没发消息的人", "The one who added a contact but hasn't messaged"),
  // power & family relations (2026-10-09)
  "jm-feedback-deflected": L("带新人三个月的组长", "Lead coaching a new hire"),
  "jm-misread-request": L("把需求交给下属对接的负责人", "Lead who handed the requirement to a junior"),
  "jm-pushback-task": L("分配月末汇总的负责人", "Lead who assigned the month-end consolidation"),
  "jm-over-commit": L("把客户需求交下属跟进的人", "Lead who delegated a client requirement"),
  "pf-mom-visits": L("独自在外生活的成年子女", "Adult child living on their own"),
  "fm-care-decision": L("在外地工作的子女", "Child working in another city"),
  "fm-share-cost": L("参与分摊手术费的子女", "Child splitting the surgery cost"),
  "fm-brother-loan": L("被弟弟借钱的哥哥", "Older sibling asked for a loan"),
  "ch-missed-promise": L("工作很忙的单亲家长", "Busy single parent"),
};

/** Every corpus scenario gets an explicit, playable "you" character so scheduling, role-play and reports share one id. */
export const YOU_ID = "you";
export function withLearner(s: Scenario): Scenario {
  if (s.characters.some((c) => c.id === YOU_ID)) return s;
  const you: Character = {
    id: YOU_ID,
    name: L("你", "You"),
    role: LEARNER_ROLE[s.id] ?? L("你自己", "Yourself"),
    personality: L("", ""),
    stance: L("", ""),
    playable: true,
    hue: 40,
  };
  return { ...s, characters: [you, ...s.characters] };
}

export const SCENARIOS: Scenario[] = [...SCENARIOS_A, ...SCENARIOS_B, ...SCENARIOS_C, ...SCENARIOS_D, ...SCENARIOS_JUNIOR, ...SCENARIOS_FAMILY, ...LOVE_SCENARIOS].map(withLearner);
export const THEORIES: Theory[] = [...THEORIES_BASE, ...THEORIES_C, ...LOVE_THEORIES];
export const CASES: Case[] = [...CASES_BASE, ...CASES_C, ...LOVE_CASES];
export type { Case, Scenario, Theory };

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
export const theoryById = (id: string) => THEORIES.find((t) => t.id === id);
export const caseById = (id: string) => CASES.find((c) => c.id === id);
