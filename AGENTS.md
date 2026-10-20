# AGENTS.md

SocialCoach —— LLM 社交技能教练。应用在 `app/`（Next.js），仓库根只有文档。

## 入口

1. 先读 `wiki/00-product-proposal.md`（做什么、**不做什么**）和 `wiki/01-project-roadmap.md`（当前阶段、功能索引）。
2. 动 `app/` 里的代码前，读 `app/AGENTS.md` —— Next.js 16 与训练数据差异较大，该文件由 `next dev` 自动维护。
3. 不要一次加载 `wiki/archive/`、`wiki/refs/`、`wiki/reviews/`。
4. 动恋爱或 Galgame 前，先读 `wiki/14-stage-f.md`、`wiki/specs/spec-love-semi-coach.md`、`wiki/specs/spec-love-studio.md`。

## 仓库与发布线

- 两个远端：`origin` = `zuiyi233/SocialCoach`（本工作区的二开分支），`upstream` = `GeminiLight/SocialCoach`（生产仓库）。Vercel `socialcoach-ai.vercel.app` 与 ModelScope 国内镜像都从 `upstream/main` 发布。
- **本线只同步到 `origin`，不向 `upstream` 开 PR。** 官方合并由 owner 那条 `codex/*` 线负责；这里做完的批次只推自己分支。
- **`wiki` 里的「已落地 / ✅」不是线上证据。** 判断发布状态要 `curl` 直连域名（`socialcoach.aurax.live` 地域分流会丢子路径，不能验深链）。
- 开工先 `git fetch upstream` 并报 ahead / behind；分叉本身就是候选下一步。合并上游后用 `app/` 的 `pnpm check` + `pnpm build` 验证语义一致，再推 `origin`（确认是 fast-forward 才推）。

## 3D 版本维护

- **主仓库是唯一开发主线。** 3D 饭局的功能、人物、交互与修复优先在 `app/src/features/dinner/` 和主站 `/3d` 完成、验证和发布。
- `GeminiLight/SocialCoach-3D` 保留为独立演示原型，只接受从主仓库到独立仓库的可选同步。允许版本落后，不以两边一致作为主站交付条件。
- 仅在适配成本低时同步可复用的场景、人物、素材或纯逻辑；不为同步复制主站的 Next.js、模型 / BYOK、存储和发布集成，也不维护两套平行实现。
- 同步时记录主仓库来源提交和实际同步范围，在独立仓库运行相应检查；需要大量适配或独立维护时，保留其已验证版本。未经新需求，不引入自动双向同步或共享包重构。

## 恋爱与 Galgame 子系统（2026-10-21）

- 恋爱域拆成两套系统：**恋爱半教练**（熟悉 / 信任 / 心动的关系状态，高关系主动关心，可选关系回顾）与 **Love Studio**（生成式 Galgame 沙盒，用户生成文本 / 人物 / 立绘 / 场景，先玩一局）。主教练（文字 / 3D / 自定义排练）不变。
- 三套内容契约见 [spec-love-semi-coach.md](wiki/specs/spec-love-semi-coach.md) §2 与 [spec-love-studio.md](wiki/specs/spec-love-studio.md)。**不要用主教练的「NPC 不讨好」「必须引用原话」「不做好感」去否决恋爱 / Galgame 需求**；这些领域规则只在教练模式生效。
- Love Studio 是独立运行时（AnimaVN fork，Python + SQLite），v1 本地伴生，v2 托管另议；不把它的运行时塞进 `app/`，也不把主站账号 / 服务端存储带进来。
- **人设只有一个 schema。** Studio 是完整 Tavern 工作台；恋爱系统是聚焦编辑器 + `.scpersona` / 基础 JSON 导入导出，完整 Tavern 卡只在 Studio 导入。不要做两套字段名，也不要要求用户装 Studio 才能改核心人设。见 [spec-love-persona.md](wiki/specs/spec-love-persona.md)。
- **Tavern 导入分两层（2026-10-21 拍板）。** Studio 完整导入 PNG / 世界书 / 预设 / 立绘包；恋爱系统只吃 `.scpersona` + 基础 JSON。离线直吃卡是唯一例外，且必须共享 Studio 的 parser（MIT）+ round-trip 契约测试，不写第二套解析器。
- **玩家 persona 与教练 profile 分表（2026-10-21 拍板）。** 只提供显式「复制到教练档案」并需确认；不自动双向同步。
- **Studio 不参与关系养成（2026-10-21 拍板）。** 关系状态只读、默认折叠；没有提升关系状态的操作、任务或提示。
- **局外成长不是等级（2026-10-21 拍板）。** 用叙事阶段（陌生 / 认识 / 熟络 / 亲近）+ 关系图鉴 + 故事收藏；不做战力、EXP、签到、streak、付费加成。等级即使出现也只读派生，不能兑换奖励或加成。
- **跨系统只通过 pack / 本地桥显式交接。** 用户确认后才写；Studio 不自动写半教练的关系状态，半教练不自动写能力分；`hidden` / `secret` / 结局谓词不导出。见 [spec-love-bridge.md](wiki/specs/spec-love-bridge.md)。
- 平台不变量仍然适用：授权与素材来源、密钥不落库、导出 / 擦除、安全与内容分级、产品名对外统一 `SocialCoach`。

## 论文材料

