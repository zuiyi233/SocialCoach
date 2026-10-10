# 本机 ComfyUI + Qwen Image 2.1 出图参考

> 查阅对象：本机 `D:\ComfyUI_Mie_2026_V8.0\ComfyUI`（ComfyUI 0.39.0，frontend 1.55.14）与千问 IMAGE 2.1 节点。
> 用途：恋爱立绘等程序化出图。踩过的坑与验收口径见 [立绘管线复盘](../81-postmortem-love-portrait-pipeline.md)。

## 服务

- 地址 `http://127.0.0.1:8188`。
- 启动：`ComfyUI启动器-CLI.cmd`，或直跑 `python_embeded\python.exe main.py --port 8188 --listen 127.0.0.1`。
- 启动器的 `ready:false` 不可信（custom nodes 多，60s 探测窗口不够）——排障轮询端口和日志。

## 可用模型组合（实测出图正常）

| 角色 | 文件 | 位置 |
|---|---|---|
| diffusion | `qwen_image_2.1_turbo_bf16.safetensors` | `models/diffusion_models/` |
| text encoder | `qwen3vl_8b_int8_convrot.safetensors`，`CLIPLoader.type=qwen_image` | `models/text_encoders/` |
| VAE | `qwen_image_2.1_vae_bf16.safetensors` | `models/vae/` |

不可用/不适用：

- `qwen_image_2.1_int8_convrot` + `qwen3.5_9b_..._pe_t2i` / `pe_i2i`：这套组合出彩色噪点。`pe_*` 是提示词增强编码器，不是出图路径的文本编码器。
- `QwenLoader`：名字像千问 loader，实际属 WanVideoWrapper。千问 Image 用 `CLIPLoader(type=qwen_image)`。
- `EmptyQwenImageLayeredLatentImage`：给 `qwen_image_layered` 分层模型用的 5D latent（`[B,16,layers+1,H,W]`），2.1 UNet 只吃 4D，接上会崩。**与透明底无关**，透明底不需要它。
- `vae/qwen_image_vae.safetensors`：千问 1.0 的旧 VAE，别和 2.1 混用。

## 采样：Turbo 必须走官方 8 步 sigma

```
KSamplerSelect(sampler_name=euler)
ManualSigmas(sigmas="1, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0")
SamplerCustom(add_noise=true, noise_seed=<seed>, cfg=1.0,
              latent_image=<见下>)
```

蒸馏 flow 模型只在这条轨迹上有效。`KSampler(steps=30, scheduler=simple, cfg=1)` 不是"质量差"而是直接出噪点。`cfg=1` 时负向提示不参与采样（CFG 分支被跳过）。单张约 12-18s。

## latent 来源

`TextEncodeQwenImage21` 的第 3 个输出（`latent`）就是采样用的 latent，尺寸取**首张参考图**（`comfy_extras/nodes_qwen.py:181`）。

- 图生图（编辑）：必须接 `["<TextNode>", 2]`。节点注释明确"其他尺寸会偏移编辑结果"。
- 文生图：该输出是 `resolution × resolution` 正方形，要竖版得显式接 `EmptyLatentImage(width, height, batch_size=1)`。2.1 UNet 接受非正方形 4D latent（实测 832×1248 正常）。

## 透明背景是原生的，不要抠图

`qwen_image_2.1_vae_bf16` 是 **Wan 2.2 布局的 RGBA VAE**（`comfy/sd.py:840`）：`spacial_downscale_ratio=16`、`latent_channels=64`、encoder 输入 4 通道、decoder 输出 4 通道、`pad_channel_value=1.0`（RGB 输入补成不透明）。alpha 由模型自己生成，`VAEDecode → SaveImage` 直接写出透明 PNG（`SaveImage` 对 `[H,W,4]` 走 PIL RGBA）。

`TextEncodeQwenImage21` 处理参考图时（`nodes_qwen.py:170`）："视觉塔看的是 alpha 叠白，VAE 保留全部四通道"。所以**参考图要保留 alpha**：

| 参考图 | 出图 alpha |
|---|---|
| 原样 RGBA | 双峰（约 43% 近透明 / 56% 不透明）✓ |
| 先叠白成 RGB | 100% 不透明，模型照抄白底 ✗ |

`LoadImage` 走 pyav `gbrpf32le` 解码，实测 alpha 能进到 VAE 参考 latent。

## API 格式的两个硬坑

1. **Autogrow 输入必须用点号键**。`TextEncodeQwenImage21` 的 `images` 是 `COMFY_AUTOGROW_V3`：

```js
inputs: { "images.image_1": ["10", 0] }   // ✓
inputs: { images: { image_1: ["10", 0] } } // ✗ 静默忽略，参考图不生效、不报错
inputs: { image_1: ["10", 0] }             // ✗ TypeError: unexpected keyword argument
```

   判据：出图尺寸。参考图生效 → 跟随参考图（如 832×1248）；被忽略 → 退回 `resolution` 正方形。
2. `resolution` 按 32 取整并保持宽高比，所以 832×1216 的参考图会算成 **832×1248**（正好 2:3）。要让文生图与编辑图同画幅，`EmptyLatentImage` 也得用 832×1248。

## 常用端点

`POST /prompt`（`{prompt, client_id}`）· `GET /history/<id>`（`status.status_str`、`outputs[*].images`）· `GET /view?filename&subfolder&type` · `POST /upload/image`（multipart，`type=input&overwrite=true`）· `GET /object_info/<Node>`（节点签名以此为准）。
