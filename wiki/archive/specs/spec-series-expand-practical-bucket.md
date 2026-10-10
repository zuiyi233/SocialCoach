# 交接方案：剧情线扩展 + 通用/职场 practical 分桶场景化

> 写给接手执行的新工作区。你只有这份文档 + 仓库代码，没有本会话上下文；按文档执行，遇到与代码事实不符处，**以仓库代码为准**并记录偏差。不需要联系原作者即可独立完成全部工作。
>
> 基线：`main` @ 2026-10-10，`pnpm check` 254 项全绿，git clean。

## 背景（一句话）

恋爱模块做完了 Galgame 游戏模式（P1-P3，含 `/api/love-play` AI 剧情引擎 + 千问 IMAGE 2.1 立绘管线，50 角色 × 4 表情 = 200 张 PNG 已通过内容体检），但：

1. **剧情线只有 1 条真正成型**（`love-arc-approach`，3 场景），且恋爱主页只露出这一条入口；另外 2 条非恋爱线（junior/family）混进了 `LOVE_SERIES` 聚合物。
2. **通用/职场 practical 场景**（backlog 记过「通用/friendship ~12 条、职场 ~6 条」）**还没场景化**，素材盘点在 `恋爱军师-skill/goutoujunshi-main/extraction-map/practical-map.md`（仓库内但 gitignored，只读素材）。

## 产品红线（违反即产品定位问题，不是代码风格问题）

- **NPC 不能讨好用户**：不因态度好让步、不提前吐露 `hidden`、不在对话内跳角色做教练。新场景/剧情线必须保留拒绝、让步、反问、玩笑、修复、续聊六类路径；失误后留修复与拒绝的路。
- **语料必须有 `source`**：不生成无出处的「策略」或「案例」。原创场景沿用既有格式：`Original fictional practice — SocialCoach, 2026-10-10, app/src/data/corpus/<file>#<id>`。
- **面向用户文案是 `L = {zh, en}` 双语对象**，用 `pick(v, lang)` 取值。场景全部字段双语。
- **色值只在 `app/src/app/globals.css` 定义**：组件不写死颜色。新场景不改样式体系，只加数据。
- **结构化输出走 `jsonCall()` / `extractJSON()`**，不用 SDK 的 `output_config.format`。
- **无账号体系/服务端存储**：状态留设备上（localStorage），可导出。
- **游戏模式不伪造能力评估**：`completeLovePlay` 只写统计（practiceDays/分钟/loveProficiency 微增益），不触发证据式 assess。

---

# 任务 A：剧情线扩展（恋爱）

## A.0 现状（已核实，2026-10-10）

- `app/src/data/corpus/love-series.ts`：`LOVE_SERIES = buildSeries()`，遍历 **全部** `SCENARIOS`，把带 `series` 字段的场景按 `SCENARIOS` 数组顺序聚合。**叙事顺序 = 各大语料文件在 `app/src/data/corpus/index.ts` 里 `SCENARIOS` 拼接的顺序**（`...LOVE_SCENARIOS, ...DEEP_APPROACH, ...DEEP_DEFINE, ...DEEP_REJECTION, ...DEEP_BREAKUP, ...DEEP_BOUNDARY, ...DEEP_TRUST, ...DEEP_LONG_DISTANCE, ...DEEP_FAMILY`）。
- `LOVE_SERIES` 实际产物（已打印核实）：

  | id | 名称 | 场景数 | 场景（按顺序） |
  |---|---|---|---|
  | `love-arc-approach` | 初见与心动 | 3 | hobby-event → date-followup → vague-investment（cast: tess, mae, zoe） |
  | `love-trust-boundary` | 信任与边界 | 3 | partner-location-pressure → love-trust-repair → love-boundary-online-reply |
  | `junior-aze` | 和阿泽的两次对话 | 2 | jm-feedback-deflected, jm-over-commit（**非恋爱，混入**） |
  | `family-care` | 家里的几笔账 | 3 | fm-care-decision, fm-share-cost, fm-brother-loan（**非恋爱，混入**） |

- **问题 1**：`LOVE_SERIES` 混入非恋爱线（junior-aze、family-care）。`love/page.tsx` 的游戏入口 `gameHref` 取 `ordered.find((s) => s.series)`——`ordered` 只含恋爱场景，所以入口只露出 `love-arc-approach` 一条；`trust-boundary` 线没有 UI 入口（URL 直达可玩）。`SeriesPlay`（`components/love/SeriesPlay.tsx`）是单线页。
- **问题 2**：现有线的 cast 不统一（approach 线 3 个场景 3 个不同人物），叙事感弱——Galgame 的剧情线应 cast 一致、剧情连贯。
- 立绘：50 角色全部有 4 表情 PNG（`app/public/love-portraits/`），现有恋爱场景角色基本都有立绘（`tess* mae* zoe* finn* iris* andre* eli* juna* dylan* eve* ivy* aunt-zhou*` 等，* 表示已有立绘）。

