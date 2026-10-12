# 在场层：承诺、回访与触达通道

状态：**方案，未开工。** 排期见本文「排期与归属」——已改为 Stage E 单列 E6，**不作为 E3 的一部分**。本文件分两节，两节各自独立验收：第一节不依赖任何新基础设施，第二节依赖通道抽象，其中 Web Push 通道**只留空实现**并写明前置条件。

> 2026-10-13 已做一次规格与代码的逐行差异研究，14 条差异与 23 条引用核验见 [review-2026-10-13-presence-layer-diff.md](../reviews/review-2026-10-13-presence-layer-diff.md)。本次按该报告修订了：`text` 的类型、`PresenceIntent` 载荷、能力估计口径、剧透条数、修正案落点、页面归属、提问上限与度量方式。

## 为什么

系统现在知道关于这个用户的一切，唯独没有一个对象叫「他说过下次要去做的那件事」。`lib/archive.ts` 的存档形状是 sessions（含完整转录、`stanceTrail`、`report`、`debriefChat`）、`patternInsight`（`archive.ts:34`）、`practiceDays`、`proficiency` / `loveProficiency`、`customScenarios`；首页与进度页只是在**回放**它们（`app/page.tsx:45` 取上一场 `stanceTrail`，`progress/page.tsx:22` 算 streak）。所以「被记住」目前只到统计层，没到关系层。

练习系统给人的感受是一次性的：开一场、被判决、关掉。把长期在场做出来，需要的不是陪伴运行时，而是**一个跨会话的承诺对象 + 一个会在下次出现时引用它的教练**。情感落点必须在教练（B13 的品牌 IP）身上，不在 NPC 身上：NPC 是对手，教练是记得你说过什么的那个人。

## 第一节：在场模块（零新基础设施）

### 边界

- **不新增服务端存储，不新增账号。** 这一节的全部状态留在设备端，走主存档正门。
- **不产生新的模型调用。** 回访文案由**固定模板 + 已验证的用户原话**拼装，不调模型。这条是硬约束：共享池是 `DEFAULT_SHARED_DAILY_TOKENS = 100000000`（`lib/shared-budget.ts:4`），并且并发上限是**全局 3**（`shared-budget.ts:10`，实测第 4 路开始 429）。任何「每天替每个用户想一遍该问什么」的后台任务都会在早高峰挤占真人开练的请求，且不产生练习记录。
  - **这条约束在数据模型里就有体现**：`text` 是 `string` 而不是 `L`。要凑出双语对象只有两条路——让用户填两遍，或机器翻译——后者直接破这条约束。所以面向用户的**模板**是 `L`，用户**原话**永远是单语原文。
- **记忆层不新做摘要。** 跨场次模式复用已有的 `patternInsight`（A16 `/api/pattern`，带引文防伪），不引入 AIcove 式「后台记忆整理助手」。
- **承诺只能来自用户自己。** 两种合法来源：`quote`（从本场转录里选一条 learner 原话，必须通过下方的三重校验）与 `typed`（用户自己敲的一句话）。**教练与 NPC 都不许替用户新增义务**——继承 `tasks/debrief-chat.ts:55` 与 `prompts.ts:222` 那条：任何新承诺必须是用户自己愿意且有条件的，不许为了显得正确而布置作业。
- **`typed` 不是证据，也不进任何模型输入。** 只有 `quote` 来源可以被复盘、提示、NPC 引用为「你说过」。`typed` 只流向 `callbackLine()` 拼回访文案，**不进** `/api/assess` / `/api/hint` / `/api/roleplay` / `/api/pattern` 的输入。唯一例外是用户自己在本场对话里说出它——那时它属于转录，按转录对待。
- **不做情绪关怀。** 在场层的文案永远只指向用户自己写下的那件行动，不问「你最近还好吗」，不做健康或情绪判断，不做敏感内容监测——那属于「不做临床评估 / 心理诊断 / 危机干预」那条线。
- **任何能力类数值都不写。** 承诺是否完成**不写** `proficiency`、**不写** `loveProficiency`、**不写** `stars`、**也不写** `practiceDays`，只改 `PresenceCommitment.state` / `askedAt` / `closedReason`。
  - 别拿 `store/useApp.ts:242 completeLovePlay` 当「不进能力分」的先例——它**确实写了**：`loveProficiency` 按结局加 0.05–0.3，并且写 `practiceDays`。可引用的只有它「轻量记录不伪造逐句复盘」那一半口径。回访点亮 streak 会让「坚持」这个词失去意义。