- 论文写作、投稿调研、审稿回复及未公开研究记录保留在本地或独立研究仓库，不纳入本产品仓库的提交、上传或部署。
- 当前本地论文材料位于 `docs/research/`，已由 `.gitignore` 排除；提交前核对新增文件，避免论文材料混入其他目录。
- 产品实现、产品评审与测试验收记录按下方 Wiki 规则维护。

## Wiki

架构 / 数据流改动再读 `wiki/02-system-architecture.md` 与当前 stage；API 改动读 `wiki/04-api-reference.md`；UI 改动读 `wiki/03-design-principle.md`；修 bug 先扫 `wiki/80-known-pitfalls.md`。

本项目用**紧凑编号方案**（`0x` 战略+架构，`1x` 阶段，`8x` 运维）。不要引入 `20-` / `30-` / `6x-` 这类展开方案编号。

开发到以下节点时同步 wiki（不需要每次 commit 都更新）：

| 做了这件事 | 更新 |
|---|---|
| 新增 / 修改 API | `wiki/04-api-reference.md` |
| 完成 stage 内一个功能 | `wiki/01-project-roadmap.md` 对应行状态 |
| 架构变更（新模块、新数据流） | `wiki/02-system-architecture.md` |
| 踩到非显而易见的坑 | `wiki/80-known-pitfalls.md`（现象 / 原因 / 解法 / 教训） |
| 同一模块连续 3+ 相关 bug | 新建 `wiki/81-postmortem-{topic}.md` |
| 发现 bug / 技术债 / 改进想法 | `wiki/85-backlog.md` |
| 新增设计 token / 动效 | `wiki/03-design-principle.md` |
| 阶段全部交付 | `wiki/90-changelog.md`（从 backlog 已完成项整理） |
| 重命名 / 移动 wiki 文件 | 全文搜索旧路径并更新引用 |

新建：功能复杂到一句话说不清 → `wiki/1X-stage-X.md`；小功能需要边界和验收 → `wiki/specs/spec-{name}.md`；外部机制被查阅 2 次以上 → `wiki/refs/{topic}.md`；评审结束 → `wiki/reviews/review-{YYYY-MM-DD}-{subject}.md`。

归档：spec 完成 → `git mv` 到 `wiki/archive/specs/` 并在 backlog 打勾；review 的 action items 全部完成 → `archive/reviews/`；stage 完结且无跨引用 → `archive/stages/`，roadmap 标 `[archived]`。

每个阶段开始时跑一次审计，按 high → medium 处理：

```bash
python3 ~/.claude/skills/project-wiki/scripts/wiki_audit.py wiki/
```

## 项目专有约束

这些约束违反了就是产品定位问题，不是代码风格问题。默认适用于主站教练与剧本模式；Love Studio 是独立子系统，除平台不变量外不逐条套用（见上方「恋爱与 Galgame 子系统」）。

- **教练模式的 NPC 不能讨好用户。** 不因态度好就让步、不提前吐露 `hidden`、不在对话内跳出角色做教练。适用于文字对练、3D 饭局、自定义排练的评估线；恋爱半教练与 Love Studio 按各自契约，不适用本条。
- **教练模式的剧情必须可玩、有转折。** 开场给具体冲突；用户行动改变后续压力、条件或关系。部分成功后谈其后果，失误后保留修复与拒绝的路。高潮是用户能回应的关键决定，不靠随机辱骂、编造紧急事件、固定回合换题或重复施压。文字 / 3D / 自定义排练统一遵守；新场景验收必须含让步、拒绝、反问、玩笑、修复与续聊，不能只测标准答案。恋爱半教练的剧情按关系节点与结局验收；Galgame 按恋爱体验验收，不套这一矩阵。
- **反馈必须先引用用户原话。** 教练模式没有转录证据的评价不出现；恋爱半教练的关系回顾同样只引用用户自由输入，点选项不算原话。
- **内置语料必须有 `source`。** 不生成无出处的「策略」或「案例」；Love Studio 的 UGC 由用户负责，manifest 记录 `source` / `license`。
- **主站与本地版不引入账号体系或服务端存储。** 状态留在设备上、可导出；Love Studio 托管版（P3/F4）是单独决策，不能顺手带进主站。
- **面向用户的静态文案是 `L = {zh, en}` 双语对象**，用 `pick(v, lang)` 取值。主站与剧本模式适用；Love Studio 的 UI 按语言包，UGC 单语原样显示。
- **产品名对外一律是 `SocialCoach`**，中文语境也不例外。中文说明放在名字下面的副行（`nav_workspace`：你的情商练习场），不做第二个名字。Love Studio 对外是「SocialCoach · Love Studio」，不是第二个产品名。
- **主句四处同源**：`README.md`、`app/src/app/layout.tsx` 的 `metadata.description`、`app/public/manifest.webmanifest` 的 `description`、`site/content.mjs` 的 `hero.h1` 与 `footer.tagline`。同源指的是**主句本身逐字一致**，不是整个字符串相等——manifest 只放主句，layout 是主句加一段展开，README 是行文。改主句必须四处一起改。Love Studio 不继承主句，它有自己的入口文案。
- **色值只在 `app/src/app/globals.css` 定义**（OKLCH）。主站与剧本模式的组件里不写死颜色；对外 SVG 用脚本换算的 hex。Love Studio 有独立样式，不并入主站 token。
- **主站与剧本模式的结构化输出走 `jsonCall()` / `extractJSON()`**，不要用 SDK 的 `output_config.format`（当前网关不支持）。Love Studio 沿用 AnimaVN 的标签/流式协议，不强行套本契约。
