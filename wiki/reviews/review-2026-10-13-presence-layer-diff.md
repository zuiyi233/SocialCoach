# 在场层差异研究：现有计划 vs spec-presence-layer.md

> 核验日期：2026-10-13｜核验范围：`wiki/`（含 `specs/`、`85-backlog.md`、`00-product-proposal.md`、`13-stage-e.md`、`01-project-roadmap.md`）与 `app/src`（逐个文件按行核对）
> 结论一句话：**23 处引用里 20 处逐字准确、1 处行号对但语义写反、2 处有误；三条硬约束里有 1 条被数据模型内部写反（会直接引爆"零新增调用"），另 2 条的缺口在施工处而不在原则处。**

## TL;DR

| 类别 | 数量 | 说明 |
|---|---|---|
| 引用逐字准确 | 20 | 行号与语义都对，含三条硬约束里两条的来源 |
| 引用需修订 | 3 | 行号错 1（`partialize`）、事实错 1（剧透条数）、语义写反 1（`completeLovePlay`） |
| 差异（高） | 3 | `text: L` 与零新增调用互斥、`PresenceIntent.text` 与载荷禁令互斥、`completeLovePlay` 先例写反 |
| 差异（中） | 4 | E3 不同轴、剧透是 5 条、修正案落点未写、没有度量通道 |
| 差异（低） | 6 | `hasQuote` 不看说话人、缺 `updatedAt`、轮回无上限、对话页无归属、3 秒未锚定、SW 需改 |
| **本文判定有误** | 1 | D7 曾断言「我」页不存在——它是存在的，就是 `/settings`（`nav_me`）。见 D7 的更正 |

---

## 1. 引用逐条核验

| # | spec 里的引用 | 实际 | 结果 |
|---|---|---|---|
| 1 | `lib/shared-budget.ts:4` = `100000000` | `DEFAULT_SHARED_DAILY_TOKENS=100000000` | ✅ |
| 2 | `shared-budget.ts:10` 并发全局 3（实测第 4 路 429） | `DEFAULT_SHARED_CONCURRENCY=3`，注释逐字写明 4→429 | ✅ |
| 3 | `shared-budget.ts:12-13` 服务端只放匿名计数器 | `Only anonymous counters live… No prompt, identity, transcript, model credential or archive is sent.` | ✅ |
| 4 | `archive.ts:34` `patternInsight` | 逐字命中（`.nullable().catch(null).default(null)`） | ✅ |
| 5 | 存档形状 = sessions（转录/`stanceTrail`/`report`/`debriefChat`）+ `patternInsight`+`practiceDays`+双 proficiency+`customScenarios` | 与 `ArchiveSchema`（`archive.ts:29-35`）一致 | ✅ |
| 6 | `practice-policy.ts:39` `hasQuote` | `39: export function hasQuote(quote: unknown, texts: string[])` | ✅（**`85-backlog.md:42` 仍写 `:31`，已过期，建议顺手改**） |
| 7 | `tasks/debrief-chat.ts:55` 不许新增义务 | `src/lib/tasks/debrief-chat.ts:55` "do not require them to promise… Any optional new commitment must be explicitly conditional" | ✅（路径缺 `src/lib/` 前缀，可接受） |
| 8 | `prompts.ts:222` 不许新增义务 | 逐字命中 "Do not add an obligation, disclosure, deadline or promise the learner did not choose." | ✅ |
| 9 | `prompts.ts:142` 不许编造过去 | 逐字命中 "Never invent a past missed meeting, betrayal, incident…" | ✅ |
| 10 | `store/useApp.ts:242` `completeLovePlay` | 行号正确 | ⚠️ **语义引用写反，见 D3** |
| 11 | `useApp.ts:292` `name:"socialcoach.v1"` | 逐字命中 | ✅ |
| 12 | `partialize`（`useApp.ts:310` 附近） | partialize 本体在 **:294**，:310 是 allow-list 最后一项 `patternInsight` | ❌ |
| 13 | `useApp.ts:357` storage event 链路 | `if(event.key!=='socialcoach.v1'||!archiveStorage.changed(...))return;` | ✅ |
| 14 | `features/dinner/storage.ts:8,57` | :8 `createDinnerStorage(...'socialcoach.dinner')`，:57 `dinnerBackup()` | ✅ |
| 15 | `lib/backup.ts:38` 合并风格 | :38 是 `mergeArchives` 的 return，抛 `backup-conflict` 在 :35 | ✅ |
| 16 | `app/page.tsx:45` 取上一场 `stanceTrail` | `const trail = last.stanceTrail ?? [];` | ✅ |
| 17 | `progress/page.tsx:22` 算 streak | `const streak = computeStreak(practiceDays);` | ✅ |
| 18 | `check-landing-ssr.ts:117-136` 剧透断言写法 | 区块边界精确 | ✅ |
| 19 | "C1 四条剧透断言同源" | 断言实际是 **5 个字段**：`simulationFacts` / `simulationDirection` / `success` / `failure` / `characters[].hidden` | ❌ |
| 20 | 2026-09-09 反馈 / 2026-09-10 统计为两条限定例外 | `00-product-proposal.md:26` 逐字记载，日期与编号都对 | ✅ |
| 21 | "（Web Push）第三条限定例外" | 编号与上一条同源，成立 | ✅ |
| 22 | 3D 模块形状（`features/dinner/` 自带 schema+纯函数+UI） | 存在 `DinnerApp.tsx` / `lib/` / `components/` / `storage.ts` | ✅ |
| 23 | iOS 只对已加到主屏的 Web App 生效 | 2026 年仍成立（iOS 16.4+ 要求 Home Screen 安装 + **用户手势才可调起授权**） | ✅（手势这条 spec 没写） |

