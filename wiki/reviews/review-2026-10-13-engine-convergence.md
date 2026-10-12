# 练习引擎 × 陪伴引擎：融合可行性调研

2026-10-13｜调研对象：`L:/SocialCoach-main`（练习引擎）与 `L:/AIcove-main`（陪伴引擎）
性质：**决策用的一次性调研**，不改两侧任何已有文件。所有结论附 `文件:行号` 证据，不能用代码回答的地方写明「无数据」。

---

## 0. 结论一句话

**引擎级融合不成立：不是难，是两个项目各自写进红线里的东西在正面冲突。** 真正可搬的不是运行时，而是 AIcove 的两处工程细节（引文溯源校验、后台任务的节流骨架）。
**这个结论不改变在场层本身的存废——在场的成立与否从来不取决于 AIcove 是否存在，而取决于「一句回访能不能带来再练」，而这件事目前没有数据。所以正确动作是把它降级成一个可证伪的小实验，而不是继续排 Stage E 的完整 feature。**

---

## 1. 两个引擎各是什么

| 维度 | SocialCoach（练习引擎） | AIcove（陪伴引擎） |
|---|---|---|
| 一句话定位 | 知道和做到之间那道沟：给阻力、给判决、给重复次数（`wiki/00-product-proposal.md:15`） | 会主动想你、记得你、能说话也能画画的 AI 陪伴应用（`AIcove-main/README.md:5`） |
| 循环优化的目标 | **performance**：压力下重复次数 | **关系连贯性**：记得过往、主动出现 |
| 真相源 | 转录原话——复盘每条判断必须引用，没有证据的评价一律不出现（`00-product-proposal.md:25`） | DB raw message 是聊天上下文唯一真相源（`DEVELOPMENT.md:189` 宪法第 4 条） |
| 运行时 | Next.js Web PWA + localStorage 主存档 | Flutter 客户端 + SQLite + 自部署同步后端 |
| 规模 | — | 997 个 dart 文件，`lib/` 168,617 行，`test/` 96,632 行，276 篇 md；公开测试版已发 Android / macOS 安装包 |
| 用户动机 | 「明天有一场难谈的对话」，要的是**不顺着他** | 「手机那头的小屋」，要的是**被惦记** |

**注意这两条动机是反的。** SocialCoach 明写「不做讨好型 NPC……这是与聊天机器人的唯一区分点」（`00-product-proposal.md:24`）；AIcove 的产品价值恰恰建立在「TA 会先来找你」上。

---

## 2. 四条可能的融合路线，逐条判

### M1｜产品合并：一个 App，练习 / 陪伴两个模式 → ❌ 不成立

需要的动作与代价：

- SocialCoach 必须破 `00-product-proposal.md:26`（不做账号体系与服务端存储）与 `:27`（不做通用聊天入口）；
- AIcove 必须破 `ADR0031` / `cloud_backend/README.md:3`（不做中心化服务器、不做会员 / 额度 / 云记忆执行 / Web 管理面板）与 `docs/项目记忆/README.md:45`（Web 端不在目标平台内，2026-09-13 已删 `web/` 目录并明文禁止加回）；
- AIcove 的 `ADR0066` 更狠：**明令禁止**——「执行条款：agent 不再提出监控、危机干预、内容审核类功能建议」，其理由是「产品的陪伴价值建立在本地与隐私之上」。这条不是技术缺口，是产品线级别的自我定义。

**任一侧都不可能在不重写自己产品定义的前提下进入对方。** 且用户重合度低：酒馆 / SillyTavern 生态的扮演用户，与「想提升谈判表现」的人，买的是两个东西。

### M2｜运行时共用：借 AIcove 的长期记忆做 SocialCoach 的跨场次记忆 → ❌ 不成立，且方向有害

**这条最容易被误判为「最合适的一条」，因为两家真相源看起来一样。但它们保值的内容不同。**

AIcove 的记忆是什么形状（`apps/aicove_flutter/lib/src/core/database/database.dart:378-390`）：

```
memory_items { id, owner_id, layer, title, content, source_ids, locked, embedding, created_at, updated_at }
```

可追溯性它确实做实了，而且是三层硬保障，不是靠提示词自觉：

- 提示词要求「source_ids 填对应消息 id；不要把助手的猜测或剧情台词当成用户的现实事实」（`background_memory_agent_adapter.dart:24`）
- 代码强制过滤：`value.whereType<String>().where(sourceIds.contains)`（`:192-194`）
- 无来源直接丢弃：`if (title == null || content == null || ids.isEmpty) continue;`（`:208-209`）

**但 content 本身仍是模型改写的有损摘要**（标题 ≤30 字 / 正文 ≤300 字），不是原话。更要命的是 AIcove 的 `ADR0062` 把压缩口径从「目标 / 进度 / 待办」改成了陪伴口径——**「答应过或未聊完的事」被降级为一句话塞进一段关系摘要里**。

