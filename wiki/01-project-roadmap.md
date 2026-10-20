<!-- Last verified: 2026-10-20 | Current stage: E -->

# 项目路线图

## 阶段总览

| 阶段 | 主题 | 状态 | 文件 |
|---|---|---|---|
| A | 产品与语料建成 | ✅ Done | [10-stage-a](./10-stage-a.md) |
| B | 定位与对外物料 | 🚧 In Progress | [11-stage-b](./11-stage-b.md) |
| C | 可索引化与 GEO | 🟡 本地实现并验收，线上未发布 | [12-stage-c](./12-stage-c.md) |
| D | 发布与增长 | 📋 Planned | — 尚未开卡 |
| E | 持续练习与可验证成长 | 🚧 In Progress | [13-stage-e](./13-stage-e.md) |

## 阶段性更新

每周六 14:00（北京时间）复盘当前交付、提出三个候选并推荐一个重点。产品更新按可靠练习 → 原话对照 → 关键回合重练 → 单场景精修 → 获客入口推进，以验收结果调整次序。→ [阶段计划](./13-stage-e.md)

## 功能索引

### Stage E — 持续练习与可验证成长

| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| E1 | 最新主线可靠性复核 | ✅ 相关回归通过 | 已修档案 / 密钥 / 额度 / 输出边界复测；真机与用户效果继续跟踪 |
| E2 | 同条件独立重练的原话对照 | ✅ 双站已发布 | 333 项核心 / 3D（含 11 项对照）、主站 9 组与国内公开嵌入页验收；真机 / 用户效果待验 → [规格](./archive/specs/spec-practice-comparison.md)、[验收](./reviews/review-2026-10-12-practice-comparison.md) |
| E3 | 缩短再练的距离：短分支练习 | 📋 Planned | 一个文字单 NPC 场景、一种具体动作；必要前情与独立分支记录。与 E6 相互独立 → [阶段表](./13-stage-e.md) |
| E4 | 一个场景玩得更深 | 📋 Planned | 一个已有 3D 开局，六类回应可玩；真机体验与主动重玩分开验证 → [阶段表](./13-stage-e.md) |
| E5 | 让急需的人找到入口 | 📋 Planned | 一个有反馈支持的主题 + 官网预览 + 对应文字 / 3D / 视频，与 C / D 联动 → [阶段表](./13-stage-e.md) |
| E6 | 在场层：承诺—回访—触达通道 | 📋 方案已完成，未开工 | 2026-10-13 单列，原打算并入 E3 已改出。第一节零新基础设施（承诺对象 + 首页 3 秒回访），第二节通道抽象且 Web Push 只留空实现 → [规格](./specs/spec-presence-layer.md)、[差异研究](./reviews/review-2026-10-13-presence-layer-diff.md) |
| E7 | 恋爱承接：跨幕记忆与承诺回访 | ✅ 本地实现，线上未发布 | P0 love-play 语音（TTS + 麦克风）/ P1 一句开场承接 / P2 结构化承诺对象（只收用户自己打的那句）/ P3 异地 8 场编线并给 `series` 加显式 `order` / P4 台词库回访卡（提问路径零模型调用）。**评审 §10.1 本把 P3/P4 排在 P1 验证之后，本批按「全做完」的指令越过闸门，P1 的停止信号（玩家没感觉到 → 整条方向不成立）仍未销账**；语音项按真机自测清单销账，不得用模拟视口 → [验收依据](./reviews/review-2026-10-13-love-companionship.md)、[落地记录](./reviews/review-2026-10-13-love-companionship.md#11-实施记录2026-10-13)、[待办](./85-backlog.md) |
| E8 | GALGAME 基本盘：存档、回想、外部 TTS 与引擎债 | ✅ 本地实现，线上未发布；浏览器 / 真机待验 | 幕内自动存档/续玩（恢复不请求模型）、冻结快照回想 + 单句重播、64 场景 / 54 人物声线；G01–G05、G07–G16、G20–G23 已收口，G06 只做 Rio，G17–G19/G24 留待下批。**P1 停止信号仍有效**；语音真机项不得用模拟视口销账 → [规格](./specs/spec-love-galgame-foundation.md)、[验收](./reviews/review-2026-10-20-love-galgame-foundation.md) |
| E9 | Rio 六幕 vertical slice 与关系账本 | ✅ 六幕全部落地；**结局未经玩家验证** | `RioRelationshipState`、E1「说清楚」/E2「体面收场」两个事实谓词结局、第 4–6 幕开场变体与状态拍点、routes 提交；两个命名结局以作者拍点链达成并有契约测试，浏览器真实走通「把话说清」（图鉴收录）。**3–5 人试玩闸门已按产品决定豁免（2026-10-20），验收标注未经玩家验证**；玩家说不出哪一幕改变了第 6 幕就停整条方向 → [规格](./specs/spec-love-rio-route.md)、[验收](./reviews/review-2026-10-20-love-galgame-foundation.md) |
| E10 | 恋爱互动叙事与陪伴层（Love Story 2.0） | ✅ P0 已交付（2026-10-20）：64 场景全量进 /love/play、阅读层（auto/skip-read/已读/文本设置）、story slot v2（1 自动 + 3 手动）、章节选择、结局图鉴。P1 已交付：设备端记忆档案（作用域硬隔离、原文唯一真相）、回归开场、承诺扩到 5–6 幕、角色 goal/redLine/secret。P2 已交付：Rio 第 5–6 幕与两个命名结局（闸门豁免、**未经玩家验证**）。P3 已交付：章节卡、景别/站位、拍点动效、限时选择（默认关、超时沉默分支）、BGM/SFX 播放器（manifest 空、静默降级；CG 不做）。引擎债 G17/G18/G06 已修（G06 的 NPC 级结局句表需新语料，留 backlog）。真机/真人不在计划 → [规格](./specs/spec-love-interactive-story.md)、[研究](./refs/galgame-companion-research.md) |

### Stage A — 产品与语料建成

| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| A1 | 三层语料库（理论 / 案例 / 场景，双语，全部带 `source`） | ✅ | 168 / 39 / 142（2026-10-03 再增 12 个原创虚构场景；2026-10-09 人际关系深化批次再增 15 个原创场景 + 理论 33 条情境打标；同日恋爱理论全量提取批次 +109 条——恋爱 126 条 / 通用 42 条，分类隔离；同日恋爱 practical 场景化批次 +37 个恋爱练习场景——恋爱场景 60 个覆盖 8 主题各 6–9 个，检索质量门校验并补 rejection 3 条 + long-distance 2 条理论；2026-10-10 恋爱剧情线扩展 +3（rio 线 1 / eve 线 2，恋爱场景 63 个）+ 通用与职场 practical 分桶批次 +18（`scenarios-wf.ts` 职场 6 / `scenarios-friendship.ts` 友情 12），两批与 C/D 同一条验收线，学习者身份改为全量把关）；`src/data/corpus/` |
| A2 | 多面分类体系（5 CASEL × 34 技能 × 7 情境 / 26 类型） | ✅ | `src/data/taxonomy.ts` |
| A3 | 自适应排程 `/api/schedule`（处方 → 受约束检索 → 适配） | ✅ | 固定放松顺序，核心约束不放松 |
| A4 | 沉浸式角色扮演 `/api/roleplay`（流式、隐藏动机、目标追踪、可续聊段落、可失败） | ✅ | 对外 `@@characterId` / `@@meta`；内部 JSON 校验，至少 12 回合、续段 +8，由用户结束；十二场景条件式后续与双人物格式修复见 [本轮评审](./reviews/review-2026-10-04-text-play.md) → [文字验收](./reviews/review-2026-10-03-text-practice.md) |
| A5 | 证据式复盘 `/api/assess`（引用原话、acquisition/performance 归因、有界增量） | ✅ | 2026-09-21 改为先验证引文再发正文与 `@@final`，新星数评沟通表现 |
| A6 | 知识检索卡片 + 苏格拉底式反思 `/api/reflect` | ✅ | 报告内嵌理论 / 案例 |
| A7 | 对话中提示 `/api/hint` | ✅ | ≤40 词，只点动作不代写 |
| A8 | `/rehearse` 生成真实处境场景 | ✅ | ~15s，输出全量打标场景 |
| A9 | 本地持久化 store + 导出 / 重置 | ✅ | Zustand persist，零注册；排练描述有标签页草稿，重置时同步清理；2026-09-09 头像选择支持本地保存与导出 |
| A10 | 能力雷达 / 熟练度 / 时间线 / 反思日志 | ✅ | `/progress` |
| A11 | 8 个路由页面 + 移动优先 PWA | ✅ | manifest + service worker；2026-09-07 打磨首页、场景目录、排练表单及共享导航 / 弹窗；2026-09-09 重绘人物头像，加入预览、精选与外观微调；2026-10-04 共享视觉、首屏筛选与首页优先级精修 → [验收](./reviews/review-2026-10-04-refined-ui.md)；同日进一步去除重复线条、加入柔和材质与连续交互，163 项检查 → [动效验收](./reviews/review-2026-10-04-material-motion.md) |
| A12 | 中英双语 UI，模型输出跟随用户语言 | ✅ | `src/lib/i18n.ts` |
| A13 | 底牌揭示（对方 `hidden` 的判定与揭示屏，含「第几回合问出来的」） | ✅ | 2026-10-03 核对：语料 41/58 有 `hidden`，其余优雅降级 |
| A14 | 对方立场表盘（`@@meta.stance`，允许下降并标出退让位置） | ✅ | 同批把 `@@meta` 移到回合最前，修掉长期静默失效的目标追踪 |
| A15 | 判决式复盘开场 + 对话地图（按回合画推进 / 没动 / 让了一步） | ✅ | `Report.verdict`；地图数据来自 `session.stanceTrail` |
| A16 | 跨场次模式识别（`/api/pattern`，引文防伪 + 至少两个场次） | ✅ | 产品提案里的 A→B 转化引擎，此前无实现 |
| A17 | 限时应答（可选模式：对方耐心 10 / 15 / 20 秒，三段升级，沉默进转录，连续两次对方离场） | ✅ | 2026-09-09；默认关闭，`role: "event"` 沉默事件不计回合 → [spec](./specs/spec-timed-reply.md) |
| A18 | 通用练习策略：角色匹配、信息边界、收尾证据、表现/结果分离 | ✅ 已部署 | 2026-09-21 双平台上线；真实模型小样本通过，仍需扩大盲测 → [方案](./archive/specs/spec-general-practice-policy.md) |
| A19 | 核心练习路径 UI/UX 精修 | ✅ 已部署 | 2026-09-21 今日 / 目录 / 准备 / 对话 / 复盘统一路径，草稿与目录状态恢复、真实等待、触控与可访问性 → [评审](./archive/reviews/review-2026-09-21-product-ux.md) |
| A20 | 首次进入与重复练习闭环精修 | ✅ 已部署 | 2026-10-02 Vercel / ModelScope 更新；快速排练 / 选场景、按需推荐、待完成复盘续接、知识关联场景、明确重练及触控修复；中英明暗浏览器矩阵 → [评审](./reviews/review-2026-10-01-product-maturity.md) |
| A21 | 练习中断与本地档案恢复 | ✅ 已部署 | 2026-10-02 双平台更新；准备失败禁止开练、完整回复才写记录、刷新 / 暂停恢复、完成回复前锁定、复盘只应用一次、损坏档案保护与恢复页；国内公共浏览器验收待复核 → [发布记录](./specs/spec-modelscope-deployment.md#体验精修与中断恢复更新2026-10-02) |

| A23 | SocialCoach 3D 饭局入口与原型接入 | ✅ 已部署 | 主站 `/3d`、首页 / 导航 / 欢迎入口、共享模型与 BYOK、独立本地存档和导出；人物面部 / 身体连接已发布。2026-10-03 连续剧情修复双平台发布：六开局，默认 12 回合、最多 24，指定对象与完整上下文。紧凑对象选择、短句生成和完整对话历史已双平台发布；三桌九人的脸型 / 发型 / 体型 / 服装区分已双平台发布；人物区分 100 项检查、中英真实模型与手机验证通过。语音随时切回编辑、迟到回调保护与手机输入高度修复已完成，110 项检查通过，见 [语音编辑验收](./reviews/review-2026-10-03-voice-edit.md)。首页首屏大幅预览与欢迎页直接入席已完成，见 [入口验收](./reviews/review-2026-10-03-3d-home-entry.md)；主站本轮沉浸体验新增旁人插话、六份可查看资料、有限动作和浏览器朗读，106 项检查通过，完成 98 次真实回复复测；发布见 [沉浸验收](./reviews/review-2026-10-03-3d-immersion.md)。线上视觉复核受网络限制。见 [人物区分验收](./reviews/review-2026-10-03-3d-cast.md)、[对话区验收](./reviews/review-2026-10-03-3d-conversation-ui.md)、[剧情验收](./reviews/review-2026-10-03-3d-story.md)、[接入说明](./archive/specs/spec-3d-integration.md)、[人物验收](./reviews/review-2026-10-03-3d-anatomy.md)；主站性能优化饭桌绘制次数 614 → 289，126 项检查通过，见 [性能验收](./reviews/review-2026-10-03-3d-performance.md) |
| A22 | 本次练习的多轮复盘 AI 助手 | ✅ 已部署 | 2026-10-02 Vercel / ModelScope 更新；概念解释 / 具体说法 / 连续追问、知识卡片入口、证据和来源验证、本地保存与 BYOK；23 项任务 + 38 项 UI 检查、真实模型三问和线上接口检查 → [评审](./reviews/review-2026-10-02-debrief-assistant.md) |

| A24 | 模型可用性、免费检查与接入恢复 | ✅ 双站已部署 | 元数据检查、运行时错误分类与门控、精简配置、默认 API 失效自动弹出可关闭接入窗（同标签页去重）、计时暂停、保留历史 / 浏览、3D 无静默脚本替代；2026-10-04 补齐强 / 弱两档检查，不因一档未确认而跳过另一档，分别验收对话与复盘失效弹窗 → [方案与验收](./archive/specs/spec-model-availability.md)；2026-10-08 补齐约 8 秒的等待提醒与直接配置入口，双平台已发布 → [验收](../docs/reviews/slow-model-reminder-2026-10-08/README.md) |

| A25 | 3D 电梯口与办公室 | ✅ 主站实现、验证通过 | 两种独立空间 / 六位新人物 / 四开局；电梯内外面板、门防夹、家具导航、白板 / 资料、主站入口、历史与旧档案兼容；117 项检查通过 → [方案](./archive/specs/spec-3d-places.md)、[体验验收](./reviews/review-2026-10-03-3d-places.md) |

| A26 | 3D 与文字共用证据式复盘 | ✅ 主站实现、验证通过 | 原话评价 / 改写 / 知识 / 反思 / 多轮咨询、现场观察补充、主站历史与导出、访客直达、返回续聊 / 同开局重练；154 项 3D + 23 项原助手检查、中英真实模型与手机浏览器 → [方案](./archive/specs/spec-3d-debrief.md)、[验收](./reviews/review-2026-10-03-3d-debrief.md) |

| A27 | Blender 人物与五类空间重建 | ✅ 双站已发布，真机待验 | 15 NPC / 玩家 / 手臂、24 GLB、12 姿态 / 人、统一材质尺度、眼高 / 电梯镜头与群体举杯；161 项检查、格式 0 errors / 0 warnings；真实手机性能待补测；操作入口 / 手机摇杆收敛已实现并验证 → [方案](./specs/spec-3d-blender-assets.md)、[资产验收](./reviews/review-2026-10-03-3d-blender.md)、[操作验收](./reviews/review-2026-10-04-3d-controls.md)；2026-10-05 五空间明亮室内 / 时段窗景 / 局部浅色字幕已实现与验证，2026-10-06 双站发布 → [光照验收](./reviews/review-2026-10-05-3d-lighting.md)；同日近景材质 / 摆盘 / 植物与陈设细化已发布，24 GLB 格式无错误或警告 → [细化验收](./reviews/review-2026-10-05-3d-craft.md)；构图 / 近物比例 / 餐具接触继续精修，227 项检查，本地正式构建通过 → [构图验收](./reviews/review-2026-10-05-3d-framing.md) |

| A28 | 饭桌文化首局与重玩流程 | 📋 产品方案已完成，待实现 / 试玩 | 《鱼头该对着谁？》单桌转盘 / 身份线索 / 可补救后果 / 接续敬酒与自由对话；验证主动重玩后再扩地域、倒酒和角色 → [方案](./specs/spec-3d-table-culture.md) |

| A29 | 可玩剧情的共同调性与十开局精修 | ✅ 核心实现 / 模型回放，网页待补验 | 十开局的条件式转折、内部剧情记忆、事实 / 承诺边界；文字与排练共用标准。172 项 3D 检查及 217 条接受模型回复；点击 / 连续网页验收因浏览器连接异常未通过 → [评审](./reviews/review-2026-10-04-scene-craft.md)、[方案](./specs/spec-scene-craft.md) |

| A30 | 用户反馈全链路修订 | 🚧 当前实现已发布，验收中 | 公共简报/自然暂停/当前意图与原目标/独立证据核对、分项与本地附件、分享卡/头像裁切/宽历史分栏；215 项行为测试与生产构建通过；核心网页、三条 3D 复盘/英文文字路线完成回放与人工阅读，真实设备/更多盲测待补。2026-10-06 当前已验证实现双站发布 → [方案](./specs/spec-feedback-refinement.md)、[当前核验](./reviews/review-2026-10-04-user-feedback.md) |

| A31 | 手机倾斜视角与视线选人 | 🚧 双站已发布，真机待验 | 当前握姿校准 / 权限与横竖屏 / 两视角 / 稳定停留选人 / 手工优先 / 草稿与收音锁定；222 项检查、正式构建、受控方向与实际模型对象回应已验证；模拟 / 手机视口不代替真机，2026-10-06 双站发布 → [方案](./specs/spec-3d-tilt-look.md)、[验收](./reviews/review-2026-10-05-3d-tilt.md) |
| A32 | 成人动画 3D 美术 | 🚧 当前样段已发布，人物品质待升级 | 16 人 / 两份手臂 / 五空间、实体发眉 / 曲面眼球 / 六面部控制与一致材质；228 项检查，格式 / 眼睑 / 32 组站坐接触检查通过，真实手机与用户盲测待补；用户指出与 A 差距大，职场构图 / 背景 / 暖光修订已于 2026-10-06 双站发布（231 项检查） → [方案](./specs/spec-3d-animation-style.md)、[首轮技术验收](./reviews/review-2026-10-05-3d-animation.md)、[对照样段](./reviews/review-2026-10-05-3d-reference.md) |

| A33 | 全仓质量与数据契约修订 | ✅ 双站已发布，真机待验 | 证据身份、运行时契约、档案写入/恢复/窗口权限、能力估计、排程诊断、双语检索、3D 内容快照、调用预算/取消与 CI；免费预算已配置、真实 REST / 两条线上对练通过；供应商金额上限与模型/设备盲测待补 → [发布记录](../docs/reviews/product-sync-2026-10-06/README.md)、[修订复核](./reviews/review-2026-10-06-repo-quality.md) |
| A34 | NPC 口吻与连续反应精修 | ✅ 双平台已发布，扩样待验 | 文字 / 3D 共用表演方向、15 位人物口吻快照、最近反应、场景指令收敛、有限听者点头、复读 / 时间 / 称谓 / 语言边界；程序与真实合成回放见 [方案](./specs/spec-npc-craft.md)、[评审](./reviews/review-2026-10-06-npc-craft.md)；PR #11 合并及 P2 复播误判修订、249 项 3D 检查见 [合并发布记录](../docs/reviews/npc-merge-2026-10-06/README.md) |

| A35 | 视频观摩与同场景练习 | ✅ 双平台已发布，真机待验 | 用户提供的职场饭局与 HR 电梯两条动画；原生播放 / 双语字幕 / 时间戳拆解 / 统一检索与收藏 / 游客入口 / 3D 确认；8 种浏览器组合和真实播放、重试与跳转已验证；2026-10-08 发布与国内公开播放复核 → [发布记录](../docs/reviews/video-release-2026-10-08/README.md)； [方案](./specs/spec-video-learning.md)、[验收](../docs/reviews/video-learning-2026-10-07/README.md) |
| A36 | NPC 自然语音与等待上限 | ✅ 双平台已发布，真机待验 | MiMo PCM 实时播放；3.5 秒首样本截止 / 一分钟降级冷却；文字先显示、开麦 / 发言 / 切页取消、设备选择与个人模型零共享请求；真实网页约 3.26 秒调度首声、国内首段音频约 2.08 秒，314 项检查 → [方案](./archive/specs/spec-natural-npc-speech.md)、[实测与发布](../docs/reviews/mimo-speech-2026-10-08/README.md) |
| A37 | 恋爱 Galgame 游戏模式 | ✅ 实现 / 254 项检查全绿，立绘 200 张通过 | 可选游戏模式（不替代教练主链）：`/api/love-play` AI 剧情引擎（非流式 JSON，复用 roleplay 契约与守卫）、`/love/play/[scenarioId]` 界面（背景 / 立绘 / 打字台词 / 选项 / 自由输入）、`completeLovePlay` 统计写入（不伪造能力评估）、千问 IMAGE 2.1 原生透明底立绘管线（50 角色 × 4 表情，2026-10-10 噪点修复后全量重出并通过内容级体检）、series 剧情线 4 条 + 设备端进度（2026-10-10：聚合物只收 `context: romantic`，职场/家庭线不再混进恋爱主页；新增「暧昧到说清楚」rio ×3 与「被拒之后」eve ×3 两条同一人物贯穿的线，`/love` 改为按线列出全部剧情线；线分两种口径展示——`LoveSeries.continuous` 由「每场 NPC 阵容是否一致」算出，贯穿线用「剧情线 / 第 N 幕 / →」，换人的旧线（初见与心动、信任与边界）改用「主题合集 / 第 N 场 / ·」，不再让人误以为也是连续剧情）；P3 打字机 / 揭示动画 / 好感度条。剩余人工项：立绘在场景渐变上的合成效果人眼复核 → [spec-love-visual-novel](./specs/spec-love-visual-novel.md) |

### Stage B — 定位与对外物料



| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| B1 | 核心定位陈述（敌人是「建议」；知道≠做到；A/B 客户分层） | ✅ | → [00-product-proposal](./00-product-proposal.md#产品定位) |
| B2 | 主句定稿并三处对齐 | ✅ | README / `layout.tsx` / `manifest.webmanifest` |
| B3 | README 按开源产品惯例重排 | ✅ | 2026-10-05 中英以“开始一场练习”为首个体验章节，接 3D / 场景 / 核心功能，SEL 学习依据后置；本地运行单独命名，3D 截图中英更新，News 保留四个发布节点，新增 2026-10-08 社交知识视频上线。维护规则见 [README 结构](./11-stage-b.md#b3-readme-结构)。2026-09-21 基础精修 → [评审](./reviews/review-2026-09-21-readme.md) |
| B4 | 品牌 banner（明暗双版 SVG，色值由 `globals.css` OKLCH 精确换算） | ✅ | `docs/banner.svg` / `banner-dark.svg` |
| B5 | 产品截图（首页 / 场景目录 / 对话中 / 复盘 / 今日推荐） | ✅ | `site/scripts/screenshots.mts`（文案取自 i18n，防漂移）对线上正式版自动拍摄，中英各五张，存 `docs/screenshots/` 与 `site/assets/`；官网四步流程各配对应截图 |
| B6 | LICENSE 文件与 README 章节 | ✅ | 2026-09-09 用户选定 Apache-2.0；根目录加入官方 LICENSE 全文，README 增加许可及第三方材料说明 |
| B7 | Live 站点地址替换 README 占位符 | ✅ | 2026-09-21 README 入口统一为 `https://socialcoach.aurax.live`，已验证跳转至当前 Vercel 站点；保留 ModelScope 备用入口 |
| B8 | wiki 文档体系 | 🚧 | 本次建立 |
| B9 | 官网（`site/`：双语静态站，首页首屏与末节指向论文） | ✅ | 2026-10-09 更新真实 3D 实景、视频示范、场景目录与复盘入口，色板跟随应用，并检查资源 / 锚点 / 双语切换；2026-09-08 上线 `https://tianfuwang.tech/SocialCoach/`（GitHub Pages，Actions 来源，账号自定义域）；含 JSON-LD / hreflang / sitemap / `llms.txt` / OG 图 / 真实截图；2026-10-06 地图补充论文 PDF、研究区补充双语材料入口，并加入 PR 构建与地图检查；2026-09-23 补充 SEL 说明及五个双语场景练习预览 → [11-stage-b](./11-stage-b.md#b9-官网) |
| B10 | ModelScope 公开体验入口 | ✅ | 2026-09-09 `GeminiLight/SocialCoach`；免费 CPU Docker 创空间，Apache-2.0；页面与线上对话 / 复盘流式验证通过 → [部署记录](./specs/spec-modelscope-deployment.md) |

| B11 | 用户反馈 → 飞书 | ✅ | 双部署真实提交通过；2026-09-17 本人 Base 可管理权限已添加并读回确认 → [反馈方案](./archive/specs/spec-user-feedback.md) |
| B12 | 匿名使用统计 → 飞书（四个事件、按月建表、留存脚本） | ✅ | 2026-09-10 Vercel 生产上线并跑通一局无错误；ModelScope 通过 OpenAPI 加变量并重建，`/api/track` 已可用 → [spec-analytics](./specs/spec-analytics.md) |
| B13 | 品牌教练 IP 与关键触点 | ✅ 已部署 | 2026-10-05 Vercel / ModelScope 同步；用户提供的小猫形象：欢迎页完整展示、首页教练问候、复盘助手肖像；统一透明素材、克制展示、双语 / 双主题 / 短屏 / 减少动效与访客入口；141 项浏览器检查 → [接入评审](./reviews/review-2026-10-04-coach-identity.md) |

### Stage C — 可索引化与 GEO

| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| C1 | 语料落地页 SSG（`corpus` 349 条 × 双语 = 698 页，独立 `generateMetadata`） | ✅ 本地实现，线上未发布 | 条数按 `corpus/index.ts` 实测（142 场景 / 168 理论 / 39 案例 = 207 library 页/语言）。2026-10-12 正式构建路由表核对：`/scenarios/[slug]` 与 `/en/scenarios/[slug]` 各 142 SSG、`/library/[slug]` 与 `/en/library/[slug]` 各 207 SSG，合计 698。剧透五项（`hidden` / `success` / `failure` / `simulationFacts` / `simulationDirection`）硬性不渲染（2026-10-13 更正：原写「四项」漏了 `simulationDirection`，而 `check-landing-ssr.ts:119` 实际遍历五个字段）。**同日复核发现原验收不合格**：`AppProviders` 的 hydration 闸门让 698 份产物都是空壳（去 `<script>` 后只剩 9 字），已改为公版语料路由直接渲染 `children`，并新增 `app/scripts/check-landing-ssr.ts` 接进 CI 构建之后——逐页断言正文可达与 1034 条剧透串零泄露。见 [坑记录](./80-known-pitfalls.md#hydration-闸门把-ssg-的正文吃掉了) |
| C2 | `app/` 的 `sitemap.ts` / `robots.ts` / `metadataBase` | ✅ 本地实现，线上未发布 | 地基见 2026-10-10 记录（`NEXT_PUBLIC_SITE_URL` 默认 Vercel 直连域名）。现 sitemap 703 条（5 入口 + 349×2），`robots.txt` / `sitemap.xml` 在构建里是静态预渲染 ○ |
| C3 | `app/` 的动态 OG 图（`opengraph-image.tsx`） | ✅ 本地实现，线上未发布 | `/og/[kind]/[slug]/route.tsx`（next/og，nodejs），1200×630 实测约 49KB，未知 slug 404；中文走 Noto Sans SC 按需子集，色板由 `globals.css` OKLCH 换算 hex；a720bd1 从 `force-dynamic` 改 ISR `revalidate 86400`（构建表显示 ƒ） |
| C4 | `app/` 的 JSON-LD：`SoftwareApplication` + `ScholarlyArticle` | ✅ 本地实现，线上未发布 | 首页 `SiteJsonLd` 两类并挂；每张语料页内嵌自身 JSON-LD，`citation` 指向该条 theory 的 `source` |
| C5 | `app/` 的 `llms.txt` 与可直接读取的语料结构 | ✅ 本地实现，线上未发布 | `app/public/llms.txt` 约 53KB（定位 / 论文 / 边界 / 全部语料 URL），由 `app/scripts/gen-llms-txt.ts` 生成，语料变动后需重跑 |
| C6 | `app/` 的 hreflang（zh / en） | ✅ 本地实现，线上未发布 | 中文在根 + `/en/` 前缀（与官网同构）；每页 `metadata.alternates` 与 sitemap `alternates.languages` 互指，x-default 指中文 |

## 里程碑

| 日期 | 里程碑 | 状态 |
|---|---|---|
| 2026-09-03 | Stage A 全量交付（首个 commit `bae956f`） | ✅ |
| 2026-09-03 | 定位定稿 + 主句三处对齐 + README 重排 + banner | ✅ |
| 2026-09-03 | wiki 体系建立 | 🚧 |
| — | 线上可访问 + LICENSE + 截图（Stage B 收口） | 📋 |
| 2026-10-12 | Stage C 工程收口：C1–C6 本地实现，正式构建 698 页 SSG 与运行时验收通过 | ✅ |
| — | 698 个落地页真正被搜索与 LLM 爬虫读到（Stage C 线上收口） | 🟡 未发布，见下方边界 |

**Stage C 的发布边界（2026-10-12 实测）**：本地 main 已含全部 C1–C6，但线上直连域名 `https://socialcoach-ai.vercel.app` 对 `/robots.txt`、`/sitemap.xml`、`/scenarios/refuse-overtime` 三个请求都返回 404（首页仍 200，是旧构建）——`socialcoach.aurax.live` 会丢掉子路径，不能用来验深链。也就是说**工程 ✅ 不等于爬虫可读**，上面那行里程碑保持 🟡 直到线上核对通过。本线只同步到自己的二开分支 `origin`（`zuiyi233/SocialCoach`，2026-10-12 已推 `c2e9722`），不向 `upstream`（`GeminiLight/SocialCoach`）开 PR；Vercel 与 ModelScope 从 upstream 主线发布，所以下一步的线上验收要等那次合并之后再做。同一口径已写进 [AGENTS.md](../AGENTS.md) 的「仓库与发布线」。

2026-10-08 全仓复核与修订：中央共享日政策 1 亿、跨窗口记录/密钥、备份故障隔离、能力窗口、模拟公开投影、接入与双语、依赖/PWA；PR #13 / #14 已合并、两站已发布，293 个程序检查通过，真实回放及保留边界见 [修订记录](./reviews/review-2026-10-08-repo-refinement.md)。
