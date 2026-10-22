# 恋爱域的「真人感」层（spec）

> 状态：**P0–P2 已实现并接线；P3 部分**（2026-10-22）。错字函数已实现但默认不接线（等设置开关拍板）；注意力漂移已接线；Studio 端口按 §7 推迟。
> 范围：只服务 `/api/love-play`（恋爱半教练 + 剧本模式 + Studio 的后续端口）；**教练模式不适用**。
> 来源：对 `L:\refs\MaiBot` v1.3.14 的四条主张做机制提取后的行为等价复刻，不是源码搬运。
> 关联：[半教练 spec](./spec-love-semi-coach.md) · [剧本模式](./spec-love-interactive-story.md) · [MaiBot 评审](../reviews/review-2026-10-22-maibot-as-foundation.md)

## 0. 结论

MaiBot 的四条主张里，**第三条「永远更了解你」我们已经在做，而且做得比它更符合本仓约束**；缺的是另外三条。所以这份方案不是"把麦麦搬进来"，是补三个具体缺口：

| MaiBot 的主张 | 我们的现状 | 本方案 |
|---|---|---|
| 没有人喜欢 GPT 的语言风格 | 只有一句「1-3 句口语化短句」，没有强制、没有长短变化、没有 markdown 剥离 | **补**：回复形态抽样 + 长度上限 + markdown 剥离 |
| 懂得什么时候说话、什么时候闭嘴 | 每回合必须给一句 + 2–4 个选项，没有"少说"的形态 | **补**：回合意图判定（回答 / 接住 / 收着 / 收尾） |
| 模仿别人的说话风格、学黑话 | 完全没有 | **补**：学习者文风靠拢 + 用词提示（无存储） |
| 永远更了解你 | **已有**：`love-memory.ts` 两层记忆 + 引文校验 + 承诺 + 面板 + 导出擦除 | **不动**，只在文档里对齐 |

三条补充全部是**纯函数 + 提示词装配**：不新增 API、不新增模型调用、不新增存储 slot、不新增导出义务。

---

## 1. MaiBot 侧的机制提取（事实）

| 机制 | 它的实现 | 参数 | 我们取什么 |
|---|---|---|---|
| 回复风格池 | 全局 `reply_style` + `multiple_reply_style` 列表，按概率临时换一种 | `multiple_probability` 默认 0 | 取"按概率换形态"，不取"全局人设池" |
| 句子切分 | 规则或 LLM 切句 | ≤8 句 / 512 字符 | 取长度预算，不取 LLM 切句（多一次调用） |
| 错别字 | 拼音/同音/词替换 + 50% 概率补一句纠正 | 错字 0.01、同音 0.1、词替换 0.006 | 取机制，**默认关**，只在玩家模式、且不在结局/揭示回合 |
| 注意力漂移 | 四档提示词注入 | `subtle/active/scattered/wild`，默认关 | 取"角色会走神"的写法，落进形态池 |
| 发言时机 | 防抖 + 逻辑回归闸门 + 空闲退避 | 见评审 §1.2 | **不取**：我们没有连续消息流；取"这一轮该少说还是多说" |
| 表达/黑话学习 | LLM 抽取 + 人工审核队列 | — | 取"学学习者自己的用词"，不取 LLM 抽取（多调用） |

**不取**：全局单人格、群聊防抖、按概率插话、LLM 切句、任何运行时。

---

## 2. 缺口（对着代码核过）

### 2.1 语言风格

`app/src/lib/tasks/love-play.ts:344` 的输出契约只写了「line：1-3 句口语化短句」，没有：

- **长度上限**：`localizedText`（`:169-176`）只有 `min(1)`，没有 `max`。模型写 500 字独白能通过 zod。
- **markdown 剥离**：提示词要求"不写 markdown"（`:367`）只约束哨兵外面，`line` 内部出现 `- ` / `**` / `##` 会原样上屏。
- **形态变化**：每回合都是 1–3 句，没有"半句""一句干巴巴的""说一半停住"。
- **走神**：角色永远紧扣话题。

### 2.2 说话时机