外部排查补充：

- 全仓 **无** `PushManager` / `showNotification` / `Notification.` 调用 → `local-notification` 与 `web-push` 零现有基础设施。
- `public/sw.js` 只有 `install` / `activate` / `fetch` 三个监听器，**没有 `push` / `notificationclick`** → `local-notification` 通道必须改这个文件，spec 未提。
- `extensions.socialcoach` 方言、`features/presence/` 目录均不存在（新建）。
- `features/dinner/lib/presence.ts` **已存在**（3D 显示层计时），与新建的 `features/presence/` 同名近义，搜索时极易混淆。
- 仓库现有代码中**不存在任何跨场次注入**：`prompts.ts` / `tasks/roleplay.ts` grep 无 cross-session 相关代码 → 核验表 #9 那条"由提示升级为断言"实际是**从零新增断言**，不是"升级"。
- 复盘页已有完全同类的现成写法可复用：`Debrief.tsx:538`
  `const isQuote=Boolean(hasQuote(text,session.messages.filter(m=>m.role==='learner').map(m=>m.text)));`
- 「我」页**存在**，就是 `/settings`：`Shell.tsx:19` 的 `{ href:"/settings", key:"nav_me" }` + `i18n.ts:151` 的 `nav_me: { zh:"我", en:"Me" }`。（这条是本文自身的更正来源，见 D7）

---

## 2. 差异清单（D = 需修订）

### D1｜【高】`text: L` 与"零新增模型调用"硬约束互斥

数据模型写 `text: L // 双语对象之外的用户原话保持原文，不翻译`。`L` 是 `@/data/taxonomy` 的双语对象，`pick(v, lang)` 取值。但用户只在一个语言里说过/写过那句话，要得到 `{zh, en}` 只有两条路：让用户填两遍，或机器翻译——**后者直接违反第一节第一条硬约束**（这一节的立身之本就是"回访文案零新增调用"）。注释与类型自相矛盾。

建议改为：

```
text: string        // 用户原话，逐字，不翻译
lang: Lang          // 记录原话所属语言
```

面向用户的**模板**继续用 `L`，取值用 `pick(template, lang)`，把 `text` 原样插入。

