# Rio 六幕 vertical slice：关系账本、两结局与复用清单

状态：**方案，未开工。** 2026-10-20 立项。本文是 `love-arc-rio-clarify`「暧昧到说清楚」从 3 幕扩到 6 幕的 spec；它依赖 [spec-love-galgame-foundation.md](./spec-love-galgame-foundation.md) 的存档、回想、配音与引擎债修复。
范围：Rio 单线、6 幕、每场单 NPC、两个命名结局、一个跨幕关系状态。
不在本文：其他 60 个恋爱场景、多 NPC 同场、E6 在场层、CG/BGM/配音包。

---

## 0. 结论一句话

Rio 线从一次软拒绝开始，经「我们算什么」、两家期待、外派期限、家长拍板，走到期限前夜的关键决定；六幕把「说清楚」从一句台词变成**可被状态记录、可被下一幕引用的具体选择**，最后只有两个都不惩罚人的结局：**「说清楚」**与**「体面收场」**。

**这不是「把 3 幕再加 3 幕」的内容批。** 现有 3 幕的 `outcome` 在叙事上只影响一句硬编码承接（`app/src/lib/love-carryover.ts:22-37,105`），选项不写任何状态（`app/src/lib/tasks/love-play.ts:55-57`；`PlayScene.tsx:250-263`）。不先补关系状态与状态驱动的开场，第 4–6 幕只会是三条更长的静态场景。

**停止线**：先只做第 4 幕 + 状态层，找 3–5 个真人试玩；如果他们说不出「第 1/2 幕的哪个选择改变了第 4 幕的哪一句/哪个选项」，停，不写第 5–6 幕。玩家打完 6 幕仍感觉不到承接，就停整条方向：不加第 7 幕、不用 CG/BGM/配音/更多立绘补。

---

## 1. 现有 3 幕清单

三条场景同挂 `series: { id: "love-arc-rio-clarify", name: L("暧昧到说清楚", "From Ambiguous to Explicit") }`；源文件 `characters` 只有 Rio，运行时 `withLearner()` 在最前面补 `you`，实际 cast 是 `[you, rio]`（`data/corpus/index.ts:184-200`）。三条都**没有** `series.order`，当前顺序依赖 `SCENARIOS` 的拼接顺序；`love-series.ts:9-12` 明确警告跨文件组线必须自己标 order。

| 幕 | id / 标题 | 行号 | maxTurns / topic | 这一幕的 hidden |
|---|---|---|---|---|
| 1 | `love-approach-soft-decline-reinvite`「最近有点忙」，是改天再约还是就此停手 / 'Been Busy Lately' — Ping Again Later or Let It Go | `love-scenarios-deep-approach.ts:112-162` | 6 / approach | 项目一团乱、下周要交，「忙」是真话；她更不想让人知道项目可能延期。只有带新信息再约并问「你最近在忙什么项目」才可能说出截止日期 |
| 2 | `love-define-rio-pace-talk` 她说「我们能不能先不急着定」 / "Can We Not Decide This Yet?" | `love-scenarios-deep-define.ts:257-310` | 10 / define-relationship | 三个月内要答复的外派项目意向；只有不质问地问「有没有什么你自己在纠结、还没告诉我的变动」才可能说出来，说出来也不等于已决定 |
| 3 | `love-family-expectation-clash` 两家都等着你们「按规矩来」 / Two Families, Two Rulebooks | `love-scenarios-deep-family.ts:110-160` | 8 / family | 她已经背着你先答应了她妈「婚礼先按她们的意思攒着」；只有单独、不指责地直接问「你是不是已经先答应了你妈什么」才可能坦白 |

### 1.1 逐场关键契约

**第 1 幕**

- objectives：读懂「忙」的两种可能，把它当需要核实的信息；要再邀就换一个有时间差、带新信息的方案，且只提一次；无效果就降级停手，把球留给她。
- success：二次邀约让她说出真实情况（项目下周结束），或你体面地把球交给她、不纠缠地收尾。
- failure：同一轮连环换日期「这周呢？下周呢？再下周呢？」，把「忙」逼成「你这个人好烦」。
- opening：「（她隔了一天，斟酌着打字）这周末真的不行……最近手上有个事特别赶。你别多想，不是不想见你，就是真没排开时间。」
- simulationFacts：「最近有点忙」是她原话；她是否真想忙完再见你未核实；含糊不等于答应，也不等于继续追问的许可；项目下周截止是 hidden；她语气缓和也不等于同意见面。

**第 2 幕**

- objectives：把「我们算什么」和「我们什么时候结婚」分成两个问题；接受一个带日期、而不是带结论的答复；说清你自己的限制，同时不替她决定她那一半。
- success：对一个具体下一步达成共识，可以只是「两周内各自想清楚再谈一次」；Rio 不必当场承诺婚期，你也没有替她填答案。
- failure：把「先不急着定」听成拒绝并追问到底，或逼她当场表态；她为结束谈话而松口，之后不再讲真实想法。
- opening：「你妈上周又问你有没有对象了吧……我知道你想说什么。我们能不能先不聊『以后』？我不是不想跟你走下去，我只是不想今天晚上顺便把婚期也定了。」
- simulationFacts：已确认你们约会两个多月、从没正式谈过排他性与未来、你家人问过而你没回答、Rio 没对婚期许过任何诺；「不急着定」不等于不想继续；外派意向是 hidden。

**第 3 幕**

- objectives：把「谁家更该被理解」变成「我们先说清我们自己想要什么」；对齐一支口径，各自只向自己父母表述，不替对方承诺；把两家期待翻译成可共同提出的选项。
- success：对齐口径、各自先跟自己父母谈；即便 Rio 瞒着答应她妈的旧账被翻出来，也把它重新收回到两人的决策里。
- failure：替 Rio 答应她家的方案，或逼她当传话筒，让两边期待越烧越旺。
- opening：「我妈今天又打电话来，说订婚宴『按老规矩，先看日子』。你爸妈不是也定了下周六见家长？我们俩……到底听谁的？」
- simulationFacts：两种家庭期待是两家分别亮出的立场，具体规矩与预算未核实；Rio 的转述可能夹加工；对齐的口径是草案，不代表两家已接受；「我爸妈那边我来谈」不等于父母同意；hidden 是她已先答应她妈。

### 1.2 现有 3 幕里会直接挡住 6 幕的三件事

1. **第 2、3 幕的静态文本把前一幕结果写死。** 第 2 幕背景说「你和 Rio 稳定约会两个多月了——从那次她被你再约出来开始」（`love-scenarios-deep-define.ts:262`），`simulationFacts` 也说「已确认：你们约会两个多月」（`:266`）。这只在第 1 幕 `success` 时成立；`partial/failure` 下第 2 幕一开场就在替玩家编造过去。第 3 幕开场「订婚宴按老规矩」也预设第 2 幕已谈到婚期。
2. **第 3 幕的 `success` 替 hidden 结账。** 它写「即便 Rio 瞒着答应过她妈的旧账被翻出来……」（`love-scenarios-deep-family.ts:148`），但 hidden 只有玩家问对问题才会被翻出（`:139`）；没问到时，这句 success 宣布了一件没发生的事。
3. **`outcome` 只够撑一句承接。** `LoveSeriesProgress` 只有 `{completed,lastScene,outcome}`（`love-series-progress.ts:4-8`）；`loveCarryoverForScene` 只读紧邻前一幕的 outcome（`love-carryover.ts:105`），命中 3 句之一（`:22-37`）。玩家在第 2 幕说过的「两周后再谈」、问出的外派、第 3 幕的半承诺，下一幕没有任何代码知道。

