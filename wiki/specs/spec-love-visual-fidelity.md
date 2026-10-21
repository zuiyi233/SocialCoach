# 恋爱 Galgame 视觉保真度：人物一致性 / 动效 / 音效（spec）

> 立项 2026-10-21。触发：用户看真实截图后指出「人物非常生硬、场景不随剧情换、没有服饰表情细节、没有动效、Galgame 本质是播片」。
> 本文只解决**表现层**；剧情与关系契约不动（见 `spec-love-visual-novel.md` §3.3、`spec-love-interactive-story.md`）。

## 一、问题定义（已用证据定位，不是猜测）

| 现象 | 根因（已核实） |
|---|---|
| 立绘像「贴上去的照片」 | 老卡立绘 PNG 是 **RGB 无 alpha**（林晚 832×1248），生成于抠图修复之前，把摄影棚白底烤进了图里 |
| 人物一动不动 | VN 前端只有静态 `<img>`；无眨眼、无呼吸、无口型、无表情切换的驱动源 |
| 背景与人物不搭 | 背景是 1280×720 WebP 矩形插画；立绘自带白底，两者光照/色温无关联 |
| 换表情时人「跳一下」 | 每个表情是**独立重新生成**的一张图，没有参考图约束，脸和构图都会漂 |
| 场景不随剧情推进 | 场景包是生成时一次性出 3 张，剧情里没有「切场景」的资产池 |
| 页面「简陋」 | 除资产外还有 chrome 泄漏：模型名默认显示、生图按钮、8 个快捷键、`■` 结束标记、标题字 SVG viewBox 裁切 |

**结论**：这不是「模型不行」，是**资产管线缺参考图约束 + 播放层没有动效层 + 前端没做玩家态收口**。三件事都可在本地做完。

## 二、能力盘点（2026-10-21 实测）

### 2.1 云端网关：做不到（已证伪）

- `/v1/models` 9 个 id，实际只有 `agnes-image-2.5-flash` 出图，其余 503（无渠道 / 被任务插件占用）。
- `/images/edits` → 503 / 500；`/images/generations` 带 `extra_body.image` 被**静默忽略**（返回的人不是参考图里的人）；`ratio` 被忽略（恒 1024×1024）。
- `/v1/videos` 只接受 `{model,prompt,mode}`，`size`/`seconds`/`aspect_ratio` 一律 `plugin_usage_invalid`；一次测试任务排队约 7 分钟后 `failed`。
- 官方文档要求 Video 2.5 的参考图必须是**公网 URL**，本地图无法直喂。

⇒ **云端这条路当前不能承担一致性，也不能承担动效。**

### 2.2 本地 ComfyUI（`http://127.0.0.1:8188`，RTX 3090，v0.42.0，4587 节点 / 108 自定义包）：能，但要选对模型

| 能力 | 本机现状 |
|---|---|
| 动漫生图 | `anima_baseV10` / `anima-preview2` / `UltraReal_anima` + `AnimaEditV1` 编辑 LoRA；Krea2 全家桶（含 `2D动漫Anime_Flat` 风格 LoRA）；`Z-Image-Turbo`；SD1.5 `majicmixRealistic` |
| 图生图 / 局部编辑 | Qwen-Image 编辑节点（`TextEncodeQwenImageEdit(Plus)`）+ `qwen_image_vae` + `qwen_2.5_vl_7b` 文本编码器；Flux.2-Klein 编码器 |
| 身份保持 | `IPAdapter FaceID plusv2`（sd15 / sdxl 两套权重）、`IPAdapterUnifiedLoader` 6 预设、`PulidModelLoader`（SDXL + Flux v0.9.1）、`InstantID`（`ip-adapter.bin` 在） |
| 面部动画 | `LivePortrait`（9 节点：Process / Cropper / Retargeting / Composite）、`SONIC`（Loader / PreData / Sampler，音频驱动口型） |
| 视频 | Wan 2.1/2.2（213 节点，含 `WanFirstLastFrameToVideo` / `WanImageToVideo` / `WanVaceToVideo`）、SVD `svd_xt_1_1`、MiniMax-H3 多套、`VideoHelperSuite`（mp4 进/出）、`seedvr2` / `flashvsr` 放大 |
| 音频 | Ace-Step 1.5（音乐）、Stable Audio、MMAudio、`qwen3-tts`、`MelBandRoFormer` / `audio-separation`（分离） |
| 训练 | `comfyui-fluxtrainer`（角色 LoRA 可训） |