### D2｜【高】`PresenceIntent.text` 与载荷禁令互斥

第二节接口 `PresenceIntent { commitmentId, text, desiredAt? }`，而 `origin:'quote'` 时 `text` **就是转录原话**。把它交给任何外在通道（尤其 web-push 的"服务端代发"），等于把转录内容送出设备——正是 D2 载荷禁令要拦的东西。

建议：`PresenceIntent` 不携带文本，只发 `{ commitmentId }`（必要时再加一个本地生成的随机 key）；文本一律本地拼装。web-push 空实现的守卫要落到"intent 里不能出现字符串 field"这一层，而不是靠实现者自觉。

### D3｜【高】`completeLovePlay` 先例写反了

spec 写"照 `useApp.ts:242 completeLovePlay` 的先例（只写 outcome bump，明确不进能力分）"。实际 `useApp.ts:242-274`：

```ts
const love = { ...s.loveProficiency };
if (topic) { const gain = success?0.3:partial?0.15:0.05; love[topic]=Math.min(5,Math.max(1,+(cur+gain).toFixed(2))); }
return { sessions, practiceDays, loveProficiency: love };
```

它**确实写了能力估计**（`loveProficiency`），也**写了 `practiceDays`**。照抄会把 streak 和streak 本身一起点亮。

建议改写为绝对口径：在场层**不写 `proficiency`、不写 `loveProficiency`、不写 `stars`、不写 `practiceDays`**，只改 `PresenceCommitment.state/askedAt/closedReason`。该先例只在"轻量记录不伪造逐句复盘"这一点上可引用，不要引它证明"不进能力分"。

### D4｜【中】E3 不同轴

spec/backlog 说"建议放在 E2 之后、与 E3 同轴（E3 要解决的正是「看完复盘到再练一次之间那段距离」）"。但 `13-stage-e.md:19` 的 E3 已有自己的定义：**E3：缩短再练的距离 = 只针对一个卡点进行短分支练习**，最小范围是"一个文字单 NPC 场景、一种具体动作；必要前情与独立分支记录"。那是 feature，不是回访。

两个选择，二选一写进文档：改 E3 行的描述把在场层并经进去（不推荐，会让 E3 变成两个 feature），或在 `13-stage-e.md` 单开一行（例如 E6：在场层），并同步 `01-project-roadmap.md` 的 Stage E 功能索引——那个索引现在**只有 E1/E2 两行**，E3–E5 都没列出，本身就欠一键维护。

### D5｜【中】剧透是五条不是四条

`simulationDirection` 在 `check-landing-ssr.ts:119` 里和实际审查名单同级。spec 的两处"四条"（第 70 行卡片条款、第 93 行验收条款）、roadmap C1、backlog 第 78 行都漏了它。card-pack 导出必须五条全拦，否则"0 命中"的断言本身写着四条，实际只测了四条。

### D6｜【中】"明文修正案"没写落在哪

前两条限定例外的形式非常一致：**原地改 `wiki/00-product-proposal.md:26` 那条「不做账号体系与服务端存储」**，注明日期、内容、是否可关。spec 只说"要落成明文修正案才能开工"，没指位置，实施时大概率漏改《不做什么》那条红线本身。

另外 spec 称两条先例"都是限定例外 + spec + 设置页可关"——**只对了一半**：2026-09-10 统计有设置页开关（`settings.telemetry`，`settings/page.tsx:260`，默认开）；2026-09-09 反馈**没有**设置页开关，它的同意形式是"用户主动点击发送"（见 `wiki/archive/specs/spec-user-feedback.md` 的「已确认边界」），IP 只用于服务器内存限流、不写入飞书或日志。写方案时别把两者合成同一个模板。

还有一条现成的额外约束被漏掉了：两条先例都采用**服务端严格 schema 拒收多余字段 + 16KB 上限 + 每 IP 限流 + 日志不记载荷**（`analytics/track.ts` / `api/feedback/route.ts`）。第三条修正案至少要对齐这个水线，不能只写"不携带 prompt 与转录"。