- **不制造过去。** 跨场引用必须逐字来自存档；`prompts.ts:142`「Never invent a past missed meeting, betrayal, incident…」目前**只靠提示约束**——仓库现有代码中没有任何跨场次注入，所以这一节不是把提示「升级」为断言，而是**从零落成**代码断言（见验收）。

### 数据

```
PresenceCommitment {
  id: string
  origin: 'quote' | 'typed'
  text: string                 // 用户原话，逐字，不翻译
  lang: Lang                   // 原话所属语言；模板用它选语言，不用来翻译 text
  quoteRef?: { sessionId, messageId }   // origin==='quote' 时必填，三重校验通过
  scenarioId?: string
  createdAt: number
  updatedAt: number            // 首次写入等于 createdAt；文本或状态每次变更都推进
  askCount: number             // 默认 0，见「提问上限」
  state: 'pending' | 'asked' | 'closed'
  askedAt?: number
  closedReason?: 'done' | 'not-yet' | 'dropped'
}
```

`origin === 'quote'` 的三重校验（缺一不可）：

1. `quoteRef.sessionId` 在当前 `archive.sessions` 中存在；
2. `quoteRef.messageId` 命中该 session 的一条消息，且 `role === 'learner'`；
3. 该消息的 `text` 与 `PresenceCommitment.text` 经 `hasQuote`（`practice-policy.ts:39`）逐字符合。

不能只留 `hasQuote` 一条：它接受任意字符串数组（`practice-policy.ts:36-43` 是 NFKC 归一化 + 折叠空白 + 小写 + 连续子串），单独用时 `quoteRef` 指向 NPC 台词也能通过。复盘页已有可直接复用的写法：`Debrief.tsx:538` 的 `hasQuote(text, session.messages.filter(m=>m.role==='learner').map(m=>m.text))`。

- 持久化：主 `ArchiveSchema` 新增 `presence: z.array(PresenceCommitmentSchema).default([]).catch([])`，与 `useApp.ts:292` 的 `name: "socialcoach.v1"` 同一条链；`partialize`（本体在 `useApp.ts:294`，allow-list 最后一项 `patternInsight` 在 `:310`）加这一个键。
- **数组有上限。** 主存档不是 dinner 那种大块 slot，每次写入都要整份序列化，`presence` 无上限会多出一条「localStorage 配额」的失败线。默认上限 20 条，超出时按 `updatedAt` 从旧到新清理，**只清理 `state === 'closed'` 的项**；一条都清不出来时停止新增并提示用户去清单里删。
- **不走 dinner 式独立 slot。** `features/dinner/storage.ts` 的 `socialcoach.dinner` + `dinnerBackup()`（`storage.ts:8,57`）适合大而不透明的 3D 存档；承诺是练习档案的一部分，必须出现在导出、恢复、跨标签页同步（`useApp.ts:357` 的 storage event）与 A21 损坏档案保护里——放主存档这些全都免费继承，独立 slot 要把冲突规则重做一遍。
- 模块目录照 dinner 的形状切：**`features/presence/`** 自带 schema、纯函数（`pendingCommitments()`、`callbackLine()`）与 UI 片段；对主链只暴露两个接口——写入（复盘页一个动作）与读取（首页一个问候槽）。
  - **同名提醒：** `features/dinner/lib/presence.ts` 已存在，是 3D 人物显示层的举杯 / 说话计时，与本模块无关。搜 `presence` 会同时命中两个；改名成本高于收益的话就别改，但要在两处文件头各写一句互指说明。
