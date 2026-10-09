# SocialCoach 桌面壳（Tauri）

把 `app/`（Next.js 16）打包成 Windows 桌面应用的集成目录。**不修改 `app/` 的 web 主线**——所有壳逻辑、打包脚本和产物都收在 `desktop/` 里。

## 架构：壳 + 本地服务器（sidecar）

SocialCoach 是 Next.js，有 12 个 `/api/*` 路由、动态路由 `/practice/[id]` 和流式输出，**无法静态导出**。因此桌面版采用「Tauri 壳 + 本地 Next standalone 服务器」模式：

```
┌─────────────────────────────────────────────┐
│  SocialCoach.exe（Tauri 壳，Rust）            │
│  ├─ WebView2 窗口 → http://127.0.0.1:3210   │
│  └─ 生命周期：spawn sidecar → 轮询 /api/health │
│        → 就绪后显示窗口 → 退出时 kill 子进程    │
└─────────────────────────────────────────────┘
        │ 启动 / 停止
┌─────────────────────────────────────────────┐
│  sidecar/runtime/（随安装包分发）              │
│  ├─ node.exe        （固定版本，构建时下载一次） │
│  └─ server.js + node_modules + .next/static   │
│     + public        （Next standalone 产物）   │
└─────────────────────────────────────────────┘
```

- **端口固定 3210**（避开 3000 的 dev 端口）；`single-instance` 插件防多开撞端口。
- **dev 模式**（`tauri dev`）不启动 sidecar：`beforeDevCommand` 跑 `next dev`（3000），`devUrl` 指向它——改前端热更新，壳照常。
- **生产模式**（`tauri build`）：`beforeBuildCommand` 先组装 runtime，壳加载 `http://127.0.0.1:3210`。
- **托盘语义**（继承模板）：关窗口 = 隐藏到托盘（进程驻留，sidecar 继续跑）；托盘菜单 **Quit** 才是真正退出——`app.exit(0)` 触发 `RunEvent::Exit` 清理 node 子进程。

## 目录布局

```
desktop/
├── package.json          # 脚本入口（desktop:runtime / desktop:smoke / desktop:dev / desktop:build）
├── scripts/
│   ├── build-runtime.mjs # next build(standalone) → 组装 runtime + 下载 node.exe
│   └── smoke-runtime.mjs # 不带壳直接冒烟：node server.js → /api/health → kill
├── src-tauri/            # Tauri 壳（模板 N:\tauri-app-template-main 的 src-tauri 为底座改造）
│   ├── tauri.conf.json   # 产品名/标识/窗口/资源映射/构建命令
│   └── src/
│       ├── lib.rs        # setup：spawn sidecar → 就绪轮询 → 显示窗口；Exit 时 kill
│       └── next_server.rs# 启动/健康轮询实现（std 实现，无额外依赖）
├── sidecar/runtime/      # 构建产物（gitignore）：随安装包分发的运行环境
├── vendor/               # 下载的 node.exe 缓存（gitignore）
└── README.md
```

## 前置条件