`lovePlayOutputSchema`（`:177-184`）每回合必填 `line` 与 2–4 个 `options`。于是：

- 学习者只回一个「嗯」时，NPC 仍然要推进一段并给出 2–4 个选项——这是"客服"，不是"会闭嘴的人"。
- 学习者刚问了一个直接问题，NPC 也可以绕开（没有"必须先回答"的约束）。
- 结局回合仍可能反问，削弱收束。

### 2.3 风格靠拢与用词

全仓 `grep -riE "mirror|靠拢|口癖|黑话|jargon"` 在恋爱域零命中。NPC 不会因为学习者说话短就变短，也不会用学习者自己的词。

### 2.4 已经有的（不要重做）

`app/src/lib/love-memory.ts` 已经是完整的两层记忆：`buildLoveMemoryCore`（按 kind 分层 + 锁定 + 最近更新）、`buildLoveMemoryArchive`（按学习者最近原话做二元组分词召回）、`buildLoveMemoryDigest`（中英双语标签）、`withLoveMemoryTurnMessages`（作为 `event` 旁白插在开场白之后）、`integrateLoveMemories`（幕末零模型抽取）、面板可编辑/删除/锁定、导出与擦除按 `LOVE_PLAY_PREFIX` 覆盖。**MaiBot 的 person profile 是有损摘要，我们的是引文一等对象**——这一条不需要向它学。

---

## 3. 模块与接缝

```
app/src/lib/human-voice.ts        纯函数：形态抽样 / 长度上限 / markdown 剥离 / 可选错字
app/src/lib/turn-taking.ts        纯函数：学习者回合分类 / 本轮意图 / 提示词块
app/src/lib/style-adaptation.ts   纯函数：文风画像 / 靠拢提示词 / 用词提示
app/src/lib/tasks/love-play.ts    装配：三段提示词 + 输出后处理（守卫之前）
app/src/components/love/PlayScene.tsx  不改（形态与文风从 messages 推导）
```

三个模块都是纯函数、无 IO、随机只从 `rng` 参数取（`human-voice` 约 290 行、`style-adaptation` 约 300 行、`turn-taking` 约 150 行），符合本仓 `love-*` 的模块风格。

### 3.1 数据从哪来

- **文风与回合分类**：服务端从请求里已有的 `messages` 推导（`role === "learner"` 的行）。**客户端零改动。**
- **记忆**：客户端已经在 `PlayScene.tsx:731` 通过 `withLoveMemoryTurnMessages` 注入，不动。
- **用词**：同样从 `messages` 的 learner 行推导，**不落盘**——所以不需要新 slot、不需要导出/擦除、不需要人工审核队列。

### 3.2 注入位置

`lovePlaySystem` 现在的顺序是：`roleplaySystem` → 关系状态 → goal/redLine → 输出契约。新增三段插在**关系状态之后、goal/redLine 之前**，理由：文风与意图只影响怎么说，不能覆盖角色目标与边界。

```
roleplaySystem
  ├─ RELATIONSHIP SO FAR（已有）
  ├─ LEARNER'S WRITING STYLE（新，style-adaptation）
  ├─ THIS TURN'S INITIATIVE（新，turn-taking）
  ├─ THIS TURN'S SHAPE（新，human-voice）
  ├─ goal / redLine / secret（已有）
  └─ 输出契约（已有，追加形态长度上限）
```

---

## 4. 模块契约

### 4.1 `human-voice.ts`

```ts
export type ReplyShape = "clause" | "short" | "two-beat" | "trail-off" | "flat";

export function pickReplyShape(input: {
  rng: () => number;
  lang: Lang;
  learnerTurn: LearnerTurnKind;
  initiative: Initiative;
  terminal: boolean;
  ended: boolean;
  turnIndex: number;
}): ReplyShape;

export function replyShapeDirective(shape: ReplyShape, lang: Lang): string;
export function replyShapeLimit(shape: ReplyShape, lang: Lang): { maxChars: number };

/** 剥离 markdown、统一标点空白；不改变事实与措辞。 */
export function stripSpokenMarkdown(text: string): string;

/** 剥离 + 归一 + 超长按句末截断（见 §4.5）。 */
export function enforceLine(text: string, lang: Lang, shape: ReplyShape): string;

/** 可选错字；默认关闭，且在 revealed / terminal / ended 时强制关闭。 */
export function maybeImperfection(input: {
  text: string;
  lang: Lang;
  rng: () => number;
  enabled: boolean;
  locked: boolean;   // revealed || terminal || ended
}): { text: string; corrected: boolean };
```

