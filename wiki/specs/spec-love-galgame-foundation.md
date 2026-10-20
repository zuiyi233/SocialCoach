# 恋爱 Galgame 基本盘：存档、回想、外部 TTS 与引擎技术债

状态：**方案，未开工。** 2026-10-20 立项。本文是「GALGAME 基本盘」的需求与验收口径；Rio 六幕 vertical slice 另见 [spec-love-rio-route.md](./spec-love-rio-route.md)。
范围：`/love/play/[scenarioId]` 的幕内存档续玩、回想（backlog）、外部 TTS 配音同步，以及会直接破坏这三件事的引擎层技术债。
不在本文：Rio 六幕剧情与关系状态（另文）、E6 在场层、Web Push、云存档、账号体系。

> **2026-10-21 方向修订**：本文「不做好感度」的非目标由 [spec-love-semi-coach.md](./spec-love-semi-coach.md) 取代；存档、回想、TTS、引擎债继续有效。Love Studio 是独立的生成式 Galgame 系统，见 [spec-love-studio.md](./spec-love-studio.md)。

---

## 0. 结论一句话

**先把恋爱模式从「一刷新就重开、看不到自己说过什么、所有角色同一把男声」补成可继续玩、可回看、有人声的基本盘；同时清掉会直接破坏这三件事的引擎债。** 基本盘不是 Rio 六幕的附属品：没有它，六幕的存档、回想、配音和关系状态都会返工。

