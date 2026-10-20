# 恋爱双系统桥：关系档案与局外成长（spec）

> 状态：**方案，未开工**（2026-10-21 立项）
> 范围：Love Studio（Galgame）与恋爱半教练之间的双向交接、关系档案、局外成长与人设包交换。
> 关联：[恋爱半教练](./spec-love-semi-coach.md) · [Love Studio](./spec-love-studio.md) · [共享人设](./spec-love-persona.md) · [Stage F](../14-stage-f.md)

## 0. 结论一句话

**一套关系档案，两个视图。** Studio 拥有「故事事实」，半教练拥有「关系状态」；两边通过 Story Pack / Persona Pack 显式交接，用户确认后才写入。v1 不做实时同步，不把 Galgame 的表现自动换成能力分，也不让两边各存一份互相看不见的关系。

### 0.1 已拍板（2026-10-21）

1. **Studio 里的关系状态只读、默认折叠。** 不提供提升关系状态的操作、任务或提示；避免 Studio 内出现「刷好感」。
2. **局外成长用叙事阶段，不用等级。** 可见成长 = 叙事阶段（陌生 / 认识 / 熟络 / 亲近）+ 关系图鉴 + 故事收藏；不做战力、EXP、签到、streak、付费加成。若未来确实要展示等级，只允许做**只读派生**，不能兑换奖励、加成或解锁条件。

## 1. 用户旅程

```
/love
├─ 「先玩一局」→ Love Studio
│     ├─ 生成/导入角色，玩完一段故事
│     └─ 「把这段关系带回半教练」→ 导入故事包
│           → 关系档案（人物 / 关键选择 / 结局 / 记忆）
│           → 可选：一条 afterstory 自定义场景
│           → 半教练继续（关系状态 / 主动关心 / 可选回顾）
│           → 「去 Studio 续写」→ 导出关系包 → Studio 继续或 what-if
└─ 「继续关系」→ 半教练（内置 66 场 + 自定义）
```

**初始实践在 Studio，成长闭环在半教练。** 桥不是「导入一个存档」；它要把人物、故事事实、关系状态和记忆都带过去，并且允许带回来。

## 2. 设计原则

1. **事实与关系分权。** Studio 写「发生了什么」（场景、选择、结局、台词）；半教练写「关系现在怎样」（熟悉/信任/心动、主动关心、承诺回访）。两边都不静默改写对方的权威字段。
2. **显式交接。** 每次导入/导出都由用户触发；预览「会写入什么、会跳过什么」；没有后台同步。
3. **不把游戏表现换成分数。** Studio 的选项点击、通关、CG 收集不写 `proficiency`、`loveProficiency`、`stars`、`assess`。半教练的关系状态只由故事节点与用户确认的映射推进。
4. **剧透边界。** 从半教练导出到 Studio 的角色包必须剥掉 `hidden` / `secret` / `success` / `failure` / 结局谓词；从 Studio 导入半教练时，用户可以选择「完整回忆 / 仅公开摘要」。
5. **追加而非覆盖。** 记忆与关键事件是 append-only；同一角色出现分歧时保留分支，不静默覆盖。
6. **局外成长不是战力。** 可见成长 = 叙事阶段、关系图鉴、故事收藏、记忆与玩家自己的人设变化；没有 EXP、战力、签到、streak、付费加成。等级即使以后出现，也只能是只读派生，不能兑换任何东西。
7. **v1 本地优先。** 文件包 + 可选本地桥；不引入账号或服务端存储。托管版是 F4，单独决策。

## 3. 关系档案（LoveArchive）

一份档案对应「一个玩家 persona × 一个角色」。v1 存在设备端（IndexedDB / story slot 的扩展）；不新开服务端。

