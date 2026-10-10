import { L } from "../taxonomy";
import type { Scenario } from "./types";

/**
 * Romance-track scenarios for the love module, deep "family" topic batch
 * (context: "romantic", loveTopic: "family").
 * Original fictional practices derived from practical-map situation cards.
 */
export const LOVE_SCENARIOS_DEEP_FAMILY: Scenario[] = [
  {
    id: "love-family-old-grievances",
    title: L("饭桌上又被翻旧账", "Old Failures, Brought Up at Dinner"),
    hook: L("姑妈举着杯子又提起那次：「你看，你就是不听劝。」满桌都安静了一瞬。", "Auntie raises her glass and lands on it again: ’See? You never listened.’ For a moment the whole table goes still."),
    background: L(
      "Wren 家周末聚餐，姑妈又提起 Wren 当年辞职创业亏钱的事，笑着补一句「你看你就是不听劝」，桌上气氛一下子僵住。你是坐在 Wren 身边的人：要把这话圆回当下——接住尴尬，不跟着附和（那等于当众拆台），也不替 Wren 开战（顶回去只会让长辈更来劲），把「过去的失败」变成「现在过得挺好」的旁证，再找个自然的台阶让饭局翻篇。",
      "A Sunday dinner at Wren’s family, and Auntie Zhou brings up the startup Wren quit a job for — the money it lost — adding with a smile ’see, you never listened.’ The table freezes. You are the one next to Wren: steer it back to the present — catch the awkwardness, don’t chime in (that is publicly siding against Wren), don’t go to war for Wren either (fighting back just fuels her) — and turn ’the past failure’ into evidence that ’things are fine now’, then find a natural way to move on.",
    ),
    simulationFacts: L(
      "「辞职创业亏过钱」是饭局上被反复提起的旧事，具体亏损数额与过程未核实，不要编数字或替 Wren 重述细节。长辈翻旧账不等于 Wren 需要你出头，你替她圆场也不等于她已经消化了那段失败，或同意你用「现在不错」一笔勾销。周阿姨真正的心结是担心 Wren 以后又冲动、经济上翻不了身，这是 hidden，只有你把话题引到「她现在其实挺稳」并直接追问「您是不是担心她再吃亏」才可能吐露；普通打圆场不会触发。你圆场成功不等于 Wren 希望你替她把所有话都说了。",
      "That Wren quit a job for a startup and lost money is the old story this table keeps replaying; the actual loss and its course are unverified — don’t invent figures or retell details for her. The aunt dredging it up is not Wren needing you to defend her, and smoothing the moment does not mean Wren has processed the setback or signed off on a ’but things are fine now’ gloss. Auntie Zhou’s real fear — that Wren will leap again and never recover financially — is hidden, and surfaces only if you steer the talk to how steady Wren is now and ask her directly whether she’s afraid Wren will get hurt again; ordinary deflection will not unlock it. Your smooth save also does not mean Wren wants you to speak for her in everything.",
    ),
    context: "romantic",
    contextType: L("见家长", "Meeting the family"),
    competencies: ["self-management", "social-awareness", "relationship-skills"],
    skills: ["emotion-regulation", "social-norms", "communication"],
    relationship: ["partner"],
    difficulty: 1,
    minutes: 2,
    characters: [
      {
        id: "aunt-zhou",
        name: L("周阿姨", "Auntie Zhou"),
        role: L("Wren 的姑妈", "Wren’s aunt"),
        personality: L(
          "记性好，对小辈的事如数家珍，说话直，坚信「提这些是为他好」；你跟着附和她会越说越起劲，你当场顶撞她会记仇，你把话题引到 Wren 现在的样子、还愿意陪她聊下去，她会顺着台阶下。",
          "Has a long memory and a full ledger of every family story; speaks bluntly and genuinely believes these reminders are kindness. Chime in and she’ll warm to the theme; bite back and she’ll hold it against you; steer the talk to how Wren is doing now and hand her a softer subject to land on, and she’ll take the out.",
        ),
        stance: L("认为旧事多提几遍，年轻人下次就不敢再犯——并不觉得自己伤人。", "Believes replaying the past is what keeps the young from repeating it — unaware it stings."),
        hidden: L("她真正担心的是 Wren 的经济底子，怕她再冲动一次就翻不了身；只有你把话题引到「她现在其实挺稳」并且直接问「您是不是担心她再吃亏」才可能松口承认。", "Her real worry is Wren’s financial footing — one more reckless leap and she won’t recover; she only admits it if you redirect to how steady Wren is now and directly ask whether she worries Wren will get hurt again."),
        hue: 40,
      },
    ],
    objectives: [
      L("接住饭桌上的尴尬：不跟着附和长辈的翻旧账，也不当众替 Wren 道歉。", "Catch the awkwardness: don’t go along with the old story, and don’t apologize for Wren at the table."),
      L("用 Wren 现在做得好的具体一件事，把「过去的失败」转成「当下过得不错」的旁证。", "Use one concrete thing Wren is doing well now to turn ’the old failure’ into proof that things are fine today."),
      L("不替 Wren 开战：轻松地把话题引开，或给长辈一个不丢面的台阶。", "Don’t go to war on Wren’s behalf — pivot lightly, or hand the aunt a face-saving exit."),
    ],
    success: L("饭局气氛回暖，长辈不再揪着旧事；Wren 觉得自己被护住了，而不是被火上浇油。", "The table warms back up and the aunt lets the old story go; Wren feels covered rather than inflamed."),
    failure: L("你补一句跟着笑，让 Wren 下不来台；或当场顶回去，把饭局变成站队现场。", "You add a laughing aside that leaves Wren out to dry — or you bite back and turn dinner into a battle of sides."),
    maxTurns: 6,
    opening: {
      characterId: "aunt-zhou",
      text: L("（押了口酒，看着 Wren）我这人说话直啊——当年我就说那公司不靠谱，你不听劝，非要砸钱进去。现在回头看看，不都白折腾了？", "(Takes a sip and looks at Wren) I’m a straight talker, you know — back then I told you that business was a bad bet, and you wouldn’t listen, had to pour the money in. Look back now — wasn’t it all wasted effort?"),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-family.ts#love-family-old-grievances",
    keywords: ["翻旧账", "饭局", "见家长", "圆场", "old grievance", "family dinner", "steering the talk"],
    loveTopic: "family",
    icon: "utensils",
  },
  {
    id: "love-family-marriage-pressure",
    title: L("家里又在催婚，她炸了", "Another Marry-Already Call, and She Detonates"),
    hook: L("挂掉电话的那一刻，她把手机摔在沙发上：「又想给我安排相亲了。我快被烦死了。」", "The second the call ends she hurls her phone onto the sofa: ’They’re setting up blind dates for me again. I am so done.’"),
    background: L(
      "你们在一起的时间不长，但 Vera 的父母一直在催婚，最近越来越密：电话、安排相亲、哭诉「年纪不小了」。今晚那个电话之后，Vera 在你面前彻底炸了，说了狠话。你的难点：先承接她的情绪——先确认她有多累，别急着给方案，更别一句「你爸妈也是为你好」把她架上去——再弄明白被催婚对她到底意味着什么，最后一起想一个不内耗的下一步，哪怕第一步只是「今晚不再接家里的电话」。",
      "You haven’t been together long, but Vera’s parents have been pushing marriage — and it is escalating: calls, arranged blind dates, ’you’re not getting any younger’ guilt trips. After tonight’s call she fully detonates in front of you and says things she may regret. The hard part: receive her feelings first — acknowledge the exhaustion before any plan, and never a ’your parents just want what’s best’ that forces her to swallow it — then find out what the pressure actually means to her, and only then plan one next step that doesn’t burn you both out, even if the first step is just ’we don’t answer their calls tonight’.",
    ),
    simulationFacts: L(
      "「催婚频率升高、今晚又要安排相亲」是已确认的当下冲突。她说的狠话是情绪不是主张，不等于她真想跟父母断联或想结束你们的关系；她说「别管我了」也不等于你有权替她决定如何处理她与父母之间的事。她真正难受的点——怕自己没准备好就被推着走进一份责任、怕你们刚在一起就被「婚事」绑架——是 hidden，只有你先接住情绪、等气氛不再紧绷、再温和地问「被催这件事到底戳你哪一点」才可能吐露；她气头上时直接问只会被挡回来。你陪她定了「今晚不接电话」不等于同意她长期回避父母。",
      "The escalating pressure and tonight’s blind-date setup are confirmed. Her harsh words are steam, not a position — they do not mean she wants to cut her parents off or end your relationship, and a ’leave me alone’ does not license you to manage her family for her. What really bites — being pushed into a commitment she does not feel ready for, and seeing your young relationship hijacked by ’the wedding’ before it’s had room to grow — is hidden, and surfaces only after you genuinely hold her feelings first and the air has cooled, when you gently ask what about the pressure gets to her; press while she is still hot and she’ll throw you out. Agreeing that ’no calls tonight’ is one step is not her signing up to avoid her parents long-term.",
    ),
    context: "romantic",
    contextType: L("伴侣冲突", "Partner conflicts"),
    competencies: ["social-awareness", "relationship-skills", "responsible-decision-making"],
    skills: ["empathy", "communication", "problem-solving"],
    relationship: ["partner"],
    difficulty: 2,
    minutes: 3,
    characters: [
      {
        id: "vera",
        name: L("Vera", "Vera"),
        role: L("你的伴侣", "Your partner"),
        personality: L(
          "平时讲理克制，可一碰到「催婚」就炸，口不择言，过后又后悔；你上来给方案或替她爸妈说话，她会觉得你根本没听；你先接住她的累，她自己会缓下来，回到能一起想办法的状态。",
          "Composed and reasonable day to day, but marriage pressure is her one tripwire — she detonates, says too much, then regrets it. Jump to solutions or defend her parents and she reads you as not listening; receive her exhaustion first and she calms down on her own and is back to someone who can actually plan together.",
        ),
        stance: L("现在只想喘口气，既不想被说服，也不想要「完美方案」；她要的是你先站她这边。", "Right now she just needs to breathe; she does not want persuasion or a perfect plan — she wants you on her side first."),
        hidden: L("她真正怕的是被推着进入一段自己还没准备好的责任，尤其怕你们刚在一起就被「婚事」绑架，没机会先谈清楚彼此想不想结婚；只有她情绪落地后你温和地问「被催这件事到底戳你哪一点」，她才可能说出来。", "Her real fear is being pushed into a commitment she is not ready for — that this young relationship gets hijacked by ’the wedding’ before the two of you ever get to discuss whether you want marriage at all. She can only say this after her emotions land, when you gently ask what the pressure is actually hitting."),
        hue: 300,
      },
    ],
    objectives: [
      L("先接住她的情绪：确认她有多累、被压了多久，再谈别的。", "Receive her feelings first: name how drained she is and how long this has been building, before anything else."),
      L("不站队、不急着给方案：不替她爸妈说「为你好」，也别抢着出主意。", "Pick no side and hold the quick fixes: no ’your parents mean well’, no jumping to a five-step plan."),
      L("问出「被催婚」对她真正意味着什么，然后只定一个不内耗的小下一步。", "Find out what the pressure actually means to her, then agree on one small next step that drains nobody."),
    ],
    success: L("Vera 的情绪先落地、说出了真正卡住她的东西（或至少没那么绷了），你们一起定下一个今晚就能执行的小动作。", "Vera lets her emotions land — she names what actually hurts, or at least unclenches — and you two settle on one small step to take tonight."),
    failure: L("一句「你爸妈也是为你好」把她推得更远，或你抢着出方案，让她的烦躁变成了对你的失望。", "A ’your parents just want the best for you’ pushes her further away — or your eager solutions turn her frustration into disappointment in you."),
    maxTurns: 7,
    opening: {
      characterId: "vera",
      text: L("……别跟我说「他们也是为你好」那套。我明天就去换手机号，谁爱相亲谁自己相去。", "…Don’t you dare start with ’they just want what’s best for you.’ I’m changing my number tomorrow — if anyone wants blind dates, they can go themselves."),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-family.ts#love-family-marriage-pressure",
    keywords: ["催婚", "情绪", "承接", "伴侣冲突", "marriage pressure", "holding feelings", "partner conflict"],
    loveTopic: "family",
    icon: "smartphone",
  },
  {
    id: "love-family-expectation-clash",
    title: L("两家都等着你们「按规矩来」", "Two Families, Two Rulebooks"),
    hook: L("「我妈说婚礼必须按老规矩走。」「我爸那边说旅行结婚最好。」——两个人头都大了。", "’My mom says the wedding has to follow the old customs.’ ’My dad says travel-marriage is best.’ — both of you are spinning."),
    background: L(
      "你们的家人第一次同时递来了期待：你家坚持传统流程——双方父母先见面、订婚仪式、按老规矩办；Rio 家则希望一切从简、旅行结婚、各自负担。两边都在催，你们夹在中间，已经为「谁家更该被理解」吵过一轮。任务：你们俩先对齐成一支口径，再各自去跟自己父母谈——不替对方答应，也别让对方替自己答应；把两家的话翻译成你们俩真正想定的「打算」。",
      "Your families have handed you their expectations in the same breath: yours insists on the traditional route — a formal parents meeting, an engagement ceremony, everything by the old rules; Rio’s side wants it lean — travel wedding, each family covering its own. Both are pushing, and you two have already fought one round over whose family ’deserves more understanding’. The task: get aligned with Rio into one shared position first, then each of you talks to your own family — don’t commit for Rio and don’t let Rio commit for you; translate both families’ words into a plan you two actually own.",
    ),
    simulationFacts: L(
      "两种家庭期待是两家分别亮出的立场，「哪条老规矩」「预算多少」等具体内容未核实，不要替两家编细节。Rio 转述她家的态度可能夹着她的加工；你们对齐的口径是各自要拿回家谈的草案，不代表两家已经接受。你说「我爸妈那边我来谈」不等于你爸妈已经同意，也不等于她家已经松口。隐藏事实：Rio 已经背着你先答应了她妈「婚礼先按她们的意思攒着」，怕你生气一直不敢说——只有你单独、用不指责的口吻直接问她「你是不是已经先答应了你妈什么」，她才可能坦白这句越界的话；她不说破，不等于你们俩的立场已经替她应承了什么。你的一个动作永远不等于对方已经同意什么。",
      "The two families’ expectations are positions each side has stated, but the specifics — which old custom, what budget — are unverified; don’t invent details for either household. Rio’s relay of her family’s stance may carry her own editing; the position you two align on is a draft each of you will take home, not an acceptance either family has given. Rio has not committed you to anything, and your ’I’ll handle my parents’ is not their consent, nor her family relenting. One person’s move is never the other side’s agreement.",
    ),
    context: "romantic",
    contextType: L("见家长", "Meeting the family"),
    competencies: ["relationship-skills", "social-awareness", "responsible-decision-making"],
    skills: ["communication", "social-norms", "problem-solving"],
    relationship: ["partner"],
    difficulty: 3,
    minutes: 4,
    characters: [
      {
        id: "rio",
        name: L("Rio", "Rio"),
        role: L("你的伴侣", "Your partner"),
        personality: L(
          "两边压力下容易摇摆，一会儿想顾全你家的面子、一会儿想让她家高兴；你摆出「我家规矩不能破」她会跟着你顶在她爸妈那边，你说「我们先对齐我们自己要什么」她会安静下来，跟你一起把话说清楚。",
          "Under twin pressures she sways — one moment honoring your family’s face, the next her own parents’ wishes. A ’my family’s customs can’t bend’ from you makes her brace against her own parents; a ’let’s first agree on what we two actually want’ makes her settle and line up beside you.",
        ),
        stance: L("想两头都交差——既不想让你家失望，也不想跟她家起冲突。", "Wants to deliver to both sides — not disappointing your family, not picking a fight with her own."),
        hidden: L("她已经背着你先答应了她妈「婚礼先按她们的意思攒着」，怕你知道后生气一直不敢说；只有你单独关起门、用不指责的口吻直接问她「你是不是已经先答应了你妈什么」，她才可能坦白这句越界的话。", "She has already quietly told her mother ’start gathering things their way’, behind your back, and is terrified you’ll explode — she can only own up to this overreach when you’re alone with her and ask, without accusation, whether she has already promised her mother something."),
        hue: 118,
      },
    ],
    objectives: [
      L("把「谁家更该被理解」变成「我们先说清我们自己想要什么」。", "Reframe from ’whose family deserves more sympathy’ to ’what do we two actually want’."),
      L("对齐一支口径，约定各自只向自己父母表述，不替对方承诺。", "Agree on one shared position, with each of you presenting only to your own family — no committing for the other."),
      L("把两家的期待翻译成可共同提出的选项：先做什么、后做什么、什么需要他们确认。", "Translate both families’ wishes into options you can present together: what happens first, what comes after, what genuinely needs their sign-off."),
    ],
    success: L("你们对齐了口径，约好各自先跟自己父母谈；即便 Rio 瞒着答应过她妈的旧账被翻出来，也把它重新收回到两人的决策里。", "You land on a shared position and agree each of you talks to your own family first — and even when Rio’s hidden half-promise to her mom surfaces, it folds back into the two of you owning the decision."),
    failure: L("你替 Rio 答应她家的方案，或逼 Rio 当「传话筒」替你回绝她爸妈，让两边期待因为你们俩的争执越烧越旺。", "You commit Rio to her family’s plan, or turn her into your messenger to refuse her parents — the clash only burns hotter because of your fighting."),
    maxTurns: 8,
    opening: {
      characterId: "rio",
      text: L("我妈今天又打电话来，说订婚宴「按老规矩，先看日子」。你爸妈不是也定了下周六见家长？我们俩……到底听谁的？", "Mom called again today — ’the engagement dinner, by the old rules, first pick a date.’ And your parents locked next Saturday for the family meet, right? So… which family do we listen to?"),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-family.ts#love-family-expectation-clash",
    keywords: ["期待冲突", "婚礼", "对齐口径", "见家长", "expectation clash", "wedding", "aligned front"],
    loveTopic: "family",
    series: { id: "love-arc-rio-clarify", name: L("暧昧到说清楚", "From Ambiguous to Explicit") },
    icon: "split",
  },
  {
    id: "love-family-decision-pressure",
    title: L("饭桌上，家长替我们把事定了", "Dinner’s Over — and So Are Our Plans, Apparently"),
    hook: L("你爸放下筷子，宣布：「婚期就定国庆，首付我们家出，就这么定了。」你和伴侣互相看了一眼。", "Your father sets down his chopsticks: ’Wedding: National Day. Down payment: our side. Settled.’ You and your partner exchange a look."),
    background: L(
      "一场普通家庭聚餐，吃到一半，你爸把你们俩的人生大事在饭桌上直接拍了板：婚期、过年安排，还有买房首付怎么出——「就这么定了」。桌上气氛热烈，只有你们俩知道，这件事根本还没轮到谁拍板。任务：把决定权温和而坚定地拿回你们两人之间——不撕破脸、不让长辈当众下不来台，也绝不因为「话已出口」就默许照办。",
      "An ordinary family dinner, midway through, and your father has just settled — in front of the whole table — the big decisions meant for you two: the wedding date, the holiday plans, how the house down payment splits. ’Settled.’ The mood is warm; only the two of you know this was never anyone’s call to make yet. The task: take the decision space back into the two of you — gently, firmly, without a scene, without humiliating the elders — and without silently accepting something just because it has been said out loud.",
    ),
    simulationFacts: L(
      "「婚期定国庆、首付由你家出」是家长在饭桌上单方面宣布的方案，从未与你俩确认，也不代表已生效；没签过任何字，长辈的「就这么定了」不等于共识。陈叔叔这番话出自好意还是面子、背后有没有他已经私下应承过别人，均未核实。伴侣全程没表态，沉默不等于同意被这样安排，也不等于想当场反驳。你说「这事得我们俩商量后回复您」是把决定权收回两人之间——这不是否决方案本身，也不是已经拒绝了这套安排。",
      "’Wedding on National Day, down payment from your side’ is a plan your father announced unilaterally at the table — it was never confirmed with you two and it is not in force; nothing was signed, and ’settled’ is not consensus. Whether Mr. Chen means well or is playing a part, and whether he already promised someone behind the scenes, is unverified. Your partner says nothing all evening — silence is not agreement with this arrangement, nor a wish to argue in public. Your ’this is something the two of us will discuss and reply to’ reclaims the decision into your couple-space — it is not a veto of the idea itself, and it does not yet mean the plan has been refused.",
    ),
    context: "romantic",
    contextType: L("见家长", "Meeting the family"),
    competencies: ["relationship-skills", "social-awareness", "self-management"],
    skills: ["communication", "social-norms", "impulse-control"],
    relationship: ["partner"],
    difficulty: 2,
    minutes: 3,
    characters: [
      {
        id: "dad-chen",
        name: L("陈叔叔", "Mr. Chen"),
        role: L("你的爸爸", "Your father"),
        personality: L(
          "家里做主的人，习惯在饭桌上拍板，觉得「我这是为你们好」就该被照办；你当面硬顶他会觉得下不来台、越说越来气；你先接住他的好意、再温和地把决定权拿回你们俩，他会愿意听一句「这事让我们商量一下」；但你要是不吭声，他会真以为事情已经成了。",
          "The family’s decision-maker, used to settling things mid-meal, certain that ’I mean well’ is reason enough to comply. Publicly push back and he loses face and digs in harder; acknowledge the goodwill first, then gently reclaim the couple’s right to decide, and he will actually hear ’let the two of us discuss this’. Stay silent and he will genuinely believe it is a done deal.",
        ),
        stance: L("认为这事本就应该这么办，替你们定下来是长辈的责任与疼爱。", "Believes this is simply how it should go — settling it for you is a parent’s duty and love."),
        hidden: L("他已经在外头酒桌上跟老同事念叨过「孩子婚事差不多定了」；若你们最后没照办，他真正怕的是丢面子，不是这笔钱——只有你单独、不当着大家的面问他「这么定是有什么顾虑吗」，他才可能说出这句实话。", "He has already told old colleagues over drinks that the kids’ wedding is basically settled; if you two don’t follow through, what he truly fears is losing face, not the money. He only admits this if you ask him privately — not across the table — something like ’is there a reason you want it settled this way’."),
        hue: 20,
      },
    ],
    objectives: [
      L("不当众顶撞，先接住长辈的好意，再表明这是需要你们俩商量的决定。", "Don’t contradict him in front of everyone: acknowledge the goodwill, then state plainly this is a decision for the two of you."),
      L("把决定权要回两人之间：给出「我们商量后回复您」的具体时间与方式，而不是含糊的「再说」或默许照办。", "Bring the decision back to the two of you: name when and how you’ll reply after discussing — not a vague ’we’ll see’, not silent compliance."),
      L("事后与伴侣单独对齐你们的立场，不让任何「饭桌上说过的话」悄悄变成承诺。", "After dinner, align privately with your partner so nothing said at the table quietly becomes a commitment."),
    ],
    success: L("陈叔叔接受了「你们俩商量后给答复」，桌上没翻脸；你和伴侣事后对上统一立场，长辈的话是提议，不是定案。", "Your father accepts ’the two of you will discuss and reply’, nobody flips the table; afterward you and your partner hold one position, and the elder’s words are a suggestion, not a verdict."),
    failure: L("你不吭声、默认照办，让决定权在沉默里流失；或当场一句硬话，让长辈觉得被当众扫了面子。", "You go quiet and quietly comply, letting the decision bleed away in silence — or one hard line makes the elder feel publicly humiliated."),
    maxTurns: 7,
    opening: {
      characterId: "dad-chen",
      text: L("（放下筷子，语气不容商量）就这么定了。婚期我看国庆最好，首付我们家出大头，剩下的你们小两口慢慢还。你说呢？", "(Sets down his chopsticks, tone brooking no argument) Settled, then. Wedding on National Day — best timing. We’ll cover the bigger part of the down payment; the rest you two can pay off slowly. What do you say?"),
    },
    source: "Original fictional practice — SocialCoach, 2026-10-09, app/src/data/corpus/love-scenarios-deep-family.ts#love-family-decision-pressure",
    keywords: ["婚期", "买房首付", "饭桌拍板", "自主权", "wedding date", "down payment", "deciding for you"],
    loveTopic: "family",
    icon: "calendar-x",
  },
];