**P1 停止信号仍然有效**：玩家没感觉到跨幕承接，该停的是整条恋爱长期在场方向，不是「再加一幕」。本文不会用「已经把基本盘做了」来证明承接有价值（[review §10.1](../reviews/review-2026-10-13-love-companionship.md#101-推荐顺序每一步都有一条不通过就停的判据)）。

---

## 1. 现状与关键事实

### 1.1 内容规模

| 事实 | 数值 | 证据 |
|---|---|---|
| 恋爱场景 | **63 场** | `SCENARIOS.filter(s => s.context === "romantic")` 实测（2026-10-20） |
| 唯一 NPC id | **54 个** | 同上；9 个场景位复用现有 id（`tess` ×2、`rio` ×3、`eli` ×3、`eve` ×3、`jamie` ×2、`sam` ×2，故 54 + 9 = 63 个场景位） |
| 立绘 | 200 张 PNG（50 角色 × 4 表情，另有 manifest） | `app/public/love-portraits/` |
| 剧情线 | 5 条 / 20 场 | `LOVE_SERIES` 实测 |
| 同女主连续线 | **只有 Rio「暧昧到说清楚」与 Eve「被拒之后」，各 3 幕** | `app/src/data/corpus/love-series.ts:44` 的 `continuous` 计算 |
| 异地线 | 8 场，8 个不同 NPC（jordan / sana / mina / june / tess / tara / ravi / eli），`continuous=false` | 同上 |
| 单幕长度 | 6–12 个学习者回合，2–4 个选项 + 自由输入 | `app/src/lib/tasks/love-play.ts:52-81` |
| 结局文案 | 每场 1 个 `success` + 1 个 `failure`，共 126 段 | 语料实测 |

### 1.2 为什么现在像「单幕互动短剧」而不是 GALGAME

| 缺口 | 现状 | 证据 |
|---|---|---|
| 幕内不存档 | `historyRef` 只在内存；挂载时 `startScene` 重置全部状态，刷新即重开 | `app/src/components/love/PlayScene.tsx:81-87,201-247` |
| 没有回想 | 过去的台词不显示；没有 sheet/滚动区 | `PlayScene.tsx` 无历史面板 |
| 没有按角色配音 | `speak(text, lang)` 不传 `SpeakerVoice`；外部 TTS 全落白桦（zh）/ Dean（en） | `app/src/lib/speech.ts:135-160`；`PlayScene.tsx:114-121` |
| 恋爱记录是空壳练习 Session | `status:"ended"`、`messages:[]`、`origin:"love-play"`，首页把它当待复盘，Debrief 先展示 hidden 再对空转录跑 assess | `app/src/store/useApp.ts:247-280`；`app/src/app/page.tsx:40,125-136`；`app/src/components/practice/Debrief.tsx:93,116-128` |
| 新存档没有数据正门 | `LovePlaySchema` 只认 carry / series / unreadable；`parseLovePlaySlot` 对非 carry 一律按 series 校验 | `app/src/lib/archive.ts:74-94` |
| 剧情幕长失控 | `practiceTurnLimit` 强制下限 12，`maxTurns:6` 实际跑 12 | `app/src/lib/practice-policy.ts:5-10`；`app/src/lib/tasks/love-play.ts:21-22` |
| 系列「继续」回刚玩过的一幕 | `nextId = lastScene` | `app/src/components/love/SeriesPlay.tsx:36-38` |
| 恋爱 slot 无跨标签页 / A21 | carry 与 series 都无 storage event；读坏即清空，下一次写入覆盖坏字节 | `app/src/lib/love-carry-store.ts:178-207`；`app/src/lib/love-series-progress.ts:13-27` |
| 删除路径不统一 | 设置页清 love slot，A21 恢复页的 `reset()` 不清 | `app/src/app/settings/page.tsx:420-429`；`app/src/components/StorageRecovery.tsx:61`；`store/useApp.ts:283-294` |

### 1.3 外部 TTS 实际链路

- `PlayScene` 每条可见 NPC 台词调用 `speak(npcLine.text, lang)`（`PlayScene.tsx:114-121`）。
- `speak()` 排队后调用 `playNpcLine(text, lang)`，第三个参数 `speaker` 永远是 `undefined`（`speech.ts:152-160`）。
- `playNpcLine` 的条件：`voiceEngine !== "system"`、非 BYOK、文本 ≤500、`AudioContext` 已解锁、未在 60 秒冷却内 → `POST /api/speech`（MiMo PCM 流），否则设备 TTS（`speech.ts:135-149`）。
- 外部 TTS 首样本 3.5 秒截止；失败降级设备并冷却 60 秒；已出声后断流不重读、不降级（`speech-playback.ts:58-60,88-92`）。
- `/api/speech` 每次都会 `reserveSharedBudget(... maxTokens: 8192 ...)`（`app/src/app/api/speech/route.ts:31`）；按预留公式估算**每句约 3.7 万 token**，日池 1 亿约合 **2,600–2,700 句/日（全站）**，并发仍受全局 3 限制。配音不是「免费的前端效果」。

---

## 2. 范围与非目标

### 2.1 本批交付

| 编号 | 交付 | 用户结果 |
|---|---|---|
| A | 幕内自动存档 + 续玩 + 记录 | 刷新/返回后回到上次停下的台词与选项；记入统计只发生一次 |
| B | 回想（backlog） | 能在对话中查看本幕已发生的全部台词，可单句重播 |
| C | 外部 TTS 配音同步 + 按角色声线 | 每条可见 NPC 台词用该角色的稳定声线读一次；文字不被语音阻塞 |
| D | 引擎技术债清单与前置修复 | 存档/回想/配音/六幕不会在数据层串人、丢字段或被旧记录污染 |
| E | Rio 六幕 vertical slice | 另文；本批只提供它依赖的基本盘 |

### 2.2 明确不做

- 云存档、账号、服务端同步；只保留设备端 + 整包导出。
- 手动多存档槽、存档列表、命名/收藏/删除单槽；自动续玩 + 「重新开始本幕」覆盖真实损失场景。
- 自动播放（auto）、跳过已读、分支树、结局画廊、CG 收集。
- BGM / SFX / 背景图 / CG / 全量语音包 / 服务端音频缓存。
- 逐字/口型同步、按情绪改语气、朗读选项/结局/UI 文案。
- 多 NPC 同场交替配音；本批保持「每场一个说话人」。
- ~~好感度、亲密度、签到、任何可刷的关系数值。~~（2026-10-21 修订：允许非可刷的关系状态驱动主动关心，见 [spec-love-semi-coach.md](./spec-love-semi-coach.md)。）
- E6 在场层 / Web Push；不要借配音把推送通道带进来。

---

## 3. 需求 A：幕内自动存档与续玩

### 3.1 槽位与形状

**一个 story slot**，key 为 `socialcoach.love-play.story`，在 `LOVE_PLAY_PREFIX` 下（`love-carry-store.ts:69`），这样导出/擦除的前缀扫描自动覆盖。**不按场景拆多个 key**：多 key 会让跨标签页、导出、恢复、清理各多一套分支；单 slot 用一张 `saves` 映射解决。

```ts
export interface LoveStoryStore {
  v: 1;
  revision: number;                 // 跨标签冲突检测
  saves: Record<string, LovePlaySave>;   // key = scenarioId
  records: LovePlayRecord[];        // 已完成的恋爱记录；不再写练习 Session
  routes: Record<string, unknown>;  // 各剧情线的已提交关系状态（Rio 见另一 spec）
  updatedAt: number;
}

export interface LovePlaySave {
  v: 1;
  scenarioId: string;
  seriesId: string | null;
  lang: "zh" | "en";
  status: "playing" | "ended";
  history: LovePlaySaveMessage[];   // 只含已确认、已显示过的台词
  currentLineId: string;            // 指向 history 中的 NPC 行
  options: { zh: string; en: string }[] | null;
  emotion: "neutral" | "smile" | "tight" | "teary";
  stance: number | null;            // 对方此刻开放度；不是学习者分数
  carryover: boolean;               // 开场是否拼过承接句（只影响眉标）
  learnerLines: { via: "pick" | "type"; text: string }[];
  outcome: "success" | "partial" | "failure" | null;
  endingId?: string | null;         // Rio 第 6 幕的命名结局；其他场景为 null
  routeState?: unknown;             // 本幕进行中的关系状态快照（按线 schema 校验）
  recorded: boolean;                // 已记入统计；刷新后不再重复
  startedAt: number;
  updatedAt: number;
}

export interface LovePlaySaveMessage {
  id: string;                       // 稳定 id；恢复后不重新生成
  role: "npc" | "learner";
  characterId?: string;             // npc 必填
  text: string;                     // 逐字保存，不翻译、不摘要
  lang: "zh" | "en";
  ts: number;
}

export interface LovePlayRecord {
  id: string;
  scenarioId: string;
  seriesId: string | null;
  outcome: "success" | "partial" | "failure";
  endingId?: string | null;
  startedAt: number;
  endedAt: number;
  lang: "zh" | "en";
}
```

- `history` 是唯一台词真相；`currentLineId`、回合数、回想都从它派生，不另存副本。
- `learnerLines` 只记录**已经进入 history** 的学习者发言，并带 `via`；请求失败/未送达的发言不得进入，避免变成承诺候选。
- `routeState` 是进行中的关系状态快照；幕结束后由 Rio spec 的提交逻辑写入 `routes[seriesId]`。
- `characterKey` 由 `scenarioId + ":" + characterId` 派生；save 内已有 `scenarioId` 与每行 `characterId`，不另存一份 id。
- `records` 上限 100；`saves` 只保留「进行中」+ 最近 12 个已结束场景，防止 63 场全部累积。
- **本批任何新增路径都不写** `proficiency` / `loveProficiency` / `stars` / `practiceDays` / `report` / evidence。`completeLovePlay` 的既有 `loveProficiency`、`practiceDays` 写入保留，但它不再创建练习 Session。

### 3.2 写入时机

只在稳定回合边界写：

1. `startScene` 的首批选项成功返回后（第 0 回合，历史只有开场 + 承接句）。
2. 每次 `send` / `retry` 成功、新的 NPC 台词已进入历史之后。
3. 判出 terminal / ended 时，写 `status:"ended"`、`outcome`、`endingId`。
4. 点「记入统计」成功：**先追加 `LovePlayRecord` 并落盘成功，再把 `save.recorded` 置 true**；两步任一失败都保留可重试状态，不能只写 `recorded`。
5. 「重新开始本幕」先删除本场景 save，再走新局；新局首批成功后重新写入。

不在这些时机写：键盘/语音草稿、请求在途、失败半回合、打字机逐字、揭示动画、临时 `revealKey`。

### 3.3 恢复行为

- 先等场景解析完成（内置场景由服务端传入；自定义场景等 hydration 后从 `customScenarios` 解析），再读 save；不要在 `sc` 为 null 时误判无存档。
- 有有效 save：恢复 `history`、当前台词、选项、情绪、立场、`outcome`、`endingId`、`recorded`、`learnerLines`、承接眉标、`routeState`；**不调用 `startScene`、不请求 `/api/love-play`**。
- 恢复时 `busy=false`、`err=null`、输入为空；`spokenRef` 预填历史 NPC 行 id，避免重读；打字机直接显示全文，不重播揭示动画。
- 恢复后显示一次轻提示「已回到上次停下的地方」（`love_play_resumed`）。
- 无 save：按现有 `startScene` 开新局。
- save 损坏/版本不兼容：不自动开新局、不覆盖原文；显示场景级恢复 sheet（下载原件 + 重新开始本幕）。
- 存储不可用：正常开新局，显示一次「这台设备暂时不能保存进度」的非阻塞提示。

### 3.4 跨标签页 / 损坏 / 导出 / 擦除

- 读取：`JSON.parse` 失败、形状不对、`scenarioId` 与 key 不一致、版本未知 → 返回 `corrupt` / `incompatible` 并保留 raw；不得静默当空。
- 写入：`expectedRevision` + 磁盘 revision 比较；冲突返回 `conflict`，由 UI 提供「载入最新 / 保留本页」；不接受静默最后写入者覆盖。
- 删除感知：另一个标签页清空数据（`event.key === null` 或 story key 变 null）→ 本页停止保存，提示返回，不重建。
- 导出：`lovePlayBackup()` 按前缀自动带上 story slot；`archive.ts` 的 `LovePlaySchema` 与 `parseLovePlaySlot` 必须新增 story 分支，否则导出得到、恢复不了。
- 恢复：只支持 replace 模式写入 love slot（现有行为）；损坏 slot 不写回、保留原件。
- 擦除：`clearLovePlaySlots()` 按前缀删除；删除失败要可见，不能静默返回 0。
- 上限：单 save 512KB、history ≤40 条、单行 ≤4000 字符、options ≤4、store ≤2MB；超限拒绝写入并保留上一份有效 save。

### 3.5 记录：不再写练习 Session

**P0 修复（G14/G15/G21/G23）**：`completeLovePlay` 不再创建 `Session`。改为：

1. 追加一条 `LovePlayRecord` 到 story slot；
2. 保留现有的 `loveProficiency` 与 `practiceDays` 写入（既定设计，不新增分项）；
3. `/love` 的完成数/分钟/结局统计改读 `records`；
4. 首页 `unfinished`、`Debrief`、`/api/assess`、`historyFor`、`schedule`、`pattern` 永远看不到恋爱记录。

`completeLovePlay` 的签名扩展为接收 `startedAt` 与 `endingId`（或接收一条 `LovePlayRecord`），不再用 `now` 伪造开局时间；它仍只写 `loveProficiency`/`practiceDays` 两个既有统计。

这样修掉「录完一局恋爱后首页出现待复盘 → 点进去先剧透 hidden → 空转录 assess 失败」的线上回归。

### 3.6 系列页「继续」

`SeriesPlay` 的 `nextId` 从「`lastScene`」改为：

1. 同系列里 `status:"playing"` 的最新 save；
2. 否则「第一个未完成幕」；
3. 全部完成 → 按产品决定回到第 1 幕或第 6 幕重玩（本批建议回第 1 幕，并在 CTA 写明「重玩」）。

场景列表对未解锁幕给出提示而不是直接链接；Rio 的 `series.order` 必须显式 1–6（见 Rio spec）。

---

## 4. 需求 B：回想（backlog）

### 4.1 内容与边界

- 只渲染本幕**已经确认**的台词：开场 → 学习者 → NPC → …，按发生顺序。
- 每行：说话人（NPC 用当前场景 cast 的 `name[lang]`；找不到回退「对方」；学习者用 `profile?.name`，否则「你」）+ 原文；开场行加「开场」标签。
- **不得出现**：选项文本、`success`/`failure` 结局文案、`hidden`、模型 meta、未返回的回合、下一回合提示、下一幕内容。
- 在途回合与失败重试的旧尝试不显示；只有成功进入 history 的发言才算「说过」。
- 打开时取当前 `history` 的冻结快照；打开期间新回合完成也不追加，关闭再开才更新。
- 打开时滚到最新；顶部提供「开场 / 最新」跳转；关闭时停止重播、恢复焦点。

### 4.2 单句重播

- 只对 NPC 行显示播放按钮；学习者的话不朗读；开场行可重播。
- 点击先 `stopSpeaking()`，再走配音线暴露的同一个单句播放函数（`playNpcLine` + 解析出的角色声线），不要用会排队的 `speak()`，避免与实时台词叠音。
- `settings.tts=false` 时隐藏播放按钮；不自动播放整段，不在打开面板时自动朗读。
- 不存音频 blob/URL；save 只存 `id`/`text`/`lang`/`characterId`。

### 4.3 入口与无障碍

- 播放页顶栏：返回 + 标题 + **回想按钮（44×44）** + 回合数；`aria-label`、`aria-haspopup="dialog"`。
- 使用全局 `Sheet`（`ui.tsx:194-241`）；移动端底部弹层、`pb-safe`、`overflow-y-auto`、`overscroll-contain`；列表 `ol`；滚动区 `role="region"` + `aria-label`；焦点归还触发按钮。
- 只使用现有 token（`text-ink*` / `bg-paper` / `bg-card` / `border-line` / `--measure`）；不写死颜色。
- 新文案全部 `L={zh,en}`；台词原文不翻译。

### 4.4 验收

- 玩到至少 2 个学习者回合，打开回想：开场、所有学习者发言、所有 NPC 回复按顺序出现；说话人正确。
- 选项的独特文本、`success`/`failure` 文案、hidden、下一回合内容都不出现。
- 刷新后回想仍完整（来自 save）；已结束场景也能回看。
- 单句重播只读该句；关闭 sheet 后实时语音不自动续播。
- 320/390 宽不溢出；读屏可读；明暗主题对比正常。

---

## 5. 需求 C：外部 TTS 配音同步与按角色声线

### 5.1 按角色声线：`LOVE_VOICES` 映射表

**决定：不改 `Character` 类型 / `ScenarioSchema`，新增 `app/src/lib/love-voices.ts`。** 理由：`Character` 加字段要同步 `runtime-contracts.ts` 的 Zod 与归档读取，否则会被 strip；映射表是纯表现层，单文件可审，且能显式处理 `tess` 同 id 不同人。

```ts
export type LoveVoiceKey = string; // `${scenarioId}:${characterId}`

// 54 个唯一 id 的基础声线；9 个重复场景位用 SCENE 覆盖。
export const LOVE_VOICES_BASE: Record<string, SpeakerVoice> = { ... };
export const LOVE_VOICES_SCENE: Record<LoveVoiceKey, SpeakerVoice> = {
  "love-approach-hobby-event:tess": { feminine: true, age: "young" },
  "love-ld-social-media-rumor:tess": { feminine: true, age: "adult" },
  // ...
};

export function resolveLoveVoice(scenarioId: string, characterId: string): SpeakerVoice | undefined;
```

- 解析优先级：`scenarioId:characterId` > `characterId` > `undefined`（自定义场景回退默认）。
- 54 个唯一 id 必须全部有基础声线；63 个场景位必须全部解析成功；测试用集合相等断言，缺一个失败。
- Rio / Eve 同一 series 的 3 幕必须同声；两个 Tess 必须不同声（分别为年轻陌生人 / 成年伴侣）。
- 8 位异地主角按语料代词分配：Sana / Mina / June / Tess / Tara 女性，Jordan / Ravi / Eli 男性；**不要按「8 个女主」一刀切**。
- 声型只有 4 种/语言（女性 young=冰糖/Mia、女性 adult/mature=茉莉/Chloe、男性 young=苏打/Milo、男性 adult/mature=白桦/Dean）；承诺的是「每个角色稳定声型」，不是 54 个独一无二音色。
- 设备 TTS 降级只能做到同语言下 pitch/rate 略差异，不能承诺可辨识音色；验收不要把「设备降级后两个女性听起来一样」判成缺陷。

### 5.2 是否需要改 `speak()`

需要。当前 `speak(text, lang)` 的队列只存 `{text, lang}`，`playNpcLine` 永远拿不到 speaker。改为：

```ts
speak(text: string, lang: Lang, speaker?: SpeakerVoice): void
```

队列元素保存 speaker；`next()` 调用 `playNpcLine(line.text, line.lang, line.speaker)`。`PlayScene` 从 `speakerOf()` 得到角色，再 `resolveLoveVoice(sc.scenarioId, speaker.id)`。不改 `playNpcLine` 的签名。

### 5.3 同步与生命周期语义

| 事件 | 当前句语音 | 队列 | 文字/UI |
|---|---|---|---|
| 台词提交（`putLine`） | 发起一次朗读；**不等待打字结束** | 正常路径上一句已在 send 停 | 打字机开始 |
| 点「显示全文」/回车/空格 | 继续读完 | 不变 | 立即全文，选项可用 |
| 点选项/发送 | 立即停止 | 清空 | 请求下一回合；新句提交后才起播 |
| 重试 | 立即停止（补） | 清空 | 重新请求 |
| 顶部返回/收尾返回 | 导航前立即停止 | 清空 | 导航；不能只靠卸载 |
| 切后台/锁屏 | 暂停 | 保留 | 回前台继续；引擎已结束则不重播 |
| 打开麦克风隐私弹窗 | 暂停 | 保留 | 取消恢复；确认则停 TTS 再开麦 |
| 开麦克风/收音中 | 立即停止；收音中不得起播 | 清空/不得新增 | 草稿更新 |
| 关 TTS | 立即停止 | 清空 | 静音；重开从下一句开始，不补读 |
| 收束（outcome） | 最后一句可播完 | 不再新增 | 收尾面板出现后不读面板 |
| 重开 | 停止 | 清空 | 新一局 |

硬规则：

1. 每条可见 NPC 台词恰好一次朗读尝试；首回合被丢弃的 `line`、选项、标题、UI、结局叙述不读。
2. 起播时点 = 台词提交/打字机开始；不要求逐字对齐，不拿语音阻塞阅读。
3. 点「跳过」只跳打字，不跳语音；进入下一句才停。
4. 全局同一时刻最多一条 NPC 语音；不允许语音 + 麦克风同时。
5. 返回/开麦/关 TTS 的取消优先于「让当前句播完」；切后台是暂停，不是取消。
6. 同一 `line.key` 不因重渲染/StrictMode/切后台恢复而重复读；重试生成新 key，读新句。

### 5.4 外部 TTS 降级与预算

| 顺序 | 条件 | 行为 |
|---|---|---|
| 0 | `settings.tts=false` | 静音；不排队、不请求 |
| 1 | `voiceEngine="system"` | 设备 TTS |
| 2 | BYOK `enabled` | 设备 TTS；0 次 `/api/speech`、0 共享池 |
| 3 | 无 `AudioContext` / 未 `unlockSpeech()` | 设备 TTS；iOS 可能静音 |
| 4 | `text.length > 500` | 设备 TTS（切块） |
| 5 | 60 秒冷却内 | 设备 TTS |
| 6 | 外部可用 | `/api/speech` PCM；首样本 ≤3.5 秒 |
| 7 | 外部失败/超时/非 PCM/断网且**尚未出声** | 设备 TTS + 60 秒冷却 + 本场一次 inline 提示 |
| 8 | 外部**已出声**后断流 | 停止该句；不重读、不降级；建议也进入 60 秒冷却 |
| 9 | 设备也失败 | 静音；文字继续；不弹错误、不卡 busy |

- 每句最多 1 次 `/api/speech`；按角色声线只换 `voice` 枚举，不增加调用次数。
- 共享池预留按 `3 × (bytes + 4096 + 8192)` 估算，约 3.7 万 token/句、全站 2,600–2,700 句/日；并发仍受全局 3 限制。**不做预合成、服务端缓存、每句多候选、朗读选项。**
- 外部 TTS 失败降级不弹窗；只在 setup 页补一句双语说明（自然语音会把当前台词文本发到语音服务，本应用不保存音频）。不复用麦克风的 `voiceNoticeSeen`；若合规章求首次弹窗，新增独立 flag 并做归档迁移。
- 请求体只含 `text/lang/voice/tone/delivery`；不含 scenarioId、characterId、角色名、hidden、用户 id；音频只在浏览器内存，不落盘；响应 `no-store`。
- iOS 首次手势：未解锁前开场白允许静音；手势后若当前句仍在屏且未读，补读一次；否则下一句必须出声。补读需要语音层回报「真正出声」，不能只靠 `spokenRef`。

### 5.5 验收

自动化（`pnpm test:core`，假 player / 假时钟 / 假 `speechSynthesis`，不碰真声卡）：

- 声线覆盖：54 个唯一 id 全有基础声线；63 个场景位全部解析非空；Rio/Eve 同声；两个 Tess 不同声。
- `speak` 透传 speaker；队列串行、取消/暂停/generation 正确；外部失败降级恰一次；60 秒冷却内不再 fetch；BYOK/system/长句 0 次 `/api/speech`；同一 key 不重复读；关 TTS 立即停；选项/标题/结局不传入 speech；请求体不含身份元数据。
- 新增 `love-voices.test.ts`、扩展 `speech-playback.test.ts`。

真机（不得用模拟视口销账）：

- iPhone Safari / Android Chrome：首声 ≤3.5 秒或自动降级；iOS 首次手势；切后台/锁屏暂停与恢复；麦克风外放不回声；长句切块不吞字；弱网/503 只提示一次；BYOK 无 `/api/speech`；关 TTS 立即静音；返回/重开无尾音；Rio/Eve 跨幕同声、两个 Tess 可区分。

---

## 6. 引擎技术债清单（一起处理）

来源：2026-10-20 恋爱引擎审计；74 项现有 love 测试全绿，但下列路径多数没有覆盖。**本表是执行清单，不是「以后再议」的观察项。**

| id | 债务 | 证据 | 影响 | 本批决策 |
|---|---|---|---|---|
| G01 | `tess` 两个不同角色共用 id，立绘/声线/关系按 id 会串 | `love-scenarios-deep-approach.ts:27`；`love-scenarios-deep-long-distance.ts:135`；`public/love-portraits/manifest.json` | 新存档、声线、关系、结局串人 | **本批**：新增 `characterKey = scenarioId + ":" + characterId`，持久化与声线一律用它；立绘暂共用同一张，不改 4 张 PNG |
| G02 | 服务端 `leadingNpc()` 与客户端 `speakerOf()` 双实现，fallback 不同 | `lib/tasks/love-play.ts:83-87`；`lib/session-utils.ts:17-25` | 配音/存档/关系归属可能各取一边 | **本批**：合并到 `speakerOf()`；服务端无 NPC 返回 400；加全语料一致性断言 |
| G03 | 两条导出 builder；设置页导出缺 `loveProficiency` / `settings` | `lib/backup.ts:89-91`；`app/settings/page.tsx:63-80` | 导出→恢复丢恋爱主题进度与设置 | **本批**：抽 `buildBackupPayload()`；两条路径顶层键与字段完全一致；回归 |
| G04 | 恋爱 slot 无跨标签页/A21；坏条被下一次写入静默删除 | `love-carry-store.ts:178-207`；`love-series-progress.ts:13-27` | 两标签互覆盖；坏数据无恢复入口 | **本批**：story slot 自带 revision/raw 保留/删除感知；旧 carry/series 加 storage 事件与坏字节保留 |
| G05 | 新 love slot 会被导出，但恢复校验是闭合联合；series key 未复用 prefix | `archive.ts:74-94`；`backup.ts:12-24`；`love-series-progress.ts:11` | 导出得到、恢复不了 | **本批**：`LoveStoryStoreSchema` 加入 `LovePlaySchema`/`parseLovePlaySlot`；series key 用统一常量；round-trip 测试 |
| G06 | 16 句承接台词跨 NPC 共用，伴侣口吻 | `love-carry-lines.ts:78-220`；`PlayScene.tsx:314-326` | 陌生人/同事场景跳戏 | **本批只做 Rio 适配 + 通用回退**；不写 50×16 |
| G07 | `Character` 无 `voice`；2D `speak()` 丢掉 speaker | `types.ts:5-19`；`speech.ts:135-160`；`PlayScene.tsx:120` | 所有角色同一音色 | **本批**：`LOVE_VOICES` 表 + `speak(text,lang,speaker?)` 透传；不改 Character/Zod |
| G08 | `startScene` abort 后不清 `requestRef`；失败发言不回滚 | `PlayScene.tsx:143-198,201-247,249-274` | 在途切换/重开只有开场无选项；计数与承接候选漂移 | **本批**：request generation；startScene 同步清 ref；send 失败回滚或 pending；StrictMode 测试 |
| G09 | `markLoveCarryAsked` 在读路径里产生副作用 | `love-carryover.ts:98-115`；`love-carry-store.ts:190-207` | 重开/回想同一幕消耗提问额度，3 次后承诺被 retire | **本批**：拆 `peek...` 纯读与显式 `mark...`；只在台词真正显示后记一次 |
| G10 | `LoveSeriesProgress` 无版本/分支/结局；「继续」= `lastScene` | `love-series-progress.ts:3-11`；`SeriesPlay.tsx:36-38,80-85` | 六幕永远回刚玩过的一幕；可跳打第 6 幕 | **本批**：升级 v2 `{v, completed, outcome, lastAct}`；`endingId` 留在 `LovePlaySave`/`LovePlayRecord`，不塞进 progress；nextId = 首个未完成；旧 v1 lazy migrate |
| G11 | `completeLovePlay` 写分无测试；承接路径「不写分」只靠组件扫描 | `useApp.ts:247-280`；`love-carry-follow-up.test.ts:322-336,439-446` | 新状态接入时容易顺手写分 | **本批**：收口写分入口；补 `completeLovePlay` 与 carry 路径「分数不变」测试；record 防双击 |
| G12 | `terminal`/`ended` 混用；partial 复用 success 文案；`maxTurns` 被 12 下限覆盖 | `love-play.ts:73-81`；`PlayScene.tsx:177-183,338`；`practice-policy.ts:5-10` | 六幕的「本幕收尾」与「目标达成」混为一谈；6 回合幕变 12 | **本批**：`ended`=自然收尾，`terminal`=目标结果；partial 单独文案或中性收尾；love-play 尊重 `maxTurns` |
| G13 | 测试缺口：收束/取消/重试/存储新路径/组件 | `love-play-turns.test.ts:50-83` 等 | 新功能裸奔 | **本批**：抽纯 reducer/decision 函数；补 G01/G02/G03/G05/G08/G09/G10/G11/G12 断言 |
| G14 | 恋爱记录是空壳 `ended` Session，首页/Debrief 触发 hidden 剧透与空转录 assess | `useApp.ts:253-264`；`app/page.tsx:40,125-136`；`Debrief.tsx:93,116-128`；`session-utils.ts:49-70` | **线上回归**：录完恋爱出现待复盘，点进去先剧透 | **本批 P0**：不再写 `sessions`；改 `LovePlayRecord`；首页/Debrief/assess/historyFor 全部排除 |
| G15 | 无转录、无开局时间、无中途存档 | `useApp.ts:257,261-262`；`PlayScene.tsx:82` | 回想无内容；刷新丢幕；分钟恒 1 | **本批 P0**：`LoveStoryStore` + 每回合落盘 + 真实 `startedAt` |
| G16 | A21 恢复页 reset 不清 love slot；删除失败静默 | `StorageRecovery.tsx:61`；`useApp.ts:283-294`；`love-carry-store.ts:78-92` | 主档损坏重置后承诺/进度仍在 | **本批**：love 清理收口到 `reset()`；返回 `{removed, failed}` 并可提示 |
| G17 | `extractJSON` 取首个 JSON 块；love prompt 自带示例 | `lib/llm-core.ts:136-184`；`love-play.ts:152-153` | 模型复述示例会产出假回合 | **下批/记录**：不重写全仓；love 契约可改用 `jsonCall` 或唯一哨兵 |
| G18 | `lovePlayTurn` 丢 `retryAt`、不校验响应 | `love-play-client.ts:56-65` | 429 立刻重试；坏响应渲染崩 | **下批**：透出 `retryAt` + 响应 zod 校验 |
| G19 | `parseRoleplay` 未知 speaker 静默落第一个 | `client-api.ts:290,306` | 未来多 NPC 会串话 | **只记录**：Galgame 保持单说话人契约，不接该解析器 |
| G20 | `saveLoveCarry` 静默截断 500 字；同场景只按 scenarioId 匹配 | `love-carry-store.ts:293-313`；`PlayCarryCapture.tsx:106-133` | 「逐字保存」被改写；换人覆盖 | **本批**：超限在采集 UI 明示/拒绝；匹配键加 `characterKey` |
| G21 | 恋爱统计读 `assessed`，Galgame 不计完成数/分钟 | `love/page.tsx:51-60` | 「记入统计」后数字不动 | **本批**：随 G14/G15 改读 `LovePlayRecord`，真实分钟 |
| G22 | `LOVE_CARRYOVER` 只按 series+outcome；Rio 无 `order` | `love-carryover.ts:22-56,70-78`；`love-series.ts:37` | 六幕每幕同一句承接；幕序漂移 | **本批**：承接键加 `prevSceneId` 或 `actIndex`；Rio 显式 `order:1-6` |
| G23 | `historyFor` 把 love-play 当练习历史 | `session-utils.ts:49-70` | 剧情占用 12 条历史名额，调度模型误读 | **本批**：G14 后不再产生；加过滤兜底 + 测试 |
| G24 | 非 series 场景没有 Galgame 入口 | `love/page.tsx:68-74,217-255` | 50+ 独立场景只能走教练入口 | **下批/产品决策**：本批只做 series 内 Rio；不偷偷改教练入口 |

### 6.1 本批必修（依赖顺序）

1. **G01 + G02 + G07**：身份键、speaker 单一实现、voice 透传。没有它们，存档/声线/关系一定串人。
2. **G14 + G15 + G21 + G23**：恋爱记录与 story save 拆分；不再写练习 Session；统计改读记录。
3. **G03 + G05 + G04 + G16**：一个 `buildBackupPayload()`；story slot 校验/导出/恢复/擦除/跨标签页/raw 保留/删除收口。
4. **G08 + G09 + G20**：请求 generation、失败回滚、承接纯读、逐字承诺不被静默截断。
5. **G10 + G12 + G22**：系列 v2、`ended`/`terminal` 分离、尊重 `maxTurns`、每幕专属承接、Rio `order`。
6. **G11 + G13**：分数不写/写一次的测试、上述路径的回归闸门。
7. **Rio 六幕**：另文；必须在 1–6 完成后才开始第 4 幕。

### 6.2 本批明确不修

- 不重命名/重出 `tess` 的 4 张立绘；只做 `characterKey` 与回退。
- 不写 50 角色 × 16 句承接台词；只写 Rio 六幕需要的专属句。
- 不做多 NPC 同场 Galgame；不把 `@@speaker` 解析器接进 `/love-play`。
- 不改非流式 JSON / 不引流式；不重写 `extractJSON`/`parseRoleplay` 全仓。
- 不引入可刷的好感度 / 关系数值分；2026-10-21 起允许熟悉 / 信任 / 心动三维关系状态驱动主动关心，`stance` 仍不进存档、不进结局（见 [spec-love-semi-coach.md](./spec-love-semi-coach.md)）。
- 不把 `completeLovePlay` 改成 assess/report；不伪造 stars。
- 不做云存档、手动多槽、音频缓存、全量语音包。
- 不迁移所有旧 slot 到主 archive；story slot 独立，但必须复制 A21 的必要子集（revision/raw/导出/擦除/删除感知）。

---

## 7. 实施顺序与验收闸门

| 序 | 工作 | 主要文件 | 验证 |
|---|---|---|---|
| 1 | 身份键 + speaker 合并 + voice 表/透传 | `types.ts`、`runtime-contracts.ts`（若需要）、`session-utils.ts`、`tasks/love-play.ts`、`speech.ts`、`lib/love-voices.ts` | `love-speaker.test.ts`、`love-voices.test.ts`、`pnpm test:core` |
| 2 | `LoveStoryStore` + `LovePlayRecord` + 停止写 Session | 新 `lib/love-story.ts`、`store/useApp.ts`、`PlayScene.tsx`、`page.tsx`、`Debrief.tsx`、`session-utils.ts` | 新 `love-story-save.test.ts`、`love-play-record.test.ts`、`session-history.test.ts` |
| 3 | archive/backup/erase/reset 正门 | `archive.ts`、`backup.ts`、`settings/page.tsx`、`StorageRecovery.tsx`、`useApp.ts` | `love-play-archive.test.ts` 扩展；导出→恢复→擦除 round trip |
| 4 | 回想 sheet + 顶栏入口 | `PlayScene.tsx`、新 `LoveRecap.tsx`、`ui.tsx`、`i18n.ts` | 组件测试 + 浏览器脚本 |
| 5 | 配音同步 + 降级 + 真机 | `speech.ts`、`PlayScene.tsx`、`api/speech` 不变 | `speech-playback.test.ts` 扩展；真机清单 |
| 6 | Rio 第 4 幕 + 3–5 人试玩闸门 | 另文 | 另文 |
| 7 | Rio 第 5–6 幕 + 两结局 | 另文 | 另文 |

**硬闸门：**

- G01/G02/G07 未完成，不开始写 story save / 关系状态 / 声线表。
- G14/G15 未完成，不叫「存档/回想」完成。
- G03/G05/G16 未完成，不发布任何新 slot。
- G10/G12/G22 未完成，不写 Rio 第 4–6 幕。
- G11/G13 未完成，不合并六幕内容。
- **P1 停止信号未销**：玩家仍感觉不到承接 → 停整条方向；不要用「基本盘已完成」当作继续加幕的理由。

---

## 8. 逐条验收清单

### 8.1 程序验证（`pnpm check` + 新增测试）

- 存档读写：turn 0 / turn N / terminal；刷新恢复同一台词/选项/回合/立场/情绪；无新增 `/api/love-play` 请求。
- 恢复不重读历史语音、不重播打字机/揭示动画；`recorded` 幂等；重复点「记入统计」不新增记录。
- 回想：完整、顺序、说话人、无选项/结局/hidden/未来内容；冻结快照；单句重播。
- 跨标签页：revision 冲突、载入最新/保留本页、删除感知不重建。
- 损坏/配额：raw 保留、不自动开新局、旧 save 不被覆盖、失败提示可见。
- 导出→恢复：story/carry/series/records 全回来；同 id 文本按 `updatedAt` 取新；坏 slot 不阻断健康 slot。
- 删除所有数据：设置页与 A21 恢复页两条入口都清空所有 love key；dinner 不受影响。
- 记录：恋爱不再生成练习 Session；首页 unfinished 不变；Debrief 不触发 assess；`historyFor` 不含 love-play；`/love` 完成数/分钟来自 records。
- 配音：54/63 覆盖、Rio/Eve 同声、两个 Tess 不同声、队列/取消/暂停/降级/冷却/关 TTS/不读选项/请求体隐私。
- 技术债：G01/G02/G03/G05/G08/G09/G10/G11/G12/G14/G15/G16/G20/G21/G22/G23 各有断言。

### 8.2 浏览器自动化（建议，不作为 `pnpm check` 前置）

`app/scripts/check-love-play-resume-browser.ts`：固定三回合 fixture → 刷新 → 断言同台词/选项/回合、请求数不增加、开场 id 不变；打开回想断言无剧透；到 terminal 记录后刷新不重复；种损坏 save 断言恢复 sheet；quota 抛错断言对话继续；两个页面同场景断言冲突；系列页 CTA 指向当前幕。

### 8.3 真机 / 人工（不得用模拟视口销账）

- iOS Safari / Android Chrome：TTS 首声、手势解锁、切后台、麦克风回声、长句、弱网、BYOK、关 TTS、返回无尾音。
- 两个 Tess 在真实播放中可区分；Rio/Eve 跨幕同声。
- 明暗主题、320/390/768/1280、读屏、安全区。
- 真实模型一局：每回合刷新不额外调用、承接句不重复、混语不异常。
- 两个标签页 + 删除所有数据；隐私模式/配额失败。

---

## 9. 风险与停止线

- **预算**：每句外部 TTS 约 3.7 万 token 预留，全站约 2,600–2,700 句/日；如果配音让对话请求频繁 `shared_busy`，先降级设备/减少自动朗读，不得加预算或预合成。上线后要记录 voice 调用数与 `shared_busy` 比例。
- **声线 casting**：54 条基础表必须由内容 owner 过一遍代词/关系/年龄气质；不要把 `hue` 当性别，不要把长辈配成年轻声。
- **存档膨胀**：单 save 512KB、store 2MB；只保留进行中 + 最近 12 个已结束场景；超限拒绝写入，不截断台词。
- **跨标签页**：单 slot 的 revision 是最后写入者获胜的折中；不引入 Web Locks。如果真实用户频繁双开，再升级。
- **P1 未验证**：基本盘 + 六幕不是「承接有效」的证据。第 4 幕后的 3–5 人试玩是硬闸门；玩家说不出「哪一幕的选择改变了第 6 幕」，停。
- **不做 save-scumming**：手动多槽会让玩家反复重 roll 结局，和「承担一次真实对话」的定位冲突；如果真实用户强烈要求，先做单场景书签，不做多槽列表。

---

## 10. 开放问题（附推荐答案）

| # | 问题 | 推荐 |
|---|---|---|
| Q1 | 手动多存档槽？ | **不做**。自动续玩 + 重新开始本幕；未来只考虑单场景书签 |
| Q2 | auto / skip 已读？ | **下批**。本批只做「跳过打字」（已有） |
| Q3 | E2 在统计里记 success 还是 partial？ | **success**。E1/E2 都是「说清楚了」，endingId 不影响分数；无决定才是 partial |
| Q4 | 第 5 幕父亲是否可见/可配音？ | **opening 引述/event-only**；保持 `continuous` 与单 NPC 配音。要可见配角先改引擎另立项 |
| Q5 | 状态拍点怎么写？ | **作者写死选项 + 逐字证据**；不让模型直接输出 `stateDelta` |
| Q6 | 旧 3 幕档怎么迁移？ | **legacy 中性开场**，不补写 hidden/承诺；不要求重玩 |
| Q7 | 关系状态是否可见？ | **本 slice 不做数值/进度面板**；只在剧情里提醒「还没说清的事」 |
| Q8 | 第 6 幕 stance 条？ | **隐藏**，避免「立场高=结局稳」的误读；acts 1–5 保留 |
| Q9 | TTS 首次隐私提示？ | **设置页一句双语说明**；不合规再新增独立 flag，不复用麦克风 flag |
| Q10 | >500 字长台词？ | **设备 TTS**；不拆多次外部调用 |
| Q11 | 自定义场景声线？ | **回退默认**；不在本批给 `/rehearse` 加 voice 契约 |
| Q12 | 54 还是 63 验收？ | **54 条基础 + 场景覆盖**；测试同时断言 54 个 id 与 63 个场景位 |
| Q13 | 恋爱记录是否保留 raw 音频/模型原始 JSON？ | **不保留**。只存台词、选项、情绪、立场、结局、证据引用 |

---

## 11. 证据索引

- 现状：`PlayScene.tsx:81-87,114-121,201-247,249-274`；`love-series-progress.ts:3-11,13-27,41-52`；`SeriesPlay.tsx:20-38,80-85`；`love-carry-store.ts:69-92,178-207,293-334`；`store/useApp.ts:247-280,283-294`；`app/page.tsx:40,125-136`；`Debrief.tsx:93,116-128`；`session-utils.ts:17-25,49-70`；`practice-policy.ts:5-10`；`tasks/love-play.ts:21-22,73-81,83-87`。
- 导出/恢复/擦除：`backup.ts:12-24,31-55,56-79,89-91`；`archive.ts:35-41,54-94`；`settings/page.tsx:63-80,420-429`；`BackupRestore.tsx:36,47,53`；`StorageRecovery.tsx:54-61`；`useApp.ts:359-368`；`archive-storage.ts:4,27-30,42-58`。
- 语音：`speech.ts:20-25,33-48,57-105,135-174`；`speech-playback.ts:16-99`；`api/speech/route.ts:8-77`；`speech-synthesis.ts:3-38`；`shared-budget.ts:4,10,83-110`；`useDinnerPlayback.ts:31-57`；`cast.ts:3-30`；`Chat.tsx:131-171`；`love-play-typing.ts:12-21,45-173`。
- 语料/身份：`data/corpus/types.ts:5-19,42-59`；`data/corpus/love-series.ts:22,37,44`；`data/corpus/index.ts:13-21,184-200`；`love-scenarios-deep-approach.ts:27,160`；`love-scenarios-deep-long-distance.ts:135`；`love-scenarios-deep-define.ts:308`；`love-scenarios-deep-family.ts:158`。
- 产品红线：`AGENTS.md` 的教练模式约束（2026-10-21 起恋爱 / Galgame 按各自契约，见 [spec-love-semi-coach.md](./spec-love-semi-coach.md) / [spec-love-studio.md](./spec-love-studio.md)）；`wiki/00-product-proposal.md:24-28`；`wiki/specs/spec-love-visual-novel.md:121-140`；`wiki/reviews/review-2026-10-13-love-companionship.md:176-179,205-208,230`。
- 测试/命令：`app/package.json:9-14`；`tests/core/love-*.test.ts`；`scripts/check-love-play-live.ts`；`wiki/85-backlog.md` 恋爱承接待办。
