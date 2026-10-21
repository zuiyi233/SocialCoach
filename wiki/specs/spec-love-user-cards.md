# 用户卡与外部语音（2026-10-21 拍板）

> 范围：① 主站恋爱模式支持用户自己导入的 Tavern 卡；② Studio 玩家模式开放卡导入/导出；③ 语音走外部 TTS API，不在本地跑 GPU 推理。
>
> 关系：[spec-love-studio.md](./spec-love-studio.md)（Studio 运行时与分工）、[spec-love-bridge.md](./spec-love-bridge.md)（跨系统交接）、[spec-love-persona.md](./spec-love-persona.md)（人设 schema）。
> 本文件只记录这三条拍板带来的新契约与交付清单，不重复上述 spec。

## 1. 三条拍板

| # | 拍板 | 含义 | 不做 |
|---|---|---|---|
| 1 | **语音要做，接外部 TTS API** | 用户/我们已部署外部 TTS 服务；Studio 只做客户端与逐句调度，不打包 GPU 推理 | 不本地起 GPT-SoVITS 训练/推理进程；不做云端托管语音 |
| 2 | **玩家可自己导入导出卡片** | Studio 玩家模式（`creator=false`）直接有导入/导出入口，不必先开创作者模式 | 不让玩家看到调试台/提示词检查器/素材编辑器 |
| 3 | **主站也支持用户卡** | `/love` 可以导入 Tavern 卡并在主站玩一局，关系状态与档案照常 | 不在主站做账号/服务端存储；不把 Python 运行时塞进 Next |

## 2. 主站用户卡

### 2.1 数据契约（`app/src/lib/love-card.ts`）

```ts
export interface LoveCard {
  id: string;                 // 本地生成：`card-` + 8 位 base36，导入时分配
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  alternateGreetings: string[];
  tags: string[];
  characterBook?: { entries: LoveCardWorldEntry[] }; // 只保留 enabled 的条目参与提示
  source: "tavern-json" | "tavern-png" | "manual";
  spec: "chara_card_v2" | "chara_card_v3" | "unknown";
  license?: string;
  importedAt: number;
  updatedAt: number;
}

export interface LoveCardWorldEntry {
  keys: string[];
  content: string;
  enabled: boolean;
  insertionOrder: number;
}
```

导入来源与规则：

- **JSON**：接受 `{ spec:"chara_card_v2"|"chara_card_v3", data:{…} }` 与扁平 `{ name, description, … }`。`data` 优先。
- **PNG**：读第一个 `tEXt` 块，`keyword` 为 `chara`（V2）或 `ccv3`（V3），内容为 base64(JSON)。只读前 8 MiB。
- **拒绝**：非 PNG/JSON、超过 8 MiB、缺 `name` 或（`description` 与 `first_mes` 同时为空）、`spec` 不认识但 `data` 也取不到。
- **未知字段**：丢弃，不报错（与 `.scpersona` 的"未知字段读→写不变"不同：卡是外部格式，主站只取它认识的子集）。
- 所有文本按原样保存，不翻译；界面按 `lang` 选择显示语言时只影响 UI 文案，不翻译卡内容。

### 2.2 存储与配额（`app/src/lib/love-card-store.ts`）

- slot：`socialcoach.love-cards.v1`，`{ version: 1, revision, cards: LoveCard[] }`。
- 上限：**50 张卡 / 1 MiB 总计**；超限返回 `quota`，不静默丢卡。
- 写入带 `revision` 冲突检测（与 `LoveArchive` 同口径），损坏时返回 `corrupt` 并保留原文供导出。
- **导出 / 擦除必须一起交付**：`loveCardBackup()` 进 `backup.ts` 的导出载荷；重置数据时删掉该 slot（照 `love-play-archive` 的教训：新 slot 要同时接上读写/导出/擦除三件事）。

### 2.3 卡驱动游玩（`/api/love-play` 契约扩展）

- `LovePlayInput` 增加可选 `card?: LoveCardPayload`；`scenario` 仍然必填（前端用 `love-card-scenario.ts` 合成一个 Scenario 形状的壳，供现有 PlayScene 渲染）。
- 合成规则（`love-card-scenario.ts`）：
  - `id = "card:" + card.id`，`title = card.name`，`hook = description 首句`，`background = card.scenario || description`
  - `characters = [{ id:"npc", name: card.name, … }]`，`opening = { characterId:"npc", text: card.firstMes }`
  - `objectives = []`、`success/failure` 用中性收束文案、`maxTurns = 12`、`custom = true`、`source = "user-card"`
  - `context = "romantic"`，`loveTopic` 不设
- **提示词分叉**（`tasks/love-play.ts`）：`card` 存在时
  - 用卡的 `description` / `personality` / `scenario` / 匹配到的世界书条目替代 `roleplaySystem` 里的场景角色简报；
  - **不注入 goal / redLine / secret**：那是作者写死的字段，用户卡没有，不许模型自己编；
  - `terminal` 一律 `null`（没有作者写的 success/failure）；`ended` 按回合上限自然收尾；
  - 契约其余部分（line/options/emotion/stance/revealed/beats/哨兵）完全不变。