- 合并：`lib/backup.ts:38` 风格新增 presence 分支，同 id 取 **`updatedAt` 较新者**——不是 `createdAt`（改过文本的承诺 `createdAt` 不变，用它会让旧文本必胜），**不抛 `backup-conflict`**（承诺文本可能因编辑而两端不同，为它阻断整档恢复不值得）。
- 开关存在 `settings` 里（`settings` 已在 allow-list 内，设置页有现成的「数据」区），不要新开顶层键。

### 入口与机制

| 位置 | 动作 | 形态 |
|---|---|---|
| 复盘页 | 「把这句话变成下次要问我的事」 | 从本场 learner 原话列表里勾选，或自己写一句 |
| 首页（hydration 完成后 3 秒内） | 教练引用那条原话问一次结果 | 模板 + 原文，三个回答按钮：做了 / 还没 / 不再问了 |
| 「我」页（即 `/settings`）的「数据」区 | 待问清单与开关 | 可全部清空；关闭后不再提问，数据保留 |
| 「我」页（即 `/settings`）的「数据」区 | 各通道的选择，以及 iOS 上的「本通道不支持」说明 | 复用 telemetry 那个 `Switch`（`settings/page.tsx:260`） |

「我」页就是 `/settings`——底部导航那一项的 i18n key 是 `nav_me`，文案是「我 / Me」（`Shell.tsx:19`）。两个入口都落在它已有的「数据」区（`st_data`），不需要新建页面；写文档时用 `/settings` 而不是「我」页，是为了对齐路由而不是改名。

**提问不止一次但有上限**：`state` 从 `pending` → `asked` 后不再重复问，除非用户选「还没」（重新 `pending`，`askedAt` 清空，`askCount + 1`）。同一条承诺最多问 3 次，且距上次追问不足 24 小时则本轮跳过；第 3 次仍是「还没」时自动转 `closedReason: 'dropped'`。无限追问会把这一层变成通知骚扰，也会污染度量口径。回答「做了」不产生任何分数、评级或 streak，只把 `state` 置 `closed`。

### 排期与归属

**不作为 E3 的一部分。** `13-stage-e.md` 的 E3 已有自己的定义（缩短再练的距离 = 只针对一个卡点进行短分支练习，最小范围是「一个文字单 NPC 场景、一种具体动作」），把在场层并进去会让 E3 变成两个 feature。改为 Stage E 单列 **E6：在场层（承诺—回访）**，待 E2 收口后与 E3 一并考虑次序。

### 如何度量

零新增模型调用不等于不可度量——否则文末那句「数据证明回访不带来再练就停」只是句口号。按 `analytics/schema.ts:11` 既有约定（**优先加字段而不是加事件**，行数是稀缺资源）：

- 在现有 `session_start` 事件上加一个字段（例如 `asked_pending: number`——进入本次练习时处于 `pending` 的承诺条数），走 `.strict()` 与既有的 `settings.telemetry` 开关。
- 该字段必须是**匿名元数据**：不带承诺文本、不带原话、不带除随机设备 id 以外的标识。
- 判断语句：`asked_pending > 0` 与 `= 0` 两组设备的 7 日内再练比例（`scripts/retention.ts` 已经能算），按周给绝对数，不填虚构基线。

## 第二节：触达通道（可插拔的部分在这里）

变化点不是记忆，是**投递**。主链只声明意图，通道自报能力；不在能力范围内的通道一律退回「打开即问」。

```
PresenceIntent { commitmentId, desiredAt?: number }
PresenceChannel { id; supported(): boolean; declare(i): void; cancel(id): void }
```

