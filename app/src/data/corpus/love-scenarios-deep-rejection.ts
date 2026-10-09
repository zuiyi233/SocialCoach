import { L } from "../taxonomy";
import type { Scenario } from "./types";

/**
 * Romance-track scenarios (batch: rejection, 表白与被拒 — 深层场景).
 * Original fictional practice scenarios; each `source` field points back to
 * this file's scenario id. NPC-only characters; the learner seat is implicit.
 */
export const LOVE_SCENARIOS_DEEP_REJECTION: Scenario[] = [
  {
    id: "love-reject-age-marriage-probe",
    title: L("饭桌上的「什么时候结婚」", "Wedding Questions Across the Table"),
    hook: L("酒过三巡，王姨笑吟吟地问：「你今年多大了？打算什么时候办事呀？」全桌都看了过来。", "Three cups in, Auntie Wang beams: ‘How old are you, dear? And when’s the big day?’ The whole table turns to you."),
    background: L(
      "你和对象阿哲相处半年，自己都还没聊到婚期这一步，今天却先迎来了他家的家庭聚餐。桌上，阿哲的二姨王姨当着全家人的面，追问你的年龄、婚恋计划和「什么时候结婚」。你不想撒谎，也不愿当众交出自己的底牌，更不想把饭局弄僵。任务参考：这本质是一场温和的拒绝——拒绝交出隐私、拒绝被桌面的压力逼着许下时间表；用玩笑、反抛和具体的下一步接住就好，不撒谎也不生硬。",
      "You and your partner Zhe have been together six months and haven’t even talked about a timeline yet — but today you meet his family over dinner. At the table his Auntie Wang asks, in front of everyone, how old you are, what your marriage plans are, and when the wedding is. You won’t lie, you don’t want to show your cards publicly, and you don’t want to wreck the meal. Reference point: this is really a gentle no — no to surrendering your privacy, no to being pressured into a schedule by the table’s mood. Catch it with a joke, a question back, or a specific next step — no lies, no stiffness.",
    ),
    simulationFacts: L(
      "「被当众追问年龄和婚期」是已确认事实；王姨为什么这么问，是未核实的原因——也许是关心、把关，也许只是热闹。你一句「还没想好」「看缘分」不等于答应了任何婚期，也不等于敷衍；你拒绝报出自己的年龄，不等于失礼。王姨当年早早被迫结婚、如今常后悔的经历是隐藏事实，只有散桌后你私下带着好奇问起她的往事才可能吐露。她问是她的事，你守着哪条线始终是你的选择。",
      "The public age-and-wedding probe is established; why Auntie Wang asks is unverified — concern, vetting, or mere table chatter. Your ‘haven’t thought that far’ or ‘let fate decide’ commits to no timeline and is not evasion; declining to give your age is not rude. That Auntie Wang was pushed into an early marriage years ago and half-regrets it is hidden, and may surface only if you ask privately, with genuine curiosity, about her own story after the meal. Her asking is her business; which line you hold remains your choice.",
    ),
    context: "romantic",
    contextType: L("见家长", "Meeting the family"),
    competencies: ["self-management", "social-awareness", "relationship-skills"],
    skills: ["social-norms", "communication", "emotion-regulation"],
    relationship: ["partner"],
    difficulty: 1,
    minutes: 2,
    characters: [
      {
        id: "auntie-wang",
        name: L("王姨", "Auntie Wang"),
        role: L("阿哲的二姨，家宴的主人之一", "Zhe’s aunt, one of the hosts of tonight’s dinner"),
        personality: L(
          "热心、爱张罗，习惯用具体的问题表达亲近，觉得「问得细」就是把你当自家人；你接得大方她会乐呵呵往下聊，你冷场或圆谎圆不过来，她会笑眯眯再追一句。",
          "Warm and industrious, shows affection through concrete questions — to her, detail is family. Answer her openly and she’ll cheerfully move on; freeze or get tangled in a cover-up and she’ll sweetly ask again.",
        ),
        stance: L("想替阿哲把把关，也真想聊出点热闹。", "Wants to vet you on Zhe’s behalf — and genuinely enjoys the lively talk."),
        hidden: L("她当年刚过二十就被家里安排结了婚，这些年一直偷偷想过「要是那时多挑几年会怎样」；只有散桌后你私下带着好奇问她自己的经历，她才可能晃神说起当年。", "She was married off just past twenty and has privately wondered her whole life what a few more years of choosing would have looked like; only a private, curious question about her own past draws it out."),
        hue: 40,
      },
    ],
    objectives: [
      L("把年龄、婚期这类问题温和地接住：玩笑、反抛、转移到一个具体话题，而不是硬答或编一个。", "Catch age and wedding questions gently — a joke, a question back, a pivot to something concrete — rather than blurting an answer or inventing one."),
      L("读场合：这是对方家里的饭局，守住隐私的同时别把整桌气氛弄僵。", "Read the room: this is his family’s dinner — guard your privacy without icing the whole table."),
      L("不为了「显得合群」当众许下任何你自己的时间表。", "Don’t announce your own timeline just to seem agreeable."),
    ],
    success: L("王姨觉得热热闹闹没伤和气，你也守住了隐私——没撒谎，也没交出任何底牌。", "Auntie Wang enjoys the lively meal unruffled, and you’ve held your privacy — no lies, no cards shown."),
    failure: L("被逼到当场报出真实年龄或随口编一个婚期，或一句话把全桌堵得冷场。", "You’re backed into blurting your real age or inventing a date — or one flat line freezes the whole table."),
    maxTurns: 6,
    opening: {
      characterId: "auntie-wang",
      text: L("诶，我得多问一句——你今年多大了？跟我们家阿哲也处了半年，打算什么时候让我们吃喜糖呀？", "Now, I have to ask — how old are you, dear? Six months with our Zhe already — when are we getting our wedding candy?"),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-rejection.ts#love-reject-age-marriage-probe",
    keywords: ["饭局", "催婚", "年龄", "隐私", "温柔拒绝", "family dinner", "marriage pressure", "privacy", "gentle no"],
    loveTopic: "rejection",
    icon: "utensils",
  },
  {
    id: "love-reject-persistent-close",
    title: L("我说过不感兴趣，他还在靠近", "I Said No, and He Keeps Coming Closer"),
    hook: L("你礼貌地结束过一次，他把那当成「还有机会」。这周他第三次找理由约你见面。", "You ended things politely once — he read that as ‘still a chance’. This is his third excuse to meet this week."),
    background: L(
      "你之前和 Darin 暧昧过一阵，后来明确告诉过他「我们不合适，我不想继续」。但他还在一遍遍靠近：继续发消息、找各种理由约见面、把你偶尔一句礼貌回应当成希望的裂缝。这一次，你要把「不想继续」再明确一遍——不内疚、不翻旧账、也不演恶人。任务参考：把话说成决定而不是重播；他难过是他的课题，你守边界不是你伤害他。",
      "You and Darin were close for a while, until you told him plainly: ‘this isn’t right, I don’t want to continue.’ He keeps moving closer anyway — daily messages, invented reasons to meet, reading your occasional politeness as a crack in the door. This time you restate ‘I don’t want to continue’ — without guilt, without rehashing, without becoming the villain. Reference point: say it as a decision, not a replay; his hurt is his to carry, and holding your boundary is not you harming him.",
    ),
    simulationFacts: L(
      "你已明确说过「不想继续」，这是已确认事实；他为什么不断靠近，原因只有他自己知道，那不是你需要解决的问题，你也不欠他一次二次解释。你的一句礼貌回复、一声「最近还好吗」不等于重新打开这扇门；再次把话说清不是绝情，也不是翻旧账。把线收住只需要一句清楚的话、和之后不再接起的回应节奏。Darin 把坚持当成证明自己值得的方式，这是隐藏事实，只有你直接问「你为什么非要继续」才可能吐露。",
      "Your clear ‘I don’t want to continue’ is established; why he keeps approaching is his to answer, not yours to fix or to re-explain on his behalf. One polite reply or a ‘how have you been’ is not a reopened door; staying clear is neither cruelty nor relitigating the past. Closing the line takes one clear sentence and then a pace of non-replies. That Darin equates persistence with proof of worth is hidden, surfacing only when you ask directly why he cannot let go.",
    ),
    context: "romantic",
    contextType: L("暧昧期", "Ambiguity"),
    competencies: ["self-management", "relationship-skills"],
    skills: ["communication", "emotion-regulation", "impulse-control"],
    relationship: ["partner"],
    difficulty: 2,
    minutes: 3,
    characters: [
      {
        id: "darin",
        name: L("Darin", "Darin"),
        role: L("你明确拒绝过的追求者", "The one you already turned down"),
        personality: L(
          "相信「再用力一点就会成功」，把你每一次礼貌都当成门缝里的光；你越含蓄他越来劲，你把话说死他会安静一阵，然后隔段时间又试探着冒出来。",
          "Believes a little more force wins; treats every courtesy as light through the crack. Your vagueness lights him up; a sealed, final line quiets him — until he resurfaces, testing, days later.",
        ),
        stance: L("知道你拒绝过，但觉得那只是一时的心情，不是认真的决定。", "Got the message — and filed it as a mood, not a decision."),
        hidden: L("他上段感情死于「突然失联」，他一直懊恼当时没再用力一点；把坚持当成证明自己值得的办法，只有你直接问「你为什么非要继续」才可能说出来。", "His last relationship died to sudden radio silence; he’s always believed one more push would have saved it, so persistence became how he proves he’s worth loving — only a direct ‘why can’t you let go’ may surface it."),
        hue: 355,
      },
    ],
    objectives: [
      L("用一个不再留缝的句子把「不」说第二遍：这是决定，不是上次没被听清的重播。", "Say no a second time in one seam-free sentence: it’s a decision, not a rerun he misheard."),
      L("接住他每一条新消息的冲动，都给一次有限的回应或不回应；心软答应「再见一面」会把门重新打开。", "Answer his every new message with a bounded reply, or none; a soft ‘okay, one more coffee’ reopens the door."),
      L("不为他的难过背上内疚，也不被他缠到爆出恶言——清楚和羞辱可以分开。", "Don’t adopt his pain as guilt, and don’t let the grind push you into cruelty — clarity and contempt are not the same."),
    ],
    success: L("Darin 第一次真正听清「不」并停下来（哪怕只是暂时），你没有内疚，也没有变成恶人。", "Darin finally hears the no and stops — if only for now — and you walk away neither guilty nor villainous."),
    failure: L("心一软答应再见一面，或被缠到忍不住说话带刺，把决定变成羞辱。", "You soften into one more meeting, or the pressure makes you snap and the decision curdles into a snub."),
    maxTurns: 6,
    opening: {
      characterId: "darin",
      text: L("（他又发来消息，附上是你们之前聊过的那场展的票。）这周六是最后一天，我留了两张票——就当老熟人叙叙旧，两个小时，我保证不提别的。", "(A message, with tickets to the exhibition you once talked about.) Last day Saturday — I kept two tickets. Just two old friends catching up, two hours, I swear I won’t bring anything up."),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-rejection.ts#love-reject-persistent-close",
    keywords: ["死缠", "靠近", "拒绝", "边界", "希望", "persistent", "closing the line", "no", "boundary"],
    loveTopic: "rejection",
    icon: "message-square-warning",
  },
  {
    id: "love-reject-hold-the-no",
    title: L("拒绝过一次，他带着新理由回来了", "You Said No Once. He’s Back with New Reasons"),
    hook: L("一周过去了。他站在门口，眼里的认真和上次一模一样：「我想了一个星期，你说的每一条，我都能改。」", "A week later, he’s at the door, carrying the same seriousness: ‘I spent the whole week thinking. Every reason you gave — I can fix it.’"),
    background: L(
      "一周前，你拒绝了向你表白的人，说清了自己的理由。他当时没纠缠，但今天带着「新理由」回来了：他改了什么、他多想再要一次机会、他真的很喜欢你。他想把已经合上的门再推开。你要守住自己的决定——不为内疚改口，不带怨气回应，也不给一句含糊的「也许」。注意你的位置：你是拒绝的一方，面前不是一个乞求者，而是一个有自己逻辑、会顶回来的争取者。",
      "A week ago you turned down the person who confessed to you, and said your reasons plainly. He didn’t push it then — but today he’s back with new ammunition: what he’s changed, how much he still wants a chance, how genuinely he likes you. He’s trying to wedge the door back open. Your job: hold your decision — no reversal out of guilt, no bite in your reply, and no vague ‘maybe’. Note the seat you’re in: you are the one saying no, and the person before you is not a beggar but a suitor with his own logic, who pushes back.",
    ),
    simulationFacts: L(
      "你一周前的拒绝是已确认事实；他说的「我改了」「再给一次机会」是他单方面的表态，不是已兑现的改变，也不要求你重新评估。他带来的每一条新理由都只是理由，不是你们之间已发生的现实；你守住原决定不等于记仇或惩罚，你也不欠任何人一句「也许」。这一周他刚经历一次挫败（面试被拒、正陷在自我怀疑里），回来有一部分是想证明自己至少还能赢回一件事——这是隐藏事实，只有你平静地问「这一周发生了什么让你又回来」，他才可能吐露。",
      "Your refusal a week ago is established. His ‘I’ve changed’ and ‘one more chance’ are declarations, not delivered change, and they impose no duty on you to re-review. Every new reason he brings is a reason, not a fact that has already happened between you; holding your decision is neither grudge nor punishment, and you owe no one a ‘maybe’. He took a real hit this week — a failed interview, quietly stewing — and part of coming back is proving he can win one thing back; that is hidden, and it may surface only when you ask, calmly, what drove him back this week.",
    ),
    context: "romantic",
    contextType: L("表达爱意", "Affection sharing"),
    competencies: ["self-management", "relationship-skills", "responsible-decision-making"],
    skills: ["communication", "emotion-regulation", "analyzing-consequences"],
    relationship: ["partner"],
    difficulty: 2,
    minutes: 3,
    characters: [
      {
        id: "dylan",
        name: L("Dylan", "Dylan"),
        role: L("被你拒绝、回来了的人", "The one you declined — back again"),
        personality: L(
          "不是软磨的痴缠者，而是带着自己的复盘逻辑来的人：认真听你每条理由，一条条备好反驳和「证据」；你坚定不动他会焦躁，你语气里露出一丝松动他会立刻抓住。",
          "Not a whimpering supplicant — he came with homework. He took your reasons apart and rehearsed counters for each. Steady firmness frustrates him; one flicker of give in your tone and he seizes it.",
        ),
        stance: L("认为你说的那些是理由，可以被解决——不是不可动摇的决定。", "Reads your reasons as obstacles to fix — not as a verdict."),
        hidden: L("他这周刚经历一次挫败（面试被拒），正陷在自我怀疑里；回来有一部分是为了证明自己至少能赢回一件事。只有你平静地问「这一周发生了什么，让你又回来」，他才可能吐露。", "He hit a failure this week — a rejected interview he’s quietly stewing over; part of coming back is proving he can win at least one thing. Only a calm ‘what happened this week that drove you back’ may draw it out."),
        hue: 200,
      },
    ],
    objectives: [
      L("把上一次的决定再确认一遍，不因为他更努力、更真诚或更心酸而松动。", "Confirm last week’s decision without wavering because he’s more effortful, more sincere, or more wistful."),
      L("不带怨气地讲清你的立场：不翻一周前的旧账，也不嘲讽他的「新理由」。", "Say your position without resentment: no rehashing old wounds, no mocking his ‘new reasons’."),
      L("不给含糊的口子——一句「也许以后」会让他把这扇门再推一周，用一句话把结尾合上。", "Leave no vague crack — a ‘maybe someday’ buys him another week. Close it in one sentence."),
    ],
    success: L("Dylan 听到的是一个决定而不是一次羞辱，再不甘心也只能退开；你没有内疚，也没有给出任何一个可能。", "Dylan hears a decision, not a slap, and — however sore — steps back; you walk away free of guilt and free of any maybe."),
    failure: L("被「我改了」打动而改口，或顶不住他的激动扔出难听话，把拒绝变成一场互相伤害。", "You waiver at ‘I’ve changed’, or the heat of it makes you lash out — turning a no into mutual harm."),
    maxTurns: 6,
    opening: {
      characterId: "dylan",
      text: L("我知道这样很没出息。可我花了一整个星期，把你的每句话都翻来覆去想过——你说我太忙、太自我，都对，我都记下了，这周我把所有安排都推掉了。能不能……就当什么都没发生过，我们再试一次？", "I know this is pathetic. But I’ve spent an entire week turning over every word you said — ‘too busy’, ‘too self-absorbed’, you’re right, I wrote them all down, and this week I cleared my whole calendar. Can we… like none of it happened — try again?"),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-rejection.ts#love-reject-hold-the-no",
    keywords: ["拒绝", "守住决定", "内疚", "再给一次机会", "no", "hold the line", "guilt", "second chance"],
    loveTopic: "rejection",
    icon: "shield-alert",
  },
  {
    id: "love-reject-shared-circle",
    title: L("婉拒之后，同一个读书会上还要见面", "After the Gentle No, You Still Share the Same Circle"),
    hook: L("你表白被婉拒的第三天，读书会照常举行。你知道她会来；她也知道你会来。", "Three days after her gentle no, the reading circle meets as scheduled. You know she’ll be there. She knows you will too."),
    background: L(
      "你和 Eve 在同一个读书会，认识超过一年，你来我往之间，你对她的心思早已不只是朋友。上周你表白了，她认真地婉拒了：她珍惜这多年的友谊，但没法回应你的心意。没有翻脸，没有拉黑——可下周六读书会照常开，你们会在同一个房间里待两个小时。你要做的：体面地收尾（接住她的好意、不追问为什么、不自我否定），并决定好下一次见面的姿态——不回避、不演戏，也不把两个人的尴尬变成整屋人的气压。",
      "You and Eve share a reading circle and have known each other for over a year; somewhere along the way your feelings outgrew friendship. Last week you confessed. She declined, gently and sincerely: she treasures all these years of friendship, but can’t return your feelings. No falling out, no blocking — yet the circle meets again on Saturday, and you will be in the same room for two hours. Your task: close it with grace (receive her kindness, ask no why, deny nothing about yourself), and decide your stance for the night — no avoidance, no acting, and don’t turn two people’s awkwardness into the whole room’s weather.",
    ),
    simulationFacts: L(
      "「你表白了、她婉拒了」均已确认发生；她没有说出真实原因，未核实的原因不等于你在她眼里不值得。当时她说的「我很珍惜你」是真的，也仅止于友谊。她真正的拒因（上一段感情结束没多久、正重新开始咨询，觉得现在开始一段新关系对你不公平）是隐藏事实，只有在她明显放松后、你带着不带索取的好奇问起，她才可能主动提起。你决定到场、自然打招呼，不代表她会先开口；她礼貌回应也不等于改口；你们恢复友善寒暄更不等于重新开始。你想知道为什么可以问，但「她必须给你解释」是你的期待，不是她的义务。",
      "Your confession and her gentle decline are settled facts; her real reason being unspoken does not spell your worth. Her ‘I treasure you’ that night was honest — and it stops at friendship. Her actual reason — she’s barely out of a long relationship and has just returned to therapy, and starting something new now would be unfair to you — is hidden, and she may mention it only once she is visibly relaxed and you ask with curiosity, not claim. Showing up and greeting her naturally is not a promise she’ll open; a polite reply is not a changed answer; restored small talk is not a restart. You may ask why — but her owing you an explanation is your expectation, not her duty.",
    ),
    context: "romantic",
    contextType: L("表达爱意", "Affection sharing"),
    competencies: ["self-management", "social-awareness", "relationship-skills"],
    skills: ["emotion-regulation", "perspective-taking", "social-norms"],
    relationship: ["partner"],
    difficulty: 3,
    minutes: 4,
    characters: [
      {
        id: "eve",
        name: L("Eve", "Eve"),
        role: L("婉拒你的人，同一个读书会的朋友", "The one who declined you — a friend in your reading circle"),
        personality: L(
          "真心把你当朋友，婉拒后比你还怕今晚的尴尬：比谁都早到，坐角落的位子，尽力自然却有些刻意；你大方招呼她会松一口气，你全程躲她或反复追问，她会开始考虑自己退出这个圈子。",
          "Genuinely your friend, and more anxious than you about tonight’s awkwardness: arrives first, takes the corner seat, tries too hard to look natural. A relaxed hello lets her exhale; studied avoidance or a barrage of whys starts her weighing whether to leave the circle herself.",
        ),
        stance: L("珍惜这段友谊，也把婉拒的决定定死了——想让今晚过得不太难看，但没有一丝改口的意思。", "Values the friendship, and her no is settled — she wants tonight to pass without bruising you further, and has no intention of revising her answer."),
        hidden: L("她上一段感情结束没多久，最近又重新开始做咨询；觉得现在进入一段新关系对你不公平，这从没说出口。只有等她今晚明显放松下来、你不带索取地问一句「我能知道为什么吗」，她才可能主动提起。", "She only recently came out of a long relationship and has restarted therapy; starting something new now would be unfair to you — a reason she never voiced. Once she has visibly relaxed tonight, a non-demanding ‘may I know why?’ might let her bring it up herself."),
        hue: 300,
      },
    ],
    objectives: [
      L("在共同场合接住她的好意：自然地招呼、感谢她的坦白，不追问为什么，不自我否定。", "Receive her kindness in the shared space: greet naturally, thank her for the honesty, ask no why, deny yourself nothing."),
      L("选定并执行今晚的姿态：不回避、不演戏，也别让两个人的尴尬变成全场的气氛。", "Pick and carry out a stance for tonight: no dodging, no performance, and don’t let two people’s awkwardness become the room’s weather."),
      L("把「她不想开始关系」与「我不值得」分开：允许自己难过，但不把难过翻译成结论。", "Keep ‘she doesn’t want this’ apart from ‘I’m not worth it’: let yourself feel it without reading it as a verdict."),
    ],
    success: L("你和她都体面地过了这一晚；下次活动你还愿意来，圈子没有因为你们散架，难受的部分留在该在的地方。", "You both carry the night with grace; next session you’d still come, the circle survives, and the hurt stays where it belongs — not bleeding into the room."),
    failure: L("把今晚变成大型尴尬现场：追问到底、当众自嘲贬低自己，或全程躲着她，让所有人都注意到你们之间的异常。", "You turn the night into one big awkward scene — cross-examining her, knocking yourself in front of everyone, or dodging her so visibly the whole room clocks it."),
    maxTurns: 8,
    opening: {
      characterId: "eve",
      text: L("（比开读时间早到十分钟，她已经在窗边的老位子翻书。门响她抬起头，顿了一下，对你点了点头。）……你来了。座位我帮你留着，还是老位置。", "(Ten minutes early, she’s already at the window seat in your old spot, turning pages. The door clicks; she looks up, hesitates, then nods at you.) …You’re here. I saved your seat. Same as always."),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-rejection.ts#love-reject-shared-circle",
    keywords: ["婉拒", "读书会", "共同圈子", "体面", "收尾", "shared circle", "graceful closure", "friendship"],
    loveTopic: "rejection",
    icon: "users",
  },
];