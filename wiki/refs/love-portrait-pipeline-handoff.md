# 恋爱立绘管线交接（2026-10-10）

> 交接对象：有视觉能力的 AI / 人工。症状已由用户视觉确认。
> 相关：[恋爱 Galgame 模式 spec](../specs/spec-love-visual-novel.md)

## 症状

恋爱 Galgame 立绘管线生成的 PNG **内容是彩色噪点，不是正常图像**（用户人工打开确认）。所有角色 × 4 表情（共 113 张 + tess 首批 4 张）全部如此。**前端已隔离**：`public/love-portraits/` 清空，应用回退到 SVG 占位头像，不显示乱码。坏产物暂存在仓库根 `_portrait-dump/`（gitignore，未入库）。

## 客观数据（无视觉工具已测）

- PNG 文件结构全部合法：832×1216，colorType=6（RGBA），有 IEND，113/113 可解码——**文件没损坏**，问题在**解码后像素内容**。
- 透明底版本（BEN2 抠图后）：不透明像素仅 2-6%——抠图把 94% 内容删了，只剩零星碎片（这也是噪点被"抠没"的叠加）。
- 无抠图版本（`--no-matte --force` 重出 1 张）：不透明像素 37.5%，平均 RGB 约 (131,130,127) 中灰——**噪点特征**（真实人物立绘的平均色应偏向肤色/衣色，不会是全图平均中灰）。

## 根因方向（待有视觉 AI 确认）

用户视觉判断"流程有问题、出来是彩色噪点"——**生成阶段就错了**，不是抠图或文件层。最可能的工作流级原因：

1. **千问 IMAGE 2.1 是 flow 模型**（非 SD 类）：cfg 语义不同（本管线用 cfg=1.0 系 Flow，需要确认千问 2.1 的正确 sampler/scheduler/cfg 组合）。
2. **int8 convrot 量化权重**（`qwen_image_2.1_int8_convrot.safetensors`）加载：convrot 是旋转量化，若 UNETLoader 未正确启用 convrot 解码后端，可能输出无效 latent → VAE 解码成噪点。
3. **CLIP 编码器**用 `CLIPLoader(type=qwen_image)` + `qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot`：若 CLIP 类型/精度不对，prompt 语义进不去 → 生成像随机噪声。
4. **参考图 I2I**：neutral 作参考 → 其余表情走 `TextEncodeQwenImage21` 的 `images.image_1` + vae 参考输入。若参考 latent 拼接错误，会直接污染生成。
5. **VAE**：`qwen_image_2.1_vae_bf16` 解码 latent——VAE 与 UNET 版本不匹配会出噪点（千问 2.0 与 2.1 的 VAE 是否兼容需验证；本机 `vae/qwen_image_vae.safetensors` 是旧版，未用）。

## 本机环境

- ComfyUI：`D:\ComfyUI_Mie_2026_V8.0\ComfyUI`，服务 `http://127.0.0.1:8188`（可用启动器 `ComfyUI启动器-CLI.cmd`，或直跑 `python_embeded\python.exe main.py --port 8188 --listen 127.0.0.1`）。
- 模型（都在 `D:\ComfyUI_Mie_2026_V8.0\ComfyUI\models\`）：
  - diffusion：`diffusion_models\qwen_image_2.1_int8_convrot.safetensors`（管线当前用这个）
  - VAE：`vae\qwen_image_2.1_vae_bf16.safetensors`（当前用）；`vae\qwen_image_vae.safetensors`（旧版备用）
  - 文本编码器：`text_encoders\qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors`（T2I）、`qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors`（I2I 参考）
- 已安装 Qwen 节点：`QwenLoader`（⚠️ 实测属 WanVideoWrapper，不适用千问 Image——正确做法是 `CLIPLoader(type=qwen_image)`）、`TextEncodeQwenImage21`、`TextEncodeQwenImage21GH`、`QwenImage21PromptGenerator|Mie`、`EmptyQwenImageLayeredLatentImage`（⚠️ 本机 2.1 unet 只吃 4D，5D 分层会崩，改用了 `EmptyLatentImage`）、`NunchakuQwenImageDiTLoader` 等。

## 当前管线用的工作流（`app/scripts/gen-love-portraits.mjs` 内嵌）

文生图：`UNETLoader(qwen_image_2.1_int8_convrot)` → `CLIPLoader(pe_t2i, type=qwen_image)` → `VAELoader(qwen_image_2.1_vae_bf16)` → `TextEncodeQwenImage21` → `EmptyLatentImage(832×1216)` → `KSampler(euler/simple, 30步, cfg=1.0)` → `VAEDecode` → `easy imageRemBg(BEN2)` 抠图 → `SaveImage` → 下载写盘。
图生图：neutral 作参考，`TextEncodeQwenImage21` 的 `images.image_1` + vae 参考输入，编码器换 `pe_i2i`。

## 给有视觉 AI 的检查任务

1. 打开 `_portrait-dump/` 任选 2-3 张确认噪点形态（纯随机噪点？有结构但灰？带纹理碎片？）。
2. 检查 `app/scripts/gen-love-portraits.mjs` 内嵌工作流，对照本机 ComfyUI `object_info` 验证节点参数；重点核对：
   - 千问 2.1 官方推荐 sampler/scheduler/cfg（该模型官方示例是 euler + 什么 scheduler + cfg 多少？）——**这是第一嫌疑**。
   - convrot int8 模型是否需要专用 loader 或后端开关（`NunchakuQwenImageDiTLoader` 是否是正确入口？）。
   - CLIP 类型：`type=qwen_image` 是否真实对应 pe_t2i 编码器；prompt 模板是否给足角色描述。
   - VAE 版本匹配。
3. 修好工作流后：用 `node scripts/gen-love-portraits.mjs --roles=tess --emotions=neutral --no-matte --force` 单张试出（24s/张），视觉确认正常 → 再 `--roles=tess`（4 表情含抠图）→ 全量 50 角色。
4. 产物目标：半身立绘、统一画风、透明底 PNG（或先不带透明，由前端背景合成）。

## 验收

- 图片内容必须是**可辨认的人物立绘**（肤色/衣色/五官），不是噪点。
- 表情 4 变体在视觉上可区分。
- 生成管线 `source` 可溯源（prompt/seed/模型记录在 manifest，脚本已做）。
- 修好后重新生成全部角色，`public/love-portraits/` 恢复产物 + manifest，前端自动从 SVG 回退切回 PNG 立绘（无需改前端）。

## 相关文件

- 生成脚本：`app/scripts/gen-love-portraits.mjs`（prompt 构建/API 提交/轮询/下载/幂等/manifest）
- 前端接入：`app/src/components/love/PlaySceneFigure.tsx`（manifest 命中用 PNG，缺失回退 AvatarFigure）
- 前端 manifest 类型：同文件 `LovePortraitManifest`
- 坏产物：`_portrait-dump/`（113 张，gitignore）
