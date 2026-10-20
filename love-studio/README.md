# SocialCoach · Love Studio

**生成式恋爱故事沙盒 —— 不是教练评分。**

Love Studio 是 SocialCoach 恋爱子系统里的「先玩一局」入口:导入或生成一个角色,让模型实时
写出一段可玩的视觉小说(立绘、背景、音乐跟着剧情换,存档 / 分支 / 回看),玩完可以把故事和
角色包带回去继续。它**不**做教学评分、**不**写能力分、**不**强制复盘 —— 那些是主站教练模式
(文字 / 3D / 自定义排练)的事,两套系统各管各的。

- **它是什么**:一个本地运行的 AI 视觉小说应用(React + Vite 前端,FastAPI + SQLite 后端)。
  数据都在这台机器上,可导出、可擦除。
- **它不是什么**:不是通用聊天入口,不是主站教练的延伸,不接 SocialCoach 账号或服务端存储。

> 本目录是 [AnimaVN](https://github.com/JayziLi/AnimaVN-public)(MIT)的 fork。来源、授权与
> 已移除的上游素材见 [NOTICE.md](./NOTICE.md);上游原始 README 留在
> [UPSTREAM-README.md](./UPSTREAM-README.md),仅作对照。

## 装和跑(一条命令)

先装好 **Python 3.11+** 和 **Node.js**(都进 PATH)。然后在 `love-studio/` 下:

| 平台 | dev(快) | 打包预览(慢、更像成品) |
|---|---|---|
| Windows | 双击 / 运行 `start.bat` | `play.bat` |
| macOS | `./start.sh`(也可双击 `start.command`) | `./play.sh` |
| Linux | `./start.sh` | `./play.sh` |

首次运行会:在 `love-studio/.venv` 建 Python 虚拟环境并装后端依赖 → 在
`love-studio/frontend/node_modules` 装前端依赖 → 起后端 → 起前端 → 等健康检查通过 → 打开浏览器。
**只装在仓库里**(`.venv/`、`frontend/node_modules/`),不动全局解释器,不写 `$HOME`。

macOS 上如果 `.sh` / `.command` 不能直接跑,先 `chmod +x start.sh play.sh start.command`。

## 端口与健康契约

- 前端(Studio 唯一的规范地址):**http://127.0.0.1:5180**
- 后端(FastAPI):**http://127.0.0.1:8000**
- 健康检查:**http://127.0.0.1:5180/api/health** —— 由前端 dev / preview 服务器把 `/api`
  **反代**到 `http://127.0.0.1:8000`,`/api/health` 直接回后端的健康 JSON
  (`{"status":"ok","version":"...","db":"ok"}`)。所有后端接口和素材都在 `/api` 下,一条规则覆盖。

**同一时刻只能开一个 5180**:dev 和 preview 共用这个端口,`vite` 配了 `strictPort`,端口被占
会直接报错(不会悄悄退到 5181 —— 否则上面那条健康契约就不成立了)。先关掉一个再开另一个。

端口可用环境变量覆盖:`STUDIO_PORT`(前端,默认 5180)、`BACKEND_PORT`(脚本里的后端,默认
8000);前端本身也认 `VITE_PORT`。后端地址另有 `VITE_API_BASE_URL`(见 `frontend/.env.example`):
不设时前端跟着地址栏主机连 `:8000`;设成空串 = 同源(走反代)。

## 接到模型 / 网关(BYOK)

Studio **不带**任何模型额度,用自己的 key(自带密钥,BYOK)。在界面的「连接 / 模型」里新建:

- **OpenAI 兼容**:OpenAI、OpenRouter、DeepSeek、GLM、本地 Ollama / LM Studio / vLLM 等,
  填 `base_url`(多数要以 `/v1` 结尾)+ 模型名 + key。
- **Anthropic**:Claude,填 key + 模型名。
- **Mock(本地测试)**:不联网也能跑通流程,默认就是它 —— 标着「本地测试」,不会假装成真模型。

默认那一档是**诚实可见、可切换**的:没配 key 时默认 Mock;配了 key 会按你选的连接启用。想省钱
就自己挑便宜快的模型档,但**不会**在背后偷偷降质 —— 当前用的连接和模型名在界面上一直看得到。
流式默认开(可按连接关掉,有些中转不认)。模型报错(密钥无效 / 限流 / 地址不对)都会翻成看得懂的
一句中文,不会把原始异常或 key 甩到界面上;key 不写日志、不回显(界面只显示「已保存」)。

## 密钥策略

- **默认「记住密钥」**:连接里填的 API 密钥存进**本机 SQLite**(和连接配置一起,只在这台机器上),
  下次启动不用重填。
- **可关**:连接抽屉里「记住密钥(存本地数据库)」开关关掉后,已保存的密钥会**从本地数据库移出**,
  只在**当前进程内存**里活着;重启 Love Studio 后需要重新填写。
- 约束:密钥**不进日志、不回显、不提交**(界面只有 `has_api_key` /「已保存」,没有明文)。

## 内容分级

- **默认 SFW。**
- **成人内容**:只在本机版本、**年龄门控**、**默认关闭**;要开得自己动手。
- **硬限制**:未成年人、真人肖像、非自愿内容 —— 一律不做。
- UGC(导入的角色卡 / 图 / 音)由用户自己负责来源与授权;manifest 记录 `source` / `license`。

## 创作者模式(调试台默认隐藏)

普通玩家打开只看到故事、存档和设置这几页,看不到提示词调试台、提示词检查器、插件 / 预设
编辑、立绘包管理等创作工具(调试台默认**不**渲染)。想改角色、调提示词时:

- 在「设置 → 显示 → 创作者模式」切到「完整调试台」,或
- 地址栏加 `?creator=1` 打开(`?creator=0` 关掉)。

这个开关按设备记在浏览器 localStorage(`studio.creatorMode`),默认关。

## 回主站

故事结束要回主站的恋爱域页面时,返回地址在
`frontend/src/debug/lib/studioConfig.ts` 的 `MAIN_SITE_LOVE_URL`(默认
`http://localhost:3000/love`)—— 需要接线的地方引这个常量,不要另写死。

## 授权与素材

- 代码 MIT,上游版权 `Copyright (c) 2026 JayziLi`,许可证见 [LICENSE](./LICENSE)。
- 本仓库**不含**上游自带的 CC BY-NC-SA 角色立绘,也**不含**《碧蓝档案》第三方音效
  (均已在 fork 移除);素材授权逐项见 `frontend/public/vn/CREDITS.txt` 与各 `seed_data/`
  角色目录的 `CREDITS.txt`。详见 [NOTICE.md](./NOTICE.md)。