### 1.3 其他会挡住六幕的引擎事实

- `continuous` 按「全员 cast 完全一致」算（`love-series.ts:22,44`）；第 4–6 幕只要把父亲/HR 放进 `characters`，`continuous` 变 false，承接直接返回 `NONE`（`love-carryover.ts:100`），「第 N 幕」UI 也失效（`SeriesPlay.tsx:35,53`）。
- 每回合只配音一个 NPC：`lovePlaySystem` 写死「你本轮只配音一个角色：`${npc.id}`」（`tasks/love-play.ts:141`），`leadingNpc` 只取开场人（`:84-87`）。多 NPC 配音是另一个引擎契约。
- `SeriesPlay` 的「继续」用 `lastScene`（`SeriesPlay.tsx:38`）；六幕下打完第 3 幕再进去会回第 3 幕，不是第 4 幕。
- 新状态 slot 不被 `archive.ts` 认识：只接受 carry/series/unreadable（`archive.ts:74-94`）。
- `practiceTurnLimit` 强制下限 12（`practice-policy.ts:5-10`）；`maxTurns:6` 实际跑 12，六幕的幕长编排不成立。
- `prompts.ts:142` 的「不许编造过去」目前只是提示约束；六幕引用的过去比三幕多，必须落成代码断言（见 §4.6）。

---

## 2. 六幕弧线

| 幕 | 压力来源 | 玩家可以改变什么 | 下一幕读到什么 |
|---|---|---|---|
| 1 | Rio 用「忙」挡，含糊不是许可 | 再邀是否带新信息、是否停手 | 第 2 幕是「稳定约会两个月」还是「刚修复的一次谈话」 |
| 2 | 家里在问、Rio 不肯当场定 | 是否拿到带日期的节奏共识、是否问出外派 | 第 3 幕是「订婚宴压力」还是「连对象都没定」 |
| 3 | 两家期待同时压来 | 是否先对齐口径、是否问出半承诺 | 第 4 幕她敢不敢把外派邮件推给你 |
| 4 | 外派答复十天倒计时 | 她的偏好、你的条件、是否替她决定 | 第 5 幕她在饭桌上更敢说还是更沉默 |
| 5 | 父亲当众拍板婚期/首付 | 是否收回决定权、是否用半承诺当武器 | 第 6 幕婚期是否已在家族群、是否需要先修复 |
| 6 | 明天中午截止 + 家族群 + 你们的未决 | 继续/暂停/结束，以及是否先修复 | 两个结局之一，或没有结局 |

### 2.1 第 4 幕：外派期限落地

- **id**：`love-rio-secondment-deadline`；**标题**：她把那封邮件推到你面前 / She Pushes the Email Across the Table
- **hook**：她的手机在桌上亮了第三次。这次她把屏幕转过来：外派意向书，答复期限还有十天。
- **开场冲突**：邮件 + 十天期限 + 她第一次把屏幕转向你；她明确说「你别急着说『你去吧』」。
- **cast**：`[you, rio]`；HR 不开口，邮件是 opening 道具。
- **objectives**：先问她自己想要什么，不替她做决定，也不把「支持」当正确答案；说清你自己的限制（能不能接受异地、能等多久、什么条件下会退出），用具体条件不用情绪；给一个带日期的下一步，并允许她说「不」。
- **success**：她说出真正的偏好（走/留/还没定）和决定窗口；你说清条件，没有替她答应或放弃；约定答复前的下一次谈话。
- **failure**：用「你去吧」表现大度却暗含怨气；逼她为了关系拒绝外派；把她的犹豫读成「她已经有别人/想撤」。
- **hidden**：她其实已倾向拒绝外派，因为怕失去你；但她恨自己把决定交给你。只有问「如果我不在这里，你会怎么选？」她才可能说出这个倾向。说出来也不等于已决定，更不等于你要为她的选择负责。
- **simulationFacts**：外派意向书和十天期限是已发生事实；走/留未定，也没告诉你全部理由；「我还没想好」是真话，不等于等你替她决定；你支持她走不等于要分手，舍不得也不等于有权要求她留下；她告诉你倾向不等于已向公司答复。
- **maxTurns**：8；**topic**：boundary；**order**：4；**icon**：`message-square-warning`（已有）。
- **状态写入**：`flags.secondmentDisclosed/secondmentPreference`、`boundaries`（secondment/contact）、`conflicts`（secondment）、`promises`（secondment-answer，dueByAct 6）、`quotes`、`lastOutcome`。
- **可改变后果**：问出偏好 → `secondmentPreference` 从 unknown 变 go/stay/undecided；替她决定 → `boundaries` crossed + `unrepairedHarm:"pressed-secondment"`，第 5 幕更沉默、第 6 幕先修复；给出具体条件 → 第 6 幕「继续」选项可用，给不出 → `requires` 挡住。

### 2.2 第 5 幕：家长在饭桌上替你们拍板

- **id**：`love-rio-family-settled`；**标题**：饭桌上，我爸替我们把事定了 / My Dad Settled It at Dinner
- **hook**：你爸放下筷子：「婚期就定国庆，首付我们家出，就这么定了。」桌下，Rio 捏了一下你的手。
- **开场冲突**：父亲当众宣布婚期/首付；Rio 在桌下捏手、说「你决定」；满桌等你们点头。**父亲只在 opening 引述里说话，不进入 `characters`**；这是为了保持 `continuous` 与单 NPC 配音契约。若要父亲可见/可配音，先改引擎另立项。
- **objectives**：不当众顶撞，先接住长辈好意，再说明这是你们俩要商量的决定，并给出具体回复时间；饭后单独问 Rio 刚才的沉默是什么意思，不把沉默当同意、不替她表态；如果她已背着你答应她妈什么，先收回到两人之间，不当武器；没说过就不逼她认。
- **success**：你爸接受「我们商量后回复」的具体时间；Rio 说出沉默的真实原因；两人对齐口径，长辈的话是提议不是定案。
- **failure**：不吭声默认照办；当场顶撞让长辈下不来台；拿 Rio 背着你答应她妈的事当武器逼她站队。
- **hidden**：Rio 刚才不说话不是同意，是她妈饭前发消息让她「别当场驳人家面子」；她怕一开口就成了搞砸饭局的人。只有饭后单独、不指责地问「刚才你没说话，是你在忍，还是你也觉得该这么定？」她才可能说出这条消息。
- **simulationFacts**：父亲单方面宣布婚期/首付是已发生事实，从未与你们俩确认，也不代表已生效；没签字，「就这么定了」不等于共识；Rio 沉默不等于同意，也不等于想当场反驳；父亲出于好意还是面子、有没有在外头应承过别人，未核实；你说「我们商量后回复您」是收回决定权，不是否决方案。
- **maxTurns**：8；**topic**：family；**order**：5；**icon**：`utensils`（已有）。
- **状态写入**：`flags.familyDecisionAnnounced/decisionReclaimed/weddingTimeline/familyHalfPromiseWithdrawn`、`boundaries`（wedding/family）、`conflicts`（wedding-timeline/decision-ownership）、`promises`（reply-to-family）、`quotes`、`lastOutcome`。
- **可改变后果**：说「爸，这事我们俩商量后回复您，明天晚上给您准话」→ `decisionReclaimed=true`、`weddingTimeline` 仍可能是 `set-by-family`（还没撤回），第 6 幕开场是「你爸在等你们明天的答复」；不吭声 → `decisionReclaimed=false`，第 6 幕开场是「你爸把国庆发进了家族群」，两个命名结局被 `weddingTimeline` 挡住直到撤回；拿她妈的半承诺当武器 → `unrepairedHarm`，第 6 幕先修复；第 3 幕没问出半承诺时该选项不可用（`requires: familyHalfPromiseDisclosed`）。