**意图里不带文本。** `commitmentId` 是本地生成的随机 id，文本一律在目标设备上由 `callbackLine()` 现场拼装。这不是洁癖：`origin === 'quote'` 的 `text` **就是转录原话**，把 intent 交给任何外在通道（尤其需要服务端代发的 web-push）等于把转录内容送出设备。守卫要落在类型这一层，而不是靠实现者自觉。

| 通道 | 第一节后是否立刻可做 | 覆盖面 / 代价 |
|---|---|---|
| `on-open` | 是（默认，永远 supported） | 全平台，零基建 |
| `ics-calendar` | 是 | 全平台，导出 `.ics`：「明天那场对话」进日历；数据不出设备 |
| `local-notification` | 是，但按能力降级 | Service Worker 定时，Chromium / Android 可用；iOS 不支持后台唤醒 → `supported()` 返回 false。**施工注意：`public/sw.js` 现在只有 `install` / `activate` / `fetch` 三个监听器，没有 `push` / `notificationclick`，做这一通道必须同时改这个文件**，否则 `supported()` 返回 true 也收不到任何东西 |
| `card-pack` | 是（导出器） | 外部陪伴运行时（AIcove 等），走 `extensions.socialcoach` 方言；**五条剧透串不得进卡**（明文即剧透，与 C1 同源） |
| `web-push` | **否，空实现** | `supported()` 恒 false。前置条件见下 |

**五条**指的是 `hidden` / `success` / `failure` / `simulationFacts` / **`simulationDirection`**。`check-landing-ssr.ts:119` 实际遍历五个字段，roadmap C1、backlog 与本文件此前都只写四项——按四条写的导出断言会漏测 `simulationDirection`。

**Web Push 的前置条件（必须先写的东西，不是代码）**：它需要服务端持有订阅并代发，属于「不引入账号体系或服务端存储」的**第三条限定例外**。

- **修正案必须落在 `wiki/00-product-proposal.md:26`**——前两条限定例外就是原地改那一行，各自注明日期、内容与是否可关。不指名这一落点，实施时大概率漏改《不做什么》那条红线本身。
- 前两条的形态**不完全一样**，别合成同一个模板：2026-09-10 匿名统计是「默认开 + 设置页 `settings.telemetry` 开关 + 服务端严格 schema 拒收多余字段 + 16 KB 上限 + 每 IP 限流 + 日志不记载荷」；2026-09-09 产品反馈**没有**设置页开关，它的同意形式是「用户主动点击发送」（见 `archive/specs/spec-user-feedback.md` 的「已确认边界」），IP 只用于服务器内存限流、不落库、不进日志。
- 第三条要对齐既有水线，不能只写「载荷禁止携带 prompt 与转录」。至少还要写明：**服务端只存订阅三元组（endpoint / p256dh / auth）与一个随机 id**；载荷不携带 prompt、转录、对话内容、承诺文本、判据、身份或设备信息；同样采用严格 schema、大小上限与每 IP 限流，**日志不记载荷**；服务端不排任何模型任务；设置页一键关闭即刻失效（含立即删除服务端订阅）。
- `shared-budget.ts:12-13` 的原则要先于修正案成立：服务端只放匿名计数器，不放 prompt、身份、转录、凭据、存档。订阅三元组与该原则同类，但同类不等于已批准。
- iOS 侧另有一条独立事实：Web Push 只对已加到主屏的 Web App 生效（2026 年仍如此），且**授权必须由用户手势触发**——设置页开关本身就发生在手势里，天然满足，但要写进文档，否则真机自测时会把「没弹授权」误判成通道缺陷。而我们没有实体 iPhone，**这条只能用用户自测清单销账，不得用模拟视口代替**。

## 验收

两节相互独立：第一节的通过不得依赖第二节任何一行代码；第二节的通过不得依赖任何服务端存储（修正案未批准则只交付其余四通道，web-push 空实现不阻断）。共同硬门槛：`pnpm check`（lint + typegen + `tsc --noEmit` + core / dinner 测试）与 `pnpm build` 均 exit 0。

