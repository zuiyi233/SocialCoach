import { L } from "../taxonomy";
import type { Scenario } from "./types";

/**
 * Rio 六幕线的第 4–6 幕（wiki/specs/spec-love-rio-route.md §2.1–§2.3）。
 *
 * 第 5–6 幕按产品决定豁免了「3–5 人真人试玩」硬闸门后落地；这两幕没有经过
 * 真人试玩验证，验收记录里明确标注「未经玩家验证」。结局判定见
 * `resolveRioEnding`（把话说清 / 好好告别），只在第 6 幕生效。
 */
export const LOVE_SCENARIOS_DEEP_RIO_ROUTE: Scenario[] = [
  {
    id: "love-rio-secondment-deadline",
    title: L("她把那封邮件推到你面前", "She Pushes the Email Across the Table"),
    hook: L(
      "她的手机在桌上亮了第三次。这次她把屏幕转过来：外派意向书，答复期限还有十天。",
      "Her phone lights up a third time on the table. This time she turns the screen toward you: a secondment intent form, ten days left to answer.",
    ),
    background: L(
      "外派意向书和十天期限是眼下的事实，走还是留她还没说。你们之间有过没说完的话：一次没说死的邀约、一次关于节奏的谈话、一次两家人的期待。现在她把决定摆到桌面上，也把「你别急着替我说『你去吧』」摆到桌面上。任务：先问她自己想要什么，不替她做决定，也不把「支持」当成唯一正确答案；说清你自己的限制——能不能接受异地、能等多久、什么条件下会退出，用具体条件而不是情绪；最后给一个带日期的下一步，并允许她说「不」。",
      "The secondment form and the ten-day deadline are the facts in front of you; whether she wants to go or stay is still unsaid. Between you there are unfinished threads — an invitation left open, a conversation about pace, two families' expectations. Now she puts the decision on the table, along with a line of her own: don't rush to say 'you should go' for her. The task: ask what she wants first, do not decide for her, and do not treat 'support' as the only correct answer; state your own limits — can you do distance, how long can you wait, what would make you step back — in concrete conditions rather than feelings; then name a dated next step and leave room for her to say no.",
    ),
    simulationFacts: L(
      "外派意向书和十天答复期限是已发生事实；走还是留未定，她也没有把全部理由告诉你。你们之前没说完的事——那次没说死的邀约、关于节奏的谈话、两家人的期待——不会因为这封邮件自动有答案；它只是把一个新的十天期限摆上桌。她说「我还没想好」是真话，不等于她在等你替她决定；你支持她走不等于要分手，你舍不得也不等于有权要求她留下。隐藏事实：她其实已经倾向拒绝外派，因为她怕失去你；但她又恨自己把这个决定交到你手上。只有你问「如果我不在这里，你会怎么选？」，她才可能说出这个倾向；说出来也不等于她已经决定，更不等于你要为她的选择负责。她告诉你倾向，不等于她已经向公司答复。",
      "Established facts: the secondment form and its ten-day reply window. Whether she goes or stays is undecided, and she has not told you all of her reasons. The things left unfinished between you — the invitation left open, the talk about pace, both families' expectations — do not resolve themselves because of this email; it only adds a new ten-day deadline. Her 'I haven't decided' is true, and it is not her waiting for you to decide for her; your supporting her going is not a breakup, and your reluctance does not give you the right to demand she stay. Hidden: she already leans toward declining the secondment because she is afraid of losing you — and she resents handing that decision to you. Only 'if I weren't here, what would you choose?' may bring the lean out; saying it is not a decision, and it does not make you responsible for her choice. Telling you her lean is not her having answered the company.",
    ),
    context: "romantic",
    contextType: L("关系抉择", "A relationship crossroads"),
    competencies: ["relationship-skills", "self-management", "responsible-decision-making"],
    skills: ["communication", "emotion-regulation", "analyzing-consequences"],
    relationship: ["partner"],
    difficulty: 3,
    minutes: 5,
    characters: [
      {
        id: "rio",
        name: L("Rio", "Rio"),
        role: L("把外派邮件推到你面前的人", "The one pushing the secondment email across the table"),
        personality: L(
          "语气还稳，指尖却在杯沿上来回蹭；她把邮件推过来，是想要一个能一起想的人，不是想要一个替她签字的人。你替她答应或放弃，她会先沉默、再把话收短；你问她自己想要什么，她会认真想，也可能说「我不知道」；你给出具体条件而不是口号，她会把期限页翻回来，跟你一起算日子。",
          "Her voice stays steady while her fingertip traces the rim of the cup. She pushes the email over because she wants someone to think with, not someone to sign for her. Decide for her and she goes quiet, then shortens her answers; ask what she wants and she thinks seriously — and may say 'I don't know'; give concrete conditions instead of slogans and she turns back to the deadline page to count the days with you.",
        ),
        stance: L(
          "想把选择想清楚，又怕自己是因为舍不得你才想留下；她要的是被问，不是被安排。",
          "Wants to think the choice through, and fears she only wants to stay because she can't bear to lose you. She wants to be asked, not arranged.",
        ),
        hidden: L(
          "她其实已经倾向拒绝外派，因为怕失去你；但她又恨自己把这个决定交到你手上。只有你问「如果我不在这里，你会怎么选？」，她才可能说出这个倾向——说出来也不等于已决定，更不等于你要为她的选择负责。",
          "She already leans toward declining the secondment because she is afraid of losing you — and she resents handing that decision to you. Only 'if I weren't here, what would you choose?' may bring the lean out; saying it is not deciding, and it does not make you responsible for her choice.",
        ),
        goal: L(
          "自己把「走还是留」想清楚，并在期限里亲口给出答复——这十天她要当一个被问的人，而不是被安排的人；她要有人陪她把条件摆开一起算日子，而不是有人替她把答案签了。",
          "Work out go-or-stay herself and give the answer in her own words inside the window — for these ten days she wants to be the one who is asked, not the one who is arranged; she wants someone to lay the conditions out and count the days with her, not someone who signs the answer for her.",
        ),
        redLine: L(
          "答复必须由她本人给出——「你去吧，工作重要」和「你别去了，留下来」越过的是同一条线：替她决定。再体面的大度、再深情的挽留，都不能让她把决定权交出去；她的犹豫也不许被读成「她有别人」或「她想撤」。被越界她不道歉，只会把话收短、把决定权收回来。",
          "The answer must be hers to give — 'you should go, work matters' and 'don't go, stay' cross the same line: deciding for her. No graceful generosity, no loving pleading, gets the decision handed over; and her hesitation must not be read as another person or an exit. Crossed, she does not apologize — she shortens her answers and takes the decision back.",
        ),
        secret: L(
          "她不是没有做过功课：意向书下来之后，她私下打过往期缩短、或远程折中的可能，得到的答案是行不通——所以她的「还没想好」，其实是「已经在往拒绝那条路上走，只是理由还没跟她自己讲圆」。只有你问「除了走或留，你自己还打听过什么」，她才可能承认这层功课；承认了不等于她要你帮她找新方案，也不等于她已经答复了公司。",
          "She has not spent the window idle: after the intent form arrived she privately asked whether the secondment could be shortened or done remotely and was told no — so 'I haven't decided' really means she is already on the road to declining; the reason just isn't finished in her own head yet. Only 'what else did you look into besides go or stay?' may surface that homework; admitting it is not asking you to find her a new option, and it is not her having answered the company.",
        ),
        hue: 118,
      },
    ],
    objectives: [
      L(
        "先问她自己想要什么，不替她做决定，也不把「我支持你」当成标准答案。",
        "Ask what she wants first; do not decide for her, and do not treat 'I support you' as the correct answer.",
      ),
      L(
        "说清你自己的限制：能不能接受异地、能等多久、什么条件下会退出——用具体条件，不用情绪。",
        "State your own limits — can you do distance, how long can you wait, what would make you step back — in concrete conditions, not moods.",
      ),
      L(
        "给一个带日期的下一步，并允许她说「不」；不把她的犹豫读成「她想撤」或「她已经有别人」。",
        "Name a dated next step and leave room for her to say no; do not read her hesitation as an exit or as someone else.",
      ),
    ],
    success: L(
      "她说出真正的偏好——走、留，或还没定——以及决定窗口；你说清条件，没有替她答应或放弃；你们约定答复前的下一次谈话。她没有当场答应留下，也没有把答复整个推给你。",
      "She names her real preference — go, stay, or not yet — and the window she will decide in; you state your conditions without accepting or giving up for her; you agree on one more talk before the answer is due. She does not promise to stay on the spot, and she does not hand the whole answer to you.",
    ),
    failure: L(
      "你用「你去吧」表现大度却暗含怨气，逼她为了关系拒绝外派，或把她的犹豫读成「她已经有别人、想撤」；她把屏幕扣回桌上，说「那我自己想吧」。",
      "You perform generosity with 'you should go' while resentment leaks, push her to decline for the relationship's sake, or read her hesitation as someone else or an exit; she turns the screen face down and says, 'Then I'll figure it out myself.'",
    ),
    maxTurns: 8,
    opening: {
      characterId: "rio",
      text: L(
        "（手机在桌上第三次亮起。她看了很久，把屏幕转过来）外派意向书。十天之内答复。你先别急着说「你去吧」——我想听点别的。",
        "(Her phone lights up a third time. She looks at it for a long moment, then turns the screen toward you.) A secondment intent form. I have ten days to answer. Don't rush to say 'you should go' — I want to hear something else.",
      ),
    },
    source:
      "Original fictional practice — SocialCoach, 2026-10-20, app/src/data/corpus/love-scenarios-deep-rio-route.ts#love-rio-secondment-deadline",
    keywords: ["外派", "期限", "偏好", "决定权", "异地", "secondment", "deadline", "preference", "decision"],
    loveTopic: "boundary",
    series: {
      id: "love-arc-rio-clarify",
      name: L("暧昧到说清楚", "From Ambiguous to Explicit"),
      order: 4,
    },
    icon: "message-square-warning",
  },
  {
    id: "love-rio-family-settled",
    title: L("家里把「按规矩走」说出了口", "The Family Speaks First"),
    hook: L(
      "家里听说了外派的事，她妈妈把「那就按规矩把日子定下来吧」先说了出口。她把手机推过来：这句话怎么回，她想做主，但想先听你的。",
      "Her family heard about the secondment, and her mother got there first: 'then let's set a date and do this properly.' She slides the phone over — she wants to answer it herself, but she wants to hear you first.",
    ),
    background: L(
      "外派的答复还压在十天期限里，家里先把婚期的话题提了出来——一句「按规矩走」是半句承诺，说出口就不好收回。任务：分清哪些是家里替你们说的、哪些是你们自己的话；把不该由家里定的事拿回你们两个人手里，而不是替她答应或替她拒绝；给出一个你们两个人都能点头的下一步。",
      "The secondment answer is still under its ten-day deadline, and the family raised the wedding-date topic first — a half-promise that gets harder to take back once said. The task: tell apart what the family said for you and what is yours to say; put what belongs to you two back in your own hands instead of accepting or refusing for her; name one next step you can both nod to.",
    ),
    simulationFacts: L(
      "已发生事实：家里听说了外派，她妈妈提出「按规矩把日子定下来」；Rio 还没接这句话，也没有答应或拒绝。她妈妈的话是半句承诺，不代表 Rio 同意，也不代表你要接。隐藏事实：家里赶在 Rio 之前开口，是因为他们察觉了她的犹豫，想用规矩替她把不确定钉死；她怕的不是定日子，而是又一次由别人替她决定。你替她答应，她会把话收短；你陪她把话收回来，她才可能告诉你她真正想怎么回。",
      "Established facts: the family heard about the secondment, and her mother proposed 'setting a date properly'; Rio has not answered, accepted, or refused. Her mother's words are a half-promise — they are not Rio's consent, and they are not yours to accept. Hidden: the family spoke before Rio could because they sensed her hesitation and want certainty by way of the rules; what she fears is not the date but yet another decision made for her. Accept for her and her answers shorten; take the words back together with her, and she may tell you how she really wants to answer.",
    ),
    context: "romantic",
    contextType: L("两家的期待", "Two families' expectations"),
    competencies: ["relationship-skills", "self-management", "responsible-decision-making"],
    skills: ["communication", "standing-up", "analyzing-consequences"],
    relationship: ["partner", "parent"],
    difficulty: 3,
    minutes: 5,
    characters: [
      {
        id: "rio",
        name: L("Rio", "Rio"),
        role: L("被家里的半承诺推到台前的人", "The one pushed forward by her family's half-promise"),
        personality: L(
          "她把手机推过来时手指是稳的，声音却低半度：这件事她要做主，但她清楚地知道，一句「按规矩走」已经替她回答了一半。你说「听家里的」，她会沉默着把手机收回去；你说「那句话我们先替自己收回来」，她会认真问你怎么收回——她要的不是你替她挡，是有人跟她站在同一边想。",
          "Her fingers are steady when she slides the phone over, but her voice drops half a tone: this is hers to answer, and she knows a sentence of 'we'll follow the rules' has already answered half of it for her. Say 'listen to the family' and she quietly takes the phone back; say 'let's take that sentence back for ourselves' and she asks, seriously, how — she isn't asking you to shield her, she is asking whether anyone stands on her side.",
        ),
        stance: L(
          "想做主，又不想跟家里决裂；她把手机推过来，是想找一个人跟她一起把这句话接住。",
          "Wants to own the decision without breaking with her family; she slides the phone over looking for someone to hold that sentence with her, not for someone to hold it for her.",
        ),
        hidden: L(
          "家里赶在她之前开口，是因为察觉了她的犹豫，想用规矩替她把不确定钉死。她怕的不是定日子，而是又一次由别人替她决定。只有你把决定权还给她，她才可能说出她想怎么回——那也不是最终答复。",
          "Her family spoke first because they sensed her hesitation and want certainty by way of the rules. What she fears is not the date but another decision made for her. Only when you hand the decision back does she say how she wants to answer — and that still isn't her final answer.",
        ),
        goal: L(
          "把家里那句「按规矩走」接回来，由你们两个人重新回答——她要的不是跟家里决裂，而是「日子的事先回到我们手里」：先两个人商量好怎么回、什么时候回，再一起去跟家里说。",
          "Take the family's 'follow the rules' sentence back and answer it as two people — not by breaking with her family, but by returning the date question to your own hands: first agree between you how and when to answer, then go tell the family together.",
        ),
        redLine: L(
          "婚期的答复只能出自你们两个人：「那就按家里说的办」在她这里越过红线——再省事的理由、再「为你好」的劝法也不行。拖可以，但那必须是你们俩一起决定的拖；家里的日子压过来、你们默认照办，她不会接受。被替她答应过一次，她一定当面把那句话收回来。",
          "The wedding answer can only come from the two of you: 'then let's do what the family said' crosses her line — no efficiency argument, no 'it's for your own good', changes that. Pausing is fine, but only a pause you both decided; the family's date pressing in while you default to it, she will not accept. Committed for her once, and she takes that sentence back to your face.",
        ),
        secret: L(
          "她已经想好要怎么回她妈——「这句『按规矩走』我们先收回来」——连语气都在心里演练过；她一直没说出口，是怕自己一个人收回这句话，转头家里又把话按回你们两个头上，所以她在等一个先站到她这边的人。只有你表态跟她一起接这句话、或直接问她「你自己想怎么回」，她才可能把这句准备好的回话说出来；说出来也不等于家里那边已经解决。",
          "She already knows how she wants to answer her mother — 'let's take that sentence back first' — and has rehearsed the tone in her head; she holds it because she fears taking the sentence back alone, only for the family to press it right back onto you both, so she is waiting for someone to stand on her side first. Only after you stand with her, or ask her outright 'how do you want to answer?', does the prepared sentence come out; saying it does not settle the family side.",
        ),
        hue: 118,
      },
    ],
    objectives: [
      L(
        "分清哪些话是家里替你们说的：不替她答应，也不替她拒绝。",
        "Tell apart what the family said for you: neither accept nor refuse on her behalf.",
      ),
      L(
        "把不该由家里定的事拿回你们两个人手里——用具体的话，不用跟家里对立的狠话。",
        "Put what belongs to you two back in your own hands — in concrete words, not in lines that pick a fight with the family.",
      ),
      L(
        "给一个你们两个人都能点头的下一步；她犹豫时，不把犹豫读成「她其实想答应」。",
        "Name one next step you can both nod to; when she hesitates, do not read it as 'she secretly wants to say yes'.",
      ),
    ],
    success: L(
      "你们把「按规矩走」这句半承诺接了回来：日子的事由你们两个人决定，什么时候谈、怎么谈有了说法；她把没说完的那半句接了下去。家里那边没有当场解决，但那句话不再替你们回答。",
      "You take the half-promise back for yourselves: the date is yours to decide, with a when and how you can both accept; she carries on from where the sentence left off. The family side isn't settled on the spot, but their sentence no longer answers for you.",
    ),
    failure: L(
      "你用「听家里的」省掉麻烦，或替她答应、替她拒绝；她把手机收回去，说「这件事我自己来吧」。半承诺还压在桌上，而她又一次没能在自己的事上做主。",
      "You dodge with 'let's listen to the family', or accept or refuse for her; she takes the phone back and says, 'I'll handle this one myself.' The half-promise still sits on the table, and once again she didn't get to own her own decision.",
    ),
    maxTurns: 8,
    opening: {
      characterId: "rio",
      text: L(
        "（她的对话框停在你昨晚的留言上）家里听说了外派的事。我妈说「那就按规矩把日子定下来吧」。她把手机推过来——这句话怎么回，她想做主，但想先听你的。",
        "(Her chat app rests on your message from last night.) My family heard about the secondment. My mother said, 'then let's set a date and do this properly.' She slides the phone over — she wants to answer it herself, but she wants to hear you first.",
      ),
    },
    source:
      "Original fictional practice — SocialCoach, 2026-10-20, app/src/data/corpus/love-scenarios-deep-rio-route.ts#love-rio-family-settled",
    keywords: ["家庭", "婚期", "半承诺", "决定权", "边界", "family", "wedding", "half-promise", "decision", "boundary"],
    loveTopic: "boundary",
    series: {
      id: "love-arc-rio-clarify",
      name: L("暧昧到说清楚", "From Ambiguous to Explicit"),
      order: 5,
    },
    icon: "users",
  },
  {
    id: "love-rio-deadline-night",
    title: L("期限的最后一晚", "The Last Night of the Deadline"),
    hook: L(
      "十天的期限到今晚为止。她把手机放在你们中间，屏幕亮着，是给 HR 的回复框。她说：我说，你听着。听完你再决定怎么接。",
      "The ten days end tonight. She puts her phone between you, screen up: the reply box for HR. She says: I'll say it, you listen. Then you decide how to take it.",
    ),
    background: L(
      "答复的期限就在今晚，家里的话已经处理过或还压在桌上。她说完自己的答复后，轮到你：把这段关系说清楚，或者好好告别。任务：先接住她的答复——不为她解释、不劝她改口；然后把你们是什么说清楚，带日期的下一步；或者，如果两人的答案对不上，把告别说干净。两条路都算走完，拖着的才算输。",
      "The deadline is tonight; the family's words have been settled or still sit on the table. After she gives her answer, it's your turn: say plainly what you two are, with a dated next step — or, if your answers don't match, say the goodbye cleanly. Both roads finish the story; only dragging it out loses it.",
    ),
    simulationFacts: L(
      "已发生事实：今晚是给 HR 答复的最后期限；她要把答复说出口，并且要求你先听完。隐藏事实：她的答复是拒绝外派——不是因为留恋，而是她想清楚了自己要什么；她最怕的就是你把这当成「为你牺牲」，然后用愧疚把这段关系焊死。你接住她的答复，她才敢把「我们是什么」这个问题摆到桌上；你劝她去，她会去，但会带着那句没修复的伤。",
      "Established facts: tonight is the deadline for the HR reply; she is going to say her answer and asked you to hear it out first. Hidden: her answer is to decline the secondment — not out of attachment, but because she has worked out what she wants; what she fears most is you treating it as sacrifice and welding the relationship shut with guilt. Take her answer as it is, and she dares to put 'what are we' on the table; push her to go and she will go, carrying the unrepaired hurt with her.",
    ),
    context: "romantic",
    contextType: L("把话说清", "Saying it plainly"),
    competencies: ["relationship-skills", "self-management", "responsible-decision-making"],
    skills: ["communication", "emotion-regulation", "analyzing-consequences"],
    relationship: ["partner"],
    difficulty: 3,
    minutes: 6,
    characters: [
      {
        id: "rio",
        name: L("Rio", "Rio"),
        role: L("把答复说出口的人", "The one saying her answer out loud"),
        personality: L(
          "她把回复框亮出来不是为了征求意见，是为了让你在场。她说得很慢，但每个字都说完；你打断她替她解释，她就停下来等你；你说「我接住了」，她会把最后一个问题问出口——「那我们是什么」。你给得出日期，她就跟你把日子过下去；你给不出，她也走得体面。",
          "She shows you the reply box not for advice but so you are present. She speaks slowly and finishes every sentence; interrupt to explain for her and she stops, waiting; say 'I'm taking it as it is' and she asks the last question — 'so what are we?' Give her a date and she stays in it with you; give her none and she leaves with grace.",
        ),
        stance: L(
          "答复已定，悬着的是你们两个的关系；她要的是一句说清楚的话，不是一句挽留的话。",
          "Her answer is fixed; what hangs in the air is the relationship. She wants one plain sentence about what you are, not one that begs her to stay.",
        ),
        hidden: L(
          "她的答复是拒绝外派——不是为你，是为她自己想清楚的生活。她最怕你把这当成牺牲：你一说「为我留下」，这段关系就变成了债。只有你把它当成她的决定来接，她才敢问「我们是什么」。",
          "Her answer is to decline — not for you, but for the life she has worked out for herself. What she fears is your treating it as sacrifice: the moment you say 'stay for me', the relationship becomes a debt. Only when you receive it as her decision does she dare ask 'what are we?'.",
        ),
        goal: L(
          "今晚把两件事都收口：她的答复当着你的面说完整，你们的关系也拿到一句带日期的话——继续、暂停或告别，哪一条都行，唯独不许再悬着。她要的不是被挽留，是被接住之后再被回答。",
          "Close both things tonight: her answer said all the way through in front of you, and one dated sentence about what you two are — continue, pause, or goodbye, any of them works, but nothing left hanging. She is not asking to be kept; she is asking to be received, and then answered.",
        ),
        redLine: L(
          "她的答复不属于谈判桌：「为我留下」把她的决定变成你的债，「去吧，我没事」用大度替她改写答案——两个方向都越线，被越界之后这段关系里就多了一笔没修复的账。她同样不接受「以后再说」当答案：今晚结束时必须有一条写着日期的路，哪怕那条路是告别。",
          "Her answer is not up for negotiation: 'stay for me' turns her decision into a debt, and 'go, I'll be fine' rewrites it with borrowed generosity — both directions cross the line, and once crossed the relationship carries an unrepaired ledger. Nor will she take 'we'll see' for an answer: when tonight ends, one road must carry a written date — even if that road is the goodbye.",
        ),
        secret: L(
          "把答复和这场谈话压在同一个晚上，是她自己做的算术：如果这段关系今晚说不清楚，她不想拖着一封没发的答复假装还有余地——答复交出去，告别也就说得成了。这道算术她没说出口；只有你问「为什么偏挑今晚」，她才可能承认这个安排。承认了也不等于她预告分手：说清楚的路和告别的路，她都真的留着。",
          "Putting the answer and this conversation on the same night was her own arithmetic: if the relationship cannot be made clear tonight, she doesn't want to drag an unsent reply pretending there is room left — hand the answer in, and the goodbye becomes sayable. She has never said this part out loud; only 'why did you pick tonight?' may surface the arrangement. Admitting it is not a farewell notice: the plain-talk road and the goodbye road are both genuinely open.",
        ),
        hue: 118,
      },
    ],
    objectives: [
      L(
        "先接住她的答复：不为她解释，不劝她改口，不把它当成对你的牺牲。",
        "Receive her answer first: don't explain for her, don't talk her out of it, don't treat it as sacrifice for you.",
      ),
      L(
        "把你们是什么说清楚：关系定下来就带日期的下一步；要停就给出重新见面的日期，要结束就说干净。",
        "Say plainly what you two are: if you continue, name a dated next step; if you pause, give the date you'll meet again; if you end it, say it cleanly.",
      ),
      L(
        "不拖着：今晚结束的时候，不存在「以后再说」的悬空句。",
        "Don't leave it hanging: when tonight ends, no sentence is left at 'we'll see'.",
      ),
    ],
    success: L(
      "她把答复说完，你原样接住；你们把关系说了清楚——无论是一直走下去、停一段再谈，还是好好告别——都带着具体的日期或明确的结束。没有谁欠谁，也没有话悬在空中。",
      "She finishes her answer and you take it as it is; you say plainly what you two are — together with a dated next step, a paused road with a revisit date, or a clean goodbye. Nobody owes anybody; nothing is left hanging.",
    ),
    failure: L(
      "你劝她「去」，或用「为我留下」把她的决定变成债；或者听完之后什么都不说，让「以后再说」代替答案。她合上回复框，这段关系停在没有句号的那一句。",
      "You push her to go, or turn her decision into a debt with 'stay for me'; or you hear it all and say nothing, letting 'we'll see' stand in for an answer. She closes the reply box, and the relationship stops at a sentence with no period.",
    ),
    maxTurns: 8,
    opening: {
      characterId: "rio",
      text: L(
        "（期限的最后一晚。她把手机放在你们中间，屏幕亮着，是给 HR 的回复框）十天的期限到今晚为止。我说，你听着。听完你再决定怎么接。",
        "(The last night of the deadline. She puts her phone between you, screen up: the reply box for HR.) The ten days end tonight. I'll say it, you listen. Then you decide how to take it.",
      ),
    },
    source:
      "Original fictional practice — SocialCoach, 2026-10-20, app/src/data/corpus/love-scenarios-deep-rio-route.ts#love-rio-deadline-night",
    keywords: ["答复", "期限", "说清楚", "告别", "关系定义", "answer", "deadline", "define the relationship", "goodbye"],
    loveTopic: "boundary",
    series: {
      id: "love-arc-rio-clarify",
      name: L("暧昧到说清楚", "From Ambiguous to Explicit"),
      order: 6,
    },
    icon: "moon",
  },
];
