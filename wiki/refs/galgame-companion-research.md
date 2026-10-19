# 参考研究：GALGAME、互动影游与 AI 陪伴（2026-10-20）

> 用途：为 [恋爱互动叙事与陪伴层](../specs/spec-love-interactive-story.md) 提供外部依据。本文是设计研究，不是语料；不把作品剧情当事实写进场景。作品链接多为百科/攻略/设计分析，用于定位机制，不作为学术证据。

## 1. 结论摘要

1. **选择的重量来自“后果可见”，不是分支数量。** 428 有大量结局、Late Shift 有大量选择点，但真正被记住的是后续被点名的旧选择；分支很多却没有 callback，玩家只会把它当读档试错。
2. **视觉小说的“底线件”是阅读层，不是 CG。** backlog、auto、skip-read、多槽存读档、文本速度/字号、章节选择、结局图鉴，缺任何一项都会立刻像“网页小说”。BGM/CG 是氛围加成，不是骨架。
3. **AI 生成会破坏传统 skip-read。** 同一幕重开时模型会生成不同句子，按“已读行 id”跳过没有意义；只能跳过**逐字相同**的已见文本或作者写死的拍点。方案必须把这条限制写清楚，不能对玩家承诺“全跳过”。
4. **陪伴感可工程化为四件事：记忆、时间、承诺、角色自己的目标。** 网页没有可靠后台，主动送达只能做成“下次打开时补演”；真推送需要服务端，违反本项目的无账号约束。
5. **AIcove 值得借的是“记忆与节拍”，不是它的移动端运行时。** 两层记忆、来源可追、用户可锁可删、打扰预算，这些能直接改写；后台服务、云账号、原生实时通话不能搬。

## 2. 机制对照表

| 机制 | 代表作品 | 作用 | 对本项目可复用性 |
|---|---|---|---|
| 旗标 / 条件锁 | Steins;Gate 的手机回复；The House in Fata Morgana 的真结局；Persona 社群 | 把选择埋进日常动作，后续按累计条件开门 | 高。现有 `flags` / `routeState` 可直接扩 |
| 关系/态度账本 | The Walking Dead S1；Detroit: Become Human；Persona；Rio 线 | 不改主线，改语气、可选行动与结局 | 高。已有 `stance` / `conflict` / `boundary` |
| 记忆回调 | The Walking Dead 的“Clementine will remember that”；428 蝴蝶效应；Slay the Princess 的容器 | 旧选择在后续被点名，产生连续感 | 高。已有 promise/history，缺检索与引用 |
| 章节 / 路线锁 | 13 Sentinels 的关键词锁线；428 时间表；Detroit / AI: The Somnium Files 流程图 | 用信息门槛控制节奏，让分支可回看 | 中高。可做幕锁 + 幕级回看 |
| 失败与补救 | Ace Attorney 的惩罚；Life is Strange 回溯；428 Bad End 提示 | 错误有代价，但保留回头路 | 中。做“关系代价”而非 game over |
| 角色自有目标 | Slay the Princess；Persona；Fata Morgana | NPC 不围着玩家转，阻力产生重量 | 高。写 goal / red line，防 LLM 讨好 |
| 限时 / 共识选择 | The Walking Dead；Detroit；Late Shift；Erica；As Dusk Falls | 逼出直觉，制造不可逆 | 中低。LLM 延迟下只宜用于高潮，且要可关闭 |
| 多视角 / 碎片 | 428；13 Sentinels；Her Story；Immortality | 玩家知道得比角色多 | 低。当前单说话人契约不适合 |
| 元叙事 / 删档 | Doki Doki Literature Club | 打破第四面墙 | 不做。与设备端存档、信任边界冲突 |

**反例：** 428 的 87 个结局、Late Shift 的 180 个选择点，多数是 Bad End 或微选择；数量不等于重量。The Walking Dead 的“会记得”如果没有真实 callback 兑现，会被玩家识破为提示层。

## 3. 呈现层基线