**硬约束（必须写进实现）**：`InstantID` 需要 SDXL 底模，本机**没有** SDXL 动漫 checkpoint ⇒ InstantID 暂不可用；要用身份保持，先走 `IPAdapter FaceID plusv2 sd15`（配 SD1.5）或 **Qwen-Image-Edit 局部编辑**（最贴合「同一张脸换表情」）。Anima 系列是本机主力动漫模型，优先级最高。

### 2.3 第一次真跑（2026-10-21，Qwen-Image 2.1）

用林晚「平静注视」那张 832×1248 立绘当参考图，手搭 Qwen-Image 2.1 图生图图（`qwen_image_2.1_bf16` + `qwen_image_2.1_vae_bf16` + `qwen3.5_9b_..._pe_i2i` + `TextEncodeQwenImage21`），提示「身份/服装/画风不变，只改成震惊」：

| 结果 | 证据 |
|---|---|
| **参考图确实生效** | 输出完整还原了参考图的人：圆框眼镜、蓝色短袖、白色围裙、单侧长马尾、五官比例都对 |
| **提示词没生效** | 表情仍是微笑，没有变成震惊 |
| **背景变成噪点石材纹理** | 参考图的白底没被保留，说明「白底 + 本地抠图」这一步仍然必需，不能指望模型给透明底 |
| **耗时** | 832×1248、20 步、cfg 4，3090 上约 **131 秒** |

结论：**「把人物人设当参考图」这条路在本机是通的**（身份能锁住），但我的临时图还没把「编辑指令」接通（表情没变）。要落地必须用用户自己验证过的那份 `Qwen_Image_2.1_合集_加PE增强.json` 里活跃的那条链路（含 `Anything Everywhere3` 广播 VAE/MODEL、`BatchImagesNode`、提示词增强节点），而不是手搭。**在接通指令之前，不要对外说「本地参考图已完成」。**

### 2.4 改正后的链路（2026-10-21 已跑通）

用户提供了两份可用工作流，按它们的图结构重建后**参考图与编辑指令同时生效**：

| 环节 | 卡 / 端口 | 模型 | 实测 |
|---|---|---|---|
| MOSS 出人物底图 | T10 `:8189` | `moss加速\moss_image_sft_int8_convrot` + `moss_image_sft_4step_v2.0` LoRA + `qwen3.5_9b_int8_convrot`(type `moss_image`) + `flux2-vae` | 832×1248、4 步，**15 s** |
| Qwen-Image 2.1 turbo 按参考图改表情 | 3090 `:8188` | `qwen_image_2.1_turbo_bf16` + `qwen3vl_8b_int8_convrot`(type `qwen_image`) + `qwen_image_2.1_vae_bf16` | 832×1248、官方 8 步 sigma，**25 s**/张（冷启 90 s） |

**之前三次出噪声/不听话的原因（已定位）**：
1. CLIP 用了 `..._pe_i2i`（提示词增强器），编辑链路要的是 `qwen3vl_8b_int8_convrot` —— 提示词因此完全没进模型；
2. `latent_image` 接了 `EmptyLatentImage`，正确接法是 **`TextEncodeQwenImage21` 的第三路 `latent`**（那已经编码了参考图）；
3. cfg 用 4、步数用 20/40；turbo 模型要 **cfg 1 + 官方 8 步 `ManualSigmas`**（`1, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0`）。

**双卡编排**：ComfyUI 的卡是启动参数（`--cuda-device`），进程内不能换卡，所以开两个实例各占一张卡：

```
python_embeded\python.exe -s ComfyUI\main.py --port 8189 --cuda-device 1
```

脚本 `D:\ComfyUI_Mie_2026_V8.0\ComfyUI\moss_qwen_pipeline.py`：MOSS 在 T10 出底图 → 把底图 `POST /upload/image` 进编辑实例 → 3090 逐张派生表情 → 写 `manifest.json`（`source` / `license` 按 UGC 契约）。一次「1 张底图 + 2 个表情」实测 **66 s** 完成 3 张。