### D7｜【中 → 判定有误，已降级】「我」页存在，就是 `/settings`

> **2026-10-13 更正**：本文初版称「『我』页不存在」，这是错的。`Shell.tsx:19` 的导航项 `{ href: "/settings", key: "nav_me" }`，而 `i18n.ts:151` 是 `nav_me: { zh: "我", en: "Me" }`——**「我」页就是 `/settings`**，`03-design-principle.md:202` 与 `spec-timed-reply.md:39` 里的「我」页也是同一页（后者写的「偏好区：默认开关 + 耐心秒数」正是 `settings.timed` / `patience`）。原始 spec 用「我」页并不算错。

仍有价值的部分是消歧：两个入口都应落在 `/settings` 已有的「数据」区（`st_data`，`settings/page.tsx:254`），复用 telemetry 那个 `Switch`（`settings/page.tsx:260`），不新建页面；写文档时用 `/settings` 指名比用别名更省事。开关本身建议存 `settings`（已在 partialize 里），不要新开顶层键。

### D8｜【中】没有任何度量通道，但验收写着"数据证明回访不带来再练就停"

现有事件只有 `app_open` / `session_start` / `session_end` / `debrief_view` / `reflect` / `pattern_view` / `api_error`。**被问过的人与没被问过的人无法区分**，所以 spec 自己那条退役判据当前不可测——而这句是文档里最诚实的一句话，别让它变成口号。

按 `analytics/schema.ts:11` 既有约定（"新问题优先加字段而不是加事件，因为行数是稀缺资源"）：在 `session_start` 上加一个字段（例如 `returned_after_ask: boolean` 或 `asked_pending: number`），走 `.strict()` 与既有 `settings.telemetry` 开关、不新增落点。代价是多一个字段的行宽，比多一个事件便宜；但要一直记得它是**匿名元数据**，不带任何文本。

### D9｜【低】`prompts.ts:142` → "代码断言"落地处未定义，且 `hasQuote` 不看说话人

`hasQuote` 只做 NFKC 归一化 + 折叠空白 + 小写 + **连续子串**（`practice-policy.ts:36-43`），它接受任意字符串数组。单靠它，`quoteRef` 指向 NPC 台词也能通过。断言必须三重：

1. `sessionId` 在 `archive.sessions` 中存在；
2. `messageId` 命中且 `role === 'learner'`；
3. 该条 text 经 `hasQuote` 与 `text` 逐字符合。

任一条不成立 → 剥离引用、退回无引用模板（spec 已要求，✅）。

### D10｜【低】合并规则会因缺 `updatedAt` 而丢编辑

spec 定"同 id 取 `createdAt` 较新者"。用户若改了承诺文本，`createdAt` 不变 → **旧文本必然胜出**。加 `updatedAt: number`（含首次创建），合并取 `max(updatedAt)`。这与 D3 的 fast-forward 口径一致，且不抛 `backup-conflict`（同意）。

### D11｜【低】"还没"可以无限轮回

`pending → asked →（还没）→ pending`，没有上限和冷却，等于允许无限追问——与边界里"不做骚扰"的调性冲突，也会被 D8 的字段打成"回访反而降低再练"的假证。建议加 `askCount` + `cooldownUntil`，或 N 次后自动转 `closedReason:'dropped'`。

### D12｜【低】"对话页（第二节之后可选）"是两节验收都没覆盖的第三块

它写在第一节的机制表里，但属于"第二节之后可选"。结果：两节都整体验收通过后，这一行仍然**没有任何人负责、没有任何判定标准**。最省事的处理是把它明确移出第一节表格，写进「明确不做/待定」，待 D4 的排期另外立项。注意它还有额外副作用：NPC 跨场次引用会碰到 `prompts.ts:142` 那条红线，届时 D9 的断言会同时成为它的前置。