| 功能 | 判定 | 理由 | 成本（相对本项目） |
|---|---|---|---|
| Backlog / 回想 | 必须 | 漏读回看、引用原话；当前已有冻结快照，只差章节分组 | 低 |
| Auto | 必须 | 配合 TTS / 打字机；没有就像网页小说 | 低 |
| Skip-read | 必须 | 重玩、多结局的刚需；只跳已见文本 | 中（见 §6） |
| 多槽 Save/Load | 标准 | 选择重量需要试错；当前单自动档是最大缺口 | 中高 |
| 文本速度 / 字号 | 必须 | 可读性与无障碍 | 低 |
| 已读标记 | 必须 | skip 的前提；需要稳定内容键 | 低中 |
| Chapter select | 加分 | 线性 4 幕可先不做；多路线后需要幕首快照 | 中 |
| Ending gallery | 加分 | `LovePlayRecord` 已有 `endingId`/outcome，补 UI 即可 | 低中 |
| BGM / SFX | 优先加分 | 氛围提升明显；注意授权与 TTS ducking | 低（有素材时） |
| CG / 语音图鉴 | 暂不做 | 无 CG；语音已有单句重播，不存音频更省 | 高 |
| Rollback | 不做 | LLM 回滚会重写历史，破坏记忆一致性 | 高 |

参考：Ren'Py 的 preferences / save-load 文档把 auto、skip、text speed、save slots 当作标准配置；Naninovel 的 GUI 也把 backlog、save/load、gallery 作为基础面板。本项目已有回想与单句重播，应优先补 auto、skip-read、多槽存档与图鉴。

## 4. 互动影游的可迁移性

互动影游（Late Shift、Erica、As Dusk Falls、Detroit、Immortality、Her Story）给我们的不是“拍视频”，而是四件事：

1. **章节卡与镜头感**：黑场、章节标题、信件/手机特写、景别切换，可以由 CSS/Framer Motion + 现有立绘完成，不需要 FMV。
2. **关键节点的限时选择**：只在高潮使用，倒计时在台词完整显示且 TTS 结束后才开始；设置里可关闭。LLM 延迟下不做全程实时。
3. **选择后的“世界状态”变化**：场景背景、人物站位、可问的问题、下一章开场白随账本变化；这比多拍几段视频便宜。
4. **回看与路线图**：互动影游靠章节回看/流程图降低试错成本；我们可用 `routes[seriesId]` + `records` 做轻量路线图。

**不做的部分：** 真人视频、全动态捕捉、多人投票、实时直播式互动。这些需要视频资产或服务端，且与当前纯前端、设备端、LLM 文本的架构不匹配。

## 5. AIcove 审计（L:\AIcove-main）

审计范围：README、AGENTS、DEVELOPMENT、`docs/项目记忆`、`apps/aicove_flutter/lib/src`。AIcove 是成熟的角色聊天/陪伴应用，但**不是互动小说引擎**：未定位到章节、分支、结局、剧情存档；它的强项是角色对话、世界书、记忆与主动关怀。

### 5.1 能力对照

