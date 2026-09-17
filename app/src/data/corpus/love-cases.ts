import { L } from "../taxonomy";
import type { Case } from "./types";

/** Romance-track cases for the love module (context: "romantic"). */
export const LOVE_CASES: Case[] = [
  {
    id: "love-case-soft-start",
    title: L("一次被软启动化解的争吵", "The Argument a Soft Start-Up Defused"),
    source: { book: "The Seven Principles for Making Marriage Work", author: "John M. Gottman" },
    situation: L(
      "晓和林住在一起。林连续三周加班到很晚，晓一个人做饭、洗碗、等到十点。周六晚上林又发消息说「又要晚回」，晓的火一下子顶了上来。",
      "Xiao and Lin live together. Lin has worked late three weeks straight; Xiao cooks alone, does the dishes, waits until ten. On Saturday Lin texts ’running late again’ and Xiao’s anger finally tops out.",
    ),
    whatHappened: L(
      "晓没有发「你干脆住公司算了」，而是等林进门后把话讲成了结构：「这两周你三次临时晚归，我都是一个人吃饭等到十点（事实）。我有点孤单，也觉得不被考虑（感受）。我需要我们能把晚饭和归期谈成共识（需要）。以后临时要晚回，能不能六点前告诉我，我好自己安排晚饭？（请求）」林愣了几秒，说出了最近那个压垮人的项目。两人定下一条规则：六点前同步归期，加班的那一周晓点外卖、不硬等。",
      "Xiao didn’t text ’may as well live at the office’. Instead, when Lin got home, the words came out structured: ’Three times in two weeks you’ve been late unannounced, and I’ve eaten alone and waited till ten (fact). I feel lonely and unconsidered (feeling). I need us to agree on dinners and coming-home time (need). When plans shift, can you tell me by six so I can sort my own dinner? (request).’ Lin blinked, then talked about the crushing project. They made one rule: sync the return time by six, and on overtime weeks Xiao orders takeaway instead of waiting.",
    ),
    takeaway: L(
      "软启动把「你怎么总是这样」换成可检验的事实和单向的请求，对方不必防御，冲突才有空间变成协商。",
      "The soft start-up swaps ’you’re always like this’ for checkable facts and a one-way request — the other person doesn’t have to defend, and the conflict gets room to become a negotiation.",
    ),
    competencies: ["relationship-skills"],
    skills: ["communication", "resolving-conflicts"],
    context: "romantic",
    keywords: ["soft start-up", "conflict", "overtime", "request", "repair", "软启动"],
    loveTopic: "trust",
  },
  {
    id: "love-case-rejection-grace",
    title: L("被拒之后，仍然体面", "Grace After a No"),
    source: { book: "Goutoujunshi skill", author: "Community practice" },
    situation: L(
      "阿凯喜欢同事小周一年，攒了很久的勇气，终于在咖啡店把话说了出来。小周温和地答：「谢谢，但我没有那样的感觉。」",
      "Kai had liked his colleague Zhou for a year, spent months scraping up courage, and finally said it in the café. Zhou answered gently: ’Thank you — but I don’t feel that way.’",
    ),
    whatHappened: L(
      "阿凯当下很难受。他没有追问「到底为什么」，只是说「谢谢你愿意直接告诉我，这样我不用再猜了」，然后问两人能不能各自要一点空间。之后两周他不再刷小周的社交动态，把晚上还给跑步和见朋友。到第三周，他发现自己没那么疼了。他把这次对话当成练习——至少，他清楚表达了，也在被拒后给自己留了回收的时间。",
      "Kai was hurt in the moment. He didn’t ask why. He said ’thanks for telling me straight — now I can stop guessing,’ and asked whether they could each take some space. For two weeks he stopped checking Zhou’s posts, gave his evenings back to running and friends. By week three it hurt noticeably less. He treated the talk as practice — at least he’d expressed himself clearly, and had given himself room to recover.",
    ),
    takeaway: L(
      "被拒后的体面不是压抑感受，而是把拒绝当成信息：接受、停止推进、复盘适配与表达，同时保留自己的节奏和生活。",
      "Grace after a no isn’t swallowing your feelings; it’s treating the rejection as information — accept it, stop pushing, review the fit and how it was said, and keep your own rhythm and life intact.",
    ),
    competencies: ["self-management", "self-awareness"],
    skills: ["emotion-regulation", "self-efficacy"],
    context: "romantic",
    keywords: ["rejection", "grace", "dignity", "self-regulation", "recovery", "体面"],
    loveTopic: "rejection",
  },
  {
    id: "love-case-scam-identified",
    title: L("她认出了一个「杀猪盘」", "She Recognized the Investment Trap"),
    source: {
      book: "网恋投资「杀猪盘」警示",
      author: "江门市公安局（2026）",
      url: "https://www.jiangmen.gov.cn/bmpd/jmsgaj/zwgk/gzdt/content/post_3457513.html",
    },
    situation: L(
      "小敏在交友 App 上认识自称海外券商高管的「陈浩」。对方几天内早安晚安不断，说自己「投资很有一套」，开始教她看行情，并让她下载一个陌生 App 注册。",
      "Min matched with ’Chen Hao’ on a dating app — self-described overseas brokerage executive. Within days the good-morning-good-night messages flowed; he claimed to be ’really good with investments’, started walking her through charts, and asked her to register on an unfamiliar app.",
    ),
    whatHappened: L(
      "小敏注意到几个细节：对方从不见面也不视频，证件信息前后对不上，一句话里五次把话题拉回「先投一千试水」，还叮嘱她「别告诉别人，专心赚点小钱」。她想起公安的警示——网恋对象引导投资、下载陌生 App、小额返利后要求追加。她说不适合投资，对方立刻冷淡下来，还开始贬低她「没魄力」。她保存了聊天记录，拉黑，并向平台举报。",
      "Min clocked the details: he refused calls and video, his ID details contradicted themselves, he steered every third sentence back to ’just try a thousand to start’, and told her ’don’t tell anyone, quietly make some pocket money’. The fraud warning she’d read came back to her — online romance directing you to invest, apps to download, small payouts, then a demand for more. She said investing wasn’t for her. He went instantly cold and started calling her ’spineless’. She saved the chats, blocked him, and reported him to the platform.",
    ),
    takeaway: L(
      "识破不等于天生多疑，而是认得套路：快速建立亲密、制造权威、引导下载陌生 App、催你转账。出现这些信号时，先保护证据和自己的钱包，再谈感情不迟。",
      "Spotting it isn’t paranoia — it’s knowing the pattern: instant intimacy, manufactured authority, an app to install, pressure to transfer money. When those signals appear, protect the records and your wallet first; the romance can wait.",
    ),
    competencies: ["self-awareness"],
    skills: ["examining-bias"],
    context: "romantic",
    keywords: ["romance scam", "fraud", "red flags", "verification", "protect", "杀猪盘"],
    loveTopic: "boundary",
  },
  {
    id: "love-case-boundary-set",
    title: L("对那句「顺便」说了认真的不", "A Real No to a ’While You’re At It’"),
    source: { book: "Goutoujunshi skill", author: "Community practice" },
    situation: L(
      "小陈和一个约会对象认识两个月，对方开始默认她随时有空：临时约、深夜来电、让她顺手帮改简历，每次被拒就笑着说「你是不是不爱我了」。",
      "Chen has been seeing someone for two months, and they’ve started assuming she’s always free: last-minute plans, late-night calls, a quick favor with the résumé. Every refusal is met with a joke — ’do you even love me?’",
    ),
    whatHappened: L(
      "小陈先在一个平静的下午把底线说清楚：「我理解你临时找我，但我需要提前约；深夜电话除非急事，我不接。」后来对方又用「你是不是不爱我了」施压，她没解释第一百遍，只重复了一遍规则，然后补了一个出口：「周六下午三点之后我有空，你提前告诉我。」对方愣了一下，接受了。几周后她发现，对方开始提前约了。",
      "Chen stated the floor one calm afternoon: ’I get that you reach out last-minute, but I need to plan; no late-night calls unless it’s urgent.’ When the ’do you even love me’ pressure came again, she didn’t explain for the hundredth time — repeated the rule once, then offered an exit: ’Saturday after three works for me, if you tell me ahead.’ He blinked, and accepted. A few weeks later, he was planning ahead.",
    ),
    takeaway: L(
      "一句清楚、可执行、不随情绪摇摆的「不」，配上替代方案，比忍到爆发有用得多；把玩笑或嫉妒包装成绑架，也改变不了越界的事实。",
      "A clear, enforceable ’no’ that doesn’t swing with your mood, paired with an alternative, beats repressing until you explode. Framing pressure as a joke or jealousy doesn’t change that the ask oversteps.",
    ),
    competencies: ["relationship-skills"],
    skills: ["standing-up", "communication"],
    context: "romantic",
    keywords: ["saying no", "boundary", "guilt trip", "alternative", "consistent", "拒绝"],
    loveTopic: "boundary",
  },
  {
    id: "love-case-approach-recovered",
    title: L("一句具体欣赏救回了快冷掉的见面", "A Specific Compliment That Saved a Cooling Date"),
    source: { book: "Goutoujunshi skill", author: "Community practice" },
    situation: L(
      "阿卓和朋友安排的相亲对象第一次见面。前四十分钟，对方只简短回答他的提问，点菜、看手机、笑容欠奉，气氛肉眼可见地冷下去。阿卓觉得要完了，开始后悔自己话太多。",
      "Zhuo’s first meet with a blind-date setup. Forty minutes in, she answers his questions in one-liners, studies the menu, checks her phone, smiles sparingly — the temperature is visibly dropping. Zhuo is convinced it’s over and regrets talking so much.",
    ),
    whatHappened: L(
      "他决定不再追加问题式的查户口，而是承接眼前一个真实细节：「你刚才说你带的那只保温杯是坏的，还是坚持喝热水——我好奇的是，你好像习惯什么都自己扛。」对方一愣，低头笑了，第一次主动讲起自己的工作压力。他抓住她分享里一个具体的点继续追问，而不是泛泛点头。散场时她说：「本来觉得今天悬了，你这人还挺会聊的。」后来他们又约了第二次。真正起作用的是那个具体的观察和一个真的问题，不是任何话术。",
      "He stopped the question-after-question interview and picked up a real detail instead: ’You said that thermos of yours is broken, yet you still insist on hot water — I’m curious whether you’re used to carrying everything yourself.’ She blinked, smiled at her lap, and for the first time talked about her work pressure. He followed up on one concrete thread she offered instead of nodding vaguely. At the end she said: ’I thought this was dead in the water — you’re actually fun to talk to.’ They met again. What saved it was the specific observation and one genuine question, not a script.",
    ),
    takeaway: L(
      "见面正在变冷时，追加问题往往让气氛更僵；转向眼前一个真实细节作具体欣赏，再配一个真的问题，能把对话从「答题」变回「相遇」。",
      "When a meet is cooling, more questions make it colder. Turning to one real, present detail as a specific appreciation — plus one genuine question — flips the conversation from an interview back into an encounter.",
    ),
    competencies: ["social-awareness", "relationship-skills"],
    skills: ["empathy", "communication"],
    context: "romantic",
    keywords: ["first approach", "specific appreciation", "curiosity", "recovery", "conversation", "第一次见面"],
    loveTopic: "approach",
  },
  {
    id: "love-case-exclusive-talk",
    title: L("把「我们到底是什么关系」问出口", "The Talk That Named the Relationship"),
    source: { book: "The Seven Principles for Making Marriage Work", author: "John M. Gottman" },
    situation: L(
      "小棠和男友暧昧三个月，每周见面、每天聊天，却从没说过「我们在恋爱」。朋友问她是不是确定了，她说「应该是吧」，又补了一句「但万一他只是在骑驴找马呢」。她想问，又怕一问就散了。",
      "Tang has been in the gray zone with someone for three months — weekly dates, daily texts, and no one ever saying ’we’re dating’. When a friend asks if it’s official, she says ’I guess so’, then adds: ’But what if he’s just keeping his options open?’ She wants to ask, and is afraid the question will end it.",
    ),
    whatHappened: L(
      "她选了一个两个人都放松的周六下午，用一次软启动而不是突袭：「最近几周我们几乎天天聊，周末也常待在一起（事实）。我挺喜欢这样的，但也开始不确定我们算什么，心里会晃（感受）。我需要知道自己不是在自作多情（需要）。你能告诉我，我们是可以期待的关系，还是你想保持现状？（请求）」对方沉默了很久，说自己也早就想问，然后认真说了他对这段关系的打算。不是逼婚，也没有求婚；只是两个人终于对齐了同一张地图。",
      "She picked a relaxed Saturday afternoon and soft-started it instead of ambushing: ’These weeks we talk almost daily and spend weekends together (fact). I genuinely like that, but I’m starting to wobble about what we are (feeling). I need to know I’m not reading this alone (need). Can you tell me — is this something to expect, or do you want to stay as we are? (request).’ He was quiet for a long time, then admitted he’d been wanting to ask too, and said, carefully, what he wanted from this. No ultimatum, no proposal — just the two of them finally on the same map.",
    ),
    takeaway: L(
      "「我们算什么」用事实、感受、需要、请求来问，比「你到底把我当什么」更像对话而不是审讯；真正的关系常常扛得住这样一次诚实的对齐。",
      "Asking ’what are we’ with facts, feeling, need, and request makes it a conversation rather than an interrogation — and a real relationship usually survives one honest realignment.",
    ),
    competencies: ["relationship-skills", "self-awareness"],
    skills: ["communication", "identifying-emotions"],
    context: "romantic",
    keywords: ["define", "relationship", "uncertainty", "request", "clarity", "明确关系"],
    loveTopic: "define-relationship",
  },
  {
    id: "love-case-breakup-clean",
    title: L("把「以后也许」留在门外", "Leaving ’Maybe Someday’ Outside"),
    source: {
      book: "Language Left Behind on Social Media Exposes the Costs of a Romantic Breakup",
      author: "Seraj et al. (2021)",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7896325/",
    },
    situation: L(
      "林和女友在一起四年，近一年像住在同一套房子的室友：各自加班、各自吃饭、周末分头见朋友。他认真想过，确认是不匹配，不是一时情绪。拖到周六，他在常去的公园说出了开场白。",
      "Lin has been with his girlfriend four years; the past year has felt like sharing a flat: separate overtime, separate dinners, separate weekend friends. He’s thought it through and knows it’s mismatch, not a mood. On Saturday, at their usual park, he says the opening line.",
    ),
    whatHappened: L(
      "他用一句结论开头：「我想好了，我们结束吧。这是我想了很久的决定。」她问是不是因为上周那件事，他说不是——是他的原因：他们想要的未来已经不在同一个方向。她把「那以后呢」咽下去，他也咽住了同样的话。没有「也许」，没有「先分开试试」。他们把房租押金、两把钥匙和猫的周末安排说完，她哭了一会儿，他还是没有松口：各自用一段时间重建生活，期间不联系、不看动态。三个月后他复盘，发现最难受的不是分手的决定，而是这段关系终于在清楚里结束——没有拖成互相消耗的拉锯。",
      "He led with the conclusion: ’I’ve decided — let’s end this. I’ve thought about it for a long time.’ She asked if it was last week’s fight; he said no — it was his reason: the futures they wanted stopped pointing the same way. She swallowed a ’so what about us later’, and he swallowed the same line. No ’maybe’, no ’let’s just take a break’. They settled the deposit, the two keys, the cat’s weekend schedule. She cried; he held the line. They agreed on real distance for a while — no contact, no checking each other’s feeds. Three months on, he found the hardest part wasn’t the decision: it was that this ended clearly, without dragging into mutual attrition.",
    ),
    takeaway: L(
      "不留「以后也许」不是冷酷，而是不给对方一个需要反复解读的空头承诺；结论清楚、事务落地、联系有边界，体面就从这里来。",
      "Withholding ’maybe someday’ isn’t cruelty — it simply leaves no promise for the other person to keep re-reading. A clear conclusion, settled logistics, and bounded contact are what dignity is made of.",
    ),
    competencies: ["self-management", "relationship-skills"],
    skills: ["emotion-regulation", "communication"],
    context: "romantic",
    keywords: ["breakup", "closure", "clean", "no false hope", "logistics", "分手"],
    loveTopic: "breakup",
  },
  {
    id: "love-case-long-distance-checkin",
    title: L("一次把深夜的等待说成请求的通话", "The Late-Night Call That Turned Waiting Into a Request"),
    source: { book: "Goutoujunshi skill", author: "Community practice" },
    situation: L(
      "阿凯和伴侣异地大半年，时差两小时。最近伴侣项目收尾，常常深夜才回消息。某天晚上十一点半，阿凯盯着对话框里下午发的那句「今天忙吗」，手机屏幕亮了——只有两个字：「在忙」。",
      "Kai and his partner have been long-distance for over half a year, two hours of timezone apart. The partner is closing out a project and replies late most nights. At 11:30 one evening Kai stares at that afternoon’s ’busy today?’; the screen lights up with two words: ’swamped now.’",
    ),
    whatHappened: L(
      "阿凯的第一反应是回「你忙你就忙，我算什么」。他在发送前停住，把这句话划掉，改成了三段：先说事实（「这一个多月你回消息都在深夜」），再说感受（「我其实不是气你忙，是感觉自己被放到了很末尾」），最后给一个具体请求（「项目结束前，能不能每晚睡前给我留一条语音，不用长，十几秒就行」）。对方第二天回了很长的语音，第一次聊了那个项目的死线，也认下了这个约定。后来的每个晚上，一条十几秒的语音都准时到。",
      "Kai’s first impulse was ’fine, you’re so busy, then where the hell do I stand’. He paused before sending, deleted it, and rewrote in three parts: a fact (’for over a month your replies have come in the dead of night’), a feeling (’I’m not angry about the work — I feel like I’ve been moved to the very bottom’), and one concrete request (’until the project wraps, can you leave me one voice message before bed each night — nothing long, fifteen seconds will do’). The partner replied the next day with a long voice memo, talked about the deadline for the first time, and took on the ritual. Every night since, a fifteen-second message has shown up on time.",
    ),
    takeaway: L(
      "深夜的等待最有杀伤力的不是没有回复，而是没有解释的沉默；把「我需要你回应我」说成一个具体、可执行、可兑现的请求，比一句「你根本不在乎」更能换来真正的东西。",
      "The most corrosive part of a late-night wait isn’t the missing reply — it’s silence with no explanation. Turning ’I need you to respond to me’ into one specific, doable, keepable request buys far more than an accusation of not caring.",
    ),
    competencies: ["self-management", "relationship-skills"],
    skills: ["emotion-regulation", "communication"],
    context: "romantic",
    keywords: ["long distance", "request", "late night", "ritual", "response", "深夜"],
    loveTopic: "long-distance",
  },
  {
    id: "love-case-meet-parents",
    title: L("把紧张说出口的那顿晚饭", "The Dinner Where They Said It Out Loud"),
    source: { book: "Goutoujunshi skill", author: "Community practice" },
    situation: L(
      "小周第一次见男友的父母。进门那一刻，他妈妈的两连问就来了：「你们打算什么时候结婚？房子首付你家出多少？」小周既怕答错又怕冷场，后背一层汗，几乎想用「阿姨您说得对」把每一句都糊回去。",
      "Zhou meets her boyfriend’s parents for the first time. At the door, the double-barrel starts: ’So when’s the wedding? And how much is your family putting up for the down payment?’ Zhou is terrified of saying the wrong thing and terrified of silence, sweating through her shirt, tempted to answer every question with ’whatever you say, Auntie’.",
    ),
    whatHappened: L(
      "她没打太极，也没硬接。她诚实地说：「说实话阿姨，我今晚特别紧张。结婚和房子都是大事，我没法当场答，但我可以跟你们讲讲我们平时怎么相处的。」然后她从自己开始讲：自己的工作、他们的相处、他们怎么分工家务。他妈妈追问婚期时，她温和地补了一句：「这个得我们两个人商量了再跟你们说。」男朋友在桌下握了握她的手。那晚结束时，他妈妈说了句「这孩子实在」，而小周发现自己真的喘过气来了——不是因为她答对了题，而是她终于没把自己当成考生。",
      "She neither dodged nor parried. She said, honestly: ’To be honest, Auntie, I’m really nervous tonight. Weddings and houses are big calls — I can’t answer on the spot. But I can tell you how we actually get along.’ Then she started with herself: her work, their rhythm, how they split chores. When the wedding question circled back, she answered softly: ’That one we’ll talk over ourselves, and then come back to you.’ Her boyfriend squeezed her hand under the table. At the end his mother said ’She’s the real deal’, and Zhou found she could finally breathe — not because she’d answered every question right, but because she’d stopped auditioning.",
    ),
    takeaway: L(
      "把考试换成关系，第一步往往是先说出自己的紧张——诚实是一种气氛，而不是一个答案；然后把决定权留给你们两个人，你的诚实和他们的尊重就会互相找到。",
      "Swapping the exam for a relationship often starts by just saying you’re nervous — honesty is an atmosphere, not an answer. Keep the decisions between the two of you, and your honesty and their respect tend to find each other.",
    ),
    competencies: ["social-awareness", "relationship-skills"],
    skills: ["social-norms", "communication"],
    context: "romantic",
    keywords: ["meeting the family", "anxiety", "honesty", "decisions", "norms", "见家长"],
    loveTopic: "family",
  },
];