```ts
interface LoveArchive {
  v: 1;
  revision: number;
  playerPersonaId: string;
  characters: Record<string, CharacterArchive>; // key = `${characterPackId}:${branchId}`；默认 branchId = "main"
  stories: StoryRecord[];
  unlocks: {
    endings: string[];
    characters: string[];
    scenes: string[];
    cgs: string[];
  };
  updatedAt: number;
}

interface CharacterArchive {
  characterPackId: string;
  branchId: string;             // "main" | "what-if-..."；不同分支不共享关系状态
  personaSnapshot: {
    name: L;
    bio?: L;
    appearance?: string;
    voiceProfileId?: string;
    cardHash?: string;          // Tavern 卡内容哈希，用于检测上游改动
    source: "builtin" | "studio" | "love-custom";
  };
  relationship: LoveRelationshipState; // 熟悉/信任/心动；见半教练 spec
  /** 只存引用与摘要，正文在 story/memory 记录里 */
  memoryIds: string[];
  activeStoryId?: string;
}

interface StoryRecord {
  id: string;
  origin: "studio" | "love";
  title: L;
  summary: L;                  // 用户可见；不自动包含 hidden/secret
  keyChoices: {
    at: number;
    choice: L;                 // 用户实际选择或说出的那句
    consequence?: L;           // 作者/桥接规则给出的后果摘要
    quote?: L;                 // 仅自由输入可存逐字原话
  }[];
  endingId?: string;
  characterPackIds: string[];
  parentStoryId?: string;      // 续写/分支来源
  branchId?: string;           // 默认 "main"；what-if 用独立分支
  branchOf?: string;
  canonical: boolean;          // 哪个分支是当前主线；用户可改
  packRef?: string;            // .sclove / 本地桥引用
  createdAt: number;
}

interface StoryPack {
  v: 1;
  manifest: {
    id: string;
    origin: "studio" | "love";
    createdAt: number;
    source: string;            // 作者 / 模型 / 用户
    license?: string;
    characterPackId?: string;
  };
  story: StoryRecord;
  persona?: unknown;           // Persona 快照；结构见 spec-love-persona.md
  assets?: Record<string, string>; // 可选 CG / 立绘引用
}
```

**记忆事件**沿用现有记忆层：导入 Studio 事实时追加 `sourceStoryId`，不覆盖半教练已有的承诺/边界。两条线各自的记忆都带 `source`，用户可删。

## 4. 权威矩阵

| 数据 | Studio | 半教练 | 用户 |
|---|---|---|---|
| 故事事实（场景/关键选择/结局/台词） | **写** | 只读，可引用 | 导入/导出、选择是否保留分支 |
| 关系状态（熟悉/信任/心动） | 只读、默认折叠 | **写** | 确认导入、重置、删除 |
| 记忆/承诺/边界 | 写自己来源的事件 | 写自己来源的事件；可引用 Studio 记忆 | 查看/删除/锁定 |
| 人设 / 角色卡 | 全量编辑（Tavern） | 聚焦编辑 + 导入导出 | 确认合并、选择版本 |
| 解锁（结局/角色/场景/CG） | 追加自己来源 | 追加自己来源 | 查看、导出 |
| 能力分 / 熟练度 / stars | **不写** | 不写（除非用户显式进入教练复盘） | 显式选择才进入教练链路 |
| 剧透字段（hidden/secret/结局谓词） | 写 | **不导入**（除非用户已解锁） | 解锁后才可见 |

## 5. 双向交接

### 5.1 Studio → 半教练

1. Studio 结束页生成 **Story Pack**：`manifest.json` + `story.json` + `persona.json` + 可选资产。
2. 半教练导入预览：故事摘要、关键选择、结局、会新增的记忆、会初始化的关系状态；用户选择「完整回忆 / 仅公开摘要」。
3. 用户确认后写入 `StoryRecord`、`characterArchive`、`memoryIds`；可选生成一条 **afterstory** 自定义场景（续写而不是重写）。
4. 关系状态的初始化走**作者/桥接规则表**，不走模型自由发挥：
   - 共同经历完成 → 熟悉 +1（每段故事最多 1 次）；
   - 承诺兑现 / 边界被尊重 → 信任 +1；
   - 明确的心动节点 / 互认 → 心动 +1；
   - 冲突未修复 → 不加，写入待修复记忆。
   映射表在导入预览里逐条展示，用户可取消。
5. 不写能力分；不触发 `assess`。

### 5.2 半教练 → Studio

1. 半教练导出 **Persona Pack + Story Pack**（公开字段）：角色名、公开人设、已解锁记忆、关系摘要、关键选择；**剥掉** `hidden` / `secret` / 成功失败条件 / 结局谓词 / route ledger。
2. Studio 导入为角色/故事上下文；可以继续写、可以 what-if，不覆盖原故事。
3. Studio 写回的包必须带 `parentStoryId` 或 `branchOf`；半教练导入时保留分支，不静默替换主线。

### 5.3 往返与冲突