### 2.3 第 6 幕：期限前夜，把话说清楚

- **id**：`love-rio-deadline-night`；**标题**：期限前夜，把话说清楚 / The Night Before the Deadline
- **hook**：外派答复截止在明天中午；你爸把「国庆」发进了家族群。Rio 把手机扣在桌上：「今晚我不替你答，你也别替我答。」
- **开场冲突**：明天中午的答复截止 + 家族群里的「国庆」+ Rio 的边界「你别替我答」；她问「你能兑现的是哪一句？」
- **objectives**：先处理未修复的伤（施压、替她承诺、用她妈的事当武器），明确收回再谈决定；用一句话说出自己的位置（继续/暂停/结束），给出带日期的下一步或清楚的收尾条件；不替 Rio 回答，也不要求她当场为你的选择鼓掌；听她的回答，并把它记录为双方决定，不是你的胜利。
- **success**：双方都能复述的决定：继续（排他性说清 + 节奏 + 日期）或体面收场（暂停/结束 + 理由 + 下一步）；没有一方被逼着点头。
- **failure**：拖过期限；用「都听你的」把决定推给她；表演一个兑现不了的承诺。
- **hidden**：公司其实允许延迟三个月入职，她没说是怕你觉得她在给这段关系出难题。只有问「有没有第三种可能，是你还没说出来的？」她才可能说出；它不替你解决任何事，只是把「现在就必须二选一」变成「还有一个带条件的可能」。这不会改变第 2 幕已发生的事实：即使第 2 幕披露了外派，她也仍然没提过延迟入职。
- **simulationFacts**：外派答复截止明天中午、你爸在家族群发了婚期，是已发生事实；Rio 的「今晚我不替你答」是边界不是威胁；她不会因为你选暂停/结束就否定你这个人；延迟三个月入职是隐藏选项，只有问到才可能说出；说出来不等于她已申请，也不等于你们自动有解；你今晚说的「继续」会被当成承诺，不是一句让她安心的话。
- **maxTurns**：10；**topic**：define-relationship；**order**：6；**icon**：`moon`（已有）。
- **状态写入**：`finalDecision`、`flags.finalDecisionMade/secondmentDecision/weddingTimeline`、`conflicts`（resolved/shelved）、`boundaries`（final terms）、`rituals`（continue 时）、`promises`（final-decision）、`repairs`、`quotes`、`lastOutcome`。
- **可改变后果**：先修复 → `repairs` 写入、`unrepairedHarm` 清空，Rio 才愿意听你的决定；选继续 + 排他 + 节奏 + 日期 → `finalDecision.kind="continue"`，其他谓词满足则 E1；选暂停 + 再谈日期 → `pause`，满足则 E2；选结束 + 理由 + 干净收尾 → `end`，满足则 E2；说「都听你的/再看看」→ 不写 `finalDecision`，Rio 拒绝替你答，场景继续；拖到回合上限 → `partial`，无命名结局，只能重玩第 6 幕。

### 2.4 六类回应覆盖矩阵（验收用，不是台词）

| 幕 | 让步 | 拒绝 | 反问 | 玩笑 | 修复 | 续聊 |
|---|---|---|---|---|---|---|
| 1 | 换成带新信息的时间窗才松口 | 「这周末不行」，不解释全部 | 「你为什么一定要这周？」 | 「忙到要住在公司了」（不揭 hidden） | 连环换日期后收回，把球留给她 | 她给一个模糊的下周；你只回「好，你想见时告诉我」 |
| 2 | 接受「两周后再谈」，不给婚期 | 不把「确认关系」跳成「定婚期」 | 「你妈问的是你，还是你妈？」 | 把「国庆办酒」说成家族群表情包 | 逼问后收回，改成「我需要一个日期，不是今晚」 | 约下一次谈话的具体时间 |
| 3 | 同意先对齐口径 | 不让你替她答应她家 | 「你妈那边你能代表吗？」 | 两家规矩像两份不同版本的说明书 | 用她妈的半承诺当武器后，先收回再谈 | 各自跟自己父母谈，约定回复时间 |
| 4 | 说出真实偏好或第三种可能 | 不让你替她拒绝外派 | 「你能接受我走吗？」 | 异地也可以当成一种恋爱模式试试（不轻佻） | 「你去吧」说假了，收回并说清条件 | 约定答复前再谈一次 |
| 5 | 父亲接受「商量后回复」；Rio 说出沉默原因 | Rio 不当传话筒；父亲不当场被顶 | 「你打算怎么跟你爸妈说？」 | 家族群已经把孩子名字都想好了（苦笑） | 拿她妈的消息当武器后，先向她道歉 | 给出具体回复时间和方式 |
| 6 | 她接受带日期的暂停；说出延迟入职 | 拒绝「再看看」；拒绝替你答 | 「你能兑现的是哪一句？」 | 「明天中午前，我们像两个赶 deadline 的人」 | 先修复再决定；不接受没修复的承诺 | 继续/暂停都给日期；结束也给干净收尾 |

---

## 3. RelationshipState schema

### 3.1 设计原则

**它不是好感度分数。** 只回答四类问题：发生过什么、答应过什么、还悬着什么、双方确认了什么。不回答「她多喜欢你」「你表现多好」「离通关还差多少」。

硬约束：

- 不出现 `score` / `affinity` / `loveScore` / `heart` / `level` / `exp` / `stance` / `proficiency` / `loveProficiency` / `stars` / `practiceDays` 字段。
- 不存计数型关系值（连续兑现次数、好感点、约会次数）。`askCount` 是 `LoveCarry` 的投递节流计数，不是关系值，结局判定不读它。
- `stance` 仍是每回合模型输出的「对方此刻的开放程度」，只活在当前会话，不进存档、不进结局。
- 每条状态都要有证据：学习者自己打的逐字原话、作者写死的关键选项文本、或 NPC 说过的原句。没有证据的状态写入一律拒绝。
- 承诺的兑现/失约只能由发生过的证据改状态，不能因为「这一幕成功了」自动全兑现。

### 3.2 接口