### D13｜【低】3 秒没锚定起点

首页所有档案读取都在 hydration 闸门之后（`AppProviders` 等 `hydrated`），而 hydration 可能因 `storageIssue`/`conflict` 而慢或失败。建议把验收写成：**自 `hydrated` 为真起 3 秒内**出现一次；若存档冲突/损坏，本轮不提问且不报错（安静降级），并把这一点并入"存储被禁用/损坏不白屏"那条。

### D14｜【低】`local-notification` 要改 `public/sw.js`

现有 SW 只做静态缓存与离线恢复页（`CACHE = "socialcoach-v2"`），无 `push` / `notificationclick`。不补这两的处理，`supported()` 即使返回 true 也收不到任何东西。iOS 侧除"必须加到主屏"外还有一条：**授权必须由用户手势触发**——设置页开关本身就发生在手势里，天然满足，但要写进文档，否则真机自测时会把"没弹授权"误判成通道缺陷。

---

## 3. 两节可独立验收的判定标准

原则：**第一节的通过不得依赖第二节任何一行代码；第二节的通过不依赖任何服务端存储（web-push 修正案未批准则只走其余四通道）。** 两节共用同一份存在主存档的 `presence` 数据，不得各自保存。

### 第一节 · 在场模块（门槛：全部 ✅ 才算通过）

| # | 判定标准 | 怎么验 | 状态 |
|---|---|---|---|
| A1 | presence 代码路径无任何自有后端 `fetch`，也无 `/api/*` 调用 | 静态断言：对 `src/features/presence/**` 正则扫 `fetch(` `/api/`，0 命中；运行时 DevTools Network 过滤 `/api/` 为空 | ⬜ |
| A2 | `origin:'quote'` 三重校验通过；改一个字的引文被拒并给可懂提示 | 单测：正例 1、反例 3（改字/跨句/指向 NPC 台词） | ⬜ |
| A3 | `prompts.ts:142` 有代码断言：存档中不成立则剥离引用、退回无引用模板 | 单测：`quoteRef` 指向不存在的 session / 指向 NPC 消息 / 指向已被编辑过的 session，三种都产出无引用文案且不抛 | ⬜ |
| A4 | 回访答「做了」不改变 `proficiency` / `loveProficiency` / `stars` / `practiceDays` | 单测：断言四个键前后 JSON 全等（含 `practiceDays`，这是 D3 的坑） | ⬜ |
| A5 | 首页 `hydrated` 后 3 秒内出现一次回访；存档冲突 / 损坏时不提问、不报错 | 浏览器脚本；存档冲突与损坏两条反例 | ⬜ |
| A6 | 「还没」→ 重新 `pending` 且 `askedAt` 清空；同一条不重复问第二次 | 单测 + 浏览器两次进入 | ⬜ |
| A7 | 候选列表只有 learner 原话与用户自写，模型生成的句子不在列表里 | 单测断言候选构造函数的输入源 | ⬜ |
| A8 | 导出 → 恢复往返 presence 完整回来；同 id 文本不同不阻断恢复（含 `updatedAt` 语义） | 复用 `lib/backup.ts` 路径的单测 | ⬜ |
| A9 | 跨标签页：另一页清空后本页不复活，且不触发额外写入 | 两条 tab 的浏览器脚本 | ⬜ |
| A10 | 存储禁用 / 损坏时与主链一起降级，不白屏 | 沿用 `check-storage-recovery.ts` 风格 | ⬜ |
| A11 | 新增文案全是 `L = {zh,en}`，色值只在 `globals.css`，中英明暗手机视口走一遍 | `pnpm check` + `pnpm build` + 浏览器矩阵 | ⬜ |

补充硬门槛：`pnpm check`（lint + typegen + `tsc --noEmit` + core/dinner 测试）与 `pnpm build` 均 exit 0。

### 第二节 · 触达通道（门槛：全部 ✅ 才算通过；**不依赖第一节之外的任何新建基础设施**）

