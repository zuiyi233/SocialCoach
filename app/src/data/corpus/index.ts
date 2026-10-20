import { SCENARIOS_A } from "./scenarios-a";
import { SCENARIOS_B } from "./scenarios-b";
import { THEORIES as THEORIES_BASE } from "./theories";
import { THEORIES_C } from "./theories-c";
import { SCENARIOS_C } from "./scenarios-c";
import { SCENARIOS_D } from "./scenarios-d";
import { SCENARIOS_WF } from "./scenarios-wf";
import { SCENARIOS_FRIENDSHIP } from "./scenarios-friendship";
import { SCENARIOS_JUNIOR } from "./scenarios-junior";
import { SCENARIOS_FAMILY } from "./scenarios-family";
import { CASES_C } from "./cases-c";
import { CASES as CASES_BASE } from "./cases";
import { LOVE_SCENARIOS } from "./love-scenarios";
import { LOVE_SCENARIOS_DEEP_APPROACH } from "./love-scenarios-deep-approach";
import { LOVE_SCENARIOS_DEEP_DEFINE } from "./love-scenarios-deep-define";
import { LOVE_SCENARIOS_DEEP_REJECTION } from "./love-scenarios-deep-rejection";
import { LOVE_SCENARIOS_DEEP_BREAKUP } from "./love-scenarios-deep-breakup";
import { LOVE_SCENARIOS_DEEP_BOUNDARY } from "./love-scenarios-deep-boundary";
import { LOVE_SCENARIOS_DEEP_TRUST } from "./love-scenarios-deep-trust";
import { LOVE_SCENARIOS_DEEP_LONG_DISTANCE } from "./love-scenarios-deep-long-distance";
import { LOVE_SCENARIOS_DEEP_FAMILY } from "./love-scenarios-deep-family";
import { LOVE_SCENARIOS_DEEP_RIO_ROUTE } from "./love-scenarios-deep-rio-route";
import { LOVE_THEORIES } from "./love-theories";
import { LOVE_CASES } from "./love-cases";
import { THEORIES_DEEP_FAMILY } from "./love-theories-deep-family";
import { THEORIES_DEEP_BREAKUP_TRUST } from "./love-theories-deep-breakup-trust";
import { THEORIES_DEEP_BOUNDARY } from "./love-theories-deep-boundary";
import { THEORIES_DEEP_APPROACH } from "./love-theories-deep-approach";
import { THEORIES_DEEP_REJECTION } from "./love-theories-deep-rejection";
import { THEORIES_DEEP_LONG_DISTANCE } from "./love-theories-deep-long-distance";
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
  // love module deep-dive scenarios (2026-10-09, practical 场景化批次)
  "love-approach-hobby-event": L("摄影活动里的人", "Photo-walk participant"),
  "love-approach-date-followup": L("约第二次见面的人", "The one asking for a second date"),
  "love-approach-soft-decline-reinvite": L("被婉拒后二次邀约的人", "The one re-inviting after a soft no"),
  "love-approach-received-interest": L("被表达兴趣的人", "The one receiving the approach"),
  "love-approach-unclear-body-language": L("第一次约会的另一方", "One half of the first date"),
  "love-define-vague-investment": L("主动邀约的一方", "The one who keeps inviting"),
  "love-define-online-only": L("想让关系落地的人", "The one who wants things offline"),
  "love-define-cooling-after-progress": L("忽冷忽热里的另一方", "The one in the hot-cold loop"),
  "love-define-one-sided-benefits": L("付出更多的一方", "The one giving more"),
  "love-define-wants-slow": L("还没准备好定下的人", "The one not ready to commit"),
  "love-define-rio-pace-talk": L("想要一个明确答案的人", "The one who wants an answer"),
  "love-reject-age-marriage-probe": L("饭局上被追问的人", "The one probed across the table"),
  "love-reject-persistent-close": L("明确拒绝过的人", "The one who already said no"),
  "love-reject-hold-the-no": L("拒绝过一次的人", "The one who declined once"),
  "love-reject-shared-circle": L("表白被婉拒的人", "The one whose confession was declined"),
  "love-breakup-early-stop": L("想清楚不继续的人", "The one who decided to stop"),
  "love-breakup-cancel-repeatedly": L("反复被失约的人", "The one being cancelled on"),
  "love-breakup-last-minute-cancel": L("约定被取消的人", "The one whose plan was cancelled"),
  "love-breakup-solemn-no-theater": L("决定分手的人", "The one ending the relationship"),
  "love-breakup-receive-decision": L("被提分手的人", "The one receiving the breakup"),
  "love-boundary-haha-reply": L("被敷衍的一方", "The one being shrugged off"),
  "love-boundary-interrogation-chat": L("被连环追问的人", "The one being interrogated"),
  "love-boundary-fight-escalation": L("被情绪指责的人", "The one on the receiving end of blame"),
  "love-boundary-privacy-slip": L("说漏嘴的人", "The one who slipped"),
  "love-boundary-belittling-jokes": L("被贬损玩笑的人", "The one targeted by belittling jokes"),
  "love-boundary-eve-contact-rhythm": L("被婉拒后还在每天联系的人", "The one still messaging daily after being declined"),
  "love-trust-small-broken-promise": L("失约的人", "The one who broke a small promise"),
  "love-trust-ld-actions-not-replies": L("用消息速度度量爱的伴侣", "The partner measuring love by reply speed"),
  "love-trust-overtime-neglect": L("加班的人", "The one working overtime"),
  "love-trust-after-concealment": L("被隐瞒的一方", "The one who was kept in the dark"),
  "love-trust-eve-what-you-told": L("替她把话说给别人听的人", "The one who explained her to others"),
  "love-ld-milestone-remote": L("异地过纪念日的人", "The one celebrating remotely"),
  "love-ld-low-mood-remote": L("异地陪伴低谷的人", "The one supporting from afar"),
  "love-ld-social-media-rumor": L("被异地质疑的一方", "The one questioned from afar"),
  "love-ld-fight-over-phone": L("电话吵架的一方", "One half of the phone fight"),
  "love-ld-visit-plan-hard": L("见面一再推迟的一方", "The one whose visit keeps slipping"),
  "love-family-old-grievances": L("圆场的人", "The one smoothing the table"),
  "love-family-marriage-pressure": L("被催婚伴侣的另一半", "The partner of someone under marriage pressure"),
  "love-family-expectation-clash": L("夹在两家人之间的人", "The one caught between two families"),
  "love-family-decision-pressure": L("被家长拍板的人", "The one whose family decided for them"),
  "love-rio-secondment-deadline": L("面对外派期限的人", "The one facing the secondment deadline"),
  "love-rio-family-settled": L("被家里催着「按规矩走」的人", "The one pressed by the family's 'do it properly'"),
  "love-rio-deadline-night": L("在期限最后一晚把话说清楚的人", "The one saying it plainly on the deadline night"),
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
  // practical 分桶场景化批次（2026-10-10，职场 6 + 通用/friendship 12）
  "verbal-scope-rewrite": L("口头分工被说成自己范围的人", "The one whose verbal split became their scope"),
  "team-dinner-entry": L("加入团队三周的新人", "The three-week newcomer at the table"),
  "long-term-extra-role": L("被要求兼任评审负责的成员", "The member offered the extra review role"),
  "presentation-data-challenge": L("汇报到一半被质疑数据的人", "The presenter whose data is challenged"),
  "proposal-rebutted-live": L("方案当场被反驳的提案人", "The proposer rebutted in the room"),
  "cross-team-favor-ask": L("跨组开口求人的人", "The one asking another team for a favour"),
  "friend-offhand-opinion": L("下周入学、被随口否定的人", "The one about to enrol, told it's pointless"),
  "skeptic-activity-invite": L("被付定金留了名额的人", "The one a deposit was paid for"),
  "praise-that-won-land": L("想认真夸一句的朋友", "The friend trying to praise properly"),
  "elder-thanks-lands": L("上门道谢的晚辈", "The younger person there to thank her"),
  "dinner-table-goes-cold": L("被要求当众站队的同桌朋友", "The tablemate asked to pick a side"),
  "rambling-trip-story": L("把提醒讲成流水账的朋友", "The friend losing their own story"),
  "three-minute-conclusion": L("被催三分钟内给结论的人", "The one with three minutes to answer"),
  "first-message-after-event": L("刚加上对方微信的人", "The one who just got the contact"),
  "reconnect-after-silence": L("两年没联系后重新开口的人", "The one returning after two years"),
  "newcomer-unclaimed": L("搬来三个月、没人约的新人", "The newcomer three months in the city"),
  "rumor-clarify-no-blame": L("话被加工过的人", "The one whose words got reworked"),
  "pattern-not-one-meal": L("半年被落下三次的人", "The one left out three times in six months"),
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