```ts
import type { L } from "@/data/taxonomy";

export type RioAct = 1 | 2 | 3 | 4 | 5 | 6;
export type RioLang = "zh" | "en";
export type RioOutcome = "success" | "partial" | "failure";

export interface RioRelationshipState {
  v: 1;
  seriesId: "love-arc-rio-clarify";
  lastAct: 0 | RioAct;
  lastOutcome: RioOutcome | null;
  legacy: boolean;                 // 从旧 3 幕迁移：未知的 hidden 不得当已发生
  stale: boolean;                  // state 落后于 LoveSeriesProgress：开场用中性变体
  unknown: RioUnknown[];
  promises: RioPromise[];
  boundaries: RioBoundary[];
  conflicts: RioConflict[];
  rituals: RioRitual[];
  flags: RioFlags;
  finalDecision: RioFinalDecision | null;
  quotes: RioQuote[];
  updatedAt: number;
}

export type RioUnknown =
  | "secondmentDisclosed"
  | "familyHalfPromiseDisclosed"
  | "paceAgreed"
  | "decisionReclaimed";

export type RioEvidence =
  | { kind: "quote"; quoteId: string }            // 学习者自己打的，逐字
  | { kind: "option"; optionId: string; text: L } // 作者写死的关键选项，不冒充原话
  | { kind: "npc"; quoteId: string };             // NPC 说过的原句

export type RioPromiseKind =
  | "call" | "visit" | "ritual"
  | "answer-with-date" | "family-talk"
  | "secondment-answer" | "reply-to-family" | "final-decision"
  | "other";
export type RioPromiseStatus = "open" | "kept" | "broken" | "released";

export interface RioPromise {
  id: string;
  kind: RioPromiseKind;
  by: "learner" | "rio";
  madeAtAct: RioAct;
  dueByAct: RioAct | null;
  status: RioPromiseStatus;
  evidence: RioEvidence;
  resolution?: RioEvidence;        // kept/broken/released 必须
  carryId?: string;                // 与 LoveCarry 同一条时
}

export type RioBoundaryTopic =
  | "pace" | "contact" | "family" | "wedding"
  | "secondment" | "privacy" | "decision-ownership";
export type RioBoundaryStatus = "proposed" | "agreed" | "crossed" | "repaired" | "withdrawn";

export interface RioBoundary {
  id: string;
  topic: RioBoundaryTopic;
  by: "learner" | "rio";
  atAct: RioAct;
  status: RioBoundaryStatus;
  evidence: RioEvidence;
  acceptedBy: Array<"learner" | "rio">;  // agreed/repaired 必须两边都在
  repair?: RioEvidence;
}

export type RioConflictTopic =
  | "availability" | "exclusivity" | "pace" | "family-expectation"
  | "wedding-timeline" | "secondment" | "decision-ownership";
export type RioConflictStatus = "open" | "narrowed" | "resolved" | "shelved";
export type RioConflictShape =
  | "soft-no-unverified" | "secondment-undecided" | "secondment-accepted-no-plan"
  | "secondment-declined" | "wedding-date-set-by-family" | "wedding-date-withdrawn"
  | "family-half-promise-open" | "family-half-promise-withdrawn"
  | "pace-undefined" | "pace-dated" | "exclusivity-undefined"
  | "exclusivity-agreed" | "exclusivity-declined";

export interface RioConflict {
  id: string;
  topic: RioConflictTopic;
  shape: RioConflictShape;
  status: RioConflictStatus;
  openedAtAct: RioAct;
  lastTouchedAtAct: RioAct;
  hasMutualNextStep: boolean;      // 只有双方都认
  evidence: RioEvidence;
  resolution?: RioEvidence;
}

export interface RioRitual {
  id: string;
  kind: "weekly-talk" | "check-in" | "family-boundary-signal" | "other";
  status: "proposed" | "agreed" | "kept" | "skipped" | "dropped";
  atAct: RioAct;
  evidence: RioEvidence;
  acceptedBy: Array<"learner" | "rio">;  // agreed 必须两边都在
}

export type RioHarm =
  | "pressed-after-soft-no" | "read-silence-as-betrayal"
  | "pressed-secondment" | "used-half-promise-as-weapon"
  | "committed-for-rio" | "rio-committed-for-you";

export interface RioRepair {
  harm: RioHarm;
  atAct: RioAct;
  evidence: RioEvidence;
}

export interface RioFlags {
  secondmentDisclosed: boolean;
  secondmentPreference: "unknown" | "go" | "stay" | "undecided";
  secondmentDecision: "undecided" | "accept" | "decline" | "defer-with-date";
  familyHalfPromiseDisclosed: boolean;
  familyHalfPromiseWithdrawn: boolean;
  familyDecisionAnnounced: boolean;
  decisionReclaimed: boolean;
  exclusivity: "undefined" | "agreed" | "declined";
  pace: "undefined" | "dated" | "open-ended";
  weddingTimeline: "unset" | "shelved" | "set-by-family" | "withdrawn";
  finalDecisionMade: boolean;
  unrepairedHarm: RioHarm[];       // 有值就阻断两个命名结局，直到 repairs 有对应项
}

export interface RioFinalDecision {
  kind: "continue" | "pause" | "end";
  agreedBy: "both" | "one-sided"; // 单方宣布不产生结局
  atAct: 6;
  evidence: RioEvidence;          // 学习者这一侧
  acceptance?: RioEvidence;       // both 必填
  hasDatedNextStep: boolean;      // continue/pause 必须；end 为 false
  revisit: "two-weeks" | "after-secondment-answer" | null; // pause 专用
  reason: "secondment" | "pace" | "family" | null;         // pause/end 专用
}

export interface RioQuote {
  id: string;
  atAct: RioAct;
  speaker: "learner" | "rio";
  text: string;                   // 逐字，不翻译/不摘要/不裁剪
  lang: RioLang;
  via: "type" | "npc";            // 点选项不算学习者原话
}
```

### 3.3 存储与迁移

- **已提交状态**存在 foundation 的 `LoveStoryStore.routes["love-arc-rio-clarify"]`，由 `RioRelationshipStateSchema` 校验；**进行中的状态快照**存在 `LovePlaySave.routeState`，每回合随存档落盘，刷新恢复不丢。
- 不做第三个独立 slot：story store 已经有 revision/raw/导出/擦除；routes 只是它的一个键。
- 迁移旧 3 幕：读 `LoveSeriesProgress` → `lastAct = max(completed)`、`lastOutcome = outcome[lastScene]`、`legacy=true`、`unknown` 含 4 项；不根据 success/failure 推断任何 hidden 已揭示或承诺已兑现。
- 迁移旧 `LoveCarry`：只迁 `seriesId === "love-arc-rio-clarify" && npcId === "rio"` 的条目；`text` 原样进 `quotes`，`carryId` 关联；`npcName` 快照不动。
- 旧档第一次进第 4 幕：用 `legacy` 中性开场；不声称「你上次已经知道外派」，也不声称「你上次没问出来」。
- 写顺序：先 `LoveSeriesProgress`，后 `routes`。state 写失败 → progress 仍有效，下次读发现落后 → `stale`，第 4–6 幕用中性开场；state 成功但 progress 失败 → 用 state 的 `lastAct/lastOutcome` 补 progress（已发生事实）。

### 3.4 字段读写矩阵

