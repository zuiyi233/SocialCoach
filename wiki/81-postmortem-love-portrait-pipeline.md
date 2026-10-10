# 恋爱立绘管线复盘（2026-10-10）

> 覆盖范围：`app/scripts/gen-love-portraits.mjs`（Qwen-Image 2.1 立绘批量生成）从首批全噪点，到定位、修复、重建验收的完整过程。
> 相关：[ComfyUI + Qwen Image 2.1 出图参考](./refs/comfyui-qwen-image-21.md) · [spec](./specs/spec-love-visual-novel.md) · [踩坑记录](./80-known-pitfalls.md)

## 一句话

配置错的不是"某个参数"，而是**整条采样路径**；而它能把 113 张垃圾产物一路送进仓库，是因为管线**只有文件层校验、没有内容层校验**。

## 时间线

| 时点 | 事件 |
|---|---|
| 首批全量 | 113 张（50 角色 × 4 表情，部分未跑完）全部为彩色噪点 |
| 隔离 | 坏产物移入 `_portrait-dump/`（gitignore），删除误入库的 tess 4 张 + manifest（`10cf299`） |
| 前端止血 | `public/love-portraits/` 清空 → manifest 404 → `AvatarStand` 自动回退 SVG 占位，应用不显示乱码 |
| 交接 | 写交接文档列出 5 个根因方向待有视觉复核（该文件现已改写为 [refs/comfyui-qwen-image-21.md](./refs/comfyui-qwen-image-21.md)） |
| 复核修复 | 用用户实测可用的两份工作流反推正确图，逐项验证，噪点消失，透明底改为原生 |

## 根因（四个独立缺陷）

### ① 模型组合不可用（噪点主因）

管线用的是 `qwen_image_2.1_int8_convrot` + `qwen3.5_9b_..._pe_t2i` / `pe_i2i`（9B 提示词增强编码器）。实测可出图的组合是：

```
UNETLoader  qwen_image_2.1_turbo_bf16.safetensors
CLIPLoader  qwen3vl_8b_int8_convrot.safetensors   type=qwen_image
VAELoader   qwen_image_2.1_vae_bf16.safetensors
```

`pe_*` 是提示词增强用的编码器，不是这条出图路径的文本编码器；`int8_convrot` 主模型配它时采样直接崩成噪声。

### ② 采样轨迹错（噪点主因）

Turbo 是蒸馏 flow 模型，只在官方 8 步 sigma 表上有效。原来的 `KSampler(steps=30, scheduler=simple, cfg=1.0)` 不是"质量差一点"，而是**完全不可用**。正确接法：

```
KSamplerSelect(euler) + ManualSigmas("1, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0")
  → SamplerCustom(add_noise=true, cfg=1, latent_image=<见 ④>)
```

单张耗时从 24s 降到约 12-18s。

### ③ Autogrow 输入在 API 格式下被静默丢弃

`TextEncodeQwenImage21` 的参考图输入是 `COMFY_AUTOGROW_V3`。API 工作流里写成嵌套对象会被**无声忽略**：

```js
// ✗ 不报错、不警告，参考图完全不生效，退化成文生图
inputs: { images: { image_1: ["10", 0] } }
// ✗ 直接报错：execute() got an unexpected keyword argument 'image_1'
inputs: { image_1: ["10", 0] }
// ✓
inputs: { "images.image_1": ["10", 0] }
```

探针是输出尺寸：参考图生效时 latent 由**首张参考图**决定（832×1248），被忽略时退回 `resolution` 正方形（1024×1024）。这条曾经让"角色一致性"整段是假的。

### ④ latent 来源

`TextEncodeQwenImage21` 的第 3 个输出就是 latent，编辑路径必须用它（节点注释：换画幅会偏移编辑结果）。文生图路径该节点只会给正方形，竖版要显式接 `EmptyLatentImage(832, 1248)`——实测 2.1 UNet 接受非正方形 4D latent，正常出图。

## 顺带纠正的旧结论

**透明底不需要抠图。** `qwen_image_2.1_vae_bf16` 是 Wan 2.2 布局的 **RGBA VAE**（`comfy/sd.py:840`）：encoder 吃 4 通道、decoder 出 4 通道、`spacial_downscale_ratio=16`、`latent_channels=64`、`pad_channel_value=1.0`（RGB 输入补成不透明）。alpha 是模型**原生生成**的通道，`VAEDecode → SaveImage` 直接写出透明 PNG。原先的 `easy imageRemBg(BEN2)` 整条是多余的，而且它在噪点上还会二次破坏（不透明像素被削到 2-6%）。

参考图的 alpha 会往下传：`nodes_qwen.py:170` 注释"视觉塔看的是 alpha 叠白，VAE 保留全部四通道"。实测对照——

| 参考图 | 出图 alpha |
|---|---|
| neutral 原样（RGBA） | 双峰：约 43% 近透明 / 56% 不透明 ✓ |
| neutral 叠白（RGB） | 100% 不透明，模型照抄白底 ✗ |

所以上传参考图**必须保留 alpha**，不能先叠白。