**形态权重**（`pickReplyShape`）：

| 前置条件 | 结果 |
|---|---|
| `ended || terminal` | 强制 `flat`（收束不要玩形态） |
| `initiative === "hold-back"` | 强制 `clause` |
| `initiative === "close"` | 强制 `trail-off` |
| `learnerTurn === "bare-ack"` | `clause` 0.5 / `trail-off` 0.3 / `short` 0.2 |
| `learnerTurn === "question"` | `short` 0.5 / `flat` 0.3 / `two-beat` 0.2 |
| 其他 | `short` 0.35 / `flat` 0.25 / `two-beat` 0.2 / `clause` 0.12 / `trail-off` 0.08 |

**长度预算**（提示词侧的目标，不做硬截断；只有绝对上限会触发截断）：

| 形态 | zh 字符 | en 词 |
|---|---|---|
| `clause` | 14 | 10 |
| `trail-off` | 24 | 14 |
| `short` | 30 | 18 |
| `flat` | 45 | 28 |
| `two-beat` | 60 | 35 |

绝对上限（任何形态）：zh 120 / en 80 词。超过绝对上限才截断，避免把正常的 2–3 句台词切碎。**形态预算只写进提示词，不在代码里硬裁**——把一句 20 字的台词裁到 14 字会把话截断在半句上，比不裁更伤。

### 4.2 `turn-taking.ts`

```ts
export type LearnerTurnKind = "question" | "bare-ack" | "invitation" | "long-share" | "statement" | "none";
export type Initiative = "answer" | "reflect" | "hold-back" | "close" | "deflect";

export function classifyLearnerTurn(text: string, lang: Lang): LearnerTurnKind;
export function chooseInitiative(input: {
  rng: () => number;
  learnerTurn: LearnerTurnKind;
  lastNpcAskedQuestion: boolean;
  terminal: boolean;
  ended: boolean;
  turnIndex: number;
}): Initiative;
export function initiativeDirective(initiative: Initiative, lang: Lang): string;
```

**分类规则**（确定性，优先匹配从上到下）：

1. 空 / 只有标点 → `none`
2. 归一后长度 ≤ 4 且命中致谢/应答词表 → `bare-ack`。尾部句末/次级标点先剥（「嗯。」仍是应答），问号保留（「好？」是问句）。
   - zh：嗯、嗯嗯、好、好的、行、可以、对、是、哦、好吧、知道了、收到
   - en：ok, okay, yeah, yep, sure, hm, mm, right, got it, fine
3. 含问句标记 → `question`：`？`/`?`、`吗`、`怎么`（前面不是「不/没」）、`哪里/哪儿/哪个/哪些/哪位`、`谁`、`几点`、`是不是`、`能不能`、`会不会`、`你觉得呢/你们呢/您呢/你呢/然后呢/干嘛呢/所以呢`、以及紧跟问号的 `呢`。
   **刻意不用裸 `哪`**（会命中「哪怕」）、**不用裸 `怎么`**（会命中「不怎么」）、**不用裸 `呢`**（会命中「我才怪呢」）。「哪里哪里」这类客套否定按 `statement` 处理。
4. 含邀请标记 → `invitation`：`要不要`、`去不去`、`来不来`、`想不想`、`今晚`、`周末`、`陪我`、`带你`、`一起` 后接动作（去/来/看/吃/玩/喝/逛/走/试试）。
   **裸 `一起` 不算**——「我们在一起三年了」是陈述，不是邀约。
5. zh ≥ 40 字 / en ≥ 25 词 → `long-share`
6. 其他 → `statement`

**意图规则**（前四条优先，其余抽样）：

