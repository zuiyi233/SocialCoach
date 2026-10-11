import { L } from "../taxonomy";
import type { ContextId } from "../taxonomy";

/**
 * /learn 「参考说法」——从 `恋爱军师-skill/goutoujunshi-main/extraction-map/practical-map.md`
 * 提取的话术条目（各篇「可提取素材清单 → 话术」小节，剔除了 00-导读元文档自带的 8 条，
 * 该元文档「本身不产独立语料条目」，引入后恰为映射表汇总的约 126 条）。
 * 全部为社区口传 / mindmap 话术手册，无学术出处：仅供展示层参考，不进入理论 / 案例语料。
 */
export interface Phrase {
  id: string;
  /** 中文原话术（对学习者轻度改写）+ 英文地道意译。 */
  text: L;
  /** 使用场景：现有 ContextId 或 "general"。 */
  scene: ContextId | "general";
  /** 溯源：来源技能包 + 原篇名 + 提取日期。 */
  source: string;
}

const from = (guide: string) =>
  `Goutoujunshi skill (community practice) — ${guide}, extracted 2026-10-12`;

export const PHRASES: Phrase[] = [
  // ── 万能吵架技巧：理性冲突处理指南 ─────────────────────────────
  {
    id: "ph-companion-complaint",
    text: L("我知道你想让我多陪你，最近我加班多了点。周末定个只属于我们俩的时间，不看手机，只陪你。", "I know you want more of my company, and I have been working late a lot. Let's set aside a weekend slot that's just ours — no phones, only you."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-family-old-grievances",
    text: L("上次没帮上忙，你心里肯定不舒服，我记着呢。这次咱们一起分工。", "I know it stung that I couldn't help last time — I have kept it in mind. This time we divide it together."),
    scene: "family",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-i-statement-phone",
    text: L("我下班想跟你聊聊天，看到你一直玩手机，会觉得有点孤单。", "I come home wanting to talk, and when you're on your phone the whole time, I start to feel a little alone."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-empathy-in-conflict",
    text: L("我知道你最近工作压力大，肯定很辛苦。我不是不理解，只是刚才没表达清楚。", "I know work's been stressful and this has worn you down — I do get it, I just didn't say it well a moment ago."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-resist-emotional-hook",
    text: L("你现在很生气，是不是觉得我没考虑你的想法？我们可以说说各自的打算。", "You're angry right now — do you feel I didn't consider your side? Let's each say what we're hoping for."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-refuse-false-choice",
    text: L("我们不用非要选一边。看看有没有既能照顾到你的想法、也能解决我顾虑的办法。", "It doesn't have to be one or the other. Let's see if there's a way that honors what you need and also handles my concern."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-conflict-pause",
    text: L("我们现在说话都有点火气，先冷静二十分钟，等会儿再好好说。", "We're both getting heated. Let's take twenty minutes to cool down, then talk it through properly."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-repair-overstatement",
    text: L("刚才我不该说「你从不关心我」，其实是我今天有点委屈，抱歉。", "I shouldn't have said 'you never care about me.' The truth is I felt hurt today — I'm sorry."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-focus-on-solution",
    text: L("我们别争谁对谁错了，先说说接下来怎么做才能把问题解决。", "Let's stop arguing about who's right and talk about what we'll actually do to fix it."),
    scene: "romantic",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },
  {
    id: "ph-no-fault-progress",
    text: L("现在纠结是谁的问题会耽误进度，咱们先核对一下对接记录。", "Figuring out whose fault it is will only slow us down — let's start by checking the handover records."),
    scene: "workplace",
    source: from("万能吵架技巧：理性冲突处理指南"),
  },

  // ── 万能夸人的话术技巧：真诚认可的实用指南 ─────────────────────
  {
    id: "ph-praise-detail",
    text: L("你帮我整理的会议纪要，连每个议题的负责人和时间节点都标得清清楚楚，太细心了。", "The meeting notes you organized for me even flag every topic's owner and deadline — so thorough of you."),
    scene: "workplace",
    source: from("万能夸人的话术技巧：真诚认可的实用指南"),
  },
  {
    id: "ph-praise-effort-and-result",
    text: L("我知道你为了这个方案熬了两晚、改了三版，既专业又有耐心。", "I know this proposal cost you two late nights and three rewrites — professional and patient in equal measure."),
    scene: "workplace",
    source: from("万能夸人的话术技巧：真诚认可的实用指南"),
  },
  {
    id: "ph-praise-noticed-memory",
    text: L("你记得我不爱吃香菜，每次做饭都特意分开放，太用心了。", "You remembered I don't eat cilantro and keep it separate every time you cook — that's so thoughtful."),
    scene: "romantic",
    source: from("万能夸人的话术技巧：真诚认可的实用指南"),
  },
  {
    id: "ph-praise-elder",
    text: L("您教我的做菜技巧，家里人都说好吃，多亏了您。", "The cooking tricks you taught me — the whole family says everything tastes better. All thanks to you."),
    scene: "family",
    source: from("万能夸人的话术技巧：真诚认可的实用指南"),
  },
  {
    id: "ph-praise-via-others",
    text: L("上次跟小X聊天，他说你帮他解决了难题，一直在夸你特别靠谱。", "When I talked to X the other day, they said you solved a real problem for them and kept praising how reliable you are."),
    scene: "friendship",
    source: from("万能夸人的话术技巧：真诚认可的实用指南"),
  },
  {
    id: "ph-praise-objective-fact",
    text: L("你办的活动参与人数比上次多了三成，背后肯定花了不少心思。", "Your event drew thirty percent more people than last time — that clearly took real effort behind the scenes."),
    scene: "general",
    source: from("万能夸人的话术技巧：真诚认可的实用指南"),
  },

  // ── 为他人提供情绪价值：温暖且有效的回应指南 ──────────────────
  {
    id: "ph-confirm-feeling",
    text: L("项目搞砸了，你现在肯定特别沮丧，还会有点自责，对么？", "The project fell through — you must feel pretty crushed, maybe even a little down on yourself. Right?"),
    scene: "general",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-invite-expression",
    text: L("跟朋友吵架肯定特别难受。你想说说是因为什么吗？", "Fighting with a friend really hurts. Do you want to talk about what started it?"),
    scene: "general",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-validating-achievement",
    text: L("第一次做蛋糕就没糊，也太厉害了。肯定查了不少教程，还特别细心。", "Your very first cake didn't even burn — impressive. You must have read a ton of guides and paid attention."),
    scene: "friendship",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-small-memory-care",
    text: L("看到这个低糖奶茶，想起你之前说想喝又怕胖，分享给你。", "Saw this low-sugar milk tea and remembered you said you wanted one but were watching your weight — thought of you."),
    scene: "romantic",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-timely-honest-reply",
    text: L("我现在有点忙，等会儿跟你细聊。", "I'm a bit caught up right now — let me give this a real reply in a bit."),
    scene: "general",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-proactive-check-in",
    text: L("今天面试怎么样呀？有没有遇到特别难的问题？", "How did the interview go today? Any questions that really threw you?"),
    scene: "general",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-break-down-anxiety",
    text: L("你怕的是知识没掌握，还是考试时紧张发挥不好？", "Is the worry about not knowing the material, or freezing up on the day?"),
    scene: "general",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-boundary-from-venting",
    text: L("我理解你的委屈，但一直聊负面的事可能会更难受。咱们想想办法？", "I get why you feel wronged, but staying on the painful loop might make it worse. Want to think it through together?"),
    scene: "general",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },
  {
    id: "ph-validate-not-dismiss",
    text: L("被领导批评肯定特别难受，我之前也经历过。", "Getting called out by your boss really stings — I've been there too."),
    scene: "general",
    source: from("为他人提供情绪价值：温暖且有效的回应指南"),
  },

  // ── 主动表达、第一次见面与自然接触 ────────────────────────────
  {
    id: "ph-approach-high-praise",
    text: L("说实话，你是我见过最特别的人。不是客套，而是你[具体行为/表达]的时候，真的会发光。", "Honestly, you're the most remarkable person I've met. Not a line — it's how you light up when you [specific behavior or way of expressing yourself]."),
    scene: "romantic",
    source: from("主动表达、第一次见面与自然接触"),
  },
  {
    id: "ph-meetup-closing",
    text: L("本来以为今天就是普通见个面，结果你比聊天里更有意思。那之后我还能约你出来吗？", "I came thinking this was just a casual meet, but you're even more interesting in person than in our chats. Could I ask you out again sometime?"),
    scene: "romantic",
    source: from("主动表达、第一次见面与自然接触"),
  },
  {
    id: "ph-direct-affection",
    text: L("我喜欢和你相处，我确实对你有好感。", "I enjoy being around you — I genuinely have feelings for you."),
    scene: "romantic",
    source: from("主动表达、第一次见面与自然接触"),
  },
  {
    id: "ph-reinvite-after-vague",
    text: L("上次时间没对上。下周三晚我准备去[更合你口味的活动]，你想一起吗？", "Last time our schedules didn't line up. Next Wednesday night I'm going to [an activity more to your taste] — want to come along?"),
    scene: "romantic",
    source: from("主动表达、第一次见面与自然接触"),
  },

  // ── 公开表达案例的伦理转译 ────────────────────────────────────
  {
    id: "ph-interest-framing",
    text: L("真实意图 → 一句具体的事实或欣赏 → 轻微的意象或幽默 → 一个可以退出的邀请。", "Say what you actually want → one concrete observation or compliment → a light touch of imagery or humor → an invitation they can freely decline."),
    scene: "romantic",
    source: from("公开表达案例的伦理转译"),
  },
  {
    id: "ph-interest-example",
    text: L("刚才你认真讲那件事的时候挺吸引我的。周末要不要一起喝杯咖啡？不方便也没关系。", "The way you got into that just now was really attractive. Want to grab coffee this weekend? No pressure if it doesn't work."),
    scene: "romantic",
    source: from("公开表达案例的伦理转译"),
  },

  // ── 关系投入失衡：互惠判断、降级投入与退出决策 ─────────────────
  {
    id: "ph-return-initiative",
    text: L("这几次都是我在安排。接下来你有明确想见的时间再告诉我，我先按自己的节奏生活。", "I've been the one making these plans. Tell me when you actually want to meet, and I'll go back to living at my own pace."),
    scene: "romantic",
    source: from("关系投入失衡：互惠判断、降级投入与退出决策"),
  },
  {
    id: "ph-scale-down-investment",
    text: L("我发现现在的互动方式让我消耗很大。我会减少联系和额外投入，这不是惩罚你，是照顾好我自己。", "I've realized this way of interacting drains me. I'm going to dial back the contact and extra effort — not as punishment, but to take care of myself."),
    scene: "romantic",
    source: from("关系投入失衡：互惠判断、降级投入与退出决策"),
  },
  {
    id: "ph-clarify-expectations",
    text: L("我很享受和你相处，也发现最近大多是我在发起。我想确认一下：你还想继续了解彼此吗？", "I really enjoy you, but I've noticed I'm usually the one reaching out. I want to check in: do you still want to keep getting to know each other?"),
    scene: "romantic",
    source: from("关系投入失衡：互惠判断、降级投入与退出决策"),
  },
  {
    id: "ph-end-relationship",
    text: L("我需要的是双方都愿意投入和回应的关系。现在这段关系达不到这个条件，所以我决定停在这里。", "I need a relationship where both of us invest and respond. This one doesn't meet that condition, so I've decided to stop here."),
    scene: "romantic",
    source: from("关系投入失衡：互惠判断、降级投入与退出决策"),
  },
  {
    id: "ph-boundary-practical-contact",
    text: L("私人关系到这儿就好。之后只沟通项目、课程或孩子安排，尽量用文字确认。", "The personal part ends here. From now on, let's only discuss the project, the course, or the kids' logistics, and prefer written confirmation."),
    scene: "romantic",
    source: from("关系投入失衡：互惠判断、降级投入与退出决策"),
  },

  // ── 化解尴尬：轻松救场的实用指南 ──────────────────────────────
  {
    id: "ph-save-wrong-name",
    text: L("哎呀，我这脑子今天肯定没睡醒。李姐您别介意，主要是您和王姐都太有气质了。", "Ah, my brain clearly hasn't woken up yet. Sorry, Sister Li — it's just that you and Sister Wang both have such presence."),
    scene: "party",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-stale-gossip",
    text: L("好家伙，我这消息也太滞后了，看来得让你多给我补补娱乐圈的知识点。", "Wow, my news feed is way out of date — I clearly need you to catch me up on what's going on in entertainment."),
    scene: "party",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-dead-air",
    text: L("说到加班，我上次加班到半夜点的外卖巨好吃。你们加班都爱点什么呀？", "Speaking of overtime — the food I ordered the last time I was late was amazing. What do you all order when you're stuck late?"),
    scene: "party",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-action-rescue",
    text: L("喝口水，刚聊得太投入了。", "Have some water — we were just so into the conversation."),
    scene: "party",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-forgot-lines",
    text: L("我上次做汇报也忘词了，脑子一下空白。你慢慢来，我们都听着呢。", "I blanked mid-presentation once too — my mind just went white. Take your time, we're listening."),
    scene: "workplace",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-spilled-soup",
    text: L("这汤肯定是太想让我尝尝，自己跑出来了！我赶紧擦。", "This soup clearly really wanted me to taste it, so it made a run for it! Let me wipe it up."),
    scene: "party",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-opinion-clash",
    text: L("每个人喜好不一样。你觉得好看，肯定有你觉得好看的点，比如演员演技特别好吧？", "Everyone has different tastes. If you liked it, there must be something — maybe the acting was really strong?"),
    scene: "party",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-salary-probe",
    text: L("说到工资，我都好久没算过具体数了。你们平时会不会记账呀？", "Salary? I haven't actually counted mine in ages. Do you usually track your spending?"),
    scene: "general",
    source: from("化解尴尬：轻松救场的实用指南"),
  },
  {
    id: "ph-save-newcomer",
    text: L("你们聊的这些事也太有意思了。我刚来还不熟悉，能不能给我讲讲？", "Everything you're talking about sounds so interesting. I'm new here and out of the loop — could you catch me up?"),
    scene: "workplace",
    source: from("化解尴尬：轻松救场的实用指南"),
  },

  // ── 场景感、松弛感与社交校准：从接话到关系推进 ────────────────
  {
    id: "ph-live-material",
    text: L("这家店的歌单比我想的复古，刚那首我差点跟着唱。你是为菜来的，还是为氛围来的？", "This place's playlist is more retro than I expected — I almost sang along to that last one. Did you come for the food or the vibe?"),
    scene: "romantic",
    source: from("场景感、松弛感与社交校准：从接话到关系推进"),
  },
  {
    id: "ph-catch-and-toss",
    text: L("听起来你今天已经被工作榨干了。先给你五分钟吐槽资格：最离谱的是哪一件？", "Sounds like work drained you dry today. You get five minutes of ranting credit: which thing was the worst?"),
    scene: "romantic",
    source: from("场景感、松弛感与社交校准：从接话到关系推进"),
  },
  {
    id: "ph-tired-three-tier",
    text: L("你想吐槽一会儿，还是先安静吃点东西？", "Do you want to vent a bit, or eat something in peace first?"),
    scene: "romantic",
    source: from("场景感、松弛感与社交校准：从接话到关系推进"),
  },
  {
    id: "ph-light-flirting-boundaries",
    text: L("用当下的小事、共同回忆、可爱的习惯或夸张的比喻来调情，不拿身材、收入、创伤、家庭或性经历取乐。", "Flirt with what's right here — small moments, shared memories, endearing habits, playful exaggeration. Never make a joke of body, income, trauma, family, or sexual history."),
    scene: "romantic",
    source: from("场景感、松弛感与社交校准：从接话到关系推进"),
  },

  // ── 实战话术编排器：从一句回复到后续分支 ──────────────────────
  {
    id: "ph-new-contact-stable",
    text: L("刚才聊到你说的[具体细节]，我回来还觉得挺有意思。你是怎么开始喜欢它的？", "That [specific detail] you mentioned — I keep thinking about it. How did you first get into it?"),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-new-contact-flirty",
    text: L("今天最意外的收获不是[活动]，而是遇到一个讲[话题]时眼睛会亮的人。", "The best unexpected part of today wasn't [the event] — it was meeting someone whose eyes light up over [the topic]."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-tired-flirty",
    text: L("今天这个世界对你不太客气。给你两个选项：吐槽五分钟，或先欠着我一份好心情。", "The world hasn't been kind today. Two options: five minutes of venting, or I lend you some good mood on credit."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-haha-firm",
    text: L("行，这话题先收着。等你有想聊的再来。", "Alright, let's shelve this. Come back when you actually want to talk."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-sudden-message-flirty",
    text: L("本来有个很正经的理由，想了想还是「有点想找你」比较真。", "I had a perfectly proper reason, but on reflection 'I just wanted to talk to you' is truer."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-chat-to-invite-stable",
    text: L("你刚说的[兴趣]让我想到一家[具体的店]。这周六下午要不要一起去看看？", "What you said about [interest] made me think of [a specific place]. Want to go check it out together Saturday afternoon?"),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-soft-decline-firm",
    text: L("可以。我就不反复问了，你想见面的时候给我一个具体时间。", "Sure. I'll stop asking — give me a concrete time when you want to meet."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-cancel-flirty",
    text: L("这次先记在你的补约账本上，等你带上新时间来销账。", "I'll log this one in your rain-check book. Settle it when you bring a new date."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-miss-you-direct",
    text: L("有点想你。不是要你马上做什么，就是想让你知道。", "I miss you a little. Not asking for anything — just letting you know."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-smooth-talker-stable",
    text: L("不会。我是因为你刚说的[具体内容]，才想这么回你。", "I don't. It's because of that [specific thing] you just said that I wanted to answer this way."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-joke-to-flirt",
    text: L("我喜欢我们现在这个聊天的感觉，有来有回，也有一点暧昧。", "I like how we talk — the back and forth, and a hint of something more."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-define-relationship-firm",
    text: L("我想要的是双方都愿意投入的关系。你如果只想保持现状，也可以直接告诉我。", "What I want is a relationship both of us are willing to invest in. If you'd rather keep things as they are, just tell me."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },
  {
    id: "ph-vent-boundary",
    text: L("我不会继续只做随叫随到的倾听和帮忙对象。", "I'm not going to keep being someone who's only on call to listen and help."),
    scene: "romantic",
    source: from("实战话术编排器：从一句回复到后续分支"),
  },

  // ── 巧妙接话技巧：让沟通更流畅的实用指南 ──────────────────────
  {
    id: "ph-follow-mood-first",
    text: L("跟同事闹矛盾肯定特别窝火，是不是因为工作分工的事？", "Getting into it with a colleague is so frustrating — was it about how the work's split up?"),
    scene: "workplace",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-keyword-extend",
    text: L("悬疑剧最容易让人上头了！是讲破案的还是密室那种？我最近正想找新剧呢。", "Thrillers are the easiest to get hooked on! Is it a detective case or a locked-room type? I've been looking for a new show."),
    scene: "general",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-fill-details",
    text: L("是哪家餐厅呀？主打川菜还是日料？", "Which restaurant was that? Mostly Sichuan or Japanese?"),
    scene: "general",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-caught-lost",
    text: L("哎，你刚说的那个我还没反应过来，再跟我说说呗？", "Wait, I didn't catch what you just said — could you tell me again?"),
    scene: "general",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-save-misstatement",
    text: L("其实你想说的是这个意思吧？我上次跟人聊天也差点说错。", "You actually meant this, right? I almost slipped the same way last time I was chatting."),
    scene: "general",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-save-forgot-word",
    text: L("没事，我经常说着话就忘，脑子跟短路似的。", "No worries — I blank out mid-sentence all the time, like my brain just shorts."),
    scene: "general",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-soft-disagreement",
    text: L("每个人喜欢的风格不一样。你觉得不好看，是因为剧情太拖沓，还是角色没代入感？", "Everyone's taste is different. What didn't work for you — the slow pacing or the characters you couldn't buy into?"),
    scene: "general",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-travel-story-refill",
    text: L("刚才聊到旅游，我忽然想起我上次去XX差点找不到住的地方……", "Speaking of travel, that reminds me of the time I almost couldn't find a place to stay in XX."),
    scene: "general",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },
  {
    id: "ph-stranger-first-open",
    text: L("我也是第一次来，刚才还在想怎么开口。你是朋友推荐来的，还是自己看到的？", "This is my first time here too — I was just wondering how to start talking to people. Did a friend tell you about this, or did you find it yourself?"),
    scene: "party",
    source: from("巧妙接话技巧：让沟通更流畅的实用指南"),
  },

  // ── 废话文学回复指南：轻松应对各类场景 ────────────────────────
  {
    id: "ph-repetition-reply",
    text: L("这电影嘛，就是好看的电影那个感觉，不好看也不会有人看嘛。", "The movie? It's got that good-movie feeling — if it weren't good, no one would watch, right?"),
    scene: "general",
    source: from("废话文学回复指南：轻松应对各类场景"),
  },
  {
    id: "ph-vague-reply",
    text: L("下周啊，大概能去，也说不定有事去不了，到时候看情况再说吧。", "Next week? Probably, though something might come up — let me see how it goes."),
    scene: "general",
    source: from("废话文学回复指南：轻松应对各类场景"),
  },
  {
    id: "ph-deflect-reply",
    text: L("你问我工资啊，我还想问你呢，你们行业现在薪资怎么样？", "You're asking me about salary? I was going to ask you — what are pay levels like in your field these days?"),
    scene: "general",
    source: from("废话文学回复指南：轻松应对各类场景"),
  },
  {
    id: "ph-loop-reply",
    text: L("要我说啊，下一步先看看现在的进展，等进展清楚了，就知道下一步该怎么做了。", "Honestly, the next step is to review where we are now — once that's clear, you'll know what comes after."),
    scene: "general",
    source: from("废话文学回复指南：轻松应对各类场景"),
  },
  {
    id: "ph-age-marriage-reply",
    text: L("年龄嘛，就到了该有的岁数；没对象也正常，缘分这东西该来的时候就来。", "Age? I'm whatever age it's time to be. No partner is normal too — that kind of thing arrives when it's meant to."),
    scene: "general",
    source: from("废话文学回复指南：轻松应对各类场景"),
  },
  {
    id: "ph-dead-air-naming",
    text: L("害，聊着聊着怎么没人说了。你刚才说的那个事，再说说呗？", "Huh, we were talking and then it all went quiet. That thing you mentioned — tell us more?"),
    scene: "general",
    source: from("废话文学回复指南：轻松应对各类场景"),
  },
  {
    id: "ph-end-chat-gracefully",
    text: L("这事儿还挺有意思的，不过我这边有点事要先处理一下，下次有空再听你聊。", "This is genuinely interesting, but something's come up on my end — let's pick it up another time."),
    scene: "general",
    source: from("废话文学回复指南：轻松应对各类场景"),
  },

  // ── 托人办事的高效话术指南 ────────────────────────────────────
  {
    id: "ph-ask-concrete-help",
    text: L("帮我把简历递给HR就行，后续面试我自己跟进。", "Just pass my resume to HR — I'll handle the interviews myself from there."),
    scene: "workplace",
    source: from("托人办事的高效话术指南"),
  },
  {
    id: "ph-warm-up-favor",
    text: L("姐，好久没见，你最近身体还好吗？对了，我最近遇到个事，想麻烦你帮个小忙。", "Hey, long time no see — how's your health been? So, one thing came up and I was hoping you could help me with a small favor."),
    scene: "friendship",
    source: from("托人办事的高效话术指南"),
  },
  {
    id: "ph-respect-busy",
    text: L("我知道你最近忙，本来不想麻烦你。你先顾自己的事，我再想想别的办法。", "I know you're swamped and I didn't want to bother you. Take care of your own things; I'll figure out another way."),
    scene: "friendship",
    source: from("托人办事的高效话术指南"),
  },
  {
    id: "ph-lower-expectation",
    text: L("能麻烦你试试我就很感谢了，成不成都没关系，不怪你。", "Just you trying is already more than I could ask. Win or lose, no blame on you."),
    scene: "friendship",
    source: from("托人办事的高效话术指南"),
  },
  {
    id: "ph-accept-refusal",
    text: L("没事，我特别理解，本来也不想给你添麻烦，谢谢你啊。", "No problem at all, I completely understand — I didn't want to put you out anyway. Thanks."),
    scene: "friendship",
    source: from("托人办事的高效话术指南"),
  },
  {
    id: "ph-thank-despite-fail",
    text: L("我知道你为这事跑了不少腿，没成也没关系，真的太谢谢你了。", "I know you went out of your way running around for this. That it didn't work out is fine — thank you so much anyway."),
    scene: "friendship",
    source: from("托人办事的高效话术指南"),
  },

  // ── 提升表达逻辑性：从混乱到清晰的实用指南 ────────────────────
  {
    id: "ph-total-part-total",
    text: L("周末去了XX山，体验特别好：一是风景好，二是人不多，下次还想再去。", "I hiked XX Mountain this weekend and it was great. One, the views; two, few crowds — I'd go again."),
    scene: "general",
    source: from("提升表达逻辑性：从混乱到清晰的实用指南"),
  },
  {
    id: "ph-prep-reasoning",
    text: L("我建议你学游泳：一是不伤膝盖、能锻炼身体，二是能应急，所以真的可以试试。", "I'd suggest you learn to swim: it protects your knees and keeps you fit, and it's there for emergencies — so it's genuinely worth trying."),
    scene: "general",
    source: from("提升表达逻辑性：从混乱到清晰的实用指南"),
  },
  {
    id: "ph-timeline-plan",
    text: L("我周末打算去外婆家：周六早上坐高铁过去，周日上午陪外婆散步。", "This weekend I'm going to my grandma's: high-speed rail over Saturday morning, then a walk with her Sunday morning."),
    scene: "general",
    source: from("提升表达逻辑性：从混乱到清晰的实用指南"),
  },
  {
    id: "ph-anticipate-question",
    text: L("大家可能会问「调研成本多少」，这里说明一下：预算五千元。", "You might be wondering what the research costs — here it is: budget of five thousand."),
    scene: "workplace",
    source: from("提升表达逻辑性：从混乱到清晰的实用指南"),
  },

  // ── 提高气场：从内到外的力量感塑造指南 ────────────────────────
  {
    id: "ph-soft-ability-refusal",
    text: L("我目前的精力都在XX上，帮不了你。这个需求超出我的能力范围，你可以试试找XX。", "My energy is currently all on XX, so I can't help. That ask is beyond what I can do — you could try asking XX."),
    scene: "general",
    source: from("提高气场：从内到外的力量感塑造指南"),
  },
  {
    id: "ph-basis-under-challenge",
    text: L("你提的XX情况确实是我们需要关注的，不过我们已经用去年的运营数据做过测算。", "The XX concern you raise is worth our attention — though we did run the numbers against last year's operations data."),
    scene: "workplace",
    source: from("提高气场：从内到外的力量感塑造指南"),
  },
  {
    id: "ph-blur-salary-probe",
    text: L("工资够我日常开支，还能攒一点，具体数字没细算。", "My salary covers daily costs with a little left to save — I don't track the exact figure."),
    scene: "general",
    source: from("提高气场：从内到外的力量感塑造指南"),
  },
  {
    id: "ph-refuse-moral-coercion",
    text: L("我的资金有固定用途，不过我听说XX平台有低息贷款，你可以看看。", "My funds are already earmarked, but I've heard the XX platform offers low-interest loans — worth a look."),
    scene: "general",
    source: from("提高气场：从内到外的力量感塑造指南"),
  },
  {
    id: "ph-decline-blame-shift",
    text: L("进度耽误确实需要解决，不过我每天都在群里同步进度。咱们先一起看是哪个环节没衔接上。", "The delay does need solving — but I've been syncing progress in the group every day. Let's look together at which step's handoff broke."),
    scene: "workplace",
    source: from("提高气场：从内到外的力量感塑造指南"),
  },
  {
    id: "ph-structure-dead-air",
    text: L("咱们刚聊了挺多方向，我整理一下——目前有三个点。", "We've covered a lot of directions — let me pull it together. Three points so far."),
    scene: "workplace",
    source: from("提高气场：从内到外的力量感塑造指南"),
  },

  // ── 有效拓展人脉：从建立到维护的实用指南 ──────────────────────
  {
    id: "ph-icebreak-with-scene",
    text: L("刚才听您在讨论XX话题，我正好在做这方面的事，想请教一下。", "I heard you discussing XX just now — that's actually what I work on, so I'd love to ask your advice."),
    scene: "workplace",
    source: from("有效拓展人脉：从建立到维护的实用指南"),
  },
  {
    id: "ph-add-contact-timing",
    text: L("今天跟您聊得特别有收获，能不能加个微信？之后有相关的资料，我也可以分享给您。", "I got so much out of our talk today — may I add you? If anything relevant comes up, I'd be happy to share it with you."),
    scene: "workplace",
    source: from("有效拓展人脉：从建立到维护的实用指南"),
  },
  {
    id: "ph-interact-before-dm",
    text: L("先在对方的动态或评论区互动两三次，再转到私信。", "Comment and interact a couple of times first, then move to a private message."),
    scene: "general",
    source: from("有效拓展人脉：从建立到维护的实用指南"),
  },
  {
    id: "ph-reconnect-with-update",
    text: L("好久没联系，之前看你在做XX项目，现在进展怎么样啦？", "It's been a while — I saw you were working on that XX project. How's it going?"),
    scene: "friendship",
    source: from("有效拓展人脉：从建立到维护的实用指南"),
  },
  {
    id: "ph-remember-key-detail",
    text: L("您家孩子最近钢琴练得怎么样了？", "How's your kid's piano practice going lately?"),
    scene: "friendship",
    source: from("有效拓展人脉：从建立到维护的实用指南"),
  },

  // ── 聊天化被动为主动：引导互动的实用指南 ──────────────────────
  {
    id: "ph-extend-sympathy",
    text: L("上班迟到扣钱也太心疼了！我上次也差点迟到。你今天是堵车还是起晚了？", "Getting docked for being late is brutal! I almost was last time too. Traffic today, or overslept?"),
    scene: "general",
    source: from("聊天化被动为主动：引导互动的实用指南"),
  },
  {
    id: "ph-share-then-guide",
    text: L("我今天中午试了公司楼下新开的沙拉店。你平时中午喜欢吃清淡的还是重口的？", "I tried the new salad place downstairs at lunch. Do you usually go light or heavy at noon?"),
    scene: "general",
    source: from("聊天化被动为主动：引导互动的实用指南"),
  },
  {
    id: "ph-open-question",
    text: L("现在的工作里，有没有让你觉得特别有成就感的事？", "Is there something in your current work that gives you a real sense of achievement?"),
    scene: "general",
    source: from("聊天化被动为主动：引导互动的实用指南"),
  },
  {
    id: "ph-light-topic-ice",
    text: L("哎，你平时喝奶茶喜欢三分糖还是全糖？", "Hey, when you get milk tea — thirty percent sugar or full?"),
    scene: "general",
    source: from("聊天化被动为主动：引导互动的实用指南"),
  },
  {
    id: "ph-shared-memory",
    text: L("我上次整理旧照片，还看到咱们大学毕业旅行的照片，海边那张风好大。", "When I was sorting old photos, I found the ones from our grad trip — that beach one where the wind was crazy."),
    scene: "friendship",
    source: from("聊天化被动为主动：引导互动的实用指南"),
  },
  {
    id: "ph-couple-dinner",
    text: L("确实不如上次那家的鱼香肉丝。这周要不要再去一次？顺便逛逛书店。", "It's really not as good as that place's yuxiang shredded pork last time. Want to go again this week? We could browse the bookstore too."),
    scene: "romantic",
    source: from("聊天化被动为主动：引导互动的实用指南"),
  },
  {
    id: "ph-family-grocery",
    text: L("你今天买了什么菜呀？是不是买了我爱吃的西红柿？晚上一起做西红柿炒蛋好不好？", "What did you pick up at the market? Did you get tomatoes — my favorite? How about tomato-and-egg stir fry together tonight?"),
    scene: "family",
    source: from("聊天化被动为主动：引导互动的实用指南"),
  },

  // ── 自然流、内在状态与结构化互动：伦理能力转译 ────────────────
  {
    id: "ph-observe-express-invite",
    text: L("你刚才讲那家店的时候明显很兴奋，我也被种草了。你最推荐哪一道？", "You were clearly buzzing when you described that place — now I'm intrigued. What do you recommend most?"),
    scene: "romantic",
    source: from("自然流、内在状态与结构化互动：伦理能力转译"),
  },
  {
    id: "ph-open-hypothesis",
    text: L("我猜你不只是不知道怎么开口，也怕主动显得掉价。我猜对了吗？也可能只是你不想给她压力。", "I'm guessing it's not that you don't know what to say — it's also worrying that reaching out looks cheap. Am I right? Or maybe you just don't want to pressure her."),
    scene: "romantic",
    source: from("自然流、内在状态与结构化互动：伦理能力转译"),
  },
  {
    id: "ph-guess-corrected",
    text: L("明白，是我刚才猜偏了。", "Got it — I guessed wrong there."),
    scene: "romantic",
    source: from("自然流、内在状态与结构化互动：伦理能力转译"),
  },

  // ── 获得领导青睐：从价值匹配到信任建立的实用指南 ──────────────
  {
    id: "ph-confirm-task-scope",
    text: L("这个方案是针对新用户拉新还是老用户促活？核心目标有明确方向吗？", "Is this plan for acquiring new users or re-activating existing ones? Is the core goal pointed in a clear direction?"),
    scene: "workplace",
    source: from("获得领导青睐：从价值匹配到信任建立的实用指南"),
  },
  {
    id: "ph-result-report-triple",
    text: L("重点数据：转化提升15%，后续可以重点投入；另外发现XX数据异常，已标注。", "Key numbers: conversion up 15%, worth investing more there; also flagged an anomaly in the XX data."),
    scene: "workplace",
    source: from("获得领导青睐：从价值匹配到信任建立的实用指南"),
  },
  {
    id: "ph-request-with-options",
    text: L("我想到两个办法：一个……另一个……我更倾向第一个，您看可行吗？", "I see two options: one is…, the other is…. I lean toward the first — does that work for you?"),
    scene: "workplace",
    source: from("获得领导青睐：从价值匹配到信任建立的实用指南"),
  },

  // ── 被孤立如何破局：从自我调适到建立连接的实用指南 ────────────
  {
    id: "ph-scene-small-talk",
    text: L("你这键盘挺好用的，在哪儿买的呀？", "That keyboard of yours is really nice — where did you get it?"),
    scene: "general",
    source: from("被孤立如何破局：从自我调适到建立连接的实用指南"),
  },
  {
    id: "ph-light-helps",
    text: L("你这台打印机好像卡纸了，我之前也遇到过，我帮你弄一下吧？", "Your printer looks jammed — I've hit that before. Want me to fix it?"),
    scene: "general",
    source: from("被孤立如何破局：从自我调适到建立连接的实用指南"),
  },
  {
    id: "ph-join-seat",
    text: L("这里有人吗？我能坐这儿吗？", "Is this seat taken? Mind if I sit here?"),
    scene: "public",
    source: from("被孤立如何破局：从自我调适到建立连接的实用指南"),
  },
  {
    id: "ph-misunderstanding-clarify",
    text: L("我最近发现你们好像不太理我，后来才知道有人说我觉得你们幼稚——其实根本没有的事。我之前没主动找你们玩，是因为刚到这儿有点不好意思。", "Lately I noticed you've all seemed distant, and I found out someone said I think you're childish — that's simply not true. I didn't reach out earlier because I was shy being new here."),
    scene: "friendship",
    source: from("被孤立如何破局：从自我调适到建立连接的实用指南"),
  },
  {
    id: "ph-supervisor-coordinate",
    text: L("王经理，我最近跟XX同事对接一直没拿到资料，能不能麻烦您帮我协调一下？", "Manager Wang, I haven't been getting the materials from XX in our handoffs — could you help coordinate this?"),
    scene: "workplace",
    source: from("被孤立如何破局：从自我调适到建立连接的实用指南"),
  },
  {
    id: "ph-neutral-party-clarify",
    text: L("我听说有人说我背后讲XX坏话，其实根本没有的事。能不能帮我跟大家解释一下？", "I heard someone's been saying I talked about XX behind their back — that never happened. Could you help set people straight for me?"),
    scene: "friendship",
    source: from("被孤立如何破局：从自我调适到建立连接的实用指南"),
  },
  {
    id: "ph-leave-gracefully",
    text: L("我这边还有方案没写完，就先回去忙啦，你们聊。", "I still have a proposal to finish, so I'll head back to work — you all carry on."),
    scene: "general",
    source: from("被孤立如何破局：从自我调适到建立连接的实用指南"),
  },

  // ── 高情商拒绝他人：体面护边界的实用指南 ──────────────────────
  {
    id: "ph-refuse-buffered",
    text: L("搬家确实需要人搭手，我特别理解你一个人搬不动。不过我周末早就约了带爸妈复查，真不好意思。", "Moving really does need help, and I totally get that you can't do it alone. But I already promised my parents their check-up this weekend — I'm so sorry."),
    scene: "friendship",
    source: from("高情商拒绝他人：体面护边界的实用指南"),
  },
  {
    id: "ph-refuse-alternative",
    text: L("我没法帮你写完整的发言稿，不过我这儿有发言稿模板，有不懂的也可以问我。", "I can't write the whole speech for you, but I have a speech template you can start from — and I'm happy to answer questions."),
    scene: "workplace",
    source: from("高情商拒绝他人：体面护边界的实用指南"),
  },
  {
    id: "ph-refuse-loan-boundary",
    text: L("我给自己定了规矩，不跟朋友有金钱往来。你可以试试银行的小额贷款。", "I've set a rule for myself: no money passing between friends. You could try a small bank loan."),
    scene: "friendship",
    source: from("高情商拒绝他人：体面护边界的实用指南"),
  },
  {
    id: "ph-refuse-delayed",
    text: L("我得先看看今晚有没有安排，二十分钟后告诉你行不行？", "Let me check whether I already have plans tonight — is it okay to get back to you in twenty minutes?"),
    scene: "general",
    source: from("高情商拒绝他人：体面护边界的实用指南"),
  },
  {
    id: "ph-refuse-overtime",
    text: L("我今晚早就约好带孩子体检。要是材料急，您看能不能找小王，或者我明早提前一小时来优先处理。", "I've already promised to take my kid for a check-up tonight. If it's urgent, could Xiao Wang handle it? Or I can come an hour early tomorrow and prioritize it."),
    scene: "workplace",
    source: from("高情商拒绝他人：体面护边界的实用指南"),
  },
  {
    id: "ph-refuse-car",
    text: L("这车我刚买没多久，怕万一剐蹭。我帮你查查租车平台，现在有优惠。", "I just bought this car and I'm worried about a scrape. Let me look up rental platforms for you — there are deals right now."),
    scene: "family",
    source: from("高情商拒绝他人：体面护边界的实用指南"),
  },
  {
    id: "ph-refuse-partner-gathering",
    text: L("我知道你想带我见你闺蜜。不过我这周末要在家修洗衣机，要不咱们下周再去？", "I know you want me to meet your friends. But I need to fix the washing machine at home this weekend — how about next week instead?"),
    scene: "romantic",
    source: from("高情商拒绝他人：体面护边界的实用指南"),
  },
];