| 字段 | 写入幕 | 读取幕 | 驱动什么 |
|---|---|---|---|
| `promises` | 1–6 | 2–6 | 开场引用具体安排；「把没兑现的承诺说清」；第 6 幕先修复 |
| `boundaries` | 1–6 | 2–6 | 第 4 幕「她的决定是她的边界」；第 5 幕「不替对方承诺」；第 6 幕条款 |
| `conflicts` | 1–6 | 2–6 | 未解决冲突决定 NPC 施压点；第 6 幕只有 resolved/shelved 才允许结局 |
| `rituals` | 4、6 | 5、6 | 第 6 幕「继续」的具体下一步；她是否相信「你们有自己的节奏」 |
| `flags.secondment*` | 2、4、6 | 3–6 | 第 4 幕敢不敢说偏好；第 5 幕敢不敢接婚期；第 6 幕「继续」条件 |
| `flags.family*` | 3、5、6 | 4–6 | 第 5 幕沉默原因；第 6 幕婚期是否已进家族群 |
| `flags.exclusivity/pace/weddingTimeline` | 2、5、6 | 3–6 | 第 3 幕开场是「订婚宴」还是「连对象都没定」；第 6 幕 E1 硬条件 |
| `unrepairedHarm` + `repairs` | 1–6 | 2–6 | 伤未修复时 NPC 更收着；第 6 幕不修复就没有结局 |
| `finalDecision` | 6 | 6 | 唯一决定结局的字段；没写就没有命名结局 |
| `quotes` | 1–6 | 2–6 | 所有承接与证据的逐字来源；不做摘要 |
| `lastAct/lastOutcome` | 每幕 | 每幕 | 与 `LoveSeriesProgress` 对账 |

### 3.5 状态如何驱动开场、选项、施压、结局

- **开场：作者变体，不让模型写。** 每幕 `openingVariants: { requires, text: L }[]`，按优先级从具体到一般匹配；无匹配用中性变体，只说这一幕已发生的事。第 4 幕示例：`secondmentDisclosed=false` → 「她把手机推过来，屏幕上是一封你从没见过的邮件」；`true` → 「她把那封你见过的邮件又推过来，这次多了 HR 的最后期限」；`legacy=true` → 「她把手机推过来，说：这件事我一直没跟你讲全」。状态变体与现有承接句只能出现一个，避免两句「你上次说……」。
- **选项：状态拍点用作者选项。** 每幕 1–2 个状态拍点，UI 只显示作者写的 2–3 个双语选项 + 自由输入；普通回合继续用模型生成的 2–4 个选项，不写状态。每个作者选项有 `requires` 与 `effects`（只允许写本幕允许的字段）。例：第 6 幕「继续」`requires: secondmentDecision !== "undecided" && pace !== "undefined"`。
- **自由输入：** 状态拍点仍可用，但只有模型返回的 `decisionProposal` 带「学习者最后一句的逐字证据」时才写状态；证据不是原话子串就拒绝并要求重说。
- **施压：** 由未解决冲突和期限决定，不由数值难度决定。每幕注入作者写的 `pressureDirection`（只给模型，不显示）：第 5 幕 `weddingTimeline="set-by-family" && decisionReclaimed=false` → Rio 更收着，只提醒一次「你爸在等」；第 6 幕 `unrepairedHarm` 非空 → 她先把伤摆回桌上，玩家必须先修复；`secondmentDecision="undecided"` → 不接受「继续」作为最终决定。
- **结局：纯函数，不信模型。** `resolveRioEnding(state)` 只读状态；模型 `terminal` 只作为「这一幕可以收了」的参考。模型说「我们结束吧」但状态没有双方决定，不产生结局。

### 3.6 防「编造过去」的代码断言

1. **静态语料断言**：每幕声明 `stateReads/stateWrites/openingVariants`；测试检查每个 read 在更早幕有 writer、每个变体都有 `requires`、没有 stateReads 的静态 opening 不得出现上一幕专有名词（外派/半承诺/婚期/国庆/两周）。
2. **运行时状态块**：`lovePlaySystem` 在 `roleplaySystem` 后注入 `RELATIONSHIP STATE`，列出已确认的承诺/边界/冲突/flags 与逐字引语；明确「只有这里列出的是已发生事实；未列出的过去一律视为未知」。**不用模型总结上一幕。**
3. **输出断言**：`parseLovePlay` 在 `replyBoundaryProblem`/`roleplaySpeechGuard` 之外加 `relationshipStateGuard`：
   - `revealed=true` 必须对应本幕 hidden 的揭示条件，且状态里尚未标记已揭示；
   - 第 1–5 幕 `terminal` 仍表示本幕成败（`success/partial/failure/null`），继续写 `LoveSeriesProgress.outcome` 与承接；**命名结局只由 `resolveRioEnding` 在第 6 幕决定**，模型 `terminal` 只作为「这一幕可以收了」的参考，不作为最终结局。第 6 幕 `ended=true` 但 `finalDecisionMade=false` 时只显示中性收尾/`partial`，不产生命名结局；`ended=true` 且 `finalDecisionMade=true` 时才调用 `resolveRioEnding`。
   - 状态拍点的 `decisionProposal.evidenceQuote` 必须是学习者最后一条消息的子串；
   - 台词出现「你上次答应/你说过/你妈已经答应」等过去断言时，必须在 `quotes` 或 `promises` 里找得到证据，否则拒绝并修复。

---

## 4. 两个结局

### 4.1 定义

- **E1「说清楚」/ Said It Plain**：双方明确选择继续，并把排他性说清（是或不是都行，不能是「还没谈」）、按自己的节奏、给出带日期的下一步；外派已有决定，婚期没有被家长单方面定死，之前的伤已修复。它不是「求婚成功」，是「我们把我们算什么说清楚了」。
- **E2「体面收场」/ A Clean Parting**：双方明确选择暂停或结束，给出理由与一个带日期的再谈窗口（暂停）或干净收尾（结束）；该关的冲突已关闭或双方同意搁置，之前的伤已修复。它不是「坏结局」，是「我们没有把对方说成错的人」。

**两个都不是惩罚性坏结局。** E1 与 E2 在练习统计里都记 `success`（完成了一次高难度的说清楚）；`endingId` 不参与任何分数计算。没有做出决定的第 6 幕才是 `partial/failure`，而且不是命名结局，只是「这次没说清，可以重玩第 6 幕」。

### 4.2 谓词

```ts
type RioEndingId = "said-it-plain" | "clean-parting";

function closed(state: RioRelationshipState, topic: RioConflictTopic): boolean {
  const rows = state.conflicts.filter((c) => c.topic === topic);
  return rows.length > 0 && rows.every((c) => c.status === "resolved" || c.status === "shelved");
}
function noCrossedBoundary(state: RioRelationshipState): boolean {
  return state.boundaries.every((b) => b.status !== "crossed");
}

function resolveRioEnding(state: RioRelationshipState): RioEndingId | null {
  const d = state.finalDecision;
  if (!d || !state.flags.finalDecisionMade) return null;
  if (d.agreedBy !== "both" || !d.acceptance) return null;
  if (state.flags.unrepairedHarm.length > 0) return null;
  if (!noCrossedBoundary(state)) return null;
  if (state.flags.weddingTimeline === "set-by-family") return null;
  if (state.flags.familyDecisionAnnounced && !state.flags.decisionReclaimed) return null;
  if (state.flags.secondmentDecision === "undecided") return null;
  if (!closed(state, "secondment")) return null;
  if (!closed(state, "wedding-timeline")) return null;
  if (!closed(state, "decision-ownership")) return null;

  if (
    d.kind === "continue" &&
    d.hasDatedNextStep &&
    state.flags.exclusivity !== "undefined" &&
    state.flags.pace === "dated" &&
    closed(state, "exclusivity") &&
    closed(state, "pace")
  ) return "said-it-plain";

  if (
    (d.kind === "pause" || d.kind === "end") &&
    d.reason !== null &&
    (d.kind === "end" ? !d.hasDatedNextStep : d.hasDatedNextStep && d.revisit !== null) &&
    closed(state, "exclusivity") &&
    closed(state, "pace")
  ) return "clean-parting";

  return null;
}
```

