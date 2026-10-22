# MaiBot 能否成为 SocialCoach 的底层架构

2026-10-22｜调研对象：`L:\refs\MaiBot`（v1.3.14, `c602a27`, 2026-10-22, GPL-3.0）与本仓 `L:\SocialCoach-main`
性质：**决策用的一次性调研**。除本文、`.gitignore` 一条防御规则与 backlog 一行外，不改动任何现有文件。所有结论附 `文件:行号` 或配置键；不能用代码回答的地方写明「未运行 / 未验证」。

---

## 0. 结论

**作为现有 SocialCoach 的底层架构或"陪伴系统整体重写基座"：不可行。** 三类正面冲突，每一类单独都足够否决：

1. **许可**：MaiBot 是 GPL-3.0，本仓是 Apache-2.0，且项目已有"GPL 代码不进主站"的先例（`wiki/02-system-architecture.md:337`、`wiki/specs/spec-3d-blender-assets.md:11`、`wiki/specs/spec-love-visual-fidelity.md:255`）。把 GPL 运行时做成产品底层，等于把整个分发物（Vercel / ModelScope / 桌面安装包）变成 GPL-3.0。
2. **产品红线**：它没有账号体系、没有服务端存储、不做通用聊天入口、教练 NPC 不讨好、复盘必须引用原话。MaiBot 恰好是"服务端常驻 + 单人格 + 通用聊天 + 讨人喜欢"的形态，与本仓四条硬边界逐条相反。
3. **能力错位**：它的核心价值是"群里什么时候该说话"。我们的三个表面（文字对练 / 3D 饭局 / 恋爱 VN）里**没有一个是群聊**，也**没有一个需要它**。它没有评估链路、没有视觉小说、没有语料与出处纪律，这三样恰好是产品的本体。

**作为"插件跑在 MaiBot 上"：不成立。** 它的 22 个 hook 只包住聊天管线；记忆、学习、人设装配、对话循环、LLM 路由、WebUI 全是核心代码，插件改不了。而我们的核心（rubric 复盘、66 场恋爱剧本、立绘/存档/结局）在它的模型里没有对应物，写不成插件。

**如果真实目标是一条新的"陪伴产品线"：MaiBot 是很好的基座**，比从零写强得多——但必须是独立产品（独立仓库、独立部署、接受 GPL），不能并入本仓。详见 §7。

**真正值得搬的是它的"真人感"机制与记忆形状**，用 TS 在本仓重写，零新运行时。其中 3 项直接可用于恋爱域，2 项用于玩家模式，其余是参考价值。详见 §6。

---

## 1. MaiBot 是什么（事实）

| 维度 | 事实 | 证据 |
|---|---|---|
| 版本 / 许可 | v1.3.14，GPL-3.0 | `pyproject.toml:10`、`LICENSE` |
| 规模 | `src/` 241,965 行 Python；`dashboard/` 222,066 行 TS/TSX；`pytests/` 59,162 行 | `wc -l` |
| 运行时 | Python ≥3.12（Docker 用 3.13）+ uv；FastAPI / uvicorn / SQLModel；runner→worker 双进程 + WebUI 独立线程 | `pyproject.toml`、`src/runtime.py:117-144`、`src/webui/webui_server.py:41` |
| 存储 | **只有 SQLite**（`MaiBot.db`），无 MongoDB / Redis；faiss 可选 | `src/common/database/database.py:28,33`、`src/A_memorix/core/storage/vector_store.py:25` |
| 端口 | WebUI 8001、legacy WS 8000、API server 8090（默认关） | `src/config/official_configs.py:5244,5091,5143,5117` |
| 首启门槛 | EULA + 隐私确认（env 或交互） | `src/runtime.py:576-596` |
| 人格 | **单实例单人格**：一个 `bot.nickname`，一组全局 `personality` / `behavior_style` / `reply_style` | `src/config/official_configs.py:148`（`PersonalityConfig`） |
| WebUI 鉴权 | **单个共享 access_token**（`data/webui.json`），无用户表、无角色 | `src/webui/core/security.py`、`src/webui/core/auth.py` |
| 发布节奏 | 1.3.13（10-21）→ 1.3.14（10-22），日更级 | `changelogs/changelog.md` |

### 1.1 消息管线（入站 → 出站）