这正是反面教材：**承诺如果被埋在有损摘要里，就不可判定、不可引用、不可核验。** SocialCoach 需要的是结构化的一等对象（`PresenceCommitment` + `quoteRef` 三重校验），不是从摘要里捞一句话。所以 AIcove 的做法不但不能借用，**它恰好证明了为什么 SocialCoach 必须自己建这个对象**——这是本次调研对在场层最有价值的一条结论。

（另注：这条路另有两处实际障碍——`memory_items` 表**暂不同步**（`docs/04_功能模块规范/记忆系统/README.md:67`），且记忆 UI 完全没暴露 `sourceIds`，全库 `lib/src/ui/` 零命中。）

### M3｜触达能力复用：借 AIcove 的主动关怀来做回访推送 → ❌ 平台错位 + 成本反向

设想很诱人：AIcove 已经实现了「你去开会了，两小时后 TA 问你开完了吗」，这不就是第二节想要的触达吗？两个回答如下。

**① 平台错位——想借的能力恰好在我们需要的平台上不存在。**

AIcove 的完整调度面只在 Android：`Workmanager.registerOneOffTask`（`background_service.dart:1245-1260`）+ `PersistentGuardService`（`PersistentGuardService.kt:23`）+ 两条通知渠道（`background_service.dart:976-985`）。iOS / macOS / Windows / Linux **通知均未实现**——`trigger_service.dart:16-21` 的注释是原话：「Linux/Windows/iOS setup can be added here. For MVP, we focus on Android as per user request」。而 SocialCoach 是 Web，它的触达面是 Service Worker / Web Push，正好是 AIcove 主动删掉的那一部分。

**② 成本反向——它的每一次关怀都要烧模型的 token，而我们的硬约束是一次都不能烧。**

| 环节 | 证据 | 模型往返 |
|---|---|---|
| AI 管家分析 | `context_analyzer.dart:125-127`（`maxRounds: 4`） | 1–4 |
| 预览工具内部再生成 | `proactive_scheduler_tools.dart:157-161` | 1 |
| 预生成 / 落缓存 | `auto_reply_dispatch_service.dart:369-375` | 0–1 |
| 到点发送 | 缓存 ≤60min 新鲜则 0 次（`auto_reply_dispatch_service.dart:257-280`）；否则 1 次 | 0–1 |
| **每条关怀合计** | | **2–6 次** |

对照 `app/src/lib/shared-budget.ts:4,10`：日 1 亿 tokens、全局并发 3。**按 AIcove 的方式给每个用户每天做几次关怀，会直接挤占真人开练的请求。** SocialCoach 第一节的「零新增模型调用」不是洁癖，是这条资源线的必然推论。

（补一条纠正：`auto_reply_dispatch_service.dart:257-280` 证明缓存命中时确实可以 0 次调用，但它做不到「整条链路 0 次」——缓存本身至少要一次调用才产生。而 SocialCoach 要的是**永远** 0 次，即模板 + 已通过 `hasQuote` 的原话。）

**可搬的是它的节流骨架**：三重门禁（日上限 3、最小间隔 120 分钟、免打扰时段）+ SQLite 认领表做前后台互斥（`auto_reply_trigger_claims`，`database.dart:436-444`）+ 命中门禁改期重排而非丢弃（`background_service.dart:530-563`）。这套东西在 on-open 通道里用不上（不需要后台），但「一轮只对同一个人问一次、被拒后冷却、超限自动退役」的节奏控制思路是同构的——在场的 `askCount` 上限 3 次与 `dropped` 状态，本质上就是它的简化版。

### M4｜数据单向导出：card-pack 通道走 `extensions.socialcoach` 方言 → ⚠️ 当前走不通，且修复收益极低

**这是本轮唯一直接打到在场层 spec 的硬发现。**

spec 第二节假设可以把承诺写成 `extensions.socialcoach` 字段导出给外部陪伴运行时（`wiki/specs/spec-presence-layer.md:104`）。核验 AIcove 的角色卡解析器 `apps/aicove_flutter/lib/src/features/agent_context/domain/silly_tavern_character_card.dart:150-182`——它是**固定字段白名单投影**：`name / description / personality / scenario / first_mes / alternate_greetings / mes_example / creator_notes / character_book`，外加 `extensions` 下只认两个子键 `regex_scripts` 与 `tavern_helper`（`:154-156`）。

**写在 `extensions.socialcoach` 里的东西，导入时被静默丢弃，不可能 round-trip。** 而且 AIcove **没有 SillyTavern 角色卡导出器**（全库只测了读与剥离「卡数据」的 `stripCardData` / `_writePng`，没有写卡数据的实现），自带备份是 ZIP + 自有 schema，且明写「插件 / 预设绑定……不在恢复范围内」（`export_format.dart:8-9`）。

顺带一条有意思的对照：AIcove 的**预设**载体反而保真（`rawPreset` 原样存，`silly_tavern_preset_store.dart:293-311`），因为它存的是完整原始 JSON。所以真要这条路，扩展数据该挂预设而不是角色卡——但那时它已经不是 spec 描述的那个东西了。