## A.1 必做（数据与入口修正，风险低）

1. **纯化 `LOVE_SERIES`**：`buildSeries()` 只聚合恋爱系列（`s.series && s.context === "romantic"` 或按 `s.loveTopic` 判定，以代码为准选成立的口径），把 junior-aze / family-care 排除出恋爱聚合物。注意：这两条非恋爱线如果**别处**（如主场景列表）有意使用 series 标签展示，则只改 `love-series.ts` 的过滤，**不动** `scenarios-junior.ts` / `scenarios-family.ts` 的数据。
2. **love 主页露出全部恋爱线**：`app/src/app/love/page.tsx` 的游戏模式入口卡片段改为**线列表**（用 `LOVE_SERIES` 遍历，每条线一个卡片：名称、进度 `readLoveSeriesProgress(series.id)`、场景数、进入 `/love/play/series/[seriesId]`）。已有文案 key（`love_mode_title` / `love_mode_sub`）若不够用，在 `app/src/lib/i18n.ts` 等文案 L 对象里补 key（双语），风格一致。
3. **回归**：`pnpm check` 全绿；`/love` 页渲染正常（`next dev` 冒烟）。

## A.2 内容扩展（新增剧情线，本轮核心交付）

**目标：新增至少 2 条 cast 一致的恋爱剧情线**，复用已有立绘角色（从 50 角色表里挑），每条线 **3-4 个场景**，剧情连贯（有冲突、有转折、有修复路径），串起 2-3 个 loveTopic（如 approach → define → boundary/trust），覆盖恋爱的不同阶段。

**做法（两种，可混合）：**

- **优先复用现有场景**：把 `LOVE_SCENARIOS_DEEP_*` 里同一 cast（相同角色 id）且可以排成连续剧情的场景，用 `series` 字段串线（`series: { id, name }` 已存在于 `Scenario` 类型，加字段即可）。改动是**为现有场景增加/修改 `series` 字段**，不改剧情内容。若一个场景要改挂线，**检查它在 `SCENARIOS` 拼接顺序中的位置**——线内场景必须在数组顺序上排成叙事顺序（否则要移动该场景到适当的 deep 文件/位置，或接受现状微调）。
- **补充原创场景**：素材缺口处写 1-2 个新场景补成完整线（cast 复用已有立绘角色），双语、`source` 标原创（格式见红线）、满足六类验收路径。新场景放对应主题的 `love-scenarios-deep-*.ts` 文件**末尾**（保持主题聚集），并同步：
  - `app/src/data/corpus/index.ts` 的 `LEARNER_ROLE`（新角色名/场景 id 登记，供 `withLearner` 注入 playable“你”）；
  - `app/src/data/corpus/index.ts` 的 `SCENARIOS` 拼接（放在对应 deep 文件数组里即自动包含）；
  - 立绘：新角色需在原立绘管线补充（`scripts/gen-love-portraits.mjs` 支持单角色出图，但**本机 ComfyUI 在 D:\ComfyUI_Mie_2026_V8.0\，未确认在线；能避免就优先复用现有 50 角色**）。

**建议新增的线（主题连贯、立绘齐备、素材足）：**

1. **「暧昧到说清楚」**（cast: tess 系列或新搭一队；topics: approach → define-relationship → trust）：初识感兴趣 → 忽冷忽热/含糊不投入 → 摊牌明确关系。
2. **「被拒之后」**（cast: eve/dylan 等；topics: rejection → boundary）：表白被软拒 → 对方反复给信号 → 划清边界守住自己。

两线都必须：开场具体冲突；`hidden` 存在且需问出；至少有 partial/failure 收束路径；验收覆盖六类（让步/拒绝/反问/玩笑/修复/续聊）。

**验收（A 部分）**：
- `LOVE_SERIES` 只含恋爱线；非恋爱线不再混入。
- love 主页显示全部恋爱线，每线入口可进、进度独立（localStorage key `socialcoach.love-play.series.<id>`）。
- 每条新线 3-4 场景、cast 一致、开场有冲突、含 hidden、六类验收路径均有覆盖。
- `pnpm check` 全绿；`check-love-retrieval.ts`（8 主题检索门）不回退。

---

# 任务 B：通用/职场 practical 分桶场景化

## B.0 现状（已核实）