| # | 判定标准 | 怎么验 | 状态 |
|---|---|---|---|
| B1 | `supported()` 为 false 的通道不出现在设置页；已声明意图自动退回 `on-open` | 单测 + 浏览器 | ⬜ |
| B2 | `.ics` 下载内容的时间与标题正确，且不含对话内容、判据、原话 | 文件级断言 | ⬜ |
| B3 | 卡包导出 `extensions.socialcoach` 字段可读回；**五条**剧透串在导出物里 0 命中 | 照 `check-landing-ssr.ts:117-136` 的写法，注意是 5 个字段（D5） | ⬜ |
| B4 | `web-push`：接口存在、`supported()` 恒 false、无订阅请求发出；**修正案未批准前不得有第二行实现** | 静态断言 `web-push.ts` 行数上限 + 网络请求计数为 0 | ⬜ |
| B5 | Android 真机本地通知：**人工、用户自测清单**；iOS 记录为"通道不支持"而非"已验证" | 用户签字 | ⬜ |
| B6 | 修正案未批准时，第二节其余四通道仍可独立交付 | 仅靠上述四条即可通过，web-push 空实现不阻断 | ⬜ |

第二节的前置物（**批准前不得开工**）：改 `wiki/00-product-proposal.md:26` 的第三条限定例外，写清——服务端只存订阅三元组与匿名 id，**载荷不携带 prompt、转录、对话内容、承诺文本、判据、身份**；设置页一键关闭即刻失效；服务端不排任何模型任务；沿用前两条例外的严格 schema + 大小上限 + 限流 + 日志不记载荷。

---

## 4. 遗留风险清单

| # | 风险 | 触发条件 | 暴露时机 | 现状缓解 |
|---|---|---|---|---|
| R1 | **零被调用的约束会被不可见地打破** | 实施时为"让文案更自然"引入一次摘要调用 | 只有人盯才知道 | A1 做静态断言 + CI |
| R2 | **typed 混进证据链** | 后续有人把 `presence` 接进 `assess`/`hint` 的输入 | 复盘质量 silently 下降 | A2/A7 之外还需在架构文档写死"typed 只流向 `callbackLine()`" |
| R3 | **presence 数组无上限，主存档字节持续增长** | 用户长期积累大量承诺；主存档字节预算有限 | 写入配额失败 | 数据模型需加上限/老化规则（spec 未提） |
| R4 | 合并冲突语义偏弱导致丢数据 | 多设备编辑 | 用户抱怨"我改过的话没了" | D10 的 `updatedAt` |
| R5 | iOS 判定被当成"已验证" | 用模拟视口或二手设备截图销账 | 发布后才发现不可用 | spec 已写死"iOS 只能记不支持"——**这条必须保留，不得放款** |
| R6 | 无限追问变成骚扰 | 「还没」被反复点 | 卸载 / 关开关 | D11 的上限与冷却 |
| R7 | 命名混淆：`features/dinner/lib/presence.ts`（3D 计时）vs `features/presence/`（在场层） | 搜索 `presence` | 改错文件 | 文档里显式标注两者无关 |
| R8 | **spec 自己的退役判据不可测** | 上线后想判断要不要停 | 决策时没数据 | 先做 D8 的字段，再谈退役 |
| R9 | 排期悬空（E3 同轴未被 stage 文档承认） | E2 收口后讨论下一步 | 在场层被无限期推迟 | D4：要么改 E3 行，要么单开一行 |
| R10 | 3 秒承诺被 hydration 延迟 / 大存档拖垮 | 老设备 + 上百条 session | 首屏看起来"没有回访" | D13 锚定起点 + 降级不报错 |

---

## 5. 建议的最小修订动作（按顺序）