- 关系与档案：`characterPackId = "card:" + card.id`，`branchId` 用本地生成的分支 id；写入 `LoveArchive` 与现有故事包逻辑不变。
- **不写能力分**：卡模式同样禁止 `proficiency` / `loveProficiency` / `practiceDays` / `stars` / `assess`。

### 2.4 UI

- 新路由 `/love/cards`：空态说明支持 PNG / JSON；列表每张卡有「玩一局」「导出」「删除」；导入按钮与拖拽。
- `/love` 首页入口卡：`love_cards_entry_title` / `love_cards_entry_sub`（`L={zh,en}`，加到 `i18n.ts`）。
- `/love/play?card=<id>`：PlayScene 用合成的 Scenario 渲染，标题显示卡名；隐藏 objectives/hidden 相关 UI。
- 删除卡需要二次确认，并提示"已产生的档案与故事不会被删除"。

## 3. Studio 玩家模式

- `creator=false` 时露出：**导入卡（PNG/JSON/zip）**、**导出卡（JSON + PNG）**、**删除卡**、**素材库（只读）**、**语音设置**（服务地址/类型/模型/音色/密钥、测试、把已有声音绑到当前卡、开关与音量；见 §4）。
- 仍然隐藏：调试台、提示词检查器、插件配置、立绘位置编辑器、素材上传编辑、角色生成向导。
- 导出补 **PNG**：把卡写回原 PNG 的 `tEXt` 块（`chara`，V2 JSON，base64），保留原图像素；没有原 PNG 时用占位图并标注。当前上游只导出 V2 JSON，这是新增能力。
- 导入/导出的 PNG 契约必须与主站 `love-card.ts` 的解析器对齐：同一张卡在主站与 Studio 之间往返，字段不丢、`name/first_mes` 不变。

## 4. 语音（外部 TTS）

现状：`AnimaBackend/app/tts/` 已有 GPT-SoVITS / IndexTTS 两个客户端（`base_url` 指外部服务）、逐句情绪参考、缓存、ducking；缺的是配置与验收，不是从零开发。

要求：
- 连接配置（设置 → 语音）：`api_type`（gpt_sovits / indextts / openai_audio）、`base_url`、可选 key、采样步数/情绪强度；只回 `has_key`，不回显。
- 角色 → 音色绑定：每个角色可绑一组参考音频（按情绪），没有绑定时退回浏览器 TTS（现有行为）。
- 逐句朗读：与打字机、自动播放、限时选择互斥（现有逻辑不动）；失败不阻塞对话，只记一条 UI 提示。
- **已落地（2026-10-21）**：`openai_audio` 适配器（`POST {base_url}/audio/speech`，base_url 填到 `/v1`；连接级 `model`/`voice`/`format`/`api_key`，key 存 `options` 且任何读接口只回 `has_key`；`/models` 探活，404/405 也算通）；声音档案不需要参考音频，`params.voice` 可覆盖连接默认音色；玩家模式（`creator=false`）新增语音设置面板，可新增/修改/测试/删除连接、把已有声音绑到当前卡、调开关与音量。
- **仍待确认（不阻塞上线）**：用户自部署那套外部 TTS 的真实协议与地址。若它不是 GPT-SoVITS / IndexTTS 形状，按 `openai_audio` 填；若是第三种形状，再加适配器，不改现有三个。

## 5. 交付清单

| 批次 | 内容 | 落点 | 验收 |
|---|---|---|---|
| **G1** | 主站卡契约 + 存储 + 合成 Scenario | `app/src/lib/love-card*.ts`、`app/tests/core/love-card*.test.ts` | PNG/JSON 往返、配额/冲突/损坏、导出/擦除、合成字段 |
| **G2** | Studio 玩家模式导入/导出 + PNG 导出 | `love-studio/frontend/src/debug/{DebugApp,library}`、`AnimaBackend/app/importer/` | 玩家模式可见入口；PNG 往返；创作者工具仍隐藏 |
| **G3** | 主站 `/love/cards` 页面 + 卡驱动游玩 | `app/src/app/love/cards/`、`app/src/components/love/`、`tasks/love-play.ts`、`task-input.ts` | 导入卡 → 玩一局 → 档案有记录；提示词无 goal/hidden；terminal 恒 null |
| **G4** | 外部 TTS 接入与验收 | `AnimaBackend/app/tts/`、Studio 设置页 | 配好连接后逐句朗读；失败不阻塞；缓存命中 |

状态（2026-10-21）：G1–G3 已落地（`d05ddb8`、`cfec408`、`47b5dee`）；G4 的适配器与玩家模式配置面板已落地，**未用真实外部端点验收**——本机只用假服务端跑通了 HTTP 全链路（`/audio/speech` 请求形状、Bearer、401 不回显 key、缓存命中），真实地址待用户提供后补一次真机验收。

依赖：G3 依赖 G1；G2 与 G1 无交集可并行；G4 的端点协议已用 `openai_audio` 覆盖通用形状，剩下的是配置。

## 6. 不做

- 不在主站解析 Tavern 的 `regex_scripts`、`text_completion`、群聊、代写。
- 不做卡的云同步、账号体系、服务端存储。
- 不把 Studio 的 Python 运行时搬进主站。
- 不让用户卡写能力分或进教练档案（只做显式"复制到教练档案"且仅 `name/bio`）。