```
[NapCat/OneBot | webui WS | API server WS]
   │ msgpack over WebSocket（maim_message 0.6.8，外部包）
   ▼
ChatBot.message_process           src/chat/message_receive/bot.py:719
   ├─ 钩子 / 违禁词 / 注册会话
   └─ HeartFCMessageReceiver → heartflow_manager.get_or_create_heartflow_chat
        ▼ 每个 session_id 一个 runtime（LRU 100 个 / 24h 闲置淘汰）
MaisakaHeartFlowChatting          src/maisaka/runtime.py:126
   ├─ MessageDebouncer             src/chat/debounce/controller.py
   ├─ "该不该说话"调度器            src/maisaka/turn_trigger/
   ├─ Planner + 工具（reply / wait / stop / 子代理）
   └─ Replyer → Item
        ▼
uni_message_sender               src/chat/message_receive/uni_message_sender.py:60
   ├─ platform=="webui" → 广播到浏览器 WS（bot_message）
   └─ 否则 → 推给平台适配器
```

**它已经自带一个 web 平台**（`webui`）与浏览器 WebSocket 聊天协议（`src/webui/routers/websocket/unified.py`）。所以"能不能接浏览器"不是难点——难点在别处。

### 1.2 它在"真人感"上确实强（这是它最有价值的部分）

| 机制 | 参数 | 证据 |
|---|---|---|
| 防抖档位 | `fast` 1/3/1/0.5s、`natural` 2/5/2/0.5s、`steady` 4/7/4/2s；批上限 8s、@ 提及 1s | `src/chat/debounce/controller.py:18-27` |
| 回复概率 | 逻辑回归：截距 −1.2005；被@ 1.5852、@别人 −1.1157、问号 0.4807、近期自己占比 2.6525 | `src/maisaka/turn_trigger/reply_likelihood.py` |
| 空闲退避 | 15s 起，指数退避封顶 300s | `src/maisaka/turn_trigger/idle_backoff.py` |
| 错别字 | 错字率 0.01、同音 0.1、词替换 0.006；50% 概率补一句纠正 | `src/chat/utils/typo_generator.py` |
| 引用（quote）概率 | 按 8 类上下文 0.011–0.209，再乘距离系数 0.5/1.0/1.1/1.5 | `src/maisaka/quote/rules.py` |
| 注意力漂移 | 四档 `subtle/active/scattered/wild`，纯提示词注入 | `src/maisaka/attention_drift.py` |
| 句子切分 | 规则或 LLM，≤8 句 / 512 字符 | `src/chat/utils/llm_sentence_splitter.py` |
| 表达 / 黑话学习 | LLM 抽取 → AI 评审 → 人工审核队列（`Expression.checked`） | `src/learners/` |

### 1.3 记忆

A_Memorix：SQLite（schema v27）+ faiss（SQ8 主索引 / FlatIP 兜底）+ FTS5 BM25 + 关系图谱，双路召回。表包含 `paragraphs` / `entities` / `relations` / `fact_claims` / `fact_evidence` / `person_profile_snapshots` / `image_*`。**需要 embedding 模型**（默认走模型 API，可选本地 sentence-transformers），记忆按 `chat_id` / `person_id` 作用域。

### 1.4 插件系统

- 契约：`_manifest.json`（`manifest_version: 2` 是唯一支持值，字段 `extra="forbid"`）+ `plugin.py` 的 `create_plugin()`。
- 隔离：插件在**独立子进程**里，宿主↔插件走 msgpack RPC（Windows Named Pipe / UDS / TCP）；崩溃重启、熔断（连续 3 次失败 → 60s 起、封顶 300s）、热重载。只有 Python SDK（`maibot-plugin-sdk>=2.16.0`，非 vendored）。
- **22 个 hook**：`chat.receive.before_process/after_process`、`chat.command.before/after_execute`、`maisaka.planner.before_request/after_response`、`maisaka.replyer.before_request/before_model_request/after_response`、`maisaka.reply.before_post_process`、`send_service.after_build_message/before_send/after_send`、`emoji.*`（3）、`expression.*`（4）、`jargon.*`（2）。
- 约 70 个 capability（send / llm / database / chat / message / person / emoji / api / component / knowledge / statistics …）。
- **核心不是插件**：记忆、版本学习、对话循环、人设装配、LLM 任务路由、WebUI 外壳都是核心代码；插件只能加组件、挂 hook、调能力。

### 1.5 它没有的东西

| 缺失 | 证据 |
|---|---|
| 评估 / rubric / 评分链路 | `grep -riE "assess\|教练\|coach\|rubric\|proficiency" src` 只命中检索打分与内部闸门，无用户评估 |
| 视觉小说 / 立绘 / 场景 / 存档分支 | `grep -riE "visual.novel\|立绘\|galgame\|存档\|scenario" src` 零命中 |
| 多租户 / 终端用户账号 | 单 token WebUI；`bot_accounts` 是"同一个 bot 的多个平台账号"，不是多个用户 |
| 内容审核 / 限流（聊天链路） | 只有 WebUI 限流；无 NSFW / 敏感词层（记忆过滤器是召回作用域，不是审核） |