说明：

- 所有条件都是 facts/flags/枚举，没有数值阈值。
- `d.agreedBy === "both"` 是「关键决定」的核心：一个人宣布、另一个人没认，不算结局。
- `unrepairedHarm`、`crossed` 边界、`set-by-family` 婚期都是「先修复/先收回」的刹车，不是扣分。
- `closed()` 要求该 topic 至少有一条冲突记录，且全部 resolved/shelved；没有记录不算「已经关掉」。第 2/4/5/6 幕的冲突 writer 必须在相关事实出现时建记录，避免真空通过。
- 结局谓词只要求 `secondment`、`wedding-timeline`、`decision-ownership`、`exclusivity`、`pace` 五个 topic 关闭；`availability` 是第 1 幕的早期误会，第 2 幕应标记 resolved；`family-expectation` 由第 5 幕的 `wedding-timeline`/`decision-ownership` 接管。E2 也要求 exclusivity/pace 关闭：结束也要把「我们算什么/什么节奏」说清，不能靠回避混过去。

### 4.3 判定例子

| # | 关键状态 | 判定 | 说明 |
|---|---|---|---|
| 1 | `continue + both + dated`；`exclusivity="agreed"`；`pace="dated"`；`secondmentDecision="defer-with-date"`；`weddingTimeline="withdrawn"`；`decisionReclaimed=true`；`unrepairedHarm=[]`；五个 topic 全 closed | **E1** | 标准 E1 |
| 2 | `pause + both + dated + revisit="after-secondment-answer"`；`secondmentDecision="accept"`；`weddingTimeline="shelved"`；`decisionReclaimed=true`；无伤；冲突全 closed | **E2** | 暂停不是失败：她接了外派，约好答复后再谈 |
| 3 | `end + both + no date + reason="pace"`；`exclusivity="declined"`；`pace="open-ended"`；`secondmentDecision="decline"`；`weddingTimeline="unset"`；无伤；冲突全 closed | **E2** | 结束也可以干净：不是谁错了，是节奏不同 |
| 4 | `continue + both`，但 `weddingTimeline="set-by-family"` 且 `decisionReclaimed=false` | **无** | 家长还定着，不能一边说「我们说清楚了」 |
| 5 | `continue + one-sided` | **无** | 你宣布继续，Rio 没认；不能替她点头 |
| 6 | `pause + both`，但 `unrepairedHarm=["used-half-promise-as-weapon"]`、`repairs=[]` | **无** | 先修复；修复后同一状态 → E2 |
| 7 | `finalDecision=null`，第 6 幕到 maxTurns | **无** | 记 partial，只能重玩第 6 幕；不是第三个坏结局 |
| 8 | 第 1 幕 failure（`pressed-after-soft-no`），第 2 幕修复，后续 E1 条件全满足 | **E1** | 早幕失败不是死刑 |

### 4.4 可达性矩阵

| 路径 | 第 1 幕 | 第 2 幕 | 第 3 幕 | 第 4 幕 | 第 5 幕 | 第 6 幕 | 结局 |
|---|---|---|---|---|---|---|---|
| A | success：带新信息再邀成功 | success：问出外派，拿到两周日期 | success：问出半承诺，对齐口径 | success：她说「想留」，你给异地条件 | success：收回决定权，婚期先不定 | continue：排他性+节奏+日期 | **E1** |
| B | partial：把球留给她 | partial：只拿到「再想想」 | partial：半承诺没问出，但先对齐 | success：她决定接受外派 | success：收回决定权 | pause：等她答复后再谈 | **E2** |
| C | success | success | success | success | success | end：节奏不同，干净结束 | **E2**（前五幕全 success 也能到 E2，证明 E2 不是失败） |
| D | failure：连环换日期 | success：修复并问出外派 | success | success | success | continue | **E1**（证明第 1 幕失败可修复） |

### 4.5 第 6 幕的关键决定

1. **先修复，再决定。** 开场读 `unrepairedHarm`；有值则 Rio 不进入三方向拍点，先把伤摆回桌上。玩家必须用明确的收回/道歉通过 `repairs`，否则状态拍点不出现。
2. **三张作者写死的方向**：继续/暂停/结束 + 自由输入。每个方向有 `requires`；条件不满足时置灰或换成「先把外派说清」。
3. **双方都认才算数。** Rio 用一句入戏的回应表明认不认；认了写 `agreedBy:"both"`，不认写 `one-sided`，她可以 counter-propose，场景继续。UI 不出现「好感 +10」或「结局达成」，只在收束时显示结局名与作者写的结局文本。
4. **拖不是选项。** 「都听你的/再看看」不写 `finalDecision`；Rio 拒绝替你答。拖到 maxTurns → partial，没有命名结局，按钮是「重玩第 6 幕」。
5. **结局文本作者写死**，`L` 双语；E1 按 `exclusivity` 分 agreed/declined 两版，E2 按 pause/end 分两版。不由模型生成，避免在结局里泄露 hidden。

---

## 5. 前 3 幕复用清单

### 5.1 原样保留

| 场景 | 原样保留 | 只加什么 |
|---|---|---|
| 第 1 幕 `love-approach-soft-decline-reinvite` | id、标题、hook、background、cast、学习者角色、objectives、success、failure、hidden、opening、simulationFacts、maxTurns、loveTopic、source、icon、keywords | `series.order: 1`；状态写入声明（不改变台词） |
| 第 2 幕 `love-define-rio-pace-talk` | id、标题、hook、cast、学习者角色、objectives、success、failure、hidden、maxTurns、loveTopic、source、icon、keywords | `series.order: 2`；background 的「约会两个多月」改成状态变体；simulationFacts 的「已确认」段改成「仅当状态确认」；opening 加 success/partial/failure 三变体；hidden 由 `secondmentDisclosed` 门禁 |
| 第 3 幕 `love-family-expectation-clash` | id、标题、hook、cast、学习者角色、objectives、failure、hidden、maxTurns、loveTopic、source、icon、keywords | `series.order: 3`；background 的「已经吵过一轮」改成状态变体；opening 加「订婚宴压力/连对象都没定」两变体；success 拆成「半承诺已翻出/没翻出」两版；simulationFacts 由 `familyHalfPromiseDisclosed` 门禁 |

**明确不重写：** 第 1 幕任何一句；第 2、3 幕的 objectives/failure/hidden 文本；`LOVE_CARRYOVER` 的 6 句兜底；16 句承诺台词库；其他 60 个恋爱场景与所有职场/家庭语料。

### 5.2 必须因状态而改的位置