**代价反转**：修好它的成本不高（AIcove 侧改一个解析分支 + 补一个导出器），但换来的场景是「用户把自己的承诺手动搬到另一个 App 里让另一个角色提醒他」——**跨了两次用户意愿门槛，还得两边都装**。收益远不足以支撑一个通道。

---

## 3. 真正值得搬的（不是运行时，是三处工程细节）

| 可搬项 | AIcove 出处 | 在社仓侧对标的已有/应有物 |
|---|---|---|
| **溯源三件套**：提示词要求 source_ids + 代码强制过滤 + 无来源即丢弃 | `background_memory_agent_adapter.dart:24,192-194,208-209` | 我们的 `hasQuote` + `quoteRef` 三重校验是同一个敌人（防模型编造过去）。AIcove 的做法多了一层 **role-aware 的代码过滤**，值得抄的是这个结构：把校验分层到「写不进去」而不是「事后检出」 |
| **后台任务节流骨架**：日上限 / 最小间隔 / 免打扰 / 认领互斥 / 改期重排 | `background_service.dart:530-563`、ADR 默认 `{daily_limit:3, min_interval_minutes:120}` | `askCount` 上限 3 次 + 24 小时冷却 + `dropped` 退役是它的 on-open 简化版，方向一致 |
| **注入预算护栏**：档案层 1500 tokens / 6 条封顶，2 秒超时则本轮不注入 | `memory_retrieval.dart:6-8,52-61` | 注入预算与降级策略，对 `/api/pattern` 的跨场引用有参考价值 |

**明确不搬**：ADR0062 的陪伴口径压缩（见 M2）、酒馆生态本身、`cloud_backend`（含账号）。

---

## 4. 对在场层的直接影响

| 项 | 现状 | 建议 |
|---|---|---|
| 第二节 `card-pack` 通道 | 技术前提已被本轮证伪（`extensions.socialcoach` 被丢弃 + 无导出器） | **砍掉**，或降级到「待定」并在那里写清被证伪的原因，不要留个实现不了的空壳 |
| 第二节 `local-notification` | Web 场景下 iOS `supported()` 恒 false，等于半个通道；且要同时改 `public/sw.js` | 保留但标注「只覆盖 Chromium / Android」，不与 card-pack 同等投入 |
| 第二节 `web-push` | 仍需第三条限定例外，未批准；与 AIcove 无关 | 维持空实现 |
| 第二节 `ics-calendar` | 不依赖任何外部项目，零成本 | 保留，这是唯一不受本次调研影响的通道 |
| 第一节 | 与 AIcove 完全无关，`text: string` + `quoteRef` 三重校验的设计被 M2 反向佐证 | **不动设计，改投入规模** |

---

## 5. 推荐动作

**R1｜不做引擎融合，也不预研。** 把本报告的 M1–M4 判词作为「已论证过」的结论归档，以后任何人再提「XX 能不能和陪伴结合」，先读第 2 节再开口。

**R2｜在场层从「Stage E 单列 E6」降级为「一个可证伪的实验」，规格只留最小版：**
复盘页写入 → 首页一句回访 → 三个回答按钮 → `on-open` 单通道。第二节其余四个通道全部移入「待定」并注明理由。

**R3｜先把度量字段加上。`session_start` 加 `asked_pending`（见 spec「如何度量」）是一个字段的成本，但它是这里唯一 Make-or-break 的东西——没有它，R4 的停用线没法执行，在场层就只能靠直觉活下去。**

**R4｜现在就写死停用线。** spec 里那句「数据证明回访不带来再练就停」是对的话，但缺两个数：最小样本量与观察窗口。建议 quit line 写成可执行的句子，例如「≥N 台设备、累计 4 周，`asked_pending>0` 组的 7 日再练比例相对 `=0` 组无提升则删功能」。**N 取多少取决于当前DAU，这需要你给——我手上没有 `scripts/retention.ts` 之外的实际数据（该脚本要有 FEEDBACK_FEISHU_* 凭据才能跑）。**

**R5｜「对话页记得上次让在哪一步」维持待定。** 它与本次调研关系不大，但 M2 已经证明「NPC 的记忆」如果走 AIcove 式摘要路线会不可核验——这加强了它待定的理由，而不是削弱。

---

## 6. 待你确认 / 本次没答

| # | 问题 |
|---|---|
| Q1 | 当前匿名统计的实际样本量（DAU / 30 日活跃设备）是多少？这决定 R4 的 stop line 能否在合理时间内判定，也决定在场层值不值得现在动手 |
| Q2 | 「陪伴」在你心里是只指 AIcove，还是也包括「让 SocialCoach 本身变得更有人味」？后者的答案与前者不同——那是产品语气问题，不是引擎融合问题 |
| Q3 | 是否要我按第 4、5 节改 `wiki/specs/spec-presence-layer.md`（砍通道、降级实验规模、写 stop line）？这轮我先只出调研，没动任何已有文件 |
