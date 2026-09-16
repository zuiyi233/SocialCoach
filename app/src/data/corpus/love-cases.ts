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
];