---

## 2. SocialCoach 是什么（对照）

| 维度 | 事实 | 证据 |
|---|---|---|
| 运行时 | Next.js 16 App Router；Vercel + ModelScope Node standalone + Tauri 桌面壳（node.exe sidecar） | `wiki/02-system-architecture.md:9-23,406-416` |
| 存储 | **无数据库、无账号**；练习档案 localStorage，可导出 / 擦除 | `wiki/02-system-architecture.md:17` |
| 表面 | 文字对练（有限段落）、3D 饭局、恋爱 VN（66 场 + Rio 线）、Love Studio（AnimaVN fork） | `wiki/00-product-proposal.md:57-69`、`wiki/14-stage-f.md` |
| 教练红线 | NPC 不讨好、必须引用原话、可失败、可续聊 | `wiki/00-product-proposal.md:34-35`、根 `AGENTS.md` |
| 语料纪律 | 34 技能 / 42 理论 / 30 案例 / 66 恋爱场景，每条必须带 `source` | `wiki/00-product-proposal.md:38` |
| 模型 | `jsonCall()` / `extractJSON()`；fast / smart；共享预算 + BYOK | `wiki/02-system-architecture.md:16,229-253` |
| 代码规模 | `app/src` 51,287 行 TS/TSX；Studio 后端 40,707 行 Python、前端 74,882 行 TS/TSX | `wc -l` |

**关键的形态差异：MaiBot 是一个"常驻在群里的人"，我们的产品是一"次"练习（有时间边界、有段落、有判决）。** 两者的时间结构不同：一个是永远的在线状态，一个是有限回合。

---

## 3. 五种架构定位，逐条判

### A｜整体重写：MaiBot 作底层 ❌

需要重建的东西：rubric 评估与引文校验、34 技能语料与检索、能力估计、文字/3D/恋爱三个表面、66 场剧本与结局账本、立绘/场景/语音、设备端存档与导出擦除、无账号形态——**MaiBot 一个都不提供**。这不是"把 5 万行 TS 换成 Python"，是在一个没有这些概念的运行时上从零重建产品本体。

同时必须破掉：无账号/无服务端存储（`00-product-proposal.md:36`）、不做通用聊天入口（`:37`）、教练 NPC 不讨好（`:34`）、GPL 边界（§0.1）。**四条产品定义级的红线，不是技术债。**

### B｜我们作为插件跑在 MaiBot 上 ❌

三个具体阻断点：

1. **能力不在 hook 里。** 22 个 hook 覆盖的是"消息进来 → LLM → 消息出去"。复盘是"对话结束后对整段转录做判决"，没有对应 hook；只能塞进 `TOOL` 让 planner 在回合内调用，或塞进 `chat.command`。两者都把评估变成聊天的一部分，与我们的段落边界冲突。
2. **超时。** planner/replyer/send/emoji/expression 类 hook 默认 5–6 秒（`src/maisaka/chat_loop_service.py:233` 等），系统兜底 60 秒（`src/plugin_runtime/host/hook_dispatcher.py:324-334`）。我们的复盘任务 `maxDuration: 180`（`wiki/02-system-architecture.md:232`）。把 3 分钟的判决塞进 6 秒 hook，只能靠调大全局阻塞超时去卡住聊天管线。
3. **人格是全局的。** 所有用户共享一个 `bot.nickname` 与一组全局 `personality`。我们的每个用户有自己的角色、立绘、关系账本；这不是配置项，要改核心数据模型。

### C｜MaiBot 作本地伴生运行时（第三个本地服务） ⚠️

技术上唯一成立的形态：MaiBot 作为独立进程，我们通过它的 `webui` 平台 / WebSocket 驱动，像 Love Studio 一样挂在 `/love` 下面。但：

- 安装摩擦远高于 Studio：Python 3.13 + uv + Playwright(Chromium) + faiss + 首次 EULA，而 Studio 已经是"一条命令"的本地伴生。
- **单人格**：一个本地实例只能演一个角色。Studio 支持任意多张 Tavern 卡与立绘包，MaiBot 不支持。
- **没有 VN 能力**：无立绘、无场景、无存档分支、无结局。它做不了 Studio 的活。
- 许可：以独立进程 + HTTP/WS 通信的"聚合"形态，GPL 传染的强度弱于链接，但这是法律判断，不能在代码评审里拍板；**无论哪种判断，代码都不能拷进 `app/`**，只能当外部服务。
- 收益：只剩"聊天更像人"这一条，而我们的恋爱域已经有立绘、语音、场景与关系状态——**它补的不是缺口，是另一种产品**。