- 每次导入/导出递增 `revision`；同一条记录两边都改过时，显示「保留 Studio 主线 / 保留半教练续写 / 两份都保留」。
- 角色身份用 `characterPackId` + `branchId` + 快照名，不用显示名反查；`tess` 撞 id 的教训继续适用。what-if 分支使用 `${characterPackId}:${branchId}`，默认主线是 `:main`，关系状态不跨分支混用。
- 删除角色/故事时提示「同时删除关联档案 / 保留为孤立档案」；没有隐藏副本。
- 同人不同分支：`canonical` 只标当前主线，其他分支仍可查看/导出，不删除。

### 5.4 回归开场

半教练的回归开场可以引用最近一段 Studio 故事（「上次你们在……结束」），但：
- 内置角色优先用已写好的台词库（零模型调用）；
- 自定义角色可以走模型，但引用必须带 `sourceStoryId`；
- 不引用用户没选「完整回忆」的剧透内容。

## 6. 局外成长（Meta-progression）

### 6.0 可见的成长表面（已拍板）

| 表面 | 内容 | 来源 | 不是什么 |
|---|---|---|---|
| **叙事阶段** | 陌生 / 认识 / 熟络 / 亲近 | 由三维关系状态保守派生（见下），不新增可刷数值 | 不是经验条、战力或排行榜 |
| **关系图鉴** | 已遇到的角色、已到达的阶段、已解锁结局、已见证的关键节点 | `LoveArchive.characters` + `unlocks` | 不做抽卡、不做数值加成 |
| **故事收藏** | Studio 故事、半教练 afterstory、what-if 分支 | `StoryRecord[]`，按角色分组 | 不是通关率 KPI |

**阶段派生**：`stage = min(familiarity, trust)`，心动只作为图鉴里的细节，不单独抬阶段——避免靠刷心动跳过信任。阶段是**只读派生**，不单独持久化；推进仍只由故事节点与用户确认的映射决定，不由点击次数、在线时长或重复刷同一场景决定。映射公式以 [半教练 spec §3.2](./spec-love-semi-coach.md) 为准，变更需版本化并保证旧档案可读。

**关系图鉴**只展示已遇到的内容；未解锁角色/结局显示为未知槽，不剧透。**故事收藏**按角色与 `canonical` 展示，分支可查看/导出，不删除用户故事。三者都不提供 EXP、战力、等级、签到、每日任务或付费加成；如果未来展示等级，只能是只读派生，不能兑换奖励、加成或解锁条件。

### 6.1 体验携带清单

| Galgame 里发生的事 | 带到半教练的形态 | 不带走 |
|---|---|---|
| 剧情/场景 | `StoryRecord` + 摘要 + afterstory 种子 | 未解锁的 `hidden` / `secret` |
| 关键选择 | `keyChoices` + 记忆事件；自由输入才存逐字 quote | 选项点击不算能力证据 |
| 关系张力 | 熟悉 / 信任 / 心动的关系状态种子（用户确认） | 不换算成好感点/战力 |
| 角色 | Persona 快照 + 立绘/声线引用 | 不执行卡内 prompt_order/jailbreak |
| 结局 / CG / 场景 | `unlocks` 收藏与图鉴 | 不做数值加成 |
| 玩家的发现 | 偏好/边界可写回玩家 persona | 不自动改教练档案/能力分 |

| 成长维度 | 具体内容 | 不做什么 |
|---|---|---|
| **叙事阶段（关系深度）** | 熟悉/信任/心动跨故事累积；派生「陌生/认识/熟络/亲近」；达到「熟络/亲近」解锁主动关心、afterstory 场景 | 不做签到、streak、每日任务、掉好感；阶段不是可刷等级 |
| **记忆** | 承诺、边界、关键原话、Studio 关键选择；可查看/锁定/删除 | 不把选项点击当技能证据 |
| **关系图鉴 + 故事收藏** | 结局、角色、场景、CG、BGM；故事与分支 | 不做战力/数值加成、不做抽卡 |
| **玩家成长** | 玩家自己的 persona 目标、边界、偏好可以更新；半教练主动关心会参考 | 不把 persona 变化自动换算成能力分 |
| **故事分支** | Studio 主线 / 半教练 afterstory / what-if 分支共存 | 不静默覆盖、不删除用户分支 |

**判据**：如果用户玩完 Studio 不愿意点「带回半教练」，先修桥的入口和预览，不加更多局外成长。局外成长不是用奖励堆出来的留存。

### 6.2 具体例子