| 位置 | 现状 | 必须怎么改 | 原因 |
|---|---|---|---|
| 第 2 幕 background | 「你和 Rio 稳定约会两个多月了——从那次她被你再约出来开始」 | 三个作者变体：success 用原文；partial「那次之后你们又见过一两次，但她没再提那天」；failure「那次之后她只回过你一条消息，没再提见面；两周后她才先开口」 | 原文在 partial/failure 下编造过去 |
| 第 2 幕 simulationFacts | 「已确认：你们约会两个多月……」 | 把「约会两个多月」移出静态事实，改由状态块注入；静态只留这一幕仍成立的事实 | 同上 |
| 第 2 幕 opening | 「你妈上周又问你有没有对象了吧……」 | 保留为 success/partial 变体；failure 改成「那次之后你发过两条消息，她都回了，但没提见面。今晚她先开口：……」 | failure 下「稳定约会」不成立 |
| 第 3 幕 background | 「已经为『谁家更该被理解』吵过一轮」 | 改成 `pace=dated` 与 `pace=undefined` 两个变体；后者不假设吵过 | 第 2 幕没谈成时，吵架是编造 |
| 第 3 幕 opening | 「订婚宴按老规矩，先看日子」 | `pace=dated` 用原文；`pace=undefined` 改成「我妈问我们到底算不算对象，你爸妈又在问什么时候见」 | 没谈成节奏就不该有订婚宴 |
| 第 3 幕 success | 「即便 Rio 瞒着答应过她妈的旧账被翻出来……」 | 拆两版：`familyHalfPromiseDisclosed=true` 用原文；false 改成「你们对齐了口径……她没说出口的那件事仍然没被翻出来，但你们没有替对方承诺」 | 原文替 hidden 结账 |

- 现有 3 幕没有作者写死的选项（都是模型生成），所以没有旧选项要重写；第 4–6 幕只在状态拍点加作者选项。
- 不改 `Scenario.success`/`opening` 的类型；`openingVariants`/`successVariants`/`endings` 放在 `rio-route.ts` 契约里，由 `PlayScene`/`PlayPanels` 按状态选；`Scenario` 原字段保留为默认/兜底，独立场景与旧客户端不受影响。
- 第 1–3 幕的 success/failure 仍是 act-local 文案，不改成命名结局；第 6 幕才用 E1/E2。

### 5.3 旧进度 / 承诺迁移

- `LoveSeriesProgress.completed`：原样保留；用于「下一幕未完成」的继续入口。
- `outcome`：原样保留；P1 承接句继续读它。
- `lastScene`：保留，但「继续」不再直接用它；改成「首个未完成幕」。
- 若 foundation 的 G10 把 progress 升到 v2，本 spec 只依赖 `completed`/`outcome`；`lastAct` 由 v2 提供，`endingId` 留在 `LovePlaySave`/`LovePlayRecord`，不重复存。
- `LoveCarry`：按 §3.3 链接到 `RioPromise`；`npcName` 快照、`text` 逐字、`askCount`/`lastAskedAt` 不动。
- `loveProficiency`/`stars`/`practiceDays`：状态层不读不写；`completeLovePlay` 的既有统计行为不动；不新增基于结局的分数。

---

## 6. 验收口径

### 6.1 结构 / 语料

- `pnpm check` 全绿；`pnpm build` 通过；`tsx scripts/check-corpus.ts` 全绿。
- 六幕 `series.id` 相同、`series.name` 双语一致、`order` 1–6 不重复；`characters` 只有 `rio`；`continuous === true`；`SeriesPlay` 显示「第 N 幕」。
- 每幕 `source` 含 `Original fictional practice` 且指向自己的文件；`simulationFacts`/`hidden` 双语；`icon` 在 `SCENARIO_ICONS` 里。
- 第 2、3 幕的静态文本不再无条件断言上一幕结果；第 3 幕 success 不再替 hidden 结账。

### 6.2 状态读写断言

新增 `app/tests/core/rio-route-contract.test.ts`：

- 六幕 `stateWrites` 只写本幕允许的字段；`finalDecision` 只由第 6 幕写。
- 每个 `stateReads` 在更早幕有 writer；每个 `openingVariants[].requires` 引用 schema 字段且双语；没有 stateReads 的静态 opening 不含上一幕专有名词（外派/半承诺/婚期/国庆/两周）。
- 每个状态拍点的 `effects` 只写本幕允许字段；`requires` 不读 `stance`/`askCount`/`loveProficiency`。
- 每幕至少 1 个状态拍点；第 6 幕恰好 1 个最终决定拍点；`agreedBy="both"` 必须有 `acceptance`。
- 所有 `quoteId` 在 `quotes` 里存在；`promises[].carryId` 在 `LoveCarry` 里存在或迁移时标记缺失。

新增 `app/tests/core/rio-relationship-state.test.ts`：

- schema 解析：缺字段/坏枚举/坏时间戳 → 安全默认或整条丢弃，不抛。
- 禁止字段：序列化后的 state 键没有 `score/affinity/proficiency/loveProficiency/stars/practiceDays/stance`。
- 承诺：`open → kept|broken|released`；不能回退；broken 必须有 `resolution`。
- 边界：agreed 必须两边都在；crossed 必须能 repaired 且带 repair 证据。
- 冲突：resolved/shelved 必须有双方认下的 `resolution`；open/narrowed 不得被 success 自动关闭。
- 仪式：agreed 必须两边都在；没有计数。
- quotes：`via:"type"` 的 text 非空、不是 `L` 对象、不来自选项文本。

### 6.3 结局可达性

新增 `app/tests/core/rio-endings.test.ts`：

- 跑 §4.3 的 8 组用例；断言 E1/E2/null。
- 路径 A–D 全部可达；E1 至少一条、E2 至少两条（暂停/结束）。
- E2 不被判成 failure；E1/E2 的 `endingId` 不影响 `loveProficiency`/`stars`/`practiceDays`（spy 或纯函数边界测试）。
- 边界：`finalDecision=null`、`agreedBy="one-sided"`、`unrepairedHarm` 非空、`weddingTimeline="set-by-family"`、`familyDecisionAnnounced && !decisionReclaimed`、`secondmentDecision="undecided"`、crossed 边界 → 全部 null。
- 修复后同一状态从 null 变 E1/E2；返回类型只有两个 id 或 null。

### 6.4 不写分数 / 不剧透 / 双语

- 静态 grep：`RioRelationshipState`、`rio-route.ts`、第 4–6 幕语料里不出现分数**字段名或分值文案**；`icon: "moon"`、`love-arc-rio-clarify` 不算。
- `resolveRioEnding` 不读 `stance`、`askCount`、`LoveSeriesProgress.outcome`。
- 第 6 幕结局页不显示数值；不把 flags 渲染成「关系进度」条。
- 三个新 hidden 的揭示条件写死在 `characters[].hidden` 与 `simulationFacts`；opening 变体/状态拍点/结局文本跑「最长公共片段」探针，不提前泄露。
- 新增 opening 变体、状态拍点选项、pressureDirection、结局名/文本全部 `L`；`quotes.text` 单语不翻译；每条新语料 source 指向自己的文件。

### 6.5 真实模型探针

扩展 `app/scripts/check-love-play-live.ts`（或新增 `check-rio-route-live.ts`），每幕按 §2.4 六类各跑一条，不能只测标准答案。关键探针：

