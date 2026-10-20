# Love Studio：Galgame 生成系统（spec）

> 状态：**方案，未开工**（2026-10-21 立项）
> 范围：独立于主站的 Galgame 子系统。用户生成文本、人物、立绘、场景、语音；先玩一局，再把关系带回半教练。
> 关联：[恋爱半教练](./spec-love-semi-coach.md) · [剧本模式美术升级](./spec-love-scripted-art.md) · [AnimaVN 参考](../refs/animavn.md) · [AGENTS.md](../../AGENTS.md)

## 0. 结论一句话

**Love Studio 是恋爱子系统里的生成式 Galgame 沙盒，不是主站教练模式的延伸，也不是通用聊天。** 它以 AnimaVN 为基座，保留 Python + SQLite 的独立运行时；v1 本地伴生，v2 才考虑托管多用户。内置 66 场的剧本模式继续留在 Next.js。

## 1. 定位与用户旅程

| 入口 | 系统 | 用户得到什么 | 不做什么 |
|---|---|---|---|
| `/love` 的「先玩一局」 | **Love Studio** | 导入/生成角色，生成剧情、立绘、场景、CG、语音；存档/分支/回看 | 不做教学评分、不写能力分、不强制复盘 |
| `/love` 的「继续关系」 | **恋爱半教练** | 关系状态、主动关心、可选关系回顾 | 不做可刷好感、不做强制阻力 |
| `/practice`、`/3d` | **主教练** | 阻力、证据式复盘、能力成长 | 不因恋爱方向放松 |

**目标旅程**：用户在 Studio 里完成初始实践 → 得到角色/故事包与关系回顾 → 「把这段关系带回半教练」→ 在剧本模式里继续这段关系。**没有这座桥，两个系统就是两个产品。**

## 2. 为什么用 AnimaVN 当基座

AnimaVN 是 MIT 的本地 AI 视觉小说应用：React 19 + Vite 前端，Python FastAPI + SQLAlchemy + SQLite 后端；约 7.2 万行 TS/TSX、1.9 万行 Python；130 个前端文件经 `lib/api` 走后端。它的能力正好覆盖「用户可额外生成」：

- **人物**：Tavern 卡 PNG/JSON（V1/V2/V3）、多个开场白、人设、角色世界书。完整工作台与共享 Persona schema 见 [spec-love-persona.md](./spec-love-persona.md)。
- **世界与风格**：卡内世界书、Chat Completion 预设、宏、聊天记录导入。
- **剧情**：LLM 实时写、流式、思考内容、OpenAI 兼容 / Anthropic / 本地模型。
- **立绘**：表情标签、批量上传、按脸对齐、切换特效。
- **场景**：背景 + BGM 场景包、CG 差分。
- **生图**：NovelAI，两段式提示词（不变的长相/画风 + 这一刻的动作），角色参考。
- **语音**：GPT-SoVITS / IndexTTS，逐句情绪参考音频，日配 + 中字，缓存。
- **运行**：逐句演出、随时插话、存档/分支、历史重播、auto/skip、设置。
- **数据**：本地 SQLite + 文件，导出/备份。

**不接的部分**：不把它的运行时塞进 Next.js；不把 SQLite 当主站存储；不把调试台暴露给普通玩家；不使用自带 DeepSeek娘立绘（CC BY-NC-SA，不在授权范围）。

## 3. 架构与部署

### 3.1 两个运行时

```
主站 Next.js（Vercel / ModelScope）
├─ /love               剧本模式 / 半教练入口
├─ /love/play/*        内置 66 场 + 自定义剧本
└─ /love/studio        入口卡片 / 本地 Studio 检测 / 安装说明
        │
        │ persona / story pack（显式交接，不共享服务端存储）
        ▼
Love Studio（独立服务，AnimaVN fork）
├─ React + Vite 前端
├─ FastAPI + SQLite 后端
├─ 本地 GPT-SoVITS / IndexTTS（可选，需 GPU）
└─ NovelAI / 本地生图（可选，BYOK）
```

### 3.2 部署方案

| 方案 | 形态 | 数据 | 适合 | 代价 |
|---|---|---|---|---|
| **A. 本地伴生（v1 推荐）** | 用户安装/运行 Studio，主站链接 `http://127.0.0.1:5180` | 本地 SQLite + 文件；用户自己备份 | 想生成角色/场景/语音的创作者；有 GPU 的用户 | 安装摩擦；非纯 Web |
| **B. 托管独立服务（v2）** | Docker 部署在 VPS / 容器平台 | 每用户隔离的数据库与对象存储 | 站内直接生成 | 账号、服务端存储、GPU TTS、生图代理、审核与运维，约 2–4 周 |
| **C. 端口进 Next** | 把 AnimaVN 重写成 Next + 设备存储 | 设备端 | 不推荐 | 9 万行 + 34 表；TTS/生图/情绪模型全部重做，周期以月计 |

