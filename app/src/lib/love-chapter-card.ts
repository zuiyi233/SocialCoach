import type { L } from "@/data/taxonomy";
import type { Scenario } from "@/data/corpus/types";
import { loveSeriesById } from "@/data/corpus/love-series";

/**
 * 章节卡（幕首卡）数据契约（spec-love-interactive-story §4.5）。
 *
 * 幕号与幕标题已在语料里（`series.order` / `scenario.title`）；这里补的是
 * 卡片另外三行的**双语常量**：时间、地点、一句引子。按场景 id 一一对应，
 * 不改 corpus 的六个场景文件；引子只烘气氛，不剧透、不复述列表 hook。
 *
 * 只覆盖恋爱剧情线的场景（`series` 存在且 context=romantic）；语料里新加的
 * 剧情场景若漏写卡片，`loveChapterCardFor` 返回 null（不显示半张卡），
 * `tests/core/love-chapter-card.test.ts` 会把这种遗漏拦下。
 *
 * Source: 作者原创内容（SocialCoach），依据各场景语料的背景与开场白归纳；
 * 见 app/src/data/corpus/love-scenarios*.ts 各场景的 source 字段。
 */

export interface LoveChapterCardData {
  /** 时间：一行的场景内时间（不是现实时间）。 */
  when: L;
  /** 地点：一行的事件发生地。 */
  where: L;
  /** 一句引子：幕首卡的气氛句，不剧透。 */
  hook: L;
}