- 素材盘点：`恋爱军师-skill/goutoujunshi-main/extraction-map/practical-map.md`（仓库根下，gitignored；只读素材，**不要提交该文件，也不要把素材本身当语料**）。
- backlog 已定分桶（照此执行，来源映射见 practical-map.md 各篇的「SocialCoach 分类映射」节）：
  - **通用/friendship ~12 条**：巧妙接话（倾诉/意见分歧/新活动）、万能夸人（同事/朋友/长辈）、化解尴尬（观点对立冷场）、提升表达逻辑性（流水账/PREP）、有效拓展人脉（加微信/唤醒久未联系）、被孤立破局（新环境/误解澄清/排挤）、托人办事（说清需求+给拒绝空间）。
  - **职场 ~6 条**：被同事甩锅、新同事聚餐插不上话、领导加派任务/拒绝加班、公开发言被质疑、会议发言接住再驳、托人办事职场向。
  - **话术素材去向**：126 条话术只作场景化时的 NPC 台词灵感，**不新增独立语料条目**（不做 theory/case 层）。

## B.1 交付物：~18 个原创场景

写入**新建** `app/src/data/corpus/scenarios-wf.ts`（职场）与 `app/src/data/corpus/scenarios-friendship.ts`（通用/friendship）两个文件，或在现有 `scenarios-a/b/c/d` 对应 context 文件追加——**优先新建文件保持本批次可追溯**（沿用 `love-scenarios-deep-*.ts` 的风格与注释头）。

每个场景完整满足 `Scenario` 类型（`app/src/data/corpus/types.ts`，已读）：`id/title/hook/background/simulationFacts/context/contextType/competencies/skills/relationship/difficulty/minutes/characters/objectives/success/failure/maxTurns/opening/source/keywords`；`context` 取值 `"workplace"` / `"friendship"`（`ContextId` 已含这两个值）；**不设** `loveTopic`（非恋爱）；如需 `series` 可后加但本轮不强求。

必须同步：
- `app/src/data/corpus/index.ts`：
  - import 新文件并加入 `SCENARIOS` 拼接（放通用文件区：`...SCENARIOS_D, ...SCENARIOS_WF, ...SCENARIOS_FRIENDSHIP, ...` 等）；
  - `LEARNER_ROLE` 为每个新场景 id 登记 playable“你”的角色称谓（双语）。
- `source` 一律 `Original fictional practice — SocialCoach, 2026-10-10, app/src/data/corpus/<file>#<id>`。
- `characters`：非 playable cast 建议**复用** `love-portraits/manifest.json` 已有角色 id（50 角色表），这样未来要转 Galgame 免重出图；也可用 `scenarios-a/b/c/d` 现有 cast 风格的新 id（这些旧场景没立绘也不影响普通教练模式）。

## B.2 验收（B 部分）

- 场景数：通用/friendship ≥ 12、职场 ≥ 6（可与地图清单一一对应，总数 ≥18）。
- 每个新场景：双语完整、source 带文件位置、开场具体冲突、至少含让渡与拒绝两条路径、`simulationFacts` 区分「已确认事实 vs 未知」。
- 新场景出现在主练习流程可检索：`next dev` 下 `/practice` 或首页新建练习能选到（注意：首页入口是「今日推荐」随机，验证方式用场景列表/搜索或直接构造 session，以现有别的场景为准，别臆造验证路径）。
- **`pnpm check` 全绿**（含 `check-love-retrieval.ts` 恋爱检索门、`test:core`、`test:dinner`）。

---

# 执行与验证清单（收尾）

1. `cd app && pnpm check` —— 全绿才算完成。
2. `pnpm dev` 冒烟：
   - `/love`：出现全部恋爱剧情线入口卡片，每条可进 `/love/play/series/<id>`；线内进度独立记录；单场景完成回线内页。
   - 新通用/职场场景可被普通教练流程选用（场景选择/首页推荐/搜索任一验证路径）。
3. 完成时更新：
   - `wiki/01-project-roadmap.md`：A 部分在 A37 行补一句（扩展了哪些线）；B 部分在 A1 语料数行加通用/职场场景计数。
   - `wiki/85-backlog.md`：打勾对应条目（剧情线已扩展、通用/职场分桶已完成）。
   - 若有踩坑 → `wiki/80-known-pitfalls.md`。
4. 提交信息惯例（参考近期提交风格）：
   - `feat: 恋爱剧情线扩展（+N 条）` / `feat: 通用/职场 practical 分桶场景化（+N 场景）`，docs 改动独立提交。

## 范围之外（本轮不做）

- 桌面端重打包（Galgame 进桌面壳）——留待剧情线/分桶完成后单独做。
- 立绘新角色出图（本机 ComfyUI 未确认在线；先复用 50 角色）。
- `/learn`「参考说法」区块等可选项，未批准不动。
- 不改 taxonomy 技能层、不改色值体系、不动 `/api/love-play` 引擎本身。