**T10 是 Turing（sm_75）**：没有 bf16，只能用 int8 / fp16 权重，脚本默认 int8。

**仍然没解决的**：输出是**白底不透明**，上舞台前仍要走 `matte.py` 抠图；场景背景、动效、音效都还没开始。

### 2.5 二次元（2026-10-21 已跑通并入库）

同一套流水线**不需要换模型**就能出二次元立绘：MOSS 的底图提示词里写 `anime illustration, cel shading` 就会出赛璐璐风，Qwen 2.1 的编辑指令沿用到表情派生也一样稳（发色、双马尾、服饰配件都不漂）。

已入库三个同人起始角色（`seed_data/genshin-*`，各 4 张透明底 WebP 832×1248，约 120 KB/张）：

| 角色 | 底图 + 表情 | 文件 |
|---|---|---|
| 甘雨 | 平静 / 微笑 / 惊讶 / 害羞 | `genshin-ganyu/` |
| 胡桃 | 同上 | `genshin-hutao/` |
| 刻晴 | 同上 | `genshin-keqing/` |

- 版权边界写在每个目录的 `CREDITS.txt`：同人二创、角色版权 HoYoverse、禁止商用与二次分发；**要公开发布或合并回上游时先删掉 `seed_data/genshin-*`**。
- 老库补种入口：`python -m app.seed_one <目录名>`（幂等，同名卡已存在就跳过）。`seed_default_tavern_data()` 只在**库为空**时跑，所以加了新起始角色后老库不会自动补。

### 2.6 音乐（YuE2，2026-10-21 已跑通）

官方蓝图 `blueprints/Text to Music (YuE2).json`（是个 subgraph），按它重建的命令行在 `ComfyUI/yue2_bgm.py`。本机只有 `yue2_3b_bf16`（蓝图写的 int8 没装），只能在 3090 上跑，T10 没有 bf16。

实测（30 秒器乐，3090）：

| 配置 | 耗时 |
|---|---|
| ABC 2048 tokens + 24 步（接近官方） | **210 s** |
| ABC 1024 tokens + 16 步 | **130 s** |
| **跳过 ABC** + 24 步 | **5 s** |
| 跳过 ABC + 16 步 | 60 s（含一次模型加载） |

**结论：ABC 乐谱自回归占了 95% 以上的时间**，采样本身只要几秒。加速的正确做法不是降步数，而是缩短或跳过 ABC（纯 BGM 用 `--no-abc`，要旋律骨架就把 `--abc-tokens` 压到 1024）。产出为 FLAC / 48 kHz / 立体声，时长精确等于 `--seconds`。

> 以上是**文件与节点盘点**，本地尚未跑通任何一条身份保持或动画 workflow。第一批必须先用一张真实立绘跑通端到端，再谈集成。

## 三、方案分层（动效）

用户原话：「两张图切眨眼、多张图快速切换做嘴动」——方向对，但裸多帧会裂。分层实现，越往下越贵、收益越小：

### L0 · 零资产层（CSS，当天可上）

- 呼吸：`transform: translateY/scale` 3.5–5 s 循环，`prefers-reduced-motion` 关闭。
- 情绪位移：`emotion` 字段驱动 —— 震惊 → 短促 shake（`keyframes` 80–160 ms，2–3 次）；害羞 → 微下沉 + 轻微 scale；生气 → 小幅横向抖。
- 入场/退场：淡入 + 8 px 上移；换人时交叉淡出。
- 焦点：非说话角色 `filter: brightness(.82) saturate(.9)` + 轻微缩放，说话者还原。
- **成本 0，收益最大**，先做。

### L1 · 单图帧派生（`talking-picture` 路线，MIT 参考已拉取）

一张立绘 → 用**局部编辑**派生 3–5 张「只改要动的地方」的帧，WebGL/Canvas 合成：