- Node ≥ 22、pnpm ≥ 9
- Rust ≥ 1.70（`rustup` + MSVC 工具链）
- WebView2 Runtime：Windows 10/11 自带；Windows 7/8 需要[安装](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
- NSIS（`tauri build` 会自动下载）

## 构建与运行

```bash
cd desktop
pnpm install                # 安装 @tauri-apps/cli（唯一依赖）

# 1) 组装运行时（next build + standalone 拷贝 + node.exe 下载，~1-2 分钟）
pnpm desktop:runtime

# 2) 不带壳冒烟：验证 runtime 的 Next 服务器能自己跑起来并应答
pnpm desktop:smoke          # 期望输出 /api/health answered 200

# 3) 打 Windows 安装包（NSIS，含简体中文）
pnpm desktop:build          # 产物在 src-tauri/target/release/bundle/nsis/
```

开发模式（壳 + 热更新前端）：

```bash
pnpm desktop:dev            # 自动跑 app/ 的 next dev，壳窗口指向 localhost:3000
```

## 安装包内容与体积

NSIS 安装包约 **70–90 MB**（WebView2 引导器 + node.exe ~30MB + Next standalone ~30–40MB + 壳 ~5MB）。自动更新当前关闭（占位公钥会让本地构建崩），启用需要：

1. `pnpm tauri signer generate` 生成密钥对，把公钥写进 `tauri.conf.json` 的 `plugins.updater.pubkey`
2. 在 `tauri.conf.json` 补 `plugins.updater.endpoints` 为真实发布地址，`createUpdaterArtifacts: true`
3. 构建时启用 feature：`cargo tauri build --features updater`（`Cargo.toml` 已预留 `updater` feature，依赖可选化）
4. 参考模板的 `.github/workflows/release.yml` 用 tag 触发构建 + 发布

## 本目录与主仓库的关系

- 主仓库 `app/` 仍是唯一开发主线；`desktop/` 只读 `app/` 的构建产物，不改任何 web 代码。
- 模板来源：`N:\tauri-app-template-main`（Tauri 2 + React 模板）——仅借用其 `src-tauri/` 壳骨架（托盘/单实例/更新插件），前端整体不用（SocialCoach 自带 Next 前端与双语）。
- 桌面壳改动后必须重建并冒烟（`desktop:build` + 进程存活 + `/api/health` 应答 + 关停），见根 `AGENTS.md` 桌面规范。

## 已知边界与后续增强

| 项 | 现状 | 建议 |
|---|---|---|
| 图标 | 模板占位图标 | 替换为 SocialCoach 正式图标（`src-tauri/icons/`，一套 10 张） |
| 模型密钥 | 走 Web 的 localStorage（明文） | 后续加 `tauri-plugin-keyring` 迁移到系统安全存储（不动 web 主线，壳侧注入） |
| 自动更新 | 关闭（无发布渠道；feature 已预留） | 见上「安装包内容与体积」 |
| 代码签名 | 未签名（SmartScreen 会提示） | 发布前用代码签名证书签名 exe/nsis |
| 安卓 | 不在本壳范围 | 需要 Capacitor 或 TWA 另一条线，见主仓库讨论 |
| 3D 饭局 | 依赖 WebGL，WebView2 支持良好 | 低配机器验收帧率；WebView2 的 GPU 策略见 [WebView2 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/gpu) |

## 故障排查

- **runtime 服务器起不来，报 `Cannot find module '@swc/helpers/_/_interop_require_default'` 或 `'@next/env'`**：pnpm 的 standalone 输出是符号链接农场（`next`/`react` 链接进 `node_modules/.pnpm/<pkg>/…`），直接拷贝会留下指向开发机的死链接。`build-runtime.mjs` 已用 `dereference + flattenPnpmStore()` 把虚拟 store 摊平到顶层 `node_modules`——如果手工重建 runtime 目录，务必保留这两步。
- **窗口一直不显示**：sidecar 没起来或 `/api/health` 未应答——release 构建缺 `sidecar/runtime` 时控制台会有 `[next-server] missing ...` 日志（`windows_subsystem` 下不可见，可临时改 `main.rs` 的 `#![cfg_attr]` 或看安装目录是否含 `runtime/node.exe`）。
- **端口被占**：`netstat -ano | findstr 3210` 找到占用进程；single-instance 已防壳多开，但手动跑过 `node server.js` 会占用。
- **强杀（崩溃/任务管理器结束）后 node.exe 残留**：`TerminateProcess` 绕过 `RunEvent::Exit` 回调，sidecar 不会被清理，3210 端口被占。重启应用前先 `taskkill /IM node.exe /F` 或在任务管理器结束残留的 node。正常退出（托盘 Quit）无此问题。
- **`pnpm --dir` 不可用**：pnpm < 8.5 时用 `cd ../app && pnpm dev` 替代（`tauri.conf.json` 的 `beforeDevCommand`）。