- 第 4 幕：标准问题 → hidden 偏好只在 `allowedFrom` 后出现；施压「你别去」→ 不出现「我答应你不去/我为你留下」；修复 → `pressed-secondment` 可修复；玩笑 → NPC 不硬转弯。
- 第 5 幕：标准「我们商量后回复」→ `decisionReclaimed` 可写、没有「我爸已经同意」；施压「就按我爸说的办」→ Rio 不当场认；修复「拿你妈的事压你是我不对」→ 可修复。
- 第 6 幕：拖延「都听你的」→ `terminal=null`、`ended=false`、`finalDecision=null`；E1 句子 → `continue/both/dated`；E2 句子 → `pause + revisit`；带未修复伤先说继续 → NPC 不接受、状态不写，修复后再接受。
- 记录 `attempts`、`stance`、`revealed`、`terminal`、`ended`；失败退出码 1；429 退避到下一分钟窗口（该网关实测约 3 次/分，live 必须串行）。

### 6.6 旧进度迁移

新增 `app/tests/core/rio-migration.test.ts`：

- 旧 `LoveSeriesProgress`（3 幕）→ `legacy=true`、`lastAct/lastOutcome` 正确、`unknown` 含 4 项、没有凭空生成的 promise/boundary/conflict。
- 旧 `LoveCarry`（Rio、seriesId 对）→ 链接到 `RioPromise.carryId`；text 逐字；npcName 快照不动；没有重复 quote。
- 坏 state slot → legacy 兜底，不抛；原文保留。
- state 落后 progress → stale，第 4–6 幕中性开场；progress 落后 state → 用 state 补 progress。
- 导出→恢复→擦除：story/routes/records/carry/series 全回来；设置页与 A21 两条 reset 都擦掉。

### 6.7 真机项（不得用模拟视口销账）

- iOS Safari / Android Chrome 各一台，完整走第 4 幕状态拍点与第 6 幕关键决定。
- 开场白 TTS 是否出声；iOS 首次手势解锁；麦克风授权/拒绝文案；朗读中开麦是否回声；长台词分块断句。
- 状态拍点长选项在窄屏不截断、不重叠；第 6 幕结局页安全区滚动。
- 后台切换/锁屏再回来，状态与进度还在；隐私模式 state 写失败时剧情仍能继续（progress 兜底）。
- 导出 → 清空 → 恢复：state/carry/progress 三者都在；「重置全部数据」擦掉 state。
- 断网/重试在第 6 幕关键决定上：不能因一次失败生成两个结局，也不能丢 `finalDecision`。

### 6.8 实施步骤与闸门

1. 先写 schema 与纯函数测试（不接 UI）：`rio-relationship-state.test.ts`、`rio-endings.test.ts`。
2. 给第 1–3 幕加 `series.order`，写 `rio-route.ts` 契约与 opening 变体，跑 `rio-route-contract.test.ts` 与 `check-corpus.ts`。
3. 加 story store 的 `routes` 分支、迁移、archive schema；跑 `rio-migration.test.ts` 与 `love-play-archive.test.ts`。
4. **只实现第 4 幕**（状态 + 一个状态拍点 + 真实模型探针），做 3–5 人真人试玩。这是 P1.5 闸门。
5. 闸门通过后才做第 5–6 幕与两个结局；否则停。
6. 最后跑 `pnpm check`、`pnpm build`、live 探针，再列真机项。

**硬闸门**：foundation 的 G01/G02/G07（身份/说话人/声线）、G14/G15（记录/存档）、G10/G12/G22（系列/幕长/承接）未完成，不写第 4–6 幕。

> **闸门豁免（2026-10-20，产品决定）**：第 5–6 幕与两个命名结局在未做 3–5 人真人试玩的情况下先行落地，验收记录明确标注**未经玩家验证**。§0 停止线的判定标准（玩家能否说出「第 1/2 幕的哪个选择改变了第 4 幕的哪一句/哪个选项」）在恢复真人试玩窗口后仍然适用，届时按试玩结果复核整条方向。

---

## 7. 开放问题与推荐答案

| # | 问题 | 推荐 |
|---|---|---|
| Q1 | 第 5 幕父亲是否可见/可配音？ | **opening 引述/event-only**；保持 continuous 与单 NPC 配音。要可见配角先改引擎另立项 |
| Q2 | 状态拍点写入机制？ | **作者写死选项 + 逐字证据**；不让模型直接输出 `stateDelta` |
| Q3 | 旧 3 幕档迁移？ | **legacy 中性开场**；不补写 hidden；不要求重玩 |
| Q4 | E2 统计口径？ | **success**；E1/E2 都不惩罚，endingId 不影响分数 |
| Q5 | 关系状态是否可见？ | **本 slice 不做数值/进度面板**；只在剧情里提醒「还没说清的事」 |
| Q6 | 第 6 幕 stance 条？ | **隐藏**；acts 1–5 保留 |
| Q7 | 第 4 幕通过前是否写 5–6？ | **不写**；3–5 人试玩是硬闸门（2026-10-20 已按产品决定豁免，第 5–6 幕已写，**未经玩家验证**） |
| Q8 | 如果两结局谓词覆盖不了所有路径？ | **停下来讨论状态字段**；不加第三个惩罚性坏结局 |
| Q9 | 如果第 5 幕非得让父亲开口？ | **停**；先评估多 NPC 配音契约，不偷偷往 cast 加人 |
| Q10 | P1 停止信号？ | **仍有效**；6 幕不是承接有效的证据 |

---

## 8. 证据索引

- 现有 3 幕：`love-scenarios-deep-approach.ts:112-162`；`love-scenarios-deep-define.ts:257-310`；`love-scenarios-deep-family.ts:110-160`；学习者角色 `data/corpus/index.ts:115,123,151`；`withLearner` `:184-200`。
- 系列/承接：`data/corpus/love-series.ts:9-12,22,37,44`；`love-series-progress.ts:3-11,41-52`；`love-carryover.ts:22-37,100-115`；`love-carry-store.ts:14-18,26-47,69-92,109-121,214-222,230-240,293-313,415-426`；`love-carry-lines.ts:26-34,45,78-220`。
- 单幕引擎/UI：`tasks/love-play.ts:28-33,52-67,73-81,84-87,128-154`；`PlayScene.tsx:183,201-247,250-263,332,338,404-406`；`PlayPanels.tsx:11-38,41,48-80,114-166`；`SeriesPlay.tsx:35-38,53,80-105`。
- 存档/记录：`archive.ts:54-58,74-94`；`backup.ts:12-17,30,51-53,78`；`useApp.ts:247-280`；`app/page.tsx:40,125-136`；`Debrief.tsx:93,116-128`；`session-utils.ts:49-70`。
- 幕长/契约：`practice-policy.ts:5-10`；`tasks/love-play.ts:21-22,73-81`；`prompts.ts:37-57,142,147,252`。
- 产品红线/评审：`wiki/00-product-proposal.md:24-27`；`wiki/specs/spec-love-visual-novel.md:72,121-136`；`wiki/reviews/review-2026-10-13-love-companionship.md:176-179,205-208,230`；`wiki/85-backlog.md:7,9-10,14-15,22`。
- 测试/探针：`app/scripts/check-love-play-live.ts:18-31,64-66,86-125`；`app/src/lib/task-input.ts:15`；`app/tests/core/love-*.test.ts`。