第一节（全部 ✅ 才算通过）：

- [ ] presence 代码路径无任何自有后端 `fetch`，也无 `/api/*` 调用——静态断言扫 `src/features/presence/**` 下 `fetch(` 与 `/api/` 零命中；运行时 DevTools Network 过滤 `/api/` 为空。
- [ ] 承诺只能来自 learner 原话或用户自写；模型生成的句子不出现在候选列表里。
- [ ] `origin: 'quote'` 三重校验通过；反例三种（改一个字 / 跨句拼接 / `quoteRef` 指向 NPC 台词）都被拒绝并给出可懂的失败提示。
- [ ] `prompts.ts:142` 的「不许编造过去」有代码断言：跨场引用在存档中不成立时（session 不存在 / `messageId` 指向 NPC / 原话已被编辑），该引用被剥离、文案退回无引用模板，且不抛。
- [ ] 回答「做了」前后，`proficiency` / `loveProficiency` / `stars` / `practiceDays` 四处 JSON 全等（`practiceDays` 是最容易顺手点亮的那一个）。
- [ ] 首页**自 `hydrated` 为真起** 3 秒内出现一次回访；存档冲突 / 损坏时本轮不提问、不报错。
- [ ] 回答「还没」重新 `pending` 且 `askedAt` 清空；`askCount` 到上限自动转 `dropped`；同一条在一次会话内不重复问第二次。
- [ ] 导出 → 恢复往返：presence 完整回来；同 id 文本不同时按 `updatedAt` 取新，不阻断恢复。
- [ ] 跨标签页：另一页清空承诺后本页不复活，且不触发额外写入（`useApp.ts:357` 链路）。
- [ ] 存储被禁用 / 存档损坏时 presence 与主链一起降级，不白屏；`presence` 达上限时按规则清理且不清掉 `pending`。
- [ ] 中英双语、明暗主题、手机视口走一遍；新增**模板**文案全部是 `L = {zh, en}`，用户原话保持原文不翻译，色值只在 `globals.css`。

第二节（全部 ✅ 才算通过）：

- [ ] `supported()` 为 false 的通道不出现在设置页，且已声明的意图自动退回 on-open。
- [ ] `PresenceIntent` 类型上不存在任何文本字段；静态断言五个通道实现里没有一处读 `text`。
- [ ] `.ics` 下载内容里的时间与标题正确，且不含对话内容、判据、原话。
- [ ] 卡包导出：`extensions.socialcoach` 字段可被读回；**五条**剧透串（`hidden` / `success` / `failure` / `simulationFacts` / `simulationDirection`）在导出物里 0 命中（照 `scripts/check-landing-ssr.ts:117-136` 的断言写法）。
- [ ] `web-push` 空实现：接口存在、`supported()` 恒 false、无订阅请求发出；修正案未批准前不得有第二行实现。
- [ ] Android 真机本地通知（人工，用户自测）；iOS 记录为「通道不支持」而不是「已验证」。

## 明确不做

不做 24/7 对话入口，不做通用聊天框，不做用户画像式「懂你」的后台整理，不做情绪监测或危机干预，不把陪伴感做成可刷的数值（`stance` 是立场不是分数，`love-play` 那条口径同样适用）。**如果哪天数据证明回访不带来再练，该停的是这一层，不是复盘**——这句话要能被验证，所以度量是第一节的组成部分，而不是上线后再补的事。

### 待定（不属两节任一节；两节都验收通过也不代表它可以开工）

- **对话页：同一 NPC 记得上次让在哪一步。** 原先写在本方案第一节的机制表里，现移出。它需要 NPC 侧跨场次引用，会碰到 `prompts.ts:142` 那条红线，届时本文件的三重校验断言会同时成为它的前置。在有人明确接手并写出自己的验收之前，它不进任何一节的范围。