- `no_mouth.png`（抹掉嘴）+ 程序化画嘴（开合 = 音频 RMS，形状 = 元音）⇒ **不需要嘴部帧**
- `eye_open / eye_half / eye_closed`（按**实测上眼睑高度排序**，不能信模型自己报的比例）⇒ 眨眼
- `hair_only` 层 ⇒ 根→梢权重旋转，头发飘动
- 头部 ±1.5° 微倾
- 关键纪律：**原图像素不动**，只在动的地方换帧；同输入同输出（确定性）

代价：每个角色一次性 4–6 次局部编辑。收益：眨眼 + 口型 + 发丝 + 微倾，全部从**现有单张 PNG** 得到，不用重画全身。

### L2 · 分层绑定（`iki` 路线，MIT 参考已拉取）

把角色拆成 `face / eyes / irises / brows / mouth / nose / hair-front / hair-back / torso` 分层 PNG，交给自动绑定器生成 `.iki`（纯 JSON），用 MIT 的 WebGL2 运行时播放：

- 眨眼、视线、口型、点头、转头、眉毛、呼吸、头发物理全是**参数**，不再有「每情绪一张图」
- 表情 = 参数组合 ⇒ 情绪种类线性扩展，资产零增长
- 风险：0.x 早期（20 star，schema 仍在变），必须锁版本；且要求**分层美术**，是一次性重资产

### L3 · 预渲染片段（真正的「播片」）

- `LivePortrait` 3–6 s 循环片（单张立绘即可，含眨眼/微动）→ `<video loop muted playsinline>` 盖在立绘位
- `SONIC` + 我们的 TTS 音频 → 逐句口型片（仅关键台词）
- `Wan 2.2 first/last-frame` / SVD / H3 → 场景转场、回忆、CM 级镜头

**取舍**：L3 每次生成几十秒到几分钟、体积 MB 级，只能用在**少量关键镜头**，不能每句都生成。

### 推荐路径

`L0 立即 → L1 作为默认动效层 → L2 作为 v2 目标（新角色才分层）→ L3 只给章节开场/结局`

## 四、方案（一致性）

### 4.1 参考图三法（按可行性排序）

| 方法 | 前提 | 适用 |
|---|---|---|
| **Qwen-Image-Edit / AnimaEdit 局部编辑** | 已有该角色任意一张立绘 | 换表情、换服装、加伤/湿/泪 —— **首选**，本机文件齐 |
| **IP-Adapter FaceID plusv2 (sd15)** | SD1.5 底模 | 全新构图但同一张脸 |
| InstantID | **需 SDXL 底模（本机没有）** | 暂不可用，除非补 checkpoint |

### 4.2 卡内自洽（零额外成本，先做）

生成角色时，**第一张成功的立绘立刻作为后续所有表情的参考图**。当前 4 张表情各自独立生成、脸会漂；改成「首张定稿 → 其余 edit」后，同一张卡内的一致性当场解决。这一步不需要用户操作、不需要新 UI。

### 4.3 跨镜头一致性（采用 drama-skills 的三层事实，MIT 参考已拉取）

- **身份 vs 变体**：身份跨集不变；服装 / 伤势 / 时段 / 天气 / 持有物是**变体**，不写进身份锁。
- **连续性锁**：只锁「不随剧情变、且观众看得出不一致」的可见事实（耳饰、外套颜色），用最小名词短语写，原样进每条生图/生视频提示词。
- **三层标记**：`IMG-*`（提示词条目）/ `PLAN-*`（计划挂的图）/ `REF-*`（项目里真实存在且检查过的图）。**不许把 PLAN 当 REF**，缺参考图要列出来，不静默降级。
- 落到本仓库：卡上新增 `visual: { identity, variants[], locks[] }`，生图提示词自动拼接 `locks`，UI 上把缺的参考图列成待补项。

### 4.4 存量资产

- 老卡立绘（无 alpha）**必须重出**：先用 `matte.py` 对现有 PNG 再抠一次；抠不动就走 4.1 的编辑重画。
- 场景图需要「同一地点多时段/多角度」的变体池，才能做到「随剧情换背景」。

## 五、方案（音效）