1. **`text: L` → `text: string` + `lang: Lang`**，并把 `PresenceIntent.text` 删除。（D1/D2，动数据模型，越早越好）
2. 重写"不入能力估计"那条解释为绝对口径，摘掉 `completeLovePlay` 的误引。（D3）
3. 数据模型加 `updatedAt`、`askCount`/冷却。（D10/D11）
4. 「四条剧透」→「五条剧透」，补上漏掉的 `simulationDirection`。（D5）
5. 补一行修正案落点：改 `wiki/00-product-proposal.md:26`，并把"已是两条例外都是 spec + 设置页可关"改成差别描述（反馈那条是"每次主动提交"，无设置页开关）。（D6）
6. 「我」页写明确（它存在，就是 `/settings` / `nav_me`）；入口落在 `{st_data}` 区；补上 SW 需改 `public/sw.js`、iOS 手势前置。（D7/D14）
7. 补一小节「如何度量」：`session_start` 加字段，遵守 `settings.telemetry`。（D8）
8. 排期写清：改 E3 行或单开一行，并同步 roadmap Stage E 索引。（D4）
9. 把"对话页记得上次让在哪一步"移入「明确不做/待定」。（D12）
10. 顺手修陈旧引用：`85-backlog.md:42` 的 `hasQuote` 行号 `:31` → `:39`；spec 的 `useApp.ts:310` → `:294`（核验表 #12）。

---

## 6. 修订落地情况（2026-10-13 已执行）

第 5 节 10 条**全部已落地**，另含一处对本文自身的更正。

| 动作 | 落到哪个文件 | 状态 |
|---|---|---|
| 1 `text: L` → `text: string` + `lang: Lang`；三重校验写入数据模型 | `wiki/specs/spec-presence-layer.md` | ✅ |
| 2 `PresenceIntent` 去掉 `text`；补「意图不带文本」的理由与静态断言 | 同上 | ✅ |
| 3 「任何能力类数值都不写」改成绝对口径，并点出 `completeLovePlay` 实际写了什么 | 同上 | ✅ |
| 4 数据模型加 `updatedAt`、改用 `updatedAt` 合并、加 `askCount` 与提问上限；加数组上限规则 | 同上 | ✅ |
| 5 剧透改五条（含 `simulationDirection`） | 同上 + `01-project-roadmap.md` C1 + `85-backlog.md` 剧透边界项 | ✅ |
| 6 修正案落点写明 `00-product-proposal.md:26`；两条先例形态差别化描述；补齐 schema/大小/限流/日志水线 | `wiki/specs/spec-presence-layer.md` | ✅ |
| 7 「我」页 = `/settings`（含 **本文对 D7 的更正**）；入口落在 `{st_data}` 区；SW 与 iOS 手势施工说明 | 同上 + 本文 D7 | ✅ |
| 8 新增「如何度量」小节：`session_start` 加字段 + `settings.telemetry` | 同上 | ✅ |
| 9 排期：Stage E 单列 **E6**，明确不并入 E3 | 同上 + `13-stage-e.md` + `01-project-roadmap.md` Stage E 索引 + `85-backlog.md` | ✅ |
| 10 「对话页记得上次让在哪一步」移入「明确不做 / 待定」 | `wiki/specs/spec-presence-layer.md` | ✅ |
| 11 顺手修正：`hasQuote` `:31`→`:39`；`partialize` 本体 `:294`（allow-list 末尾 `patternInsight` 才在 `:310`）；`prompts.ts:142` 是「从零落成」而非「升级」 | `85-backlog.md` + spec | ✅ |
| 12 验收表改写：两节独立性原则、11 条 / 6 条判定项、`pnpm check` + `pnpm build` 硬门槛 | `wiki/specs/spec-presence-layer.md` | ✅ |

`00-product-proposal.md:26` **未改动**——第三条限定例外尚未批准，此时改《不做什么》那条红线本身属于越权；修订只把落点指到那一行，等批准时再原地写。

**本文自身的更正**：初版 D7 断言「我」页不存在，是错的。`/settings` 就是「我」页（`nav_me`）。已在 D7、TL;DR 与「外部排查补充」三处更正，原始 spec 的「我」页写法本身不算错。