/** 每条剧情线场景一张卡；键 = scenario.id。 */
export const LOVE_CHAPTER_CARDS: Readonly<Record<string, LoveChapterCardData>> = {
  // ---- love-arc-rio-clarify「暧昧到说清楚」（Rio，第 1–6 幕）----
  "love-approach-soft-decline-reinvite": {
    when: { zh: "被婉拒后的第六天，午后", en: "Day six after the soft no, afternoon" },
    where: { zh: "美术馆附近的咖啡馆", en: "A café near the museum" },
    hook: {
      zh: "「最近有点忙」这五个字，摆在你和下一次邀约之间。",
      en: "“Been busy lately” sits between you and the next invitation.",
    },
  },
  "love-define-rio-pace-talk": {
    when: { zh: "周五傍晚，下班的人潮里", en: "Friday evening, in the after-work crowd" },
    where: { zh: "她公司楼下的长椅", en: "A bench outside her office" },
    hook: {
      zh: "你只问了一句「我们算什么」，她却先谈起了节奏。",
      en: "You asked what you two are; she answered with pace instead.",
    },
  },
  "love-family-expectation-clash": {
    when: { zh: "周末中午，圆桌刚坐下", en: "Weekend noon, just seated at the round table" },
    where: { zh: "两家人约的那家馆子", en: "The restaurant both families picked" },
    hook: {
      zh: "两本「规矩」同时递到你面前，而你们自己的那本还没写。",
      en: "Two rulebooks land on the table; the one you two are writing isn’t finished.",
    },
  },
  "love-rio-secondment-deadline": {
    when: { zh: "意向书下来的当晚", en: "The night the intent form arrived" },
    where: { zh: "你们常去的那家小馆，靠窗的位子", en: "Your usual booth by the window" },
    hook: {
      zh: "邮件在桌上亮了三次，这一次她没有自己收回去。",
      en: "The email lit up three times; this time she didn’t take the phone back.",
    },
  },
  "love-rio-family-settled": {
    when: { zh: "十天答复期限过半", en: "Halfway through the ten days" },
    where: { zh: "她家的家庭群，和一条没回完的消息", en: "The family group chat, one message left hanging" },
    hook: {
      zh: "「按规矩走」这句话，已经有人替你们说出了口。",
      en: "Someone has already said “follow the rules” for you both.",
    },
  },
  "love-rio-deadline-night": {
    when: { zh: "十天期限的最后一晚", en: "The last night of the ten days" },
    where: { zh: "她家的餐桌", en: "Her kitchen table" },
    hook: {
      zh: "今晚必须有一句话带着日期落地，拖着的那句不算数。",
      en: "Tonight one sentence must land with a date on it; “we’ll see” doesn’t count.",
    },
  },

  // ---- love-arc-eve-after-no「被拒之后」（Eve，第 1–3 幕）----
  "love-reject-shared-circle": {
    when: { zh: "婉拒后的第三天，晚上七点", en: "Three days after the gentle no, seven in the evening" },
    where: { zh: "常去那家书店的读书会角", en: "The book-club corner of your usual bookstore" },
    hook: {
      zh: "书还是那些书，只是你们之间多了一句没说完的话。",
      en: "Same books, same shelves — and one unfinished sentence between you.",
    },
  },
  "love-boundary-eve-contact-rhythm": {
    when: { zh: "被拒后的第一个月", en: "The first month after the no" },
    where: { zh: "聊天框里，和读书会的群里", en: "The chat window, and the book-club group" },
    hook: {
      zh: "她说「还是朋友」，然后给「朋友」画了一条线。",
      en: "“Still friends,” she says — then draws a line around the word.",
    },
  },
  "love-trust-eve-what-you-told": {
    when: { zh: "新频率相处满一个月的今晚", en: "Tonight, one month into the new rhythm" },
    where: { zh: "散场后的书店门口", en: "Outside the bookstore, after closing" },
    hook: {
      zh: "她第一次单独叫住你，问的是你替她说的那句话。",
      en: "For the first time she stops you alone — to ask what you said for her.",
    },
  },

  // ---- love-arc-approach「初见与心动」（第 1–3 场，人物不贯穿）----
  "love-approach-hobby-event": {
    when: { zh: "周六下午，活动过半", en: "Saturday afternoon, halfway through the event" },
    where: { zh: "城市公园的摄影活动现场", en: "A photo-walk meetup in the city park" },
    hook: {
      zh: "她在认真调一张照片，你还没想好第一句。",
      en: "She’s absorbed in a photo; you haven’t found your first line.",
    },
  },
  "love-approach-date-followup": {
    when: { zh: "第一次见面后的第七天", en: "Seven days after a good first meeting" },
    where: { zh: "手机上的对话框", en: "The chat window on your phone" },
    hook: {
      zh: "那天聊得很顺，然后一整周没有人先开口。",
      en: "The conversation went well — then a week of nobody going first.",
    },
  },
  "love-define-vague-investment": {
    when: { zh: "第三次约会收尾时", en: "As the third date wraps up" },
    where: { zh: "你们常约的那家面馆", en: "The noodle shop you keep meeting at" },
    hook: {
      zh: "她每次都来，但「下次见」永远轮不到她说。",
      en: "She always shows up; “next time” is never hers to say.",
    },
  },

  // ---- love-arc-long-distance「两座城市，八种异地」（第 1–8 场，人物不贯穿）----
  "love-long-distance": {
    when: { zh: "上午的消息，凌晨才被回", en: "A morning message, answered past midnight" },
    where: { zh: "两座城市之间的聊天框", en: "The chat window between two cities" },
    hook: {
      zh: "「刚下班。先睡了。」——六个小时的时差，隔着一块屏幕。",
      en: "“Just got off. Sleeping.” — hours apart, one screen between.",
    },
  },
  "love-ld-milestone-remote": {
    when: { zh: "纪念日当天晚上", en: "Anniversary night" },
    where: { zh: "两地的视频通话里", en: "A video call across two cities" },
    hook: {
      zh: "蛋糕各点了一份，祝福却总差半拍。",
      en: "Two cakes, one toast — always half a beat off.",
    },
  },
  "love-ld-routine": {
    when: { zh: "异地第三年的一个普通夜晚", en: "An ordinary night in year three" },
    where: { zh: "每晚九点的视频通话", en: "The nine-o’clock video call" },
    hook: {
      zh: "「吃了没」「忙吗」之后，又轮到沉默接棒。",
      en: "After “eaten yet?” and “busy?”, silence takes its turn.",
    },
  },
  "love-ld-low-mood-remote": {
    when: { zh: "她面试被拒的第二天", en: "The day after her interview fell through" },
    where: { zh: "屏幕两端", en: "Two ends of a screen" },
    hook: {
      zh: "她红着眼眶说「没事」，这句话要不要接住，看你。",
      en: "She says “I’m fine” with red eyes; the words are yours to catch or drop.",
    },
  },
  "love-ld-social-media-rumor": {
    when: { zh: "那张合照发出去的当晚", en: "The night that photo went up" },
    where: { zh: "晚上的视频通话", en: "The evening video call" },
    hook: {
      zh: "一张合照，一串问号，和一个只能由你回答的夜晚。",
      en: "One photo, a string of questions, and a night only you can answer for.",
    },
  },
  "love-ld-visit-plan": {
    when: { zh: "假期计划提上日程的那晚", en: "The night the holiday plan comes up" },
    where: { zh: "各自的日历前", en: "In front of two separate calendars" },
    hook: {
      zh: "假期只有五天，你们想要的日期差了两天。",
      en: "Five days of holiday; two days between the dates you each want.",
    },
  },
  "love-ld-visit-plan-hard": {
    when: { zh: "第三次改签的车票前", en: "Before the third rebooked ticket" },
    where: { zh: "电话里", en: "On the phone" },
    hook: {
      zh: "「你说了算」一出口，空气就冻住了。",
      en: "“You decide” lands, and the line goes cold.",
    },
  },
  "love-ld-fight-over-phone": {
    when: { zh: "挂断后的第十分钟", en: "Ten minutes after the hang-up" },
    where: { zh: "一通没打完的电话", en: "A phone call that never finished" },
    hook: {
      zh: "忙音响着，你在心里改写最后一句话。",
      en: "The busy tone hums; you’re rewriting the last thing you said.",
    },
  },

  // ---- love-trust-boundary「信任与边界」（第 1–3 场，人物不贯穿）----
  "partner-location-pressure": {
    when: { zh: "晚上十一点半，刚进门", en: "Eleven-thirty at night, just home" },
    where: { zh: "晚归进门后的玄关", en: "The doorway, right after you get in" },
    hook: {
      zh: "「把定位打开」——这句话在等你接。",
      en: "“Turn on your location” — the sentence is waiting for you.",
    },
  },
  "love-trust-repair": {
    when: { zh: "转账记录被看到的那天深夜", en: "Late the night the transfer was found" },
    where: { zh: "客厅的沙发上", en: "The living-room sofa" },
    hook: {
      zh: "他没吵也没走，只是把手机递到了你面前。",
      en: "No shouting, no leaving — he just holds the phone out to you.",
    },
  },
  "love-boundary-online-reply": {
    when: { zh: "又一次「消失」之后的深夜", en: "Late, after another vanishing act" },
    where: { zh: "聊天框里", en: "The chat window" },
    hook: {
      zh: "她还在等，等的不是回复，是一句解释。",
      en: "She’s still up — not waiting for the reply, for the explanation.",
    },
  },
};

