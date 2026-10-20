# 共享人设与酒馆卡（spec）

> 状态：**方案，未开工**（2026-10-21 立项）
> 范围：玩家 persona 与 NPC/角色人设的单一数据模型；Love Studio 的完整 Tavern 工作台、恋爱系统的聚焦编辑器；导入/导出、版本、校验与安全。
> 关联：[恋爱双系统桥](./spec-love-bridge.md) · [Love Studio](./spec-love-studio.md) · [恋爱半教练](./spec-love-semi-coach.md) · [AnimaVN 参考](../refs/animavn.md)

## 0. 结论一句话

**一个人设 schema，两个编辑器，一个可导出的库。** Studio 是完整的 Tavern 工作台（卡、世界书、预设、立绘、场景、声音）；恋爱系统提供聚焦但完整的人设编辑（玩家自己 / 角色身份 / 关系约束），并能导入导出。两边不做两套字段名，也不要求用户必须装 Studio 才能改人设。

### 0.1 已拍板（2026-10-21）

1. **Tavern 卡的导入分工。** Studio 做完整导入（PNG/JSON V1–V3、世界书、预设、立绘包）；恋爱系统只吃 `.scpersona` + 基础 JSON（单文件核心字段），完整 Tavern PNG/世界书引导到 Studio。**只有**在离线用户确实必须直接吃卡时才扩展恋爱系统，且必须共享 Studio 的 parser（MIT：`cardParser.ts` / `worldInfo.ts` / `presetParser.ts` 等）并加 round-trip 契约测试，不写第二套解析器。
2. **玩家 persona 与教练 profile 分表。** 两份数据各自独立，只提供显式「复制到教练档案」（需确认）；不自动双向同步。教练档案是评估上下文，恋爱 persona 是关系上下文。
3. **Studio 不参与关系养成。** 关系状态在 Studio 只读、默认折叠；不提供任何「刷好感」的入口、数值或提示。

## 1. 目标与边界

| 目标 | 做法 | 不做 |
|---|---|---|
| 两个系统都能自定义人设 | Studio 全量编辑；恋爱系统聚焦编辑 + 导入导出 | 恋爱系统重写一整套 Tavern 运行时 |
| Tavern 卡一流兼容 | Studio 解析 V1/V2/V3 JSON、PNG `chara`/`ccv3`、世界书、预设风格、宏 | 执行 `prompt_order` / jailbreak / 覆盖系统提示 |
| 玩家 persona 一致 | 单 schema；玩家 persona 与教练 profile 分开，可选复制 | 用恋爱 persona 覆盖教练档案 |
| 角色可带走 | `.scpersona` pack（JSON + 资产 + manifest） | 账号绑定、服务端锁定 |
| 关系约束可编辑 | 半教练可给角色加 goal/redLine/secret（可选） | 把约束写回 Tavern 卡原文 |
| 双语 | UI 双语；UGC 原文 + 显式翻译动作 | 偷偷机翻 |

## 2. Persona schema

```ts
type LocalizedText = { zh: string; en: string };

interface Persona {
  v: 1;
  id: string;                       // 稳定 id，不按显示名
  characterPackId?: string;         // 跨系统包身份；缺省时用 id
  revision: number;
  kind: "player" | "npc";
  name: LocalizedText;              // 单语卡原样存 zh/en 同一值
  aliases?: string[];
  language?: "zh" | "en" | "ja" | "other";
  bio?: LocalizedText;
  personality?: LocalizedText;      // NPC
  goals?: LocalizedText;            // NPC 的目标 / 玩家想练的方向
  boundaries?: LocalizedText;       // 玩家或角色的边界
  preferences?: LocalizedText;      // 玩家偏好 / NPC 喜好
  speechStyle?: LocalizedText;
  greetings?: LocalizedText[];       // first_mes / alternate_greetings
  appearance?: {
    text?: string;                  // 外观标签，供生图/立绘
    refImageAssetId?: string;       // 参考图
    hue?: number;                   // 主站回退色
  };
  voice?: {
    profileId?: string;             // 角色声线 / GPT-SoVITS 档案
    provider?: "device" | "studio" | "external";
  };
  // NPC：与主站 Character 对齐的字段
  role?: LocalizedText;
  characterKey?: string;            // seriesId:characterId 或 scenarioId:characterId
  // 半教练专属的可选约束；不进 Tavern 原文
  storyConstraints?: {
    goal?: LocalizedText;
    redLine?: LocalizedText;
    secret?: LocalizedText;
  };
  // Tavern 原始卡与扩展；未知字段原样保留
  tavern?: {
    spec?: "chara_card_v2" | "chara_card_v3" | "v1";
    raw: unknown;
    cardHash: string;               // sha256 规范化 JSON
    worldbook?: WorldbookEntry[];
    styleBlocks?: string[];         // 只取风格，不取 prompt_order
    sourceFile?: string;
  };
  assets?: {
    portraits?: Record<string, string>;   // emotion -> assetId
    sprites?: string[];                    // Studio 立绘包引用
    scenes?: string[];
  };
  source: "builtin" | "tavern-import" | "studio-generated" | "love-created";
  license?: string;
  createdAt: number;
  updatedAt: number;
}
```