## 验收：从"文件能解码"到内容级体检

首批 113 张全部通过当时的检查（PNG 合法、832×1216、colorType=6、有 IEND、可解码），说明文件层校验对生成错误完全无效。现在加了一条无需人眼的内容判据（`inspectPortrait` / `portraitRejectReasons`）：

| 指标 | 阈值 | 依据 |
|---|---|---|
| `edgeEnergy`（不透明区相邻像素平均梯度） | ≤ 6 | 113 张坏图实测 8-35，正常立绘 1.9-4.7 |
| `clearFrac`（alpha<32 占比） | ≥ 5% | 背景真的透明；拦下约 15% 的"白底"出图 |
| `opaqueFrac`（alpha>200 占比） | ≥ 20% | 有主体 |
| `midFrac`（alpha 32-200 占比） | ≤ 10% | 半透明只该出现在轮廓边（正常 0.5-1.7%）；整幅起雾的脏蒙版会到 30%+ |
| 尺寸 | = 832×1248 | 四表情同画幅 |

不合格**换种子**重试（`seed + attempt*7919`）——稳定种子会让同一缺陷无限复现，不换种子等于死循环。

`midFrac` 这条是**跑完全量之后才补的**：`leo-teary` 半透明占 33.1%（其余 199 张最高 1.7%），等于整幅蒙了一层雾，但前三条全部通过——它的 alpha 既不在"全透"也不在"不透"的判据区间里。补上规则后重跑，第 1 次就复现同一 33.1%（种子稳定），第 2 次合格。**教训**：一组阈值各管一段时，中间地带就是盲区；新加一个统计量，必须同时决定它能不能否决。

全量结果：50 角色 × 4 表情 = 200 张，200/200 通过体检；`edgeEnergy` 1.90-4.74，`clearFrac` 28.2-52.3%，`midFrac` 最高 1.7%。约 15% 的生成至少需要一次换种子重出，耗时 4591s（76.5 分钟）。

## 产物两级：原图不入库

832×1248 RGBA 原图约 1.1MB/张，200 张 = **215MB**，而整个仓库工作区当时只有 99MB、最大单文件 10MB——直接提交会让 git 历史永久翻倍且不可逆（要减只能重写历史 + force push）。交付尺寸也不该按原图定：UI 里 `AvatarStand` 默认 216 CSS px 宽，512 已够 2.3×DPR。

所以：**原图写 `app/.portrait-masters/`（gitignore）**，只作参考图和重打包源；**512×768 交付图写 `public/love-portraits/`（入库）**，200 张 76MB（约 390KB/张）。`--pack-only` 只重打包不重出图（约 6 分钟）。缩放是纯 Node 实现（面积平均 + 预乘 alpha，避免边缘描边；逐行自适应 filter），实测缩放前后 alpha 分布平均只差 0.08%，交付图同样全数过体检。

> 记一笔估错的地方：当时按 250KB/张 ≈50MB 报的预算，实测 390KB/张 =76MB。PNG 对这种平涂+软边 RGBA 就是压不下去，真要更小得换 WebP/AVIF（需引入编码依赖）。

## 遗留与风险

- **编辑路径会整段锁白底**：同一（prompt, 参考图）下可能连续多次全不透明。`tess/smile` 一度 3/3 全失败，重试上限已从 3 提到 5；仍失败的项在日志里以 `失败: 连续 N 次体检不合格` 报出，需要单独重跑。
- **改 prompt 措辞治不了白底**：A/B 各 3 次（`transparent background` vs 加强版 `isolated on a fully transparent background (alpha channel), no background scenery…`）6/6 全过，差异不可测；也就是说这是采样运气问题，不是文案问题。
- **性别只能从文案代词推**：语料没有 `appearance`/`gender` 字段。50 个角色里 45 个自身 `personality`/`role` 文案的英文代词无歧义（24 女 / 21 男），`maya`、`leo`、`kai`、`sam`、`dani` 5 个无证据（`kai`、`sam` 文案用 they/them）→ prompt 写 `a person` 交给模型（用户 2026-10-10 决定）。这是**内容层面已知的不确定性**，不是 bug；将来若给语料补 appearance 字段，应改为读字段而不是猜。
- **人眼验收**：`edgeEnergy`/alpha 能拦噪点和脏蒙版，但拦不住"画得丑""不像这个人""四个表情区分不开"。已目视确认的样本：tess 全 4 表情（中性/微笑/紧张/含泪彼此可辨、同一人）、daryl/kai 等若干 neutral、以及修复前后的对照单张。**未确认**：立绘透明边缘叠在应用场景渐变上的实际合成效果——本次 in-app Browser 表面不可用（`visibilityState=hidden`，截图与 DOM 读取都拿不到有效结果），这一条留给人工过一遍。
- **目视缩略图会误导**：`kai-neutral` 在压缩到约 150px 的预览里像"戴了白色口罩"，按面部条带取样后（嘴部 RGB 241,210,174、色度差 67）确认是正常肤色，深色的是刘海。分辨率不够时不要从缩略图下内容结论，改测像素统计。