/** 一张展开后的幕首卡：幕号、标题与三行常量。 */
export interface LoveChapterCard {
  /** 幕号（1 起）；`series.order` 优先，缺省按线内顺序。 */
  act: number;
  /** 同一人物贯穿的线称「幕」，否则称「场」（与系列页口径一致）。 */
  continuous: boolean;
  seriesName: L;
  title: L;
  data: LoveChapterCardData;
}

/**
 * 场景 → 幕首卡。非恋爱系列（如职场/家庭线）、无 `series` 的场景、
 * 或没写卡的场景一律返回 null——绝不显示半张卡。
 */
export function loveChapterCardFor(scenario: Scenario): LoveChapterCard | null {
  if (!scenario.series || scenario.context !== "romantic") return null;
  const data = LOVE_CHAPTER_CARDS[scenario.id];
  if (!data) return null;
  const series = loveSeriesById(scenario.series.id);
  let act = scenario.series.order && scenario.series.order >= 1 ? scenario.series.order : 0;
  if (!act) {
    const index = series?.scenarios.findIndex((s) => s.id === scenario.id) ?? -1;
    act = index >= 0 ? index + 1 : 1;
  }
  return {
    act,
    continuous: series?.continuous ?? true,
    seriesName: scenario.series.name,
    title: scenario.title,
    data,
  };
}

/**
 * 限时选择只在**高潮幕**启用（spec §4.5 / 拍板 Q6：默认关闭、只用于高潮、
 * 超时按沉默处理）。当前的高潮幕 = Rio 第 6 幕「期限的最后一晚」；
 * 场景级常量标记，后续加高潮幕在这里登记即可。
 */
export const LOVE_TIMED_CHOICE_SCENES: ReadonlySet<string> = new Set(["love-rio-deadline-night"]);