| 条件 | 意图 |
|---|---|
| `ended \|\| terminal` | `close` |
| `learnerTurn === "question"` | `answer`（必须先回答，不许绕） |
| `learnerTurn === "bare-ack" && lastNpcAskedQuestion` | `hold-back`（不要再堆一个问题） |
| `learnerTurn === "invitation"` | `answer`（可以带一个澄清问句） |
| `learnerTurn === "long-share"` | `reflect`（只接住一个具体细节，不给建议） |
| 其他 | `answer` 0.45 / `reflect` 0.3 / `hold-back` 0.2 / `deflect` 0.05 |

`deflect` 只能出现在非 `question`、非 `invitation`、非 `ended`、非 `terminal`、且 `turnIndex > 0` 的回合；它意味着"先岔开半句再回来"，不是拒绝回答。首回合不给 `deflect`，否则一开口就像没在听。

### 4.3 `style-adaptation.ts`

```ts
export interface StyleProfile {
  samples: number;
  avgChars: number;
  shortRatio: number;      // ≤8 zh chars / ≤4 en words
  questionRatio: number;
  ellipsisRatio: number;
  emojiRatio: number;
  particles: string[];     // zh: 啊/吧/呢/嘛/诶/呀；en: 空
  latinRatio: number;      // 中英混用
  lowercaseStartRatio: number;
}

export function analyzeStyle(lines: readonly string[], lang: Lang): StyleProfile;
export function styleMirrorBlock(profile: StyleProfile, lang: Lang): string | null;

export interface LexiconTerm { term: string; count: number; source: string }
export function extractTerms(lines: readonly string[], lang: Lang): LexiconTerm[];
export function lexiconBlock(terms: readonly LexiconTerm[], lang: Lang): string | null;
```

- `samples < 3` → `styleMirrorBlock` 返回 `null`（样本太少不画像）。
- `avgChars > 60`（学习者写长文）→ 只提示"不要比他更啰嗦"，不提示靠拢。
- `extractTerms` 只取三类，避免中文分词依赖：
  1. 引号包住的词（`「」『』""''`）
  2. 拉丁/数字 token（≥2 字符，去掉常见停用词）
  3. 同一 CJK 2–4 字片段在 learner 行里出现 ≥2 次，且不在停用词表
- 上限 8 条，按出现次数降序；`source` 存第一次出现的原句，便于面板/测试追溯。
- **不落盘**：每次请求从 `messages` 现算。

### 4.4 提示词块（中英双语，实现时按 `lang` 取一版）

**文风靠拢**

```
LEARNER'S WRITING STYLE（只影响你说话的长短与语气，不改变人设、不改变立场）
- 他的消息平均 12 字，以短句为主；常用「吧」「啊」；几乎不用 emoji。
- 轻微靠拢：句子长度接近他，少用书面语。
- 不要模仿错别字，不要评论他说话的方式，不要变成另一个人。
```

**本轮意图**

```
THIS TURN'S INITIATIVE: hold-back
- 只回一句短话，不反问、不推进新话题，把下一步留给他。
- 可以只接住他情绪的一半；允许停顿（用省略号），不要用「你呢？」结尾。
```

四种意图各一段，`answer` 额外写明「先直接回答他的问题，再决定要不要多一句」。

**本轮形态**

```
THIS TURN'S SHAPE: one clause（≤14 个汉字 / ≤10 个英文词）
```

### 4.5 输出后处理（顺序很重要）

```
parseLovePlay
  → beats 拼接成 line（已有）
  → enforceLine(line)            ← 新增，先归一
  → replyBoundaryProblem          ← 已有守卫，必须看到玩家真正会看到的文本
  → roleplaySpeechGuard           ← 同上
  → 返回
```

**为什么必须在守卫之前**：守卫检查的是"会不会泄底 / 会不会把未确认的安排说成事实"。如果先守卫再剥离 markdown，守卫看到的是带 `**` 的文本，玩家看到的是另一份；两份不一致时，证据链就断了。

**超长截断规则**（`enforceLine`）：

1. 未超绝对上限 → 只做 markdown 剥离与标点归一。
2. 超绝对上限 → 在绝对上限之前找**最后一个句末标点**（`。！？.!?`），截到那里。
3. 找不到句末 → 找最后一个次级标点（`，、；,;`），截到那里并补 `……` / `…`。
4. 仍找不到 → 原样返回（模型完全没遵守，不在标点中间硬切）。
5. beats 逐句处理，再按原规则重新拼接，保证 `line === beats.join()` 不变式（`tests/core/love-play-turns.test.ts` 已有该不变式）。

### 4.6 可选错字（默认关）

- 只在 `settings` 显式打开时启用；默认 `false`。
- `revealed || terminal || ended` 任一为真 → 强制关闭（不要给告白或结局打错字）。
- 中文走同音/词替换，英文只做轻微拼写错误（如 `teh`、漏 apostrophe），概率取 MaiBot 的 1/3：错字 0.003、同音 0.03、词替换 0.002。
- 50% 概率在下一回合开头补一句纠正；纠正句不计入 `line` 的形态预算，也不改变选项。
- **教练模式永不启用**（`/api/roleplay`、`/api/assess` 不 import 这个模块）。

---

## 5. 接缝改动清单

| 文件 | 改动 | 风险 |
|---|---|---|
| `src/lib/human-voice.ts` | 新增 | 无 |
| `src/lib/turn-taking.ts` | 新增 | 无 |
| `src/lib/style-adaptation.ts` | 新增 | 无 |
| `src/lib/tasks/love-play.ts` | `lovePlaySystem` 加三段参数与注入；`runLovePlay` 加可选 `rng`；`parseLovePlay` 里 `enforceLine` | 中：守卫顺序 |
| `src/lib/task-input.ts` | 不改（不新增字段） | 无 |
| `src/components/love/PlayScene.tsx` | 不改 | 无 |
| `tests/core/*.test.ts` | 新增 3 个 + 扩 1 个 | 无 |

**不新增**：API 路由、模型任务、存储 slot、导出字段、设置项（错字开关除外，放 `settings` 既有白名单）。

---

## 6. 边界与红线

- **只作用于恋爱域**。教练模式的 `roleplaySystem` 不 import 这三个模块；`/api/roleplay`、`/api/assess`、`/api/debrief-chat`、3D 饭局一律不动。理由：教练模式要逐字引用原话，任何"错字/靠拢/走神"都会污染证据。
- **不改变事实层**。形态、意图、文风只影响"怎么说"，不改变 `goal` / `redLine` / `secret` / `terminal` 判定；守卫仍在归一后的文本上跑。
- **不新增记忆**。用词提示不落盘，不参与 `love-memory` 的 kind 体系，避免第二套"她记得你"。
- **不承诺质量**。这套机制能让台词更像人，但不能证明玩家会觉得像人；验收只到"结构正确 + 桌面实测可读"。

---

## 7. 分阶段

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **P0** | `human-voice`：markdown 剥离 + 绝对上限 + 形态抽样（服务端 only） | 单测；`line` 不再出现 markdown；超长按句末截断 | ✅ 2026-10-22 |
| **P1** | `turn-taking`：分类 + 意图 + 提示词块 | 单测；`bare-ack` 回合不再连环追问；问句必答 | ✅ 2026-10-22 |
| **P2** | `style-adaptation`：文风画像 + 靠拢 + 用词提示 | 单测；样本 <3 不注入；8 条上限 | ✅ 2026-10-22 |
| **P3a** | 注意力漂移写法 | 单测；非问句 / 非收束回合按 0.15 放行 | ✅ 2026-10-22 |
| **P3b** | 可选错字 | 函数与单测就绪；`locked`（revealed / terminal / ended）强制关 | ✅ 2026-10-22：默认**关**，设置页「台词里偶尔打错字」显式打开；只改对白语言那一键，落地时丢 beats |
| **P3c** | Studio 端口 | 与主站同契约 | ⏸ 推迟，原因见下 |

