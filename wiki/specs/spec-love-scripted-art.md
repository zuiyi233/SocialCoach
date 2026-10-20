# 剧本模式美术升级（spec）

> 状态：**方案，未开工**（2026-10-21 立项）
> 范围：`/love/play` 的内置 66 场与自定义剧本；全幅舞台、场景背景、CG、逐句 beat。与 [Love Studio](./spec-love-studio.md) 并行，不依赖 Studio。
> 关联：[恋爱半教练](./spec-love-semi-coach.md) · [互动叙事](./spec-love-interactive-story.md) · [立绘管线复盘](../81-postmortem-love-portrait-pipeline.md)

## 0. 结论一句话

剧本模式的内容已经能玩，但画面仍像「立绘卡片 + 渐变」；这一批只补**舞台与演出**，不改语料、路线账本、结局与承接。目标是在不引入运行时生图、不接 Studio 运行时的前提下，让作者线也有全幅背景、CG 和逐句表情。

## 1. 现状与缺口

| 层 | 已有 | 缺口 |
|---|---|---|
| 立绘 | 201 张 PNG（50 角色 × 4 表情）+ manifest（模型/prompt/seed） | 无按场景的站位/构图；无切换动效 |
| 背景 | `scenarioTone` 渐变 + 装饰 | **无场景背景图**；无 CG |
| 台词 | 打字机、auto、skip-read、已读 | **一回合只有 1 个情绪**，无法一句话一个表情 |
| 镜头 | 章节卡、远/中/近景、左右站位、轻震 | 背景与镜头没有联动；CG 展示层未实现 |
| 音频 | BGM 播放器（manifest 空、静默降级） | 无授权素材；SFX 只有拍点静音 |
| 自定义场景 | 可进 `/love/play` | 无立绘时退回 SVG 圆形占位 |

## 2. 全幅舞台

### 2.1 分层

```
背景层（cover，按 focus 裁切）
  └─ 立绘层（contain，底部对齐，按 shot/side 缩放位移）
       └─ 前景层（暗角 / 渐变 / 雨雪等轻量叠加，可选）
            └─ 对话框（现有卡片，改为半透明底，不遮立绘眼睛）
```

- 背景使用 `object-fit: cover` + `object-position`（manifest 的 `focusX/focusY`），手机竖屏不裁掉脸。
- 立绘保持现有 832×1248 透明 PNG；全幅舞台下取消圆角卡片容器，改为透明叠层；只有无立绘时才显示 SVG 占位卡片。
- 对话框高度自适应；背景亮时加一层可读性渐变；不改变现有 i18n 文案与选项布局。

### 2.2 场景 manifest

```ts
interface LoveSceneVisual {
  scenarioId: string;
  background?: {
    src: string;          // public/love-scenes/...
    focusX?: number;      // 0–100
    focusY?: number;
  };
  cg?: { src: string; at: "reveal" | "ending" | "beat"; caption?: L }[];
  source: string;         // 生成的模型 / 作者 / 授权
  license: string;
}
```

- 静态 manifest：`public/love-scenes/manifest.json`，与 `public/love-portraits/manifest.json` 同纪律。
- 缺失/坏条目静默降级到现有渐变；不显示半张背景。
- 资产必须登记 `source` / `license`；没有出处的图不进 manifest（与 ambient 同一条纪律）。

### 2.3 CG

- CG 是背景层之上的整幅插图，带淡入和轻微推近；`reduceMotion` 时直接显示。
- 只在 `reveal`（hidden 揭示）、`ending`（结局）、作者指定 beat 出现；不随机插入。
- 第一版只做 Rio 2–3 张；其余场景按批次补。

## 3. 逐句 beat

### 3.1 契约扩展

`LovePlayTurn` 增加可选 `beats`，保留 `line` 作为回退、回忆与 TTS 的完整文本：