### D｜只搬机制（推荐）✅

不引入运行时、不引入许可问题、不加部署面。见 §6，用 TS 在本仓重写，落点明确。

### E｜另立陪伴产品线（如果这才是真实目标）

如果用户要的是"一个会记得你、会主动找你的 AI 伴侣"（而不是给现有产品加陪伴感），**MaiBot 比从零写更合适**：它的记忆图谱、表达学习、发言时机、错别字/引用概率、插件沙箱都是现成的，且工程质量高于绝大多数同类。但必须独立：独立仓库、独立部署、接受 GPL-3.0、重做多租户（账号、每用户人格、隔离存储、审核），并与 SocialCoach 的主句/品牌/承诺切开。这与 `review-2026-10-13-engine-convergence.md` 对 AIcove 的结论同构：**两条产品线不合并，能力可以借。**

---

## 4. 不可行的具体差异点（汇总）

| # | 维度 | MaiBot | SocialCoach | 判定 |
|---|---|---|---|---|
| 1 | 许可 | GPL-3.0 | Apache-2.0，且已有 GPL 不进仓先例 | **硬阻断** |
| 2 | 运行时 | Python 长驻进程 + 子进程 RPC + SQLite | Vercel serverless + Node standalone + Tauri sidecar | **硬阻断**（部署面全换） |
| 3 | 存储位置 | 服务端 SQLite | 设备端 localStorage | **硬阻断**（产品红线） |
| 4 | 多用户 | 单实例单人格 + 单管理员 token | 每用户独立设备档案、无账号 | **硬阻断**（要改核心） |
| 5 | 表面 | 群聊 / 私聊 | 文字段落 / 3D / VN | **硬阻断**（无对应物） |
| 6 | 评估 | 无 | rubric + 引文校验 + 能力估计 | **能力缺口** |
| 7 | 语料 | 无 | 130+ 条带 `source` | **能力缺口** |
| 8 | 插件边界 | 记忆/循环/人设/路由在核心 | 我们的核心不在它 hook 的语义里 | **不可替换** |
| 9 | 稳定性 | 日更级、无正式破坏性变更政策、manifest 只认 v2 | 需要可预测的升级面 | 中等风险 |
| 10 | 模型接入 | OpenAI 兼容 / Gemini，自定义 base_url，任务级路由 | 同样是 OpenAI 兼容 + fast/smart | 一致（唯一强兼容项） |

---

## 5. 哪些"看起来能对上"、其实对不上

| 看起来像 | 实际 |
|---|---|
| "它记忆很强，可以当我们的跨场次记忆" | 我们的记忆是**引文一等对象**（`hasQuote` / `quoteRef` / 原话可删），A_Memorix 是**有损段落 + 图谱**。`fact_claims` / `fact_evidence` 的分层思想可取（§6），但把我们的承诺对象塞进它的段落摘要，正是 `review-2026-10-13-love-companionship.md` §3 判过死刑的 ADR0062 形态。 |
| "它会主动说话，正好做主动关心" | 它的主动是"常驻进程里按概率插话"；我们的主动关心是**零模型调用的台词库 + 每场 1 次 / 24h 1 次 / 夜间静默**（`spec-love-semi-coach.md:84-86`）。它的调度模型与我们"下次打开补演"的通道完全不同（没有后台推送）。 |
| "它有 webui，可以当我们的前端后端" | webui 是**单管理员控制台**（单 token），不是面向终端用户的账号体系。把它当 BFF 就要重写鉴权与隔离。 |
| "它有插件市场，可以生态化" | 插件生态是它的产品；我们不运营第三方插件，也不需要一个 24 万行的宿主来跑自己的功能。 |
| "它没有评估，加个插件就行" | 见 §3B：hook 超时、全局人格、单 token 三道墙；且评估需要整段转录的归属与幂等，不是一次 hook 调用。 |

---

## 6. 真正值得搬的（推荐动作）

只搬机制与形状，不搬代码。按"落点是否真实存在"排序：

