# 恋爱独立模块设计（spec）

> 状态：**首批已实施**（2026-09-17，实施记录见[第九节](#九实施记录2026-09-17)）
> 日期：2026-09-17　|　素材来源：[goutoujunshi-skill.md](../refs/goutoujunshi-skill.md)
> 关联：本项目 wiki 编号方案 0x=战略/架构、1x=阶段；本模块属 Stage B 之后的独立功能线。

## 一、背景与目标

用户反馈：SocialCoach 现有的练习更偏职场 / 上下级 / 人际沟通，**恋爱关系指导极少**，且缺乏引导入口。目标是做一个**恋爱独立模块**：专门的 `/love` 入口 + 一批 romantic 语料，让恋爱练习有"自己的门面"，并自然接入现有排程 / 复盘 / 雷达机制。

## 二、现状基线（2026-09-17 核对，修正此前误传数据）

> 注：此前口头/报告传的"99 个场景"不准确；以 `scenarios-a/b/c.ts` 逐条核对为准，**场景共 46 个**。

| 语料 | 总数 | romantic（恋爱） | 占比 |
|---|---|---|---|
| 场景 scenarios | 46 | **4**（scenarios-b: first-date-silence 约会冷场 / partner-forgot-anniversary 忘纪念日 / saying-i-love-you 第一次说我爱你；scenarios-c: partner-alone-evening 想独处被听成拒绝） | 8.7% |
| 理论 theories | 42 | **0**（恋/约/伴侣/affection/dating/love/分手 全关键词零命中） | 0% |
| 案例 cases | 30 | **2**（case-first-date-question 约会问句 / case-anniversary-repair 纪念日修复） | 6.7% |

**taxonomy 缺口**（`app/src/data/taxonomy.ts`）：
- `CONTEXTS.romantic` 细类只有 3 个：约会 Dating / 伴侣冲突 Partner conflicts / 表达爱意 Affection sharing
- `SkillId` 34 个技能中**无恋爱专属技能**；关系类型仅 `partner` 一个恋爱相关
- 配色/插图已就绪：`scenario-icons.tsx` 有 `CONTEXT_HUES.romantic = 338`，`context-illustrations.tsx` 有 Romantic 插图——渲染不缺口

**调度行为**（影响模块设计）：
- `app/src/lib/retrieval.ts`：context 约束**精确匹配**（`core.contexts.includes(s.context)`），由 LLM prescription 决定是否挑 romantic 场景——不能保证恋爱场景出场率
- `app/src/app/arena/page.tsx`（L59-67）"for you"推荐按 `profile.contexts` **硬过滤**，这是唯一可控的保证路径
- `/love` 模块页自身按 `context === "romantic"` 过滤是自己的筛选入口，与排程解耦

## 三、缺口清单（现有 romantic 未覆盖的主题）

搭讪/接近、暧昧期/关系定义（"我们算什么"）、表白被拒/被拒绝后、收到表白、分手对话、异地恋、见家长/家庭见面、前任边界、信任修复（隐瞒/出轨重建）、缺乏安全感/依恋焦虑、亲密需求不匹配、关系淡化/重燃、相亲/家人介绍、暧昧边界（情感出轨）、拒绝追求者/拒绝进一步亲密、恋爱与工作朋友的时间平衡。

## 四、决策记录（用户已拍板）

1. **模块形态 = 独立入口 + 语料扩充**：新增 `/love` 路由页（恋爱场景/理论/案例聚合），练习复用现有 `practice/[id]` 链路；导航加第 6 个 Tab。
2. **英文翻译**：由实现方基于「恋爱军师中文原文 + 项目现有英文风格（`L()` 双语、README_EN 风格）」生成 `{zh,en}`，用户抽查校对。
3. **复用现有 34 技能**：不新增恋爱专属技能；恋爱语料打现有 `SkillId` 标签（映射见下），保证排程检索、复盘归因、雷达（按 5 大 CASEL 能力聚合）全部可见可用。

另：`CONTEXTS.romantic.types` 细类建议 3 → 7（纯展示文案 `L`，不影响检索），见实施步骤。

## 五、首批语料清单

### 5.1 恋爱场景 ~10 个（放入语料后 `context:"romantic"` 自动进入 arena / 排程池）

| id | 主题（中/英） | contextType（新细类） | 技能标签（现有 SkillId） | 难度 |
|---|---|---|---|---|
| love-approach-cafe | 咖啡店初识搭讪 / Making the First Approach | 初次认识 First approach | building-relationships, social-norms, initiative | 2 |
| love-define-relationship | 暧昧期"我们算什么" / Defining the Relationship | 暧昧期 Ambiguity | communication, perspective-taking, self-efficacy | 3 |
| love-confession-declined | 表白被拒后的回应 / After a No | 表达爱意 Affection ⑵ | emotion-regulation, perseverance, self-efficacy | 2 |
| love-receive-confession | 收到意外表白 / Someone Confesses to You | 表达爱意 Affection | communication, empathy, identifying-emotions | 2 |
| love-breakup-talk | 和平分手对话 / The Breakup Talk | 分手与前任 Breakup | communication, emotion-regulation, analyzing-consequences | 3 |
| love-boundary-with-ex | 前任边界 / Boundaries with an Ex | 分手与前任 Breakup | standing-up, self-discipline, communication | 3 |
| love-long-distance | 异地缺乏安全感 / Long-Distance Insecurity | 异地/安全感 Trust & distance | perspective-taking, empathy, communication | 2 |
| love-meet-parents | 见家长 / Meeting the Family | 见家长 Family | stress-management, social-norms, communication | 2 |
| love-uneven-investment | 投入失衡 / Out of Balance | 伴侣冲突 Partner conflicts | self-efficacy, communication, goal-setting | 2 |
| love-trust-repair | 隐瞒被揭穿后重建信任 / Rebuilding Trust | 信任与边界 Trust | emotion-regulation, empathy, resolving-conflicts | 3 |

⑵ 表白被拒场景复用"表达爱意"细类，避免细类被拒绝语态污染（题材上是"对方拒绝"）。

skills 字段 1–3 个、按重要度排序，competencies 由 `skillById` 反推（无需手写但需 TS 类型合法）。`source` 字段：恋爱军师场景素材无独立书名，标素材来源（如 `"Goutoujunshi skill (community practice), grounded in Gottman"` 之类，实现时按实际引用核对）；`hidden` 底牌按现有 17/34 覆盖率惯例尽量配备。

### 5.2 恋爱理论 ~10 条（Theory schema：principle + howTo + source{book,author,url?}）

| id | 主题 | 出处（实现时按 **[refs/goutoujunshi-skill.md](../refs/goutoujunshi-skill.md)** 对应 knowledge 篇末"核心来源"核对） | 技能标签 |
|---|---|---|---|
| love-theory-attachment | 依恋理论：焦虑-回避双维度（非四类人格） | 依恋理论篇（Simpson & Rholes 等） | identifying-emotions, emotion-regulation |
| love-theory-soft-start | 冲突软启动：事实—感受—需要—请求 四步 | 沟通冲突修复篇 | communication |
| love-theory-responsiveness | 回应性：五个高价值观察点 | 亲密关系心理学总论篇 | empathy |
| love-theory-bids | 情感邀约（bids）与连接 | 亲密关系心理学总论篇 | empathy, sense-of-belonging |
| love-theory-attraction-ethics | 吸引机制与伦理转译（冷读的合理用法） | 吸引/约会启动篇 | social-norms, examining-bias |
| love-theory-rejection | 被拒后的自我调节：区分事实/解释/恐惧 | 依恋理论 + 分手篇 | self-efficacy, perseverance |
| love-theory-investment | 关系投入平衡与退出决策 | 投入失衡篇 | goal-setting, analyzing-consequences |
| love-theory-guard | 操控识别（PUA 机制 + 防御）——立场为"识别/防御" | 操控伦理替代篇 | examining-bias, ethical-responsibility |
| love-theory-closure | 分手与结束：健康告别 | 分手背叛与修复篇 | emotion-regulation |
| love-theory-boundary | 设边界：具体、可执行、可退出 | 边界/拒绝话术篇 | standing-up, self-discipline |

### 5.3 恋爱案例 ~4 条（Case schema：situation + whatHappened + takeaway + context:"romantic"）

| id | 主题 | 技能标签 |
|---|---|---|
| love-case-soft-start | 一次用软启动化解的争吵（故事化） | communication, resolving-conflicts |
| love-case-rejection-grace | 表白被拒后仍体面收尾 | emotion-regulation, self-efficacy |
| love-case-scam-identified | 识别杀猪盘沟通套路（防御向） | examining-bias |
| love-case-boundary-set | 对越界请求说"不"并守住 | standing-up, communication |

### 5.4 技能标签映射策略（保证「雷达可见 / 复盘可用」）

- **雷达 /progress** 按 5 大 CASEL 能力聚合：以上标签覆盖 self-awareness / self-management / social-awareness / relationship-skills / responsible-decision-making 全部 5 个能力域 → 恋爱练习直接反映到雷达五维（无需改 progress 代码）
- **复盘 /api/assess** 按场景 `skills` 归因 acquisition/performance → 标签合法即自动工作
- **排程 /api/schedule** 核心约束 `target_skills` 取自 `profile.goals` → 用户在 onboarding 选了恋爱相关技能（communication/empathy 等）即会径向优先恋爱场景
- 不需要为恋爱改 taxonomy 的技能层（用户已拍板复用）

### 5.5 恋爱独立熟练度设计（不新增技能的可视化完整方案）

用户拍板：复用 34 技能的同时，**恋爱独立熟练度纳入本次实践阶段**（不是"以后再说"）。双轨制设计：

- **新增 `loveTopic`（恋爱主题）元数据**：love 场景带可选字段 `loveTopic: LoveTopicId`（仅恋爱场景填，`check-corpus` 无破坏）。`LoveTopicId` 联合类型定义在 `love-scenarios.ts` 并导出，取值与 5.1 场景表分组一致（approach / define-relationship / rejection / breakup / boundary / long-distance / family / trust 等）
- **新增 `loveProficiency: Record<LoveTopicId, number>` store 字段**（`app/src/store/useApp.ts`）：`applyReport()` 写回时，若 `session.scenario.context === "romantic"` 且场景有 loveTopic，把 `report.deltas` 聚合（求和后 clamp 到与 `proficiency` 一致的有界区间，具体聚合与 clamp 规则实现时参照现有有界增量语义定）记到对应 loveTopic
- **双轨制原则**：恋爱练习的 deltas **照常**写回 `proficiency`（同时提升 communication 等通识技能，通识雷达不变），`loveProficiency` 是**附加的恋爱专属视图**，不互相覆盖、不污染主表、不新增 SkillId
- **`/love` 页展示**：各恋爱主题熟练度条 + 恋爱练习统计（次数 / 分钟 / star）+「从熟练度最低的主题推荐下一个练习」，形成「恋爱练习 → 恋爱熟练度反馈」闭环

## 六、实施步骤（下次执行顺序）

1. **语料文件**：新建 `app/src/data/corpus/love-scenarios.ts`、`love-theories.ts`、`love-cases.ts`（独立文件、模块化），按 `index.ts` 现有合并模式（`[...a, ...b, ...love]`）接入；语料 schema 参见 `corpus/types.ts`
2. **taxonomy 细类扩展**：`CONTEXTS.romantic.types` 3 → 7（新增：初次认识 First approach / 暧昧期 Ambiguity / 分手与前任 Breakup / 信任与边界 Trust & boundaries，双语 `L` 文案）——纯展示，不影响检索逻辑
3. **`/love` 路由页**：新建 `app/src/app/love/page.tsx`——聚合展示恋爱场景（可按 section 分组/难度筛选）、恋爱理论、恋爱案例；点场景进入 `practice/[id]`；复用现有卡片/封面组件（`ScenarioCover`、`PatternCard` 等）
4. **导航**：`app/src/components/Shell.tsx` `tabs` 加第 6 项（`{ href: "/love", key: "nav_love", Icon }`）；`TabBar` 移动端 `grid-cols-5` → `grid-cols-6`
5. **i18n**：`app/src/lib/i18n.ts` 加 `nav_love` 等键；love 页文案键
6. **可选增强**：`/arena` 顶部加"恋爱"快捷入口（预置 `ctx=romantic` 过滤），onboarding 情境选择给 romantic 卡片加提示
7. **恋爱主题标签与检索优化（补偿①）**：love 场景填 `loveTopic`（见 5.5）；`/api/assess` 的知识检索（`app/src/lib/tasks/assess.ts` 的 `retrieveKnowledge` 调用处）在 romantic 场景下**按 loveTopic 优先匹配**理论/案例，命中不足再回退现有 skills 检索——解决"恋爱理论被通用/职场理论挤掉"的知识错配
8. **恋爱独立熟练度（补偿③，完整可视化方案）**：按 5.5 实现——`love-scenarios.ts` 的 `LoveTopicId` + `app/src/store/useApp.ts` 的 `loveProficiency` 字段与 `applyReport()` 写回 + `/love` 页熟练度条与练习统计卡
9. **模块内目标引导（补偿②）**：`/love` 页顶部「你想练什么」分组（搭讪/暧昧/拒绝/分手/边界/异地/见家长/信任），点击过滤场景列表，补上 onboarding 技能选择对恋爱用户的引导缺口
10. **wiki 同步**：实现后按 AGENTS.md 更新 `01-project-roadmap.md`（新功能行）、本文档状态改"已实施"

## 七、验收标准

- `pnpm lint` + `pnpm build`（或 `tsc --noEmit`）通过——新增语料类型合法（skills/context/competencies 均为合法 id）
- romantic 场景 4 → 14（+10），`/love` 页正确展示场景/理论/案例
- 从 `/love` 选一个场景走通 练习 → 复盘 → 雷达收益 全链路
- `/love` 页显示恋爱主题熟练度条 + 练习统计 + 主题筛选/引导，「恋爱练习 → 恋爱熟练度反馈」闭环可见（5.5 双轨制，不污染 `proficiency` 主表）
- 导航 6 Tab（移动端 6 列布局正常），PWA 壳不受影响
- 双语：所有新增文案 `{zh,en}` 齐全；英文经用户抽查校对

## 八、边界（不做的事）

- 不新增恋爱专属技能（taxonomy 技能层不动）；不新增恋爱专属 `SkillId`
- `/progress` 主进度页不按 romantic 情境聚合——恋爱独立视图按 5.5 双轨制放在 `/love` 模块内，与 `proficiency` 主表互不覆盖
- 不收录无学术出处的 14 篇 mindmap 话术手册为理论条目；不收录时效性法律/统计内容（见 refs 集成原则）
- 操控识别类只作"识别/防御"立场，安全红线（家暴/自伤/诈骗）标注转介，不越"不做临床评估与危机干预"边界
- 不引入账号体系 / 服务端存储；不复制恋爱军师 skill 文件进仓库（只提取语料）

## 九、实施记录（2026-09-17）

**状态**：首批全部落地并通过验证（`pnpm lint` / `npx tsx scripts/check-corpus.ts` / `pnpm build` 全通过；独立审查 0 个 P0/P1）。

**与本文档的差异（实现时的合理修正）**：
1. `LoveTopicId` / `LOVE_TOPICS` 定义在 `app/src/data/corpus/love-topics.ts`（而非 5.5 写的 love-scenarios.ts）——避免 types.ts ↔ love-scenarios.ts 循环 import
2. **Theory / Case 也加了可选 `loveTopic` 字段**（5.5 只写了场景）——补偿①的检索加权需要理论/案例可标注主题
3. `CONTEXTS.romantic.types` 扩到 **8 个**（比 3→7 多一个"见家长"）——love-meet-parents 场景需要独立细类
4. 旧 4 个 romantic 场景（first-date-silence 等）补了 loveTopic，与新场景一起进入恋爱模块
5. loveProficiency 单场 gain 设上限 **0.4**（求和后 clamp 到 [1,5]），避免一场复盘把主题条拉满

**实际落地**：
- 语料：10 场景 + 10 理论 + 4 案例（id 与第五节清单一致）；hidden 覆盖 10/10；source 以真实出处为主（Eastwick et al. 2023 / Luo & Zhang 2009 / Gottman / Candel & Turliuc 2013 / Joel et al. 2020 / Ribeiro et al. 2020 / Seraj et al. 2021 / Miller 等，核对自恋爱军师各篇"核心来源"），5 条无学术出处者显式标 `Goutoujunshi skill (community practice)`
- `/love` 路由：主题引导（8 主题 chips）+ 熟练度条（role="meter"）+ 练习统计（含自定义场景，从 session 快照统计）+ 「下次练这个」推荐（熟练度最低的未练主题）+ 场景/理论/案例列表
- Shell 第 6 Tab（移动端 grid-cols-6，图标内边距 px-4→px-3 适配窄屏）、arena 顶部恋爱快捷入口
- loveProficiency：zustand persist `partialize` 显式列入（allow-list）、reset 清空、与 proficiency 共用 allowed 白名单口径
- 校验：check-corpus 新增 love 断言（loveTopic 必填、love 检索回归、无 url 的 source 必须 book+author）；next 16.3.4→16.3.5（安全补丁）
- 依赖：新增 `app/src/data/corpus/love-*.ts` 三文件 + index.ts 合并

**遗留（已随第二批完成，2026-09-17）**：`long-distance`、`family` 主题缺理论/案例的问题已解决——第二批补了 2 条理论（love-theory-long-distance / love-theory-family）、5 条案例（approach / define-relationship / breakup / long-distance / family 各 1）、1 个 boundary 场景（love-boundary-online-reply）。**8 个恋爱主题现已全部具备 场景+理论+案例 全覆盖**（romantic 场景 15、恋爱理论 12、恋爱案例 9）。检索断言同步强化（主题无关 query，反事实实验验证有效）。

## 十、上游合并记录（2026-10-09）

**状态**：已整体合并官方上游 `GeminiLight/SocialCoach` 最新 `main`（154 个新提交，merge 提交 `8ffe847`），恋爱模块功能全部保留、无功能冲突。

**合并方式**：`git merge upstream/main` 手动解决 10 个冲突文件。语料层零冲突（上游未动 `taxonomy` / `scenarios-b/c` / `love-*`），逻辑层逐处融合（`retrieval` / `useApp` / `arena` / `progress` / `Shell` / `assess` / `check-corpus`）。合并后恋爱模块适配上游新机制：`estimateProficiency`（从全部 assessed sessions 重估）、归档 + 多窗口存储（`parseArchive` / `appStorage` / `archiveStorage`）、评分 `scoringVersion===2`、URL 驱动 arena 筛选、中文 bigram 检索。

**合并后独立审查发现的修复（全部完成）**：
- **P0（数据丢失）**：上游把持久化读取改为 Zod schema 校验（`parseArchive`），但 `ScenarioSchema` 缺 `loveTopic`、`ArchiveSchema` 缺 `loveProficiency`、store `merge` 未保留该字段——每次刷新 / 跨窗口 rehydrate 会把恋爱熟练度剥离归零、复盘写回静默跳过、恋爱加权失效。修复：`runtime-contracts.ts` 新增 `LoveTopicSchema` 并入 `ScenarioSchema`；`archive.ts` 新增 `LoveProficiencySchema`（默认 `{}`）；`useApp.ts` merge 显式 `loveProficiency: archive.loveProficiency ?? current.loveProficiency`。
- **P1**：上游 D 批 2 个 romantic 场景（`partner-location-pressure` → `boundary`、`partner-trip-change` → `trust`）补 `loveTopic`；`check-corpus` 新增强制断言——**所有 `context === "romantic"` 的场景必须带 `loveTopic`**（防止未来新增浪漫场景再次脱离恋爱模块）。
- **P2**：`applyReport` 恋爱 gain 对称截断（`Math.max(-0.4, Math.min(0.4, …))`，负分也回落，与 generic 轨道口径一致）；arena 的 `loveTopic` 仅在 `ctx === "romantic"` 时计入筛选计数与 selected-filters 显示（消除深链残留不一致）；love 页 stars 按 `scoringVersion === 2` 口径统计。

**当前语料基线**：romantic 场景 23（旧 4 + 首批 + 第二批 + 上游 D 批 2 + 2026-10-09 恋爱深度 6：approach / long-distance / family 各 +2，含对方视角——**8 个恋爱主题现全部 2+ 场景**）、恋爱理论 12、恋爱案例 9。验证：`lint` / `tsc` / `check-corpus` / `build` 全部通过。

**2026-10-09 人际与恋爱深化**：新增向下管理 4 场景（jm-*）与家庭 5 场景（pf-/fm-/ch-*）补齐 junior/parent/child/sibling 语料空白；Theory 架构新增可选 `context`，33 条理论打标（恋爱 12 条均 romantic），`retrieveKnowledge` rank 加情境 +0.5 加权（与 Case 同口径，不破坏 loveTopic +3 断言）；arena 新增「关系对象」筛选；3 条系列场景线（junior-aze / family-care / love-trust-boundary）带双语徽标在 arena 与 /love 展示。