**Studio 端口为什么推迟**：Studio 的提示词装配不在 Python 后端，而在前端 `love-studio/frontend/src/debug/lib/assembler.ts`（`assemble()`，862 行 + 自带测试）。把三个模块复制进去等于开第二套平行实现，而项目明令避免「两套平行实现」；同时 Studio 目前还没有承载日常游玩。插入点已确认：`DebugApp.tsx` 的 `assembleForSend()`（约 2351 行）是唯一出口，将来在此处按 `history` 计算同三个块并追加到最后一条 system 消息即可。等 Studio 真正承载日常游玩时再做，届时按 [persona 的先例](./spec-love-persona.md)补一份契约测试。

---

## 8. 测试清单

**`tests/core/love-human-voice.test.ts`**

- `stripSpokenMarkdown`：`- 你好`、`**嗯**`、`## 标题`、```` ``` ````、`> 引用`、`1. 第一` 全部剥离；`……` 与「」保留。
- 长度上限：五种形态各一条超长输入，截断落在句末标点。
- `enforceLine` 幂等：同一输入两次结果相同。
- `pickReplyShape` 固定 `rng` 时结果可预测；`ended` 恒为 `flat`。
- `maybeImperfection` 默认不产生错字；`locked` 时即使 `enabled` 也不产生。

**`tests/core/love-turn-taking.test.ts`**

- 分类表：`嗯` → `bare-ack`；`你为什么这么说？` → `question`；`周末要不要一起去看展` → `invitation`；40 字叙述 → `long-share`。
- 意图：`ended` → `close`；问句 → `answer`；`bare-ack` + 上轮 NPC 提问 → `hold-back`。
- `deflect` 不出现在 `question` / `invitation` / `ended` 回合。
- 每个意图的 directive 非空且含语言对应的关键词。

**`tests/core/love-style-adaptation.test.ts`**

- 画像：3 条短句 → `shortRatio` 高、`avgChars` 小；长文 → `styleMirrorBlock` 返回 `null`。
- `samples < 3` → `null`。
- 用词：`「」` 引号词、`POV`、重复两次的 3 字词被抽出；常见词（`我们`、`就是`）不被抽出；上限 8。
- 块里不出现"模仿错别字"或"评论对方"的措辞（反向断言）。

**`tests/core/love-play-turns.test.ts`（扩）**

- 提示词含三段新块，顺序在关系状态之后、goal 之前。
- `line` 带 markdown 时返回结果已剥离。
- 超长 `line` 被截断且 `beats` 拼接不变式仍成立。
- 守卫失败时仍然 502（归一不掩盖泄底）。

---

## 9. 风险与未决

| 风险 | 处理 |
|---|---|
| 形态抽样让台词变得过短，剧情推进变慢 | 权重里 `two-beat` 与 `flat` 合计 0.45；结局与问句回合不受影响；P0 后先看 3 局再调 |
| 文风靠拢变成"学舌" | 提示词显式禁止模仿错别字与评论对方；块里只给 2–3 个可观察特征，不给原句 |
| 用词提取误报（中文无分词） | 只取引号词 + 拉丁 token + 重复片段；上限 8；只作"可以用一次"的提示，不强制 |
| 截断破坏台词完整性 | 只在绝对上限（zh 120 / en 80 词）触发；优先句末，其次次级标点；找不到就原样返回 |
| 错字污染存档与 TTS | 默认关；结局/揭示回合强制关；只改 `line` 文本，不改选项 |
| 与 `beats` 的交互 | 逐句处理后重新拼接，保持 `line === beats.join()` |

**未决（需要拍板）**：

1. 错字默认是否真的关？（我建议关，玩家可开）
2. 形态权重是否按场景类型分（暧昧 vs 冲突）？先统一，看数据再分。
3. Studio 端口排在 P3 还是与 P0–P2 并行？取决于 Studio 是否开始承载日常游玩。

---

## 10. 许可说明

本方案按**行为等价复刻**写：参数、判定规则、提示词策略与 MaiBot 一致，代码用本仓的 TS 结构与命名重写。若改为逐行搬运 GPL-3.0 源码，整个分发物（Vercel / ModelScope / 桌面安装包）需按 GPL-3.0 发布——这是产品决策，不在本 spec 的技术范围内。