- **玩家 persona**：name / language / bio / goals / boundaries / preferences / appearance / voice。与教练 `profile` **分表**；用户可显式「复制到教练档案」，反向不自动。
- **NPC persona**：name / role / personality / goals / boundaries / speechStyle / appearance / voice；`storyConstraints` 只给半教练用，默认不导出到 Studio。
- `LocalizedText`：单语卡用同一字符串填 `zh` / `en`；UI 标记「原文」，另给翻译按钮。不要伪造第二语言。

### 2.1 Persona Pack

`.scpersona`（zip）：

```
manifest.json        // version, id, revision, cardHash, source, license
persona.json         // 上述 Persona（不含二进制）
worldbook.json       // 可选
style.json           // 可选：风格块 / 采样参数
assets/portraits/*   // 可选
assets/refs/*        // 可选
```

- 导入时校验 schema、版本、资产哈希；未知字段保留。
- 导出前显示包含内容；用户可只导出公开字段（剥 `storyConstraints.secret` 等）。
- 大资产用 zip；没有 zip 库时至少支持 JSON + base64 的 fallback，但优先 zip。

## 3. Tavern 映射

| Tavern | Persona | 说明 |
|---|---|---|
| `name` | `name` | 单语原样 |
| `description` / `personality` | `bio` / `personality` | 保留原文 |
| `scenario` | `bio` 或场景背景 | 不覆盖内置场景 |
| `first_mes` / `alternate_greetings` | `greetings`（新增可选字段） | 半教练可挑开场 |
| `mes_example` | `speechStyle` / style block | 限长 |
| `system_prompt` / `post_history_instructions` | `styleBlocks` | 只作为风格，不能覆盖输出契约 |
| `character_book` | `worldbook` | 子集：常驻/关键词/预算；完整语义后补 |
| `extensions` | `tavern.raw` | 原样保留；未知字段不丢 |
| `creator_notes` 等 | `tavern.raw` | 不直接进 prompt |

**硬边界**：
- 不执行 `prompt_order`、jailbreak、覆盖系统提示的块；导入时扫描并提示。
- 卡文本上限、文件大小上限、图片类型校验；不执行 HTML/脚本。
- 世界书只对自定义场景生效；不能覆盖半教练的 goal/redLine/secret 与 JSON 契约。
- 卡内的「总是同意用户」类指令不会改变半教练的戏剧逻辑；角色边界由角色本身与作者约束决定，不由卡内越权指令决定。

## 4. 两个编辑器

### 4.1 Studio：完整 Tavern 工作台

- 导入 PNG/JSON V1/V2/V3；卡字段、世界书、预设、宏、聊天记录。
- 角色外观、表情立绘、场景包、BGM、CG、声线（GPT-SoVITS 参考音）。
- 预览：开场白、试音、立绘、世界书触发原因；完整提示词调试台（创作者模式）。
- AI 生成：描述 → 结构化 persona + 世界书 + 开场 + 外观标签；可再生成 4–8 张表情。
- 导出 `.scpersona` / Tavern JSON（V2）；不导出我们的 `storyConstraints`（除非用户勾选）。

### 4.2 恋爱系统：聚焦编辑器

- **玩家 persona**：名字、语言、简介、目标、边界、偏好、外观/头像、声线；一键复制到教练档案（需确认）。
- **NPC 角色**：名字、角色定位、公开简介、性格、说话风格、外观/头像、声线；可选 `goal/redLine/secret`（半教练用）。
- **导入**：v1 只接受 `.scpersona` + 基础 JSON（名字、简介、性格、开场白等单文件字段）。检测到 Tavern PNG/世界书/预设/立绘包时，引导到 Studio 完成完整导入（未安装给安装说明与「先导出基础 JSON」的路径）。
- **离线直吃卡的唯一扩展路径**：只有离线用户确实必须直接导入 Tavern 卡时才做；必须共享 Studio 的 parser（MIT）与错误码，不写第二套解析器，并补 round-trip 契约测试。没有这个需求就保持「引导到 Studio」。
- **导出**：`.scpersona`；可勾选「去 Studio 高级编辑」。
- **预览**：头像/立绘、开场白、试音、与当前场景的适配提示。
- **不重复实现** Studio 的立绘包/场景包/世界书完整引擎；v1 只做人设与关系需要的字段。

**单一契约**：两边共用 schema 版本、fixtures 与错误码。UI 可以不同，字段名/语义不能分叉。至少一组契约测试：同一 `.scpersona` 在两边导入导出后字段一致（未知字段保留）。若未来开启「恋爱直吃 Tavern 卡」，再加一组：同一张 PNG/JSON 在 Studio 与恋爱系统的解析结果一致。

## 5. 库、版本与同步