| 能力 | AIcove 做法 | 代码位置 | 对恋爱模块 |
|---|---|---|---|
| 主动关怀 | 5 分钟无消息或切后台触发分析；模型答 JSON 决定时机；代码换算 3–8 分钟 / 半小时 / 1–2 小时 / 次日；免打扰、日限 3、间隔 120 分钟、连续未回休眠 | `features/auto_reply/data/analyzer_scheduler.dart`、`proactive_decision.dart`、`proactive_planner.dart`、`conversation_proactive_state.dart` | **改写**：借“打扰预算 + 未回休眠”，不借后台自动发送 |
| 长期记忆 | 每角色 SQLite `memory_items`；core 约 2k tokens 全带，archive 用 FTS5 检索 ≤6 条；压缩后记忆 Agent 输出 add/update/delete，带 `source_ids`；用户编辑自动 `locked`；原文是唯一真相 | `features/memory/domain/memory_item.dart`、`application/memory_retrieval.dart`、`data/sqlite_memory_store.dart`、`application/memory_keeper_service.dart` | **改写**：借两层 + 来源 + 锁 + 可编辑；owner 改为 story/route，避免跨线串记忆 |
| 上下文压缩 | 手动“翻篇”可预览/编辑；80% 自动触发，保留 16%；摘要带 `sourceDigest`，原文改动即失效 | `features/context/domain/context_window_policy.dart`、`application/context_manager.dart` | **直接借鉴**：按章翻篇，摘要即“回忆录”，原文可回看 |
| 多模态消息 | `MessageBlock` 分 text/image/audio/emoji/tool/call；TTS/表情按标签拆条；时间插件注入当前时间/上次消息时间 | `core/models/message_block.dart`、`features/plugins/time_awareness/time_awareness_plugin.dart` | **改写**：借有序块与时间戳；不借自动 TTS/表情匹配 |
| 语音通话 | 流式 ASR→LLM→切句→流式 TTS；默认半双工；通话记录存 `CallRecordBlock` | `features/voice_call/application/voice_call_session.dart` | **不要搬**：依赖原生 AEC、本地 ASR、后台音频 |
| 角色卡 / 世界书 | V1/V2/V3 PNG/JSON；字段 name/description/personality/scenario/first_mes/alternate_greetings/character_book/regex；关键词触发世界书；多角色=多会话，无群聊 | `features/agent_context/domain/silly_tavern_character_card.dart`、`silly_tavern_world_book.dart` | **直接借鉴**：卡格式、开场白、世界书适合内容生产；章节/存档/结局需自建 |
| 关系 / 好感 | 无产品级好感数值/阶段/UI；MVU 可选变量按消息快照；无“不讨好”规则 | `features/conversation_state/domain/mvu_engine.dart`、`docs/项目记忆/MVU变量与表格记忆兼容方案.md` | **不要搬**：恋爱关系应自建边界与拒绝，AIcove 无可借 |
| 存储 / 同步 | 本地 SQLite + SharedPreferences；可选账号云同步（服务端持钥加密）；API Key 落本地 | `core/database/database.dart`、`features/sync/data/cloud_sync_engine.dart` | **不要搬**：与无账号/设备端冲突 |
| 工具 / 插件 | 插件注册 tools；角色级开关；`create_reminder` 等；QuickJS 沙盒 | `features/agent_plugins/aicove_plugin.dart`、`features/plugins/trigger/trigger_plugin.dart` | **改写**：仅保留少量剧情/状态工具，不做插件市场 |
| UI | 聊天气泡/文档切换/选项气泡/语音条/通话气泡；900px 主从 | `ui/features/chat/pages/chat_page.dart` | **改写**：视觉小说要舞台/立绘/章节，不照搬聊天列表 |

### 5.2 最值得借的三件事

1. **“原文为真相”的两层记忆**：core + archive、FTS 检索、`source_ids`、用户锁定/编辑、从原文重建。它让长线恋爱能“记得”而不篡改历史。
2. **主动关怀的打扰预算**：免打扰 22–08、日限 3、间隔 120 分钟、3 次未回休眠；先决定“该不该/何时/深夜可否”，再写话。这套逻辑可跨端，只是送达方式要改成“下次打开时”。
3. **酒馆卡 + 世界书 + 选项回填 + 状态快照**：角色卡字段、关键词触发世界书、选项填回输入框、按消息保存状态，适合恋爱 AVG 的内容生产与分支状态。

### 5.3 最不该搬的三件事

1. **Android 前台服务 / WorkManager / 本地通知**：Web 没有可靠后台；照搬只能上服务端推送，违反无账号约束。
2. **账号云同步 + 服务端持钥 + 本地明文 Key**：与“设备端、BYOK”冲突；密钥卫生也不应复刻。
3. **原生实时通话全链路**：`record` / `mp_audio_stream` / 系统 AEC / 229MB 本地 ASR / 桌面多窗口；Web 做不出同等可靠性，且“角色主动打电话”对恋爱模块是高风险打扰。

### 5.4 README 与代码的差异（引用时注意）

- README 宣称“AI 用工具调用安排下一次关心”；代码里现行是模型答 JSON + 代码建 trigger，未定位到 `schedule_proactive` 工具。
- README 宣称语音通话“随时可以插话打断”；代码默认 `allowBargeIn = false`，文档写明默认半双工、全双工待 AEC 验证。
- 好感数值 / 关系阶段 / 不讨好边界 / 群聊 / 章节存档：未定位。

## 6. 对 AI 生成式 GALGAME 的直接含义

1. **skip-read 只能跳“逐字已见”或作者拍点。** 现有 NPC 行 id 是每局随机 `uid()`，重开会变；要用 `scenarioId + 文本哈希` 或作者拍点 id 做稳定内容键。动态生成的新句子不跳。
2. **多槽存档要先解决“状态快照”而不是复制文本。** 每个手动档必须同时保存 `routeState`、series progress、read 集合；否则读档后第 5 幕的旗标会倒退。
3. **章节选择需要幕首账本。** 当前 `routes[seriesId]` 只存最新账本；要支持回到第 3 幕，需要每幕开始时的账本快照或可从事件重放。
4. **陪伴层的主动消息只能“下次打开补演”。** 不承诺后台推送、不制造“你不回我就生气”的 streak；用离开时长、未兑现承诺、上次原话做开场。
5. **BGM/CG 是资产工程，不是代码工程。** 没有素材前，优先把 auto/skip/存档/图鉴做扎实；有素材时按 manifest + source 管理。