**v1 选 A**：它保留 AnimaVN 的完整能力，不把主站变成多租户 Python 服务，也不破坏「主站无账号/无服务端存储」。v2 是单独的产品决策，不是 v1 的技术债。

### 3.3 主站与 Studio 的桥

- **Persona**：Studio 做完整 Tavern 卡/世界书导入；主站导出 `socialcoach.love-persona.v1` / `.scpersona`（name / lang / bio / goals），Studio 导入为 persona；主站恋爱系统反向只吃 `.scpersona` + 基础 JSON（2026-10-21 拍板）。不传密钥、不传练习记录。
- **故事包**：Studio 导出 `socialcoach.love-story.v1`（summary / characterPackId / keyChoices / ending / 可选图片），主站导入为「生成故事」记录，并可生成一条自定义恋爱场景。完整的权威矩阵、分支与冲突见 [spec-love-bridge.md](./spec-love-bridge.md)。
- **关系状态**：Studio 只读、默认折叠展示；没有提升关系状态的操作、任务或提示。叙事阶段 / 关系图鉴 / 故事收藏由主站 `LoveArchive` 展示，Studio 不维护第二份成长数值。
- **角色包**：Studio 导出 `socialcoach.love-character.v1`（Tavern 卡 + 立绘/场景 manifest）；主站后续可把它用于自定义剧本（另立 spec），v1 只做入口与展示。
- **回链**：Studio 结束页给「把这段关系带回半教练」，带故事包返回 `/love`。
- **不做**：不做双向实时同步；不做自动写 `loveProficiency` / 关系状态；用户确认后才初始化。

## 4. Galgame 内容契约

- **恋爱优先**：角色可以亲近、主动、讨好；不要求阻力、不需要每场有拒绝；冲突只服务戏剧，不服务教学。
- **不做教学评分**：不显示能力雷达、不写 `assess`、不强制复盘；可以有可选的「关系回顾」，但由用户主动打开。
- **内容分级**：默认 SFW；成人内容只在本地版、年龄门控、默认关闭；未成年人、真人肖像、非自愿内容是硬限制。
- **UGC 授权**：用户对导入的卡/图/音负责；manifest 记录 `source` / `license`；不随仓库分发第三方素材。
- **不冒充主站**：Studio 的品牌是「SocialCoach · Love Studio」，但不继承主教练的定位与承诺；入口文案明确「生成式故事，不是教练评分」。

## 5. P0–P3

### P0（2–3 天）：规则与基座跑通

**交付**
- 本 spec、[半教练 spec](./spec-love-semi-coach.md)、[美术 spec](./spec-love-scripted-art.md)、[AnimaVN 参考](../refs/animavn.md)、AGENTS 适用范围修订。
- Fork AnimaVN 到 `love-studio/`（或独立仓库），保留 `LICENSE` / NOTICE，品牌改为「SocialCoach · Love Studio」。
- 默认隐藏调试台；保留创作者模式开关。
- 模型连接：OpenAI 兼容网关 / Anthropic / BYOK；默认便宜快档；流式；模型可用性错误可读。
- 本地启动文档（Windows / macOS / Linux），一条命令跑通前后端。

**验收**
- 本地打开 Studio，导入一张 Tavern 卡，完成一局生成故事并保存/读档。
- 主站不改动，`pnpm check` / `pnpm build` 不受影响。
- 授权/素材检查：仓库不含 CC BY-NC-SA 立绘。

### P1（3–5 天）：入口、persona 与起始内容

**交付**
- `/love` 双入口：「先玩一局」与「继续关系」；Studio 未运行时给安装/启动说明。
- 本地健康检查（`/api/health`）与版本提示；不阻塞主站。
- Persona 交接：主站导出 `.scpersona` / URL 传递，Studio 导入；恋爱系统的聚焦编辑器与 Studio 共用同一 schema（见 [spec-love-persona.md](./spec-love-persona.md)）。
- 一个原创起始角色 + 一个场景包 + 一个世界书示例（素材可商用/自制）。
- Studio 结束页回链。