| # | 机制 | MaiBot 依据 | 我们的落点 | 价值 |
|---|---|---|---|---|
| 1 | **注意力漂移**：角色偶尔走神/跑题，不每句都紧扣主题 | `src/maisaka/attention_drift.py` 四档 | 恋爱半教练与 Studio 的 NPC 提示词（恋爱域允许不完美） | 高：真人感最直接的一条，且不碰教练线 |
| 2 | **概率引用**：按上下文与距离决定要不要复述对方上一句 | `src/maisaka/quote/rules.py` 0.011–0.209 | `love-carryover` / 关系回顾的"引用上一句"从确定性改为概率性 | 高：我们已有 quote 纪律，缺的是"不是每次都引" |
| 3 | **错别字与即时纠正**：低概率错字 + 一半概率补一句纠正 | `typo_generator.py` 0.01 / 0.1 / 0.006 | **仅玩家模式（Studio / 恋爱）**；教练模式必须关闭——复盘要逐字引用，错字会污染证据 | 中高：成本低，但要严守教练线 |
| 4 | **句子切分预算**：≤8 句 / 512 字符，短句优先 | `llm_sentence_splitter.py` | 语音链路（我们已有 `deviceChunks`），可把"生成时的长度预算"前移 | 中：我们是在 TTS 侧切的，生成侧没有硬预算 |
| 5 | **claim / evidence 分层**：事实与证据行分开，无证据不成立 | `fact_claims` / `fact_evidence` | 已有 `hasQuote` / `quoteRef`；可把"关系信号 → 原话证据"显式成两行，而不是一条带 quote 的记录 | 中：结构更硬，但现状已够用 |
| 6 | **任务级模型路由矩阵** | 12 个 task（replyer/planner/memory/embedding/…） | 我们只有 fast / smart 两档；`mid_memory` / `learner` 这类细分的思路可参考 | 低：当前规模不需要 |
| 7 | **发言时机模型**（逻辑回归闸门） | `reply_likelihood.py` | **没有落点**：我们没有异步聊天表面，VN 回合是显式的 | 参考：如果未来做异步陪伴才用得上 |
| 8 | **防抖档位** | `debounce/controller.py` | **没有落点**：同上，没有连续消息流 | 参考 |

**明确不搬**：GPL 代码、插件宿主、A_memorix 存储层、全局单人格模型、WebUI 外壳、`wait/stop` 的工具循环（与我们的段落状态机重复）。

---

## 7. 如果目标其实是新陪伴产品线

最小可行形态与代价，按"必须先解决"排序：

1. **许可决策**：接受 GPL-3.0（整个分发物）或只把它当独立服务（聚合形态，法律判断需专业意见）。这是第一道门，不是最后一道。
2. **多租户**：账号体系、每用户人格、隔离存储、配额。MaiBot 目前是"一个操作者的一只 bot"，要变成"每个用户一只 bot"，改的是核心数据模型与鉴权，不是插件。
3. **部署与成本**：常驻 Python 进程 + SQLite/faiss + embedding 调用；不能上 Vercel serverless。按用户数算常驻内存与 embedding 成本。
4. **审核**：它没有内容审核层，托管必须自建。
5. **产品边界**：与 SocialCoach 的主句、品牌、教练承诺切开；不共享账号与档案。

**如果只想要"现有产品更有人味"**：走 §6 的第 1–3 项，成本以"天"计，不动运行时、不动许可、不动部署。这是本文的推荐动作。

---

## 8. 未验证 / 边界

- **没有把 MaiBot 跑起来。** 本机有 Python 3.12.10 与 uv 0.12.7，但它还需要 Playwright/Chromium、faiss、embedding 模型与 LLM key；本文所有运行时结论来自源码与配置模板，不是实测。启动成本、内存占用、真实对话质量均未验证。
- **没有跑 Love Studio 与 MaiBot 的对照实测**；Studio 能力结论来自 `wiki/specs/spec-love-studio.md` 与目录。
- **许可结论是工程惯例判断，不是法律意见。** GPL-3.0 与 Apache-2.0 的兼容方向（Apache→GPL 可单向合并）成立，但"服务端运行不分发"等边界需要法务确认。
- **hook 超时的"6 秒"是默认值**，配置可调；本文的论点是"把 3 分钟判决塞进聊天管线不是设计意图"，不是"技术上绝对做不到"。
- **插件 API 稳定性**只能从 `compat_policy.py`、manifest 版本与 changelog 观察，没有正式的破坏性变更承诺可引。

---

## 9. 参考

- `L:\refs\MaiBot`（v1.3.14）— 与 `iki` / `talking-picture` / `drama-skills` 同目录，**仓库外，不入库**。
- [练习引擎 × 陪伴引擎融合调研](./review-2026-10-13-engine-convergence.md) — 同一类问题的前一次结论（引擎级融合不成立，只搬工程细节）。
- [恋爱系统的陪伴化](./review-2026-10-13-love-companionship.md) — (i) 关系型练习 vs (ii) 陪伴产品的二分，以及为什么选了 (i)。
- [AnimaVN 参考](../refs/animavn.md) — Love Studio 的基座，与本问题里的"本地伴生运行时"是同一格。