## 7. 来源

**作品资料 / 设计分析：**
- [Steins;Gate](https://en.wikipedia.org/wiki/Steins;Gate)、[100% guide](https://www.kirikiribasara.com/2025/01/09/steinsgate-100-guide/)、[choice analysis](https://www.superjumpmagazine.com/this-is-the-choice-of-steins-gate/)
- [The House in Fata Morgana](https://en.wikipedia.org/wiki/The_House_in_Fata_Morgana)、[endings](https://fatamorgana.miraheze.org/wiki/The_House_in_Fata_Morgana/Endings)
- [428: Shibuya Scramble](https://en.wikipedia.org/wiki/428:_Shibuya_Scramble)、[choice analysis](https://fujoshimademenightcore.wordpress.com/2019/05/13/the-effects-of-choice-in-428-shibuya-scramble/)
- [13 Sentinels: Aegis Rim](https://en.wikipedia.org/wiki/13_Sentinels:_Aegis_Rim)、[guide](https://www.rpgsite.net/feature/12637-13-sentinels-aegis-rim-remembrance-mode-walkthrough-guide)
- [AI: The Somnium Files](https://en.wikipedia.org/wiki/AI:_The_Somnium_Files)、[routes](https://somniumfiles.miraheze.org/wiki/Resolution_Route/AI)
- [Doki Doki Literature Club](https://en.wikipedia.org/wiki/Doki_Doki_Literature_Club)
- [Slay the Princess](https://en.wikipedia.org/wiki/Slay_the_Princess)、[combinatoric narrative](https://tiendil.org/en/posts/slay-the-princess-combinatoric-narrative)
- [Detroit: Become Human](https://en.wikipedia.org/wiki/Detroit:_Become_Human)、[flowchart](https://steamcommunity.com/sharedfiles/filedetails/?id=2162781882)
- [Life is Strange](https://en.wikipedia.org/wiki/Life_Is_Strange)、[choices](https://life-is-strange.fandom.com/wiki/Choices_and_Consequences)
- [The Walking Dead](https://en.wikipedia.org/wiki/The_Walking_Dead_(video_game))、[Clementine will remember](https://amostagreeablepastime.com/2014/03/04/clementine-will-remember-that/)
- [As Dusk Falls](https://en.wikipedia.org/wiki/As_Dusk_Falls)、[interview](https://news.microsoft.com/source/features/work-life/multi-player-votes-and-in-depth-narrative-choices-set-as-dusk-falls-apart-from-other-interactive-games/)
- [Late Shift](https://en.wikipedia.org/wiki/Late_Shift_(video_game))、[Erica](https://en.wikipedia.org/wiki/Erica_(video_game))、[Immortality](https://en.wikipedia.org/wiki/Immortality_(video_game))、[Her Story](https://en.wikipedia.org/wiki/Her_Story_(video_game))
- [Persona 5](https://en.wikipedia.org/wiki/Persona_5)、[confidant guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2877810456)
- [LovePlus](https://en.wikipedia.org/wiki/LovePlus)、[techno-intimacy](https://gamestudies.org/1102/articles/galbraith)

**呈现层：**
- [Ren'Py preferences](https://www.renpy.org/doc/html/preferences.html)、[Ren'Py save/load/rollback](https://www.renpy.org/doc/html/save_load_rollback.html)
- [Naninovel GUI](https://naninovel.com/guide/gui)、[VN Dev GUI](https://vndev.wiki/Graphical_User_Interface)

**记忆工程：**
- [Mem0 companion memory](https://mem0.ai/library/agent-memory/how-to-add-long-term-memory-to-ai-companions)、[arXiv 2409.11192](https://arxiv.org/html/2409.11192v1)

**AIcove（本地代码审计，2026-10-20）：** 路径见 §5；README 与 `docs/项目记忆` 为项目自述，代码差异已在 §5.4 标注。
