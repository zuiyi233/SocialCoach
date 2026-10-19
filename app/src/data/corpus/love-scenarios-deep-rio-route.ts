import { L } from "../taxonomy";
import type { Scenario } from "./types";

/**
 * Rio 六幕线的第 4 幕（wiki/specs/spec-love-rio-route.md §2.1）。
 *
 * 硬闸门：先只做第 4 幕 + 状态层，3–5 人真人试玩通过后才写第 5–6 幕。
 * 这一批不产生第 5/6 幕语料，也不写两个命名结局的最终场景。
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
];