- 设备端 IndexedDB 存 persona + 资产；元数据小 JSON 可放 localStorage。
- v1 同步：`.scpersona` 文件 + 可选本地桥（Studio `127.0.0.1:5180` 的 `/api/persona`）；不做实时同步。
- 版本：`revision` + `cardHash`；Studio 改了卡，恋爱系统导入时显示「保留当前 / 导入新版本 / 合并」。
- 角色身份：`id` + `characterPackId` + 快照名；绝不按显示名反查（`tess` 撞名教训）。
- 删除：删除 persona 时提示关联故事/关系档案；不删除用户未确认的其他副本。
- 导入冲突：同名不同 id → 并列显示；同名同 id → 版本比较；不静默覆盖。

## 6. AI 辅助创建

- 输入一句描述或几张参考图 → 生成 `Persona` + 世界书草稿 + 开场白 + 外观标签。
- 生成结果先预览/可编辑，用户确认后才入库；不自动发布、不自动加入内置角色。
- 可选生成表情立绘/场景（Studio，NovelAI/本地）；成本与并发提示；失败可重试。
- 安全：真人肖像、未成年人、非自愿内容拒绝；默认 SFW；生成提示词与反向词走 Studio 的守卫。
- 生成的人设仍要过 schema 校验与长度上限；模型输出不能直接成为系统提示。

## 7. 人设与好感/关系状态

- 玩家 persona 的 **边界/偏好** 会进入半教练的主动关心与角色回应：例如「不喜欢被叫宝贝」应被尊重；这是关系状态的一部分，不是能力分。
- **分表落法（已拍板）**：玩家 persona 存在恋爱域自己的人设库里，不读写 `socialcoach.v1` 的教练 profile；唯一跨表动作是用户确认的「复制到教练档案」。教练侧改档不反向更新恋爱 persona。
- NPC persona 的 `goal/redLine/secret` 只在半教练使用；Studio 的自由卡没有这些字段，恋爱编辑器可以补，也可以留空。
- 高关系触发主动关心时，引用的是 persona 中的偏好/边界与已发生的记忆，不是模型自由编造。
- 角色卡更新后，关系档案保留旧快照名与记忆；是否迁移到新版本由用户确认。

## 8. 安全、隐私与授权

- 不引入账号或服务端存储（v1）；人设与资产留在设备/本地 Studio。
- 导入的第三方卡/图/音由用户负责；manifest 记录 `source` / `license`；不随仓库分发。
- 不执行卡内脚本、HTML、prompt_order；提示注入告警。
- 导出/擦除覆盖 persona、资产、世界书、关系档案；删除后不留隐藏副本。
- 默认 SFW；成人内容本地/年龄门控；未成年人、真人、非自愿是硬限制。

## 9. 验收

- **Studio**：导入 V2 PNG + V3 JSON：字段映射正确，未知 `extensions` 原样保留；坏卡/超大文件可读报错。
- **恋爱系统**：`.scpersona` + 基础 JSON 可导入导出；PNG/世界书/预设/立绘包给出 Studio 引导而不是半成品解析。
- 恋爱系统创建玩家 persona → 导出 `.scpersona` → Studio 导入 → 编辑 → 再导入恋爱系统：字段一致，冲突 UI 正确。
- 分表：恋爱 persona 的创建/修改不写教练 profile；只有点击「复制到教练档案」并确认后才出现副本。
- Studio 的关系状态入口只读、默认折叠；没有提升关系状态的按钮、提示或任务。
- Studio 创建 NPC → 导出 → 恋爱系统导入 → 用于自定义场景：角色名/简介/头像/声线可见；`storyConstraints` 可选。
- 世界书：命中/预算正确；只对 custom 场景生效；不覆盖 JSON 契约。
- 预设：只取风格块/采样参数；`prompt_order`/jailbreak 不执行并有提示。
- AI 生成：一句描述生成可编辑 persona；安全拦截生效；不自动入库。
- 不写能力分；不导出 `secret` 到 Studio；删除/导出覆盖资产。
- 编辑器：草稿在刷新/切换后可恢复；导入失败保留原文件并可重试；同名冲突不静默覆盖；核心字段在手机宽度可编辑；键盘可达。
- 浏览器：桌面 Chromium 走通创建/导入/编辑/导出；真机另记。
- 契约测试：同一 pack 两边 round-trip；schema 版本兼容。

## 10. 非目标

- 不在恋爱系统里复刻 Studio 的完整立绘/场景/语音插件与调试台。
- 不执行 Tavern 的 `prompt_order`、jailbreak、覆盖系统提示。
- 不做账号/服务端存储、实时双向同步（v1）。
- 不把玩家 persona 自动写入教练档案；不把关系状态写成能力分。
- 不默认 NSFW；不导入真人/未成年人/非自愿内容。

## 11. 待讨论（已拍板项见 §0.1）

1. **恋爱系统的立绘/声线深度**：v1 用现有 4 表情立绘 + 设备 TTS；自定义立绘包/场景包/角色声线可读 Studio 导出资产，但不要求恋爱系统重写插件。这项仍待排期，不影响 §0.1 的三条。