1. **Studio → 半教练**：Studio 完成「雨夜告白」，`keyChoices` 里有「先问她想要什么」和「答应下周给答复」。导入时用户确认：熟悉 +1、信任 +1（答应给答复且兑现）、心动 +1（互认节点）；生成 afterstory「第二天早上」。半教练的主动关心引用「她记得你答应过下周给答复」，不凭空编。
2. **半教练 → Studio**：Rio 线走到第 4 幕后导出公开角色包，Studio 里做 what-if「如果她接了外派」。Studio 写回时带 `branchOf: rio-4`；半教练导入时把 what-if 作为分支保留，不覆盖 Rio 主线；关系状态单独建一个 `CharacterArchive` 分支，不混进主线数值。
3. **收藏与成长**：Studio 解锁的结局/CG、半教练解锁的 afterstory/结局图鉴进入同一「关系档案」；用户可以看到「这段关系经历过什么」，但没有 EXP、战力或可刷好感。玩家 persona 可以把 Studio 里发现的偏好/边界写回自己，半教练的主动关心会参考，但不写能力分。

## 7. 数据、隐私与安全

- v1 全部设备端：关系档案在浏览器 IndexedDB / story slot 扩展；Studio 的故事/角色在本地 SQLite；交接用 `.sclove` / `.scpersona` 文件或本地桥。
- 本地桥只允许主站 origin（CORS allowlist）；不传密钥；健康检查失败时退回文件导入。
- 导出包含用户生成文本与图片；导出前显示「包含哪些内容」；删除时清档案与缓存。
- 不引入账号或服务端存储；托管版（F4）另立隐私/隔离方案。
- 内容分级：Studio 默认 SFW；成人内容本地/年龄门控；半教练不导入成人内容到内置角色。

## 8. UX 表面

- `/love` 顶部「关系档案」卡：最近 Studio 故事、当前关系阶段、下一步（继续半教练 / 去 Studio 续写 / 导入）。
- Studio 结束页：「把这段关系带回半教练」为主按钮；次按钮「再玩一局 / 导出故事包」。
- 半教练关系档案页：角色、故事、记忆、结局/收藏、导入导出、删除。
- Studio 侧：「从 SocialCoach 导入角色/故事」「导出到 SocialCoach」；显示来源与版本。
- Studio 的关系状态面板：只读、默认折叠；没有提升关系状态的操作、任务或提示。
- 所有 UI 文案 `L={zh,en}`；UGC 单语原样显示，提供显式翻译动作。

## 9. 验收

- 往返：Studio 故事 → 半教练导入 → afterstory → 导出 → Studio 继续；角色名、公开人设、关键选择、关系状态一致；不覆盖原故事。
- 权威：Studio 不写能力分；半教练导入不写 `assess`/`stars`；测试断言跨系统零技能写入。
- 剧透：半教练导出不含 `hidden`/`secret`/结局谓词；Studio 导入不显示未解锁内容。
- 冲突：两边同时改同一故事 → 出现合并选择；选择后 `canonical` 正确；无静默覆盖。
- 删除/导出：档案、记忆、解锁、缓存一起处理；无隐藏副本。
- 局外成长：可见表面只有叙事阶段、关系图鉴、故事收藏；阶段为只读派生，重复刷同一场景不推进，代码里没有 EXP/等级/签到字段。
- Studio 关系状态：只读、默认折叠；拦截任何提升关系状态的写入口。
- 浏览器：桌面 Chromium 走通一次完整往返；真机另记。
- `pnpm check` / `pnpm build` 全绿（主站部分）。

## 10. 非目标

- 不做实时同步、账号、云存档（F4 另议）。
- 不把 Galgame 的通关/选项/CG 收集换算成能力分或好感分。
- 不让 Studio 直接写半教练的关系状态；反之亦然。
- 不导出 `hidden` / `secret` / 结局谓词给 Studio。
- 不做 EXP、战力、签到、streak、付费加成；等级即使展示也只读派生，不能兑换任何东西。
- 不重写 Studio 的故事事实；afterstory 是续写/分支，不是覆盖。

## 11. 待讨论（已拍板项见 §0.1）

1. 关系状态的初始化映射：作者逐故事配置，还是通用规则表？建议通用规则表 + 导入预览，故事可覆盖。
2. afterstory 是普通自定义场景，还是单独模式？建议普通 custom scenario + `StoryRecord` 关联，复用现有引擎。
3. 半教练是否允许导入 Studio 的成人内容？建议默认不导入内置角色，自定义角色由用户确认并做年龄门控。