**验收**
- 从 `/love` 一键进入 Studio，persona 预填；玩完回到 `/love`。
- Studio 未启动时主站不报错，说明可操作。
- 桌面 Chromium E2E；真机另记。

### P2（5–7 天）：故事包、角色生成向导、双语

**交付**
- 故事包导出/导入（`socialcoach.love-story.v1`），主站展示为「生成故事」。
- **角色生成向导**：描述角色 → LLM 生成 Tavern V2 卡 + 世界书 + 外观标签 → NovelAI 生成 4–8 张表情立绘 + 3–5 张场景 → 可选 GPT-SoVITS 参考音。
- Studio UI 中英双语（至少 chrome 与关键路径）；UGC 单语原样显示。
- 频率/花费提示：生图与语音的额度、并发、失败重试。

**验收**
- 从一句描述生成一个可玩角色，至少有 4 个表情与 2 个场景；导出故事包并在主站打开。
- 生成失败有可读错误与重试；不扣费缓存命中。
- 主站只读故事包，不执行 Studio 的任意提示词。

### P3（2–4 周，Stage F 的 F4）：托管版（可选）

**交付**
- Docker 部署、账号、每用户数据隔离、对象存储、备份。
- GPU TTS 服务（或外部 TTS 兜底）、NovelAI 代理、限流与成本控制。
- 内容审核、滥用处理、删除/导出、隐私说明。
- 监控与版本升级路径。

**验收**
- 两个用户的数据互不可见；删除账号/数据可验证。
- 密钥不落库；日志不回显；限流与 429 可读。
- 成本/并发预算有上限；故障可降级。

## 6. 与剧本模式的关系

- **剧本模式**保留：66 场、route ledger、命名结局、记忆/承接、阅读层。它服务「作者把关的完整故事」。
- **Love Studio** 服务「用户生成 / 自己的角色 / 无限内容」。两者是 campaign 与 sandbox，不做互相替代。
- 共享：persona、恋爱情境分类、角色/故事包格式。
- 不共享：运行时代码、存储、评分链路。
- 如果 Studio 证明用户更愿意在沙盒里玩，再评估是否把内置内容迁入 Studio；当前不迁，因为 route ledger/结局/承接在 Studio 没有等价物。

## 7. 风险与待拍板

| 风险 | 处理 |
|---|---|
| 两套运行时长期维护 | Studio 作为独立 fork，定期 cherry-pick 上游安全修复；主站不引 Python |
| 托管版多用户是重写 | v1 本地伴生；P3 单独立项，先算清账号/存储/GPU 成本 |
| GPT-SoVITS 需要 GPU | 默认浏览器 TTS；本地 Studio 可选 GPU，失败静默降级 |
| NovelAI 订阅/Cloudflare/429 | 用户自带 key；代理带浏览器 UA；单并发队列；缓存 |
| UGC 存储/备份 | 本地 SQLite + 文件；导出/擦除；配额提示 |
| 内容审核/合规 | 默认 SFW；本地成人内容年龄门控；托管版强制审核 |
| 上游分叉漂移 | 记录上游 commit；只同步安全/关键修复；不追全量功能 |

**待拍板**：v1 是否接受本地安装；Studio 默认语言；生图默认关还是手动；TTS 默认浏览器还是本地 GPT-SoVITS；Studio 放本仓库还是独立仓库。

## 8. 非目标

- 不替换主站教练或剧本模式。
- 不把 AnimaVN 的 Python/SQLite 塞进 Next.js / Vercel。
- 不在主站做账号或服务端练习存储（托管 Studio 是独立决策）。
- 不把 Studio 做成通用聊天入口；它仍是恋爱故事沙盒。
- 不随仓库分发 CC BY-NC-SA 立绘或第三方角色素材。
- 不默认 NSFW；不做未成年人/真人/非自愿内容。

## 9. 与旧规格的关系

- [spec-love-visual-novel.md](./spec-love-visual-novel.md) 的「游戏模式」是本文的前身；其中「NPC 不讨好」「不做好感」的条目由 [半教练 spec](./spec-love-semi-coach.md) 与本文取代。
- [spec-love-galgame-foundation.md](./spec-love-galgame-foundation.md) 的存档/回想/TTS/引擎债继续作为剧本模式的基本盘；「不做好感」条目不再适用于 Studio。
- [spec-love-interactive-story.md](./spec-love-interactive-story.md) 的阅读层/记忆/陪伴机制继续服务剧本模式；Studio 的阅读体验由 AnimaVN 提供。
