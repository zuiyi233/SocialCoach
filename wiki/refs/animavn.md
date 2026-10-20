# AnimaVN 参考：能借什么、不能借什么（2026-10-21）

> 外部项目：`L:\AnimaVN-public-main`（GitHub `JayziLi/AnimaVN-public`）
> 用途：作为恋爱子系统里 **Love Studio（生成式 Galgame）** 的基座候选。本文只记事实与取舍，方案见 [spec-love-studio.md](../specs/spec-love-studio.md)。
> 授权：用户已取得项目授权；代码 MIT，自带角色立绘 CC BY-NC-SA（不在 MIT 范围），示例素材 MIT / CC BY。

## 1. 它是什么

本地运行的 AI 视觉小说应用：LLM 写剧情，立绘/场景/BGM 跟着剧情换，角色用 GPT-SoVITS 的声音念台词；支持酒馆角色卡、世界书、Chat Completion 预设、宏、聊天记录导入。

- 前端：React 19 + Vite + TypeScript，约 7.2 万行 TS/TSX；没有路由，调试台 + Visual Novel 两个视图。
- 后端：Python 3.11+ / FastAPI / SQLAlchemy / SQLite，约 1.9 万行 Python。
- 存储：`AnimaBackend/data/animabackend.db` + 文件；角色卡、存档、立绘、场景、声音都在本地。
- 模型：OpenAI 兼容 / Anthropic / Mock；流式；思考内容拆分；本地 Ollama / LM Studio / vLLM。

## 2. 能力清单（对恋爱子系统的价值）

| 能力 | 实现 | 对 Love Studio 的价值 |
|---|---|---|
| 角色卡 | PNG `chara` / `ccv3`、JSON V1/V2/V3；`extensions` 原样保留 | 用户可导入现成角色；导出/再导入不丢字段 |
| 世界书 | 照酒馆 1.18 的 `checkWorldInfo` 移植；关键词/逻辑/正则/递归/概率/分组/延迟/8 种插入位置 | 长线角色的设定一致性 |
| 预设 / 宏 | Chat Completion 预设、89 个宏、人设、聊天记录 jsonl | 用户把自己调好的风格带进来 |
| 剧情 | LLM 实时写、逐句切分、流式、随时插话 | 用户生成文本，不是只选内置选项 |
| 立绘 | 表情标签、批量上传、按脸对齐、切换特效、气泡/音效 | 用户生成/上传角色表情 |
| 场景 | 背景 + BGM 场景包、CG 差分 | 用户生成场景与事件插图 |
| 生图 | NovelAI（`image.novelai.net/ai/generate-image`，返回 zip）；两段式提示词；角色参考；SFW/成人保护词 | 生成 CG/场景；角色一致性靠参考图 |
| 语音 | GPT-SoVITS / IndexTTS；逐情绪参考音频；日配 + 中字；缓存 | 角色自己的声音；有 GPU 的用户可本地跑 |
| 阅读 | 逐句演出、auto/skip、历史重播、存档/分支、设置 | 接近商业 Galgame 的阅读体验 |
| 调试台 | 完整提示词、token 预算、世界书触发原因、思考过程 | 创作者调角色/预设的效率 |

## 3. 耦合事实（决定能不能搬）

- 前端 **130 个文件** import `frontend/src/debug/lib/api.ts`；`BASE_URL` 默认指向 `:8000`。
- `VNScreen.tsx`（2590 行）本身不持有对话数据，`entries`、立绘、场景、声音配置都由 `DebugApp.tsx` 以 props 传入；**渲染核心可以后端无关，但产出这些 props 的存储/资源/生成全在后端**。
- 后端 34 张 SQLite 表；角色卡、聊天、立绘包、场景包、声音、blob 全走 FastAPI。
- 内容持久化是 SQLite；localStorage 只存 UI 偏好（字号、BGM 音量等）。
- 所以：**不能只搬 VN 屏幕**；要么带 Python/SQLite，要么重写整个 `lib/api` 层（约 1,900 行）与资源管线。

## 4. 可借的 MIT 代码 / 思路

- `frontend/src/debug/lib/cardParser.ts`、`worldInfo.ts`、`presetParser.ts`、`macroEngine.ts`：角色卡、世界书、预设、宏的解析与匹配。移植时保留 MIT 版权头，并在本文记录来源。
- `frontend/src/debug/vn/script.ts`、`timeline.ts`、`tags.ts`：逐句切分、标签剥离、每句状态。只在做流式逐句时需要；剧本模式目前是非流式 JSON，不强依赖。
- `AnimaBackend/app/plugins/imagegen/assemble.py`、`nai.py`：两段式提示词、人数/服装/POV/SFW 守卫、NovelAI 请求形状（zip、浏览器 UA、单并发、免费额度）。只借思路与请求形状，Python 不直接搬进 Next。
- `AnimaBackend/app/tts/gpt_sovits.py`、`indextts.py`：`/tts`、权重切换、参考音频、缓存。若做本地语音桥，可按此契约接。
- `frontend/src/debug/plugins/imagegen/`：生图 UI 与计划器交互；只作交互参考。

## 5. 不借

- Python FastAPI + SQLite 运行时进主站 / Vercel；主站不引入第二套服务端存储。
- Vite/全局 CSS/调试台直接进 Next App Router；端口成本高于收益。
- 自带 DeepSeek娘立绘（CC BY-NC-SA，不可商用）与第三方角色截图。
- 完整 Chat Completion 预设执行（`prompt_order`、jailbreak、覆盖系统提示）——会破坏半教练/剧本模式的输出契约与角色边界。只取风格块与采样参数。
- 情绪 embedding 作为首选方案：它解决「立绘标签与模型情绪对不上」，而我们的 4 情绪枚举 + 导入时显式映射更便宜、可调试；ONNX 兜底另议。

## 6. 接入形态

| 形态 | 做法 | 适合 |
|---|---|---|
| **本地伴生** | fork 成 `love-studio/`，用户本地运行；主站链接 `http://127.0.0.1:5180` | v1 推荐；保留全部能力，不破坏主站无服务端存储 |
| **托管独立服务** | Docker + 账号 + 每用户隔离存储 + GPU TTS + 生图代理 | v2；2–4 周基础设施，单独决策 |
| **端口进 Next** | 把前端/后端重写到 Next + 设备存储 | 不推荐；9 万行 + 34 表，TTS/生图/情绪模型全重做 |

## 7. 安全与隐私注意

- NovelAI token：AnimaVN 由后端持有；若我们做代理，token 每请求携带、不落库、日志不回显；聊天 BYOK 仍保持浏览器直连。
- UGC：卡/图/音由用户负责；manifest 记录 `source` / `license`；不随仓库分发第三方素材。
- 内容分级：默认 SFW；成人内容本地/年龄门控；未成年人、真人肖像、非自愿是硬限制。
- 本地 SQLite 含用户聊天与角色数据；导出/擦除必须可用。

## 8. 来源

- `README.md`（能力、兼容表、授权、启动方式、TTS/生图说明）
- `LICENSE`（MIT，Copyright 2026 JayziLi）
- `frontend/src/debug/lib/api.ts`（BASE_URL、接口面）
- `frontend/src/debug/vn/VNScreen.tsx`（props 驱动）
- `AnimaBackend/app/plugins/imagegen/nai.py` / `assemble.py`（NovelAI 请求与提示词）
- `AnimaBackend/app/tts/gpt_sovits.py`（TTS 契约）
- 本仓库核对时间：2026-10-21；未运行其完整测试套件，规模/耦合来自源码清点。