```ts
interface LovePlayBeat {
  text: L;
  emotion: LovePlayEmotion;
}

interface LovePlayTurn {
  line: L;                    // 兼容旧路径；beats 存在时仍为拼接后的完整台词
  beats?: LovePlayBeat[];     // 2–4 句；无 beats 时按 line + turn.emotion 渲染
  // ...现有字段不变
}
```

- 后端 schema / prompt 只在场景开关打开时要求 `beats`（先 Rio + custom），避免 66 场全部涨价。
- 客户端 zod 校验：2–4 条、每条非空、emotion 合法；不合法则丢弃 beats，回退整句，不让坏数据上屏。
- `line` 始终是完整文本，回忆/存档/结局判定不依赖 beats。

### 3.2 渲染与状态

- 逐 beat 打字；每 beat 切换立绘表情；beat 之间可加 120–200ms 停顿。
- TTS：按 beat 入队朗读；ducking 跟随当前 beat；全部读完才算「TTS 结束」。
- 限时选择：仍然在**最后一句台词打字 + TTS 完成**后才起表；超时沉默分支不变。
- auto / skip-read：auto 按 beat 推进；skip-read 只对逐字已见的文本生效（现有口径）。
- 记忆/承接：只读 `line` 与历史，不读 beats；避免两套转录。

## 4. 素材与生产

- **第一批**：Rio 六幕各 1 张背景（6 张）+ 2–3 张 CG；用现有 ComfyUI + Qwen 2.1 管线或 ImageGen 生成，832×1248 / 16:9 按舞台需要裁切；manifest 记录模型、prompt、seed、source。
- **第二批**：其余 5 条剧情线（Eve / 异地 / 初见 / 信任）按线补背景与 CG。
- **第三批**：独立场景按主题复用背景包（咖啡馆 / 书店 / 餐桌 / 视频通话 / 玄关），不要求一场一张。
- 生成脚本不进运行时；运行时只加载静态文件。资产大小控制在首屏可接受范围，必要时 WebP/AVIF。
- 立绘的站位/构图不重出图；用 `shot` / `side` / `focus` 组合。

## 5. 分批与验收

| 阶段 | 交付 | 规模 | 验收 |
|---|---|---|---|
| A 舞台 | 背景层 + 场景 manifest + 无背景回退 + 手机裁切 | 1–2 天 | 浏览器截图；无布局跳动；reduce-motion；坏 manifest 静默降级 |
| A 素材 | Rio 6 背景 + 2–3 CG + manifest | 素材周期 | 背景不遮立绘眼睛；CG 只在指定节点出现 |
| B 逐句 | `beats` 契约 + 渲染 + TTS/auto/skip/限时选择联动 | 2–3 天 | 逐句表情切换；坏 beats 回退；TTS 不重复；计时不提前/卡死；单测 + 浏览器 |
| C 扩展 | 其余剧情线与独立场景的背景包 | 按批次 | 每批 manifest 完整；性能与首屏加载可接受 |

**共同门槛**：`pnpm check` / `pnpm build` 全绿；桌面 Chromium 实测；真机单列（不作为本批阻塞）。素材人工过目：立绘合成、背景裁切、CG 与台词是否对得上。

## 6. 非目标

- 不做运行时生图、不做 UGC 场景包（那是 Love Studio）。
- 不改语料、路线账本、命名结局、记忆/承接。
- 不重出 201 张立绘；不引入第二套立绘管线。
- 不做全量 CG 收集/画廊（结局图鉴已有；CG 是演出，不是收集系统）。
- 不把 BGM 补成必须项；没有授权素材就保持静默降级。

## 7. 与 Love Studio 的关系

- 两者独立：Studio 负责生成式沙盒；本 spec 负责作者线的观感。
- 可以共享素材格式（背景/CG manifest、source/license 纪律），但不共享运行时。
- Studio 生成的角色/场景包若要进剧本模式，另走 [spec-love-studio.md](./spec-love-studio.md) 的角色包桥；本批不接。