- 音源：Ace-Step（BGM/氛围）、Stable Audio（短音效）、MMAudio（视频配音）；离线生成，入 manifest 记 `source` + `license`。
- 播放：现有 `audioBus` + ducking 已在（`frontend/src/debug/vn/audioBus.ts`）；新增 `sfx` 通道与对话/选择/BGM 的优先级表。
- 事件表（最小集）：翻页、选择悬停/确认、场景切换、章节卡、情绪重击（震惊/心碎）、门铃/雨/脚步等场景层。
- 纪律：音效不抢台词；同一事件 300 ms 内不重入；`prefers-reduced-motion` 不静音但降低动效。
- 上游曾移除 19 个 SFX wav，可评估恢复。

## 六、批次与验收

| 批次 | 内容 | 验收 |
|---|---|---|
| **V0** | 存量立绘重抠 + 玩家态 chrome 收口（模型名/生图键/快捷条/结束标记）+ 标题字 viewBox 修复 | 截图对比：无白底、无调试元素、标题完整 |
| **V1** | L0 动效（呼吸 / 情绪位移 / 焦点 / 入场） | 三种情绪肉眼可辨；`prefers-reduced-motion` 生效；无 layout shift |
| **V2** | 本地生图 provider + 参考图（首张立绘当参考；Qwen-Image-Edit 或 IP-Adapter） | 同卡 4 表情脸不漂；假服务端契约测试 + 一次真实 ComfyUI 端到端 |
| **V3** | L1 帧派生 + 口型（接 TTS 音频 RMS） | 眨眼不裂、口型与音频同步、原图像素不被变形 |
| **V4** | 场景变体池（同地点多时段）+ 剧情驱动切换 | 一章内至少 2 次背景切换且光照一致 |
| **V5** | 音效层 + 事件表 | 事件全覆盖；不抢台词；开关可关 |
| **V6** | L3 关键镜头（章节开场/结局，Wan/LivePortrait） | 片长 3–8 s、首尾帧接得上、体积可控 |

依赖：V2 是 V3/V4 的前置；V0/V1 独立可并行。

## 七、不做

- 不把 ComfyUI 运行时塞进 `app/` 或 `love-studio/`；本地生图走 HTTP provider，和云端 provider 同契约。
- 不引入账号、云存储、付费加成。
- 不在主站写死颜色（仍只在 `app/src/app/globals.css`）；Studio 侧用自身样式。
- 不为「看起来成功」静默降级：参考图缺失要显式报出来。

## 八、风险与未验证

- **参考图一致性已验证**（§2.4）：同一底图派生「震惊」「害羞」，五官/发型/服装/构图都不漂。**只验了 1 个角色 3 张**，还没做整卡（4–6 表情 × 多角色）的稳定性验收。
- **本地动画 workflow 一次都没跑通**（LivePortrait / Sonic / Wan2.2-Animate 都有现成模板 `开箱即用/视频|通用`，但没执行）。LivePortrait / Sonic 的**权重文件**也未确认已下载（节点在）。
- `iki` 是 0.x，schema 会变；接入必须锁版本并包一层适配。
- 时间已测：MOSS 15 s、Qwen 编辑 25 s（暖机）/ 90 s（冷启）、3 张共 66 s。**视频耗时与显存占用未测**（LTX-2 19B / H3 都可能吃满）；T10 上跑更大的模型会不会 OOM 未测。
- 两个 ComfyUI 实例同时持有模型时，系统内存 96 GB / 空闲约 48 GB；长时间连跑是否碎片化未测。
- 动效在低端移动端的帧率未验。

## 九、参考项目（已拉取，均在仓库外 `L:\refs\`）

| 仓库 | License | 用途 |
|---|---|---|
| `zeikar/iki` | MIT | L2：`.iki` 格式 + WebGL2 运行时 + 自动绑定（TS，可直接进 Studio 前端） |
| `narumi-p/talking-picture` | MIT | L1：单图帧派生 + 程序化嘴型 + 发丝权重，**原始像素不动**的工程纪律 |
| `zenstory-ai/drama-skills` | MIT | 4.3：身份/变体/连续性锁 + `IMG/PLAN/REF` 三层事实 |
| `ArcReel/ArcReel` | AGPL-3.0 | **只读架构参考**（跨镜头资产流水线）。AGPL 与体积原因未 clone，禁止拷代码 |
