# 恋爱 Galgame 视觉模式（spec）

> 状态：**P1-P3 已实施**（2026-10-10，实施记录见[第九节](#九实施记录2026-10-10)）
> 日期：2026-10-10　|　关联：[恋爱独立模块](./spec-love-module.md) · [场景创作](./spec-scene-craft.md) · [3D 饭局](./spec-3d-table-culture.md)

## 一、背景与目标

用户方向：恋爱模块增加一个**可选的 Galgame 游戏模式**——有画面、有剧情、有选项的沉浸式恋爱剧情体验。**它不是替代**现有教练练习（briefing → 对话 → 复盘的证据式链路），而是恋爱模块里一个独立可选的入口：同一个语料库，换一种"玩游戏"的呈现。

**用户已拍板的三项决策**（2026-10-10）：
1. **游戏模式计入练习统计**（practiceDays / 完成数 / 分钟数进入现有统计）。
2. **立绘由 AI 生成**（构建期 ComfyUI 批量生成 PNG 资产，运行时零成本）。
3. **剧情由 AI 动态生成**（游戏过程中一边玩一边生成剧情，非静态场景重组）。

定位一句话：**恋爱模块的「教练模式」（现状）与「游戏模式」（新增）双入口并存，共用语料与档案；游戏模式计入练习统计，但不自动伪造能力评估。**

## 二、现状基线（2026-10-10 核对）

| 资产 | 现状 | 对 Galgame 的价值 |
|---|---|---|
| 恋爱场景 | 60 个（8 个 loveTopic 各 2+，deep 系列 37 个带 simulationFacts + hidden 动机 + 双语 + 原创 source） | 游戏模式的**剧情骨架**：cast / opening / hidden / objectives / success / failure 全复用 |
| 角色模型 | `characters[]`：id/name/personality/stance/**hidden**/hue | LLM 生成台词的角色约束 + 立绘人物清单 |
| 视觉锚点 | 每角色带 `hue` + `personality` | AI 立绘 prompt 的种子（人物设定 → 出图描述） |
| 剧情线数据模型 | `Scenario.series?: { id, name }`（`data/corpus/types.ts` L56-57）**已存在，尚无场景使用** | 剧情线归属字段；首批 1-2 条基础线直接落 |
| 进度 | `loveProficiency: Partial<Record<LoveTopicId, number>>`（`store/useApp.ts` L76/L311） | 跨场景 topic 进度展示 |
| 对话链路 | `practice/[id]`：Briefing → Chat（流式、多回合、条件式后续、可失败）→ Debrief | 游戏模式**复用 roleplay 链路的 LLM 契约**，换呈现 |
| 本机图像生成 | ComfyUI（`comfyui-manager` / `danbooru-tags` 技能，本机已配） | **AI 立绘管线**：构建期批量出图，产 PNG 进 `public/` |

## 三、产品形态

### 3.1 双入口

```
/love 页（现状：场景列表 → 点卡片 → /practice/[id] 教练练习）
  └── 新增「游戏模式」入口卡片
        ├── 选剧情线（series）：首批基础线（见 3.3）
        └── 进入 /love/play/<seriesId> → Galgame 界面
```

- 每个场景卡片保留现有"教练练习"入口；**新增**一个"剧情模式"入口（仅对带 `series` 的恋爱场景显示）。
- 游戏模式完成场景写入练习统计（practiceDays + 完成数 + 分钟数），见 5.4。

### 3.2 Galgame 界面构成

```
┌────────────────────────────────────────────┐
│  背景（CSS 渐变+场景装饰，色板取 hue）       │
│        ┌────────────────────────┐          │
│        │  角色立绘（AI 生成 PNG，│          │
│        │  表情按情绪切换）       │          │
│        └────────────────────────┘          │
│  ──────────────────────────────────────     │
│  [角色名] 台词（逐段浮现，双语）             │
│  ──────────────────────────────────────     │
│  [选项 A]  [选项 B]  [选项 C]  [自由输入]   │
└────────────────────────────────────────────┘
```

- **台词**：LLM 实时生成（见 4.2），逐段浮现，点按跳过。
- **选项**：LLM 每回合生成 2-4 个候选回复（基于场景 objectives/skills）+ 允许自由输入。选项方向覆盖 success/failure/partial，**不是**无脑好感度选择。
- **立绘**：AI 生成的 PNG 资产（见 4.3），表情 3-4 种（neutral/smile/tight/teary），按回合情绪切换。
- **背景**：CSS 渐变 + 场景 icon 装饰（按 `scenarioTone`/`hue` 取色）。

### 3.3 剧情线与 AI 动态剧情

- `Scenario.series` 字段承载剧情线归属；`series.id` + `series.name` 双语。
- **首批 1-2 条基础线**，素材最足、难度低，例如：
  - `love-arc-approach`：「摄影散步开场（approach-hobby-event）」→「再见面（approach 续）」→「暧昧落地（define 线）」。
- **AI 动态生成**：每条线只定**场景序列与每场约束**（cast / opening / hidden / objectives），**具体台词与分支由 LLM 每回合实时生成**：
  - 输入：场景 cast + personality/stance/hidden + objectives/skills + 回合历史 + 用户上一句（或所选选项）。
  - 输出：NPC 台词（角色口吻、双语）、2-4 个选项、情绪标签（驱动立绘表情）、是否揭示 hidden（满足揭示条件时）。
  - 承接：后一场景 opening 反映前一场景结果（`simulationDirection` 口径）。

## 四、架构与复用

### 4.1 数据层

| 复用 | 说明 |
|---|---|
| `Scenario` | 游戏模式消费现有场景对象作为**剧情约束**，不新增类型；`series` 字段补上 |
| `simulationFacts` / `hidden` | 隐藏动机揭示条件沿用同一口径（具体问题才揭示，不提前吐露） |
| `loveProficiency` | 游戏模式完成场景按 topic 增益**计入**（见 5.4 口径），与教练模式共用 |
| `source` | 每场景 source 已溯源；AI 生成台词以场景 source 为出处分级 |
| 练习统计 | 游戏模式完成 = 一次 session 记录（practiceDays + 分钟数），见 5.4 |

### 4.2 对话链路（AI 动态生成）

- **新 API `POST /api/love-play`**（或复用 roleplay 改造）：
  - 输入：`scenarioId`（或 series 进度）+ `history[]`（回合）+ `lastChoice`。
  - 输出：`{ line: L, options: L[2-4], emotion: "neutral"|"smile"|"tight"|"teary", hiddenRevealed?: boolean, terminal?: "success"|"failure"|null }`。
  - 复用现有 LLM 契约（`task-runtime.ts` 的调用/预算/取消；BYOK 与共享池同现有链路）。
  - **非流式优先**：galgame 逐句浮现用前端打字机效果，不需要流式；v2 若需要再切流式。
- 选项与自由输入并存：点选项 = 发送选项文本作为用户发言；自由输入直接发送。
- 结局判定：LLM 按场景 success/failure 口径给出 terminal 标记；失败/拒绝/修复路径保留。

### 4.3 视觉（AI 立绘管线）

- **构建期管线**（`desktop` 与 web 共用一套脚本，或独立 `scripts/gen-portraits.mjs`）：
  1. 输入：场景角色清单（id/name/personality/hue）+ 表情清单（neutral/smile/tight/teary）。
  2. 生成：对每个角色 × 表情，用 ComfyUI（`danbooru-tags` 校验锚点 + `comfyui-manager` 执行工作流）出图：半身立绘、透明/纯色背景、统一画风。
  3. 输出：`app/public/love-portraits/<roleId>-<emotion>.png` + `portraits-manifest.json`（记录模型 + prompt + seed + 日期 → **source 可溯源**）。
  4. 运行时：前端只加载 manifest 指向的 PNG，**零运行时图像服务**。
- **v1 不引入运行时 AI 出图**（Vercel 无 GPU）；所有立绘是构建产物，与 `sw.js` 缓存策略兼容。
- 画风统一：同一基础模型 + 同一提示模板（角色描述差分 + 表情差分）；`hue` 用作角色主色的参考写入 prompt。

### 4.4 动画与交互

- Framer Motion（项目已有）：台词浮现、立绘表情切换、选项高亮、场景转场。
- 进度：线内进度设备端 `localStorage`（`{ seriesId, sceneIndex, lastResult }`），重玩清空重记。

## 五、验收标准

### 5.1 结构（新增/改动后必跑）

- `pnpm lint` / `tsc` / `check-corpus` / `build` 全绿。
- 新增文件 ≤ 900 行/函数 ≤ 50 行，遵守现有组件分层。
- 所有新增文案进 `L(zh, en)` 双语对象。

### 5.2 剧情质量（沿用项目红线，**不是**只测标准答案）

每条剧情线实测验收**必须包含**：让步（NPC 偶尔松口）、拒绝（明确说不且不讨好）、反问（NPC 质疑用户）、玩笑（情绪调节不硬转弯）、修复（失误后留修复路径）、续聊（自然延续）。选项至少一条路径通往失败/拒绝，且失败后仍有退路——**杜绝固定回合换题、编造紧急事件、重复施压**。AI 动态生成剧情按此口径抽查 2-3 条线。

### 5.3 隐藏动机（沿用 deep 口径）

- `hidden` 只对具体问题揭示（"你是不是已经先答应了你妈什么"），不提前吐露。
- 界面不显示"隐藏动机"标签；用户问对问题才在台词里自然浮出。LLM 提示中把 hidden 作为"仅当满足揭示条件才可提及"的私有字段。

### 5.4 双红线与统计口径

1. **NPC 不讨好用户**：游戏模式选项绝不出现"无脑加好感"的设计；阻力是护城河。验收：NPC 拒绝、质疑、保留都在。
2. **语料必须有 source**：场景沿用现有 `source`；AI 立绘 manifest 记录生成参数；AI 生成的**台词与选项**以场景 source 为出处（剧情线只重组/消费现有场景的 cast 与约束，**不新增**无出处的角色或剧情事实）。
3. **不引入账号/服务端存储**：线内进度设备端，可导出。
4. **计入统计但不伪造评估**：游戏模式完成场景 = 一次练习 session 记录——**计入 practiceDays / 场景完成数 / 分钟数**；loveProficiency 按场景 topic 增益（与教练模式共用同一 gate）。**不自动触发证据式 assess**：点选项不等于用户真实表达，因此游戏模式的星星/能力归因默认不产生；用户若想复盘，走教练模式或显式入口。这样"进统计"与"不伪造能力评估"自洽。
5. **不污染教练主链**：`/practice/[id]` 教练入口保持原样，游戏模式独立路由。

## 六、实施步骤

### P1：AI 剧情引擎 + 单场景试玩（先验证手感）

- [ ] `POST /api/love-play`：LLM 每回合生成台词+选项+情绪+结局判定（复用 task-runtime 契约）
- [ ] `/love/play/[scenarioId]` 单场景 Galgame 界面（背景/立绘/台词/选项/自由输入）
- [ ] 完成写入练习统计（session 记录 + loveProficiency 增益，不触发 assess）
- [ ] 验收：5.2 剧情质量抽查 1 条 deep 场景；`pnpm check` 全绿

### P2：AI 立绘管线 + 剧情线

- [ ] ComfyUI 立绘生成脚本：角色 × 表情 → `public/love-portraits/` + manifest（source 可溯源）
- [ ] 首批 1-2 条基础 series（3-4 场景，`series` 字段落地 + 跨场景承接）
- [ ] `/love/play/[seriesId]` 线式入口 + 设备端线内进度
- [ ] 验收：完整跑通一条线（含拒绝/失败/修复路径）；立绘管线产出对齐 manifest

### P3：增强（可选，单独评审）

- [ ] 流式台词（打字机实时）
- [ ] 隐藏动机揭示动画
- [ ] 好感/信任度条（只读展示）
- [ ] 更多剧情线与 AI 生成剧情的深度调优

## 七、工作量预估

| 项 | 预估 |
|---|---|
| P1 AI 剧情引擎 + 单场景界面 | 2-3 天 |
| P1 验收修整 | 1 天 |
| P2 ComfyUI 立绘管线 | 1-2 天 |
| P2 series 编排 + 进度 + 验收 | 1-2 天 |
| **合计（P1+P2）** | **5-8 天** |

## 八、决策记录（用户已拍板 2026-10-10）

1. **游戏模式计入练习统计**：practiceDays / 完成数 / 分钟数进入现有统计；能力评估不自动触发（口径见 5.4）。
2. **立绘 AI 生成**：构建期 ComfyUI 批量出图进 `public/`，manifest 记录 source；不引入运行时图像服务。
3. **剧情 AI 动态生成**：场景只定 cast/约束，台词与选项 LLM 实时生成（`/api/love-play`）；首批做基础剧情线（approach/define）。

## 九、实施记录（2026-10-10）

**P1-P3 全部按拍板方案实施完毕，一次性提交（`approve` 后 commit）**，验证 `pnpm check` 254 项全绿。

- **P1 剧情引擎**：`POST /api/love-play`（`lib/tasks/love-play.ts` + `app/api/love-play/route.ts`）。复用 roleplay 的 `taskLLM`/`roleplaySystem`/`roleplaySpeechGuard`/`hasQuote` 守卫与一次有界修复；输出 `{ line: L, options: L[2-4], emotion, stance, revealed, terminal, ended }`。**预算键暂用 `"roleplay"`**（`TASK_LIMITS` 无 love-play 键；独立预算需另改 task-runtime，记 backlog）。
- **P1 界面**：`/love/play/[scenarioId]`（`components/love/PlayScene.tsx` 等 4 文件 + `lib/love-play-client.ts`）。Galgame 布局（背景/立绘/打字台词/选项/自由输入）；开场本地展示后进历史；收束界面「记入统计」。`store.completeLovePlay()` 写 sessions（`origin:"love-play"`、`status:"ended"`、无 report）+ practiceDays + loveProficiency（success +0.3 / partial +0.15 / failure +0.05，clamp 1-5）。
- **P2 立绘管线**：`scripts/gen-love-portraits.mjs`。千问 IMAGE 2.1 **Turbo 官方 8 步**（`qwen_image_2.1_turbo_bf16` + `CLIPLoader(qwen3vl_8b_int8_convrot, type=qwen_image)` + `ManualSigmas` + `SamplerCustom(cfg=1)`）；**透明底由模型原生生成**（2.1 VAE 是 Wan2.2 布局的 RGBA VAE，不抠图）；neutral 走文生图 + `EmptyLatentImage(832×1248)`，其余 3 表情以 neutral 的 **RGBA 原图**（不叠白）作参考走编辑路径，采样 latent 取 `TextEncodeQwenImage21` 的第 3 输出。**两级产物**：832×1248 原图写 `app/.portrait-masters/`（gitignore，作参考图与重打包源），512×768 交付图写 `public/love-portraits/`（入库，约 390KB/张；UI 里 `AvatarStand` 默认 216 CSS px，512 已覆盖 2.3×DPR）——`--pack-only` 可只重打包不重出图。`manifest.json` 溯源（prompt/seed/模型）。落图前有内容级体检（`edgeEnergy` / 透明占比 / 主体占比 / 半透明蒙版），不合格换种子重试。→ 根因与验收口径见 [立绘管线复盘](../81-postmortem-love-portrait-pipeline.md)，节点与模型细节见 [ComfyUI + Qwen 2.1 出图参考](../refs/comfyui-qwen-image-21.md)。
- **P2 剧情线**：`series` 字段落地（`love-approach-hobby-event` / `love-approach-date-followup` / `love-define-vague-investment` → `love-arc-approach`，Tess/Mae/Zoe）；`lib/love-series.ts` 聚合；`/love/play/series/[seriesId]` 静态段路由（避免与 `[scenarioId]` 竞态）+ `lib/love-series-progress.ts`（localStorage 设备端进度）。
- **P3 增强**：`lib/love-play-typing.ts`（中文逐字/英文逐词、句末停顿、skip、尊重 reduced-motion）；hidden 揭示徽标 + 立绘 emphasize + 背景提亮（`revealed` 触发、自动淡出）；`LoveStanceBar`（stance 0-100 三档 `--clay/--teal/--rose`，role="meter"，首回合隐藏）。
- **实测**：dev 三路由（love / play/series / play/[id]）200；`/api/love-play` 真实场景 payload → 无 key 优雅 `503 {"modelIssue":"setup"}`（契约与守卫验证通过）。
- **遗留**：~~全量 50 角色出图~~ 已完成（2026-10-10 修复管线后全量重出：50 角色 × 4 表情 = 200 张，全部通过内容体检，manifest 记录 prompt/seed/模型；入库交付图 512×768 共 76MB，832×1248 原图不入库）。首批 113 张噪点的根因、修复与验收口径见 [立绘管线复盘](../81-postmortem-love-portrait-pipeline.md)。**未做**：立绘透明边缘叠在应用场景渐变上的合成效果人眼验收——本次 in-app Browser 表面不可用（`visibilityState=hidden`），截图与 DOM 都取不到有效结果，这一条需要人工过一遍。
- **审查**（2026-10-10，验证子代理）：修复 archive origin 枚举缺 `love-play` 导致的存档整体解析失败 + 回归测试；清理 2 个未用 i18n key；love-play 独立任务预算（`TASK_LIMITS['love-play']=[55s,2]`）；reveal 徽标首回合防御（挂 opening key）。全仓 `pnpm check` 254 项绿。