export const SCENARIOS: Scenario[] = [...SCENARIOS_A, ...SCENARIOS_B, ...SCENARIOS_C, ...SCENARIOS_D, ...SCENARIOS_WF, ...SCENARIOS_FRIENDSHIP, ...SCENARIOS_JUNIOR, ...SCENARIOS_FAMILY, ...LOVE_SCENARIOS, ...LOVE_SCENARIOS_DEEP_APPROACH, ...LOVE_SCENARIOS_DEEP_DEFINE, ...LOVE_SCENARIOS_DEEP_REJECTION, ...LOVE_SCENARIOS_DEEP_BREAKUP, ...LOVE_SCENARIOS_DEEP_BOUNDARY, ...LOVE_SCENARIOS_DEEP_TRUST, ...LOVE_SCENARIOS_DEEP_LONG_DISTANCE, ...LOVE_SCENARIOS_DEEP_FAMILY, ...LOVE_SCENARIOS_DEEP_RIO_ROUTE].map(withLearner);
export const THEORIES: Theory[] = [...THEORIES_BASE, ...THEORIES_C, ...LOVE_THEORIES, ...THEORIES_DEEP_FAMILY, ...THEORIES_DEEP_BREAKUP_TRUST, ...THEORIES_DEEP_BOUNDARY, ...THEORIES_DEEP_APPROACH, ...THEORIES_DEEP_REJECTION, ...THEORIES_DEEP_LONG_DISTANCE];
export const CASES: Case[] = [...CASES_BASE, ...CASES_C, ...LOVE_CASES];
export type { Case, Scenario, Theory };

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
export const theoryById = (id: string) => THEORIES.find((t) => t.id === id);
export const caseById = (id: string) => CASES.find((c) => c.id === id);
