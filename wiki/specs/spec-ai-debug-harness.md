# AI 调试引擎

> 状态：v1 已落地（2026-10-22）。入口 `app/scripts/debug.mjs`，运行时目录 `app/.debug/`（已忽略）。
> 摩擦日志：`app/debug/FRICTION.md`。本文是契约与用法；摩擦日志是实测记录。

## 1. 问题

让 AI 靠截图识别按钮、再模拟人类点击，做功能迭代有三个硬伤：

1. **慢**：一次「打开页面 → 找到按钮 → 点击 → 等渲染」要几秒到几十秒，且每步都要多模态推理。
2. **脆**：按钮位置、文案、动画、视口都会变；同一段流程重跑一次就可能点错。
3. **贵**：真实模型调用既花钱又抖动；同样的恋爱回合，两次输出不同，失败无法复现。

目标不是「让 AI 更像人」，而是**让 AI 直接驱动应用的状态机**：能用一条命令做的事，不要用三次点击。

## 2. 设计原则

| 原则 | 做法 |
|---|---|
| 不做视觉识别 | 控件挂 `data-debug="..."`，命令用语义别名（`love.send`）或可访问名（`--text`） |
| 不模拟人类 | 页面内 `__sc.click/type/wait` 直接调用 DOM API；React 输入用原生 setter + `input` 事件 |
| 状态先于流程 | `state.load` 直接把 localStorage 设到目标状态，跳过 onboarding / 前置对话 |
| 模型可回放 | `model.use` 用 CDP `Fetch` 拦截 `/api/*`，按请求语义返回夹具；不联网、不花钱、不抖动 |
| 观测不靠截图 | 控制台错误、未处理异常、API 往返、夹具命中都进事件缓冲，随每条命令返回 |
| 零新依赖 | Node 24 自带 `WebSocket` + 本机 Chrome；不引入 Playwright / Puppeteer |
| 只在本地 | 守护进程只监听 `127.0.0.1` 随机端口；`.debug/` 不入库；生产构建无任何调试入口 |

## 3. 架构

```
AI / 人
  ├─ node scripts/debug.mjs <cmd> [args] [--flags]      ← CLI（argv 解析 + 打印 + 退出码）
  └─ MCP 客户端 → scripts/debug/mcp-server.mjs          ← 28 个 sc_* 工具
       │
       ▼
  命令层（scripts/debug/commands.mjs）
       │  场景执行 / Studio / 日志 / 契约 / 录制落盘；浏览器命令转 rpc
       │  daemon-client.mjs：读 app/.debug/session.json，没有就拉起守护进程
       │  POST http://127.0.0.1:<port>/rpc  {cmd, args}
       ▼
  守护进程（scripts/debug/daemon.mjs）
       │  可选：pnpm dev；常驻 Chrome；持有 CDP 会话
       ▼
  引擎（scripts/debug/engine.mjs）
       │  Page.navigate / Runtime.evaluate / Fetch.fulfillRequest / Page.captureScreenshot
       ▼
  页面（Next.js）
       └─ window.__sc：click / type / wait / text / snapshot / trace
```

CLI 和 MCP **共用同一个命令层**，只是出口不同：一个 print JSON 并设退出码，一个包成 MCP 工具结果。
命令逻辑只有一份，避免两条路径各自漂移。

为什么必须常驻：`Fetch` 拦截、控制台事件、页面状态都绑在一条 CDP 会话上。每条命令新起进程的话，
`model.use` 下一跳就失效，`ui.click` 也拿不到上一页的上下文。

## 4. 命令

所有命令输出 JSON：

```json
{ "ok": true, "data": { }, "console": [] }
```

失败时 `ok: false`、退出码 1，`error.message` 是给人看的结论，`error.stack` 只在前 8 行。
`console` 默认只带错误/警告（最多 20 条，已剔除 Next HMR 噪声）；`--console=all` 回传全部。

### 4.1 会话

| 命令 | 作用 |
|---|---|
| `debug up [--serve] [--base=…] [--headless=0]` | 启动/复用守护进程；`--serve` 顺带起 `pnpm dev` |
| `debug down` | 关 Chrome、关它启动的 dev server、删 session 文件 |
| `debug doctor` | Node / Chrome / base / server / 当前夹具模式 |

### 4.2 导航与页面

| 命令 | 作用 |
|---|---|
| `debug nav <route>` | 导航并等 `readyState=complete` + body 有字；`--wait=<selector>` 再等元素 |
| `debug reload` | 刷新并等就绪 |
| `debug viewport <w> <h>` | 设备尺寸 |
| `debug shot [path] [--full]` | 截图（默认落 `.debug/shots/`）；只在确实需要看画面时用 |
| `debug eval "<expr>"` | 在页面里求值，返回 JSON |

路由不要写前导斜杠（Git Bash 会把 `/` 转成 `C:/Program Files/Git`）：`nav home`、`nav love/play/<id>`。
引擎会兜底还原被转过的路径，但示例以不带斜杠为准。

### 4.3 状态

| 命令 | 作用 |
|---|---|
| `debug state.load <fixture>` | 写 localStorage 并刷新 |
| `debug state.dump [name]` | 导出当前 `socialcoach.*`；给 name 就写成夹具 |
| `debug state.set <key> <json>` | 写单个键 |
| `debug state.clear` | 清掉所有 `socialcoach.*` 并刷新 |

夹具在 `app/debug/fixtures/states/`：

```json
{
  "archive": { "profile": { }, "settings": { "tts": false } },
  "keys": { "socialcoach.love-play.carry": [] }
}
```

`archive` 会被包成 `{version:0,state:…}` 写进 `socialcoach.v1`；`keys` 里的值原样写入（对象会 stringify）。
**`state.load` 先删所有 `socialcoach` 前缀的键**（含 `socialcoach-dinner-v1` 这类带连字符的），再写夹具——
所以夹具天然是「干净起点」，不会继承上一局的存档。
现有：`love-start`、`practice-briefing`、`practice-active`。契约变了就重跑
`cd app && npx tsx --tsconfig tsconfig.json scripts/debug-seed.ts`，不要手改字段。

> `practice-active` 必须以 **NPC 发言收尾**。最后一条是学习者发言时，Chat 会进「等待回复 / 恢复」态，
> 输入框被禁用，`ui.type` 会一直等到超时。

### 4.4 交互

| 命令 | 作用 |
|---|---|
| `debug ui.click <target> [--nth=0]` | 等元素可点击（非 disabled、可见）再点 |
| `debug ui.click --text="…" [--role=…]` | 按可见文字 / aria-label 找可点元素 |
| `debug ui.type <target> "<text>" [--enter] [--submit=<target>]` | 等可输入再写；`--enter` 触发回车，`--submit` 点提交按钮 |
| `debug ui.wait <target> [--timeout=15000] [--gone] [--visible]` | 等出现 / 消失 / 可见 |
| `debug ui.text <target> [--contains=…]` | 读文本（含输入框 value）；带 contains 会先等 |
| `debug ui.value <target>` | 读输入框 value |
| `debug ui.exists / ui.count / ui.list [--role=…]` | 存在性 / 数量 / 可点元素清单 |

语义别名（`scripts/debug.mjs` 的 `ALIASES`）：

| 别名 | 页面 |
|---|---|
| `love.input` / `love.send` / `love.line` / `love.options` / `love.option-0…3` | 恋爱 Galgame |
| `practice.input` / `practice.send` / `practice.end` / `practice.messages` / `practice.mic` | 文字练习 |
| `dinner.input` / `dinner.send` | 3D 饭局 |

新控件加 `data-debug="<area>.<name>"`，再在 `ALIASES` 里登记。不要把 Tailwind class 或文案当选择器。

位置参数和 `--flag` 两种写法等价：`ui.type dinner.input "…"` 与
`ui.type --target=dinner.input --text="…"` 都能用；缺 target 时会直接报「needs a target」，
不会拿 `undefined` 去查选择器（那会表现成「选择器找不到」，把人带偏）。

### 4.5 模型夹具

| 命令 | 作用 |
|---|---|
| `debug model.use <fixture…> [--strict]` | 开启 `Fetch` 拦截，按路由返回夹具；`--strict` 见下 |
| `debug model.record <name>` | 透传真实模型并录制响应，`model.stop` 落盘 |
| `debug model.stop` | 停止录制并写文件 |
| `debug model.off` | 关闭拦截，清空夹具 |
| `debug fixture build <spec.json>` | 把「人写的一回合」编译成带 `@@meta` / `@@final` 的夹具 |
| `debug fixture probe <name…> [--url=/]` | **夹具自检**：装上夹具，按文件里的 `probes` 逐条真发一次请求，断言状态码与响应形状 |
| `debug fixture show <name>` | 打印已生成的夹具（核对包装有没有问题） |

**`--strict`（离线严格模式）**：没配夹具的 `/api/*` 不回真实网络，而是回 `503` +
`{"code":"debug-fixture-missing"}`，并在 trace 里留一条 `model.missing`。
`model.record` 录夹具时用它，否则会悄悄打到真实模型上、录出来的流程也可能被真实响应污染。

夹具在 `app/debug/fixtures/models/`。**路由键是 URL path 去掉 `/api/`**（请求体里没有 `task` 字段）。

三种写法：

```json
{
  "name": "love-flow",
  "routes": {
    "love-play": {
      "by": "learnerTurns",
      "responses": [ { "line": { }, "options": [ ] } ]
    },
    "roleplay": {
      "responses": [
        { "__raw": "@@meta\n{…}\n@@michael\n…", "__contentType": "text/plain; charset=utf-8" }
      ]
    },
    "health": { "serverKey": true, "requireByok": false, "state": "available" }
  }
}
```

- **默认（counter）**：按第几次调用取响应，最后一条重复。
- **`by: "learnerTurns"`**：数请求体 `messages` 里 `role === "learner"` 的条数，用它当索引。
  同一回合的重复请求（React StrictMode 双调用、网络重试）拿到同一条，不会把队列顶歪。恋爱流程用这个。
- **`__raw`**：流式任务（`/api/roleplay`、`/api/dinner/direct`、`/api/assess`、`/api/reflect`）回的是纯文本，
  不能 `JSON.stringify`。`__raw` 原样回放，`__contentType` 默认 `text/plain; charset=utf-8`。
- `model.record` 已经按 `content-type` 自动分流：JSON 存对象，流式存 `{__raw, __contentType}`。
- 未命中的路由 `continueRequest` 走真实网络；所以 `/api/health` 之类要么给夹具，要么确保本地能返回。

#### 流式夹具生成器（`fixture build`）

手写 `@@meta` / `@@final` 的换行与转义很容易错，错了表现为「页面一片空白」，排查成本极高。
`fixture build` 吃一份**只有台词和报告**的 spec，自己拼协议：

```json
{
  "name": "practice-flow",
  "routes": {
    "health": { "serverKey": true, "requireByok": false, "state": "available" },
    "roleplay": { "by": "learnerTurns", "turns": [
      { "meta": { "scores": { }, "notes": [ ] },
        "utterances": [ { "characterId": "michael", "text": "我们先对齐一下最急的三页。" } ] }
    ] },
    "assess": { "reports": [ { "scoringVersion": 2, "verdict": "…" } ] },
    "reflect": { "texts": [ "你这次先给了限制，再追问范围。" ] }
  }
}
```

`turns` → `@@meta` + `@@<characterId>` 分段；`reports` → `\n@@final\n<JSON>`；
`texts` → 原样纯文本。输出写到 `debug/fixtures/models/<name>.json`。

现有：`love-flow`（3 个恋爱回合）、`practice-flow`（health + roleplay）、`assess-flow`（复盘报告）、
`dinner-flow`（`dinner/direct` 的 JSON 回复）、`practice-side`（hint / feedback / pattern / reflect /
debrief-chat）、`coach-side`（rehearse / schedule / track）、`speech-flow`（`audio/pcm` 二进制）。
spec 在 `app/debug/fixtures/specs/`。

**夹具文件带 `probes`，`fixture probe` 才算验过。** 「文件存在」只让 `contracts` 变绿，
证明不了请求真被拦到、响应形状真能被解析。每个夹具顶层写：

```json
"probes": {
  "hint": { "method": "POST", "body": { "scenario": { }, "messages": [] } },
  "track": { "method": "GET", "query": { "available": "1" } }
}
```

`fixture probe` 会先 `model.use` 再在页面里 `fetch('/api/<route>')`，任一请求非 2xx 或抛错就失败
并带上实际状态码。注意它会消耗 counter 型夹具的响应序列，所以放在场景末尾或单独跑。

### 4.6 观测

| 命令 | 作用 |
|---|---|
| `debug why` | **一条命令给全局面**：url / 可见文本 / `data-debug` 状态 / 错误 / 模型回放 / storage / lock |
| `debug snapshot` / `inspect` | 语义快照：url / title / ready / 可见文本 / 可交互元素 / `data-debug` 状态 |
| `debug anchors [route]` | 列出当前页（或先导航到 route）的 `data-debug` 锚点和**没有锚点的可交互元素** |
| `debug trace [--clear]` | 页面内环形缓冲（sessionStorage，跨导航） |
| `debug trace.clear` | 清空 |
| `debug errors` | 只挑异常 / 错误 / `model.missing`，带计数 |
| `debug logs [--file=next\|daemon\|studioBackend\|studioFrontend] [--lines=80]` | 读守护进程自己起的服务日志 |

**先跑 `why`，再决定要不要 `eval`。** 它输出的量是固定的（文本 1200 字、交互元素 40 个、
各类事件各 8–10 条），不会像 `trace` 全量那样淹掉上下文。

`debug anchors` 是给「AI 找不到按钮」这类问题准备的：有锚点的控件是稳定的，没锚点的靠文案，
文案一改场景就断。给某个新页面补锚点时先跑它，出来的 `unlabeled` 就是待办清单。

`trace` 的 `kind`：`fetch`、`console.error`、`console.warn`、`error`、`rejection`、`model.replay`、
`model.missing`、`storage`、`lock`。

排查「为什么这一回合不对」的顺序：`model.replay` 的 `route/index` → 对应 `fetch` 的 `body`
→ `ui.text` 的实际文本。排查「存档怎么没了 / 为什么说另一窗口在改」看 `storage` + `lock`：
`storage` 记录每一次 `socialcoach*` 的 set/remove 和调用栈，`lock` 记录每次 Web Lock 请求是
`acquired` 还是 `NULL`（`NULL` 就是应用判冲突的直接证据）。

`snapshot` 是「不截图也能知道页面长什么样」的默认手段：它把 `data-debug` 锚点、按钮文案、
禁用状态、输入框当前值一次给全。

### 4.7 场景与烟测

| 命令 | 作用 |
|---|---|
| `debug run <scenario.json> [--repeat=N]` | 顺序执行步骤，失败即停并报第几步；`--repeat` 连跑 N 次抓不稳定 |
| `debug suite` | 跑 `app/debug/scenarios/*.json` 全部 |
| `debug smoke [route…]` | 逐路由检查：无应用错误文案、body 有内容、无控制台错误 |

`run` / `suite` / `smoke` 失败时退出码为 1，可以直接当门禁用。
**新增或修改场景后至少 `--repeat=2`**：只跑一次通过不代表稳定，今天 3D 饭局的存档竞态就是
「第一次过、第二次必挂」。

场景步骤就是上面的命令，外加断言：

```json
{
  "name": "love-happy",
  "steps": [
    { "cmd": "state.load", "fixture": "love-start" },
    { "cmd": "model.use", "fixtures": ["love-flow"] },
    { "cmd": "nav", "path": "love/play/love-approach-cafe", "wait": "[data-debug=\"love.options\"]" },
    { "cmd": "assert.text", "target": "love.line", "contains": "你也点了这款豆子" },
    { "cmd": "ui.click", "target": "love.option-0" },
    { "cmd": "assert.trace", "kind": "model.replay", "contains": "love-play" },
    { "cmd": "assert.noErrors" }
  ]
}
```

`assert.text` / `assert.exists` / `assert.gone` / `assert.trace` / `assert.noErrors`。
`assert.noErrors` 已剔除 Next HMR 噪声；场景还可以声明自己预期内的噪声：

```json
{ "cmd": "assert.noErrors", "ignore": ["THREE.GLTFLoader: Couldn't load texture blob"] }
```

`ignore` 是正则（字符串或数组），被忽略的条数会记在 `row.data.ignored` 里——
**别用全局过滤把它藏掉**，写清为什么这条在这个场景里可以接受。

**失败包**：任何一步失败时，`run` 会把现场写到 `.debug/failures/<时间戳>/`：
`report.json`（每步结果）、`trace.json`、`snapshot.json`、`page.html`、`screen.png`。
先读 `report.json` 找第几步，再读 `snapshot.json` 看当时页面状态，通常不用看截图。

现有场景（14 条）：`love-happy`、`practice-chat`、`practice-hint`、`practice-debrief`、
`practice-debrief-ask`、`practice-voice`、`practice-tts`、`practice-pattern`、`practice-feedback`、
`assert-primitives`、`coach-flows`、`dinner-turn`、`dinner-conflict`、`studio-chat`（`requires: studio`）。

### 4.8 Love Studio

Studio 是独立运行时（FastAPI :8000 + Vite :5180），状态在 SQLite 而不在 localStorage，
所以它有自己的一套「种子 + 启停」命令，**不经过浏览器**：

| 命令 | 作用 |
|---|---|
| `debug studio up` | 起后端（`uvicorn app.main:app`）和前端（`npm run dev`），日志落 `.debug/studio-*.log` |
| `debug studio seed [card] [--reset]` | 跑 `python -m app.debug_seed`：默认酒馆数据 + 一张角色卡 + `mock` 连接 + `调试对话`；`--reset` 先删掉旧对话 |
| `debug studio status` | 前后端可达性 + SQLite 路径 + 已记录的 PID |
| `debug studio down` | 杀掉自己起的进程 |
| `debug studio byok [--api-type=openai --model=… --base-url=… --key-env=STUDIO_BYOK_KEY]` | 真实 BYOK 验证：建临时连接 → 发一句 → 断言回复 → 删连接；无 key 时明确 `skipped` |

`studio seed` 会**停用其他所有 ApiConnection**、只留 `mock`（`api_type: "mock"`），
并把卡片的 `last_chat_id` 指向 `调试对话`，所以同一个种子可以反复跑，不需要清库。
它打印一行 JSON（`{ok, seed, card, chat, preset, connection}`），场景里直接当 `state.load` 用。

页面入口是 `http://127.0.0.1:5180/debug.html`；创作者控制台加 `?creator=1`。
Studio 的路由与主站不同源，`nav` 接受绝对 URL。

**场景里的 seed 必须带 `reset: true`。** 对话存在 SQLite 里，不重置的话上一轮的消息会留下来，
`assert.text` 命中旧历史，看着绿其实这一轮什么都没发出去（踩过一次，见 FRICTION F23）：

```json
{ "cmd": "studio.seed", "card": "genshin-ganyu", "reset": true }
```

Studio 前端已有 11 个 `data-debug` 锚点，`studio-chat` 全流程走锚点（含重生成 / 新对话 / 模型下拉）。
选卡那一步按**卡名**点（`ui.click text=甘雨`）而不是点列表第 0 行：库里还有 starter 的顾星遥和以前跑留下的卡，
点第 0 行会接到别人的旧对话上，`seed --reset` 就白做了，断言还可能命中上一轮的同一条 mock 回复。
列表本身由 `assert.count studio.card` 证明在。

锚点清单：

| 锚点 | 元素 |
|---|---|
| `studio.cardList` / `studio.card`（`data-card-id`） | 角色列表容器 / 角色行 |
| `studio.composer` / `studio.send` / `studio.stop` | 输入框 / 发送 / 停止 |
| `studio.regenerate` / `studio.newChat` | 重新生成 / 新对话 |
| `studio.creatorTab`（`data-tab`）/ `studio.save` | 创作者页签 / 导出 `.scpersona` |
| `studio.modelSelect` | 顶栏模型下拉 |
| `studio.lastReply` | 最后一条 assistant 消息——断言只读这一块，不要断言整个 `body` |

`studio.lastReply` 是为断言加的：断言 `body` 会把整段历史（可到几千字）塞进结果，
既难读又把上一轮内容一起匹配进来；锚到最后一条回复后，结果稳定在 150 字符量级。

三个锚点还没有场景驱动：`studio.creatorTab` / `studio.save` 要先从素材库打开卡编辑器，
`studio.save` 还会触发浏览器下载（无头环境没有断言面）；`studio.stop` 只在流式回复进行中渲染，
mock provider 每块 20ms、整段 1 秒内结束，没有稳定的点击窗口。这三条留给下次 Studio 场景扩展，
不放宽成「存在即覆盖」。

`studio byok` 的 key 只从环境变量读（默认 `STUDIO_BYOK_KEY`），不写库、不进日志、不回显；
没有 key 时返回 `{skipped:true, reason}` 而不是假装通过。`--api-type=mock` 可以不填 key
自检整条流程（建临时连接 → `test-message` → 断言回复 → 删连接），
所以「harness 本身对不对」随时可验，剩下没验的只有真实 provider 那一步。

Studio 场景在 JSON 里声明 `"requires": "studio"`：本机没有 `love-studio/.venv` 时
`debug suite` 会**跳过**它并标 `skipped`，而不是让整条套件变红（CI 里就是这种环境）。

### 4.9 录制：人点一遍，落成场景

| 命令 | 作用 |
|---|---|
| `debug record start [name]` | 开始录制：页面侧记点击/输入，CLI 侧记导航/装夹具/state |
| `debug record stop` | 合并成场景，写到 `debug/scenarios/<name>.json` |

```bash
pnpm debug record start dinner-take
pnpm debug state.load love-start
pnpm debug nav 3d
pnpm debug ui.click --text="开始接话"
pnpm debug ui.type dinner.input "我先确认一下排期。"
pnpm debug record stop
pnpm debug run debug/scenarios/dinner-take.json --repeat=2
```

合并规则（`scripts/debug/recorder.mjs`）：

- 页面侧只记 `click` / `input` 两个原子动作，目标统一成 **`data-debug` 锚点名**；
  没有锚点的动作记进 `notes`（`跳过 N 次无锚点点击：发送`），不写进步骤——文案选择器一改就断。
- CLI 与页面重复记同一动作时（同 cmd、同锚点、±500ms），只保留 CLI 那条。
- 连续同一输入框的 `ui.type` 只留最后一条；300ms 内的连点算一次。
- 输出步骤里没有时间戳；**录制不会自动加断言**，回放前自己补 `assert.text`。

### 4.10 快照 diff：改代码前后的回归

| 命令 | 作用 |
|---|---|
| `debug diff --save [--name=baseline]` | 把当前语义快照存成基线（`.debug/snapshots/<name>.json`） |
| `debug diff [--name=…] [--limit=40]` | 与基线比较，只输出变化的文本行 / 可交互元素 / 存档键 |

典型用法：改样式或文案前 `diff --save`，改完 `diff`，输出里只有真正变了的行。
`changed: false` 就是「这一页没动」——比重新读一遍整页文本快得多。

### 4.11 语音：可控的假 SpeechRecognition

| 命令 | 作用 |
|---|---|
| `debug speech stub [--lang=zh-CN] [--interim]` | 注入假 `SpeechRecognition`（同时注册到后续导航） |
| `debug speech say <text> [--delay=ms] [--final=false]` | 排一条转写结果 |
| `debug speech log` | `{starts, stops, aborts, results, errors}` 计数 |
| `debug speech off` | 撤掉注册并清掉页面上的桩 |

无头 Chrome 没有麦克风，`SpeechRecognition` 的真实转写也不可回放——**假设备参数只解决
`getUserMedia`，解决不了转写文本**。这个桩替换的就是「识别服务」这一层，应用代码不用改。
`practice-voice` 场景覆盖：导航前 `speech.stub` → 导航后 `speech.say` → 点 `practice.mic`
→ 断言转写落进输入框。

**输出侧（TTS）另有一套观测。** 本仓库的 TTS 契约是 `openai_audio`：客户端 POST `/api/speech`，
拿回 `audio/pcm;rate=24000;channels=1` 的 PCM，再用 WebAudio `decodeAudioData` 播放。
无头环境放不出声，但「有没有解码、有没有真的 start」可以断言：

| 命令 | 作用 |
|---|---|
| `debug audio log` | `{mediaPlays, mediaPauses, audioConstructed, decode, buffers, sourcesStarted}` + 最近几条 src 前缀 |
| `debug audio clear` | 清空计数（每轮从零开始） |

插桩由引擎注入（`audio-stub.mjs` 的 `audioStubSource()`），生产代码零改动。
`practice-tts` 场景覆盖：`state.load practice-active` → 组合夹具（roleplay + speech）→
发一句 → `audio.clear` 后等回复 → `assert.audio` 断言 `buffers >= 1 && sourcesStarted >= 1`。
`sourcesStarted` 才是「真的开始播」，只看 `buffers` 会把「解码了但没播」当成通过。

### 4.12 多标签页：真实冲突路径

| 命令 | 作用 |
|---|---|
| `debug tab open <url>` | 新开一个同源标签页，返回 `{id, url, loaded}` |
| `debug tab list` | 列出页面级 target |
| `debug tab use <id>` / `tab close <id>` | 激活 / 关闭；`id` 可以是 `last`（最近打开的那个） |
| `debug tab eval <id> <expr>` | 在指定标签页求值（可用来直接改 localStorage） |

单窗口测不到「另一个窗口改了存档」：storage 事件只在**其他**同源文档里触发。
`dinner-conflict` 场景就是这么测的：主标签页在 `/3d` 有草稿 → 第二个标签页把存档重写成
等价 JSON → 主标签页出现「另一窗口修改了这场练习」且发送被禁用 → 下载 → 重新读取 → 恢复发送。

### 4.13 API 契约巡检

| 命令 | 作用 |
|---|---|
| `debug contracts [--strict]` | 扫 `src/app/api/**/route.ts` 与夹具键对账 |

输出四组：`routes`（真实路由 + methods + 是否动态段）、`covered`（哪些夹具能回放它）、
`missing`（还没有夹具、**不能离线跑**的路由）、`unknown`（夹具里写了但路由不存在，通常是拼错）。
`--strict` 时只要还有静态路由没夹具就返回非零，可以当「新接口必须配夹具」的门禁。

### 4.14 CI

`.github/workflows/debug-harness.yml` 在 ubuntu-latest 上跑，但**步骤只有一份实现**：
`app/scripts/debug/ci-steps.sh`。workflow 只负责装 pnpm / node，然后 `bash scripts/debug/ci-steps.sh`；
本地容器用同一个脚本跑（`docker run … node:22-bookworm`），所以「本地跑过」和「CI 跑过」
是同一条代码路径，不会各写一套然后漂移（F25）。

脚本顺序：浏览器探测（找不到就 `exit 1`，不静默跳过）→ `pnpm install --frozen-lockfile` →
`up --serve` → `doctor` → `smoke`（逐路由预热 Next 的按需编译）→ `suite` → `contracts`；
`trap EXIT` 负责 `debug down`。`studio-chat` 因缺 venv 自动跳过。
失败包与日志由 workflow 上传，且必须 `include-hidden-files: true`——`.debug` 是隐藏目录，
upload-artifact v4 默认跳过它，结果就是「上传步骤成功但 0 个文件」（F38）。

**第一次真实 runner 运行（2026-10-23，run 39836977654）**失败在 4 条场景：`coach-flows`（点击不到推荐按钮）、
`dinner-conflict` / `dinner-turn`（3D 的 `ui.wait` 报 CDP timeout）、`love-happy`（导航后等不到选项）。
runner 比本机慢一个量级（`state.load` 28s、`nav` 41s），暴露出三个真实问题，修法见 F36/F37/F38：
上一场景页面在 `state.load` 之后把旧档案写回去（跨场景串味）、点击过程中整页重载导致 Promise 被回收、
冷启动时按需编译吃掉场景超时。本地连续 3 轮 `suite` 已稳定（中间仍有 1 次 Studio 场景的间歇失败，
CI 里该场景本就不跑），runner 上的复跑结果见 §9。

**第二次真实运行（run 39844874580）**前进到新加的 `smoke (warm-up)` 步骤后失败，失败点是 `/love`：
`Failed to load resource: net::ERR_CONNECTION_REFUSED`。原因不是页面坏了——`/love` 会探测本机 Studio
（`127.0.0.1:5180`，见 `src/lib/love-studio-link.ts`），runner 上没有 Studio，浏览器必然记这一条。
所以 `smoke` 的错误过滤改成 `isSmokeNoise(text, route)`：HMR 握手噪声全局忽略，
`net::ERR_CONNECTION_REFUSED` **只在 `/love*` 路由**上忽略，别的路由连不上仍然算失败（有单测锁住这条边界）。

同批还修了两个只在真环境暴露的机制问题：

- **点击不能靠「目标还在不在」判断是否生效**（F37 补充）。`studio-chat` 在本机 `suite` 里约 1/3 失败，
  单跑全绿：点击卡片后 CDP 的 `Runtime.evaluate` promise 被回收，重试时卡片因为 `selectCard` 里还有几个
  `await` 仍挂在 DOM 上，被判成「没点到」，重跑表达式，最后干等满 30s timeout 报 `not found`。
  现在 `ui.click` 生成 token、页面点击前写进 `data-sc-click`，重跑看到同一 token 直接返回 `already`；
  点击表达式用 `evaluate({ retries: 0 })`，重跑只由 `uiClick` 控制；目标 400ms 内消失也算生效
  （结果带 `afterNavigation`）。冷启动连续 3 轮 `suite` 全绿，其中一轮走的就是 `afterNavigation` 分支。
- **守护进程会跑旧代码**（F39）。`engine.mjs` 常驻在 daemon 内存里，改了不重启，红绿都可能是假的。
  `daemon-client.ensure()` 现在比较 `scripts/debug/*.mjs` 的 mtime 与 `session.startedAt`，源码更新就重启；
  重启前要等旧进程退干净（它的 `shutdown()` 会删 `session.json`，抢跑会把新会话文件删掉，整轮套件全红）。

**第三次真实运行（run 39852100058）**smoke 已过，suite 失败在 `coach-flows`：
`ui.click 推荐今日练习` 等满 90s 报「找不到可点元素」，失败截图里页面上的按钮是灰的。
根因不是点击机制，而是**场景隐式依赖本机配了模型 key**：首页那颗按钮是 `<Button requiresModel>`，
`canUseModel` 读 `/api/health`；本机 `.env.local` 有 key → `available` → 可点，runner 没 key → `unavailable`
→ `disabled`，`clickTextReady` 只接受可点元素。修法是**回放模式下由 harness 回答 `/api/health`**
（`{state:"available"}`），夹具里显式写 `health` 可以覆盖（想测不可用路径就这么写）。
A/B 验证：夹具写 `available` → 按钮可点；写 `unavailable` → `disabled` 且
`title="接入可用的模型后继续"`（F40）。

**第四次真实运行（run 39853577091）全绿**：`doctor` → `smoke (warm-up)` → `suite` → `contracts` 四步通过，
`studio-chat` 按预期跳过（runner 没有 Python venv），耗时约 3 分钟。这是 CI 入口第一次真正跑通；
四次运行各暴露一层问题（跨场景串味 / 隐藏目录产物 / 探测噪声 / 环境就绪依赖），都不是「本地也复现」的那种。

### 4.15 MCP：把同一套能力变成原生工具

CLI 是「AI 学会调命令」，MCP 是「工具本来就在手里」。同一套命令被包成一个 stdio MCP 服务器，
不复制逻辑：`scripts/debug/mcp-server.mjs`（协议）→ `mcp-tools.mjs`（工具表）→ `commands.mjs`（命令层）→ 守护进程。

```bash
pnpm debug:mcp            # 直接跑 MCP 服务器（stdio，给客户端拉起）
pnpm debug:mcp:smoke      # 握手 + tools/resources/templates/prompts 清单 + 读 guide，不碰浏览器
pnpm debug:mcp:smoke --call sc_contracts   # 顺带调一个真实工具
```

注册：仓库根已有 `.mcp.json`（server 名 `socialcoach-debug`，`node app/scripts/debug/mcp-server.mjs`）。
客户端从仓库根启动即可；若它用别的工作目录，把 `args` 改成绝对路径。

33 个工具，全部 `sc_` 前缀（客户端会再加 `mcp__<server>__` 命名空间）：

| 分组 | 工具 |
|---|---|
| 会话 | `sc_up`(serve 默认 true) `sc_down` `sc_doctor` |
| 观测 | `sc_why` `sc_snapshot` `sc_anchors` `sc_eval` `sc_trace` `sc_errors` `sc_logs` `sc_shot` `sc_canvas`(stats) `sc_audio`(log/clear) |
| 导航 / 状态 | `sc_nav` `sc_state`(load/set/clear/dump) |
| 交互 | `sc_click` `sc_type` `sc_wait` `sc_text` |
| 断言 | `sc_assert`(api/state/count) |
| 模型夹具 | `sc_model`(use/record/stop/off) `sc_fixture_build` `sc_fixture_probe` |
| 场景 | `sc_run` `sc_suite` `sc_smoke` `sc_diff` `sc_contracts` `sc_record`(start/stop) |
| 离线报告 | `sc_report`(coverage/triage/bundle) |
| 语音 / 多标签页 | `sc_speech`(stub/say/log/off) `sc_tab`(open/list/close/use/eval) |
| Studio | `sc_studio`(up/seed/down/status/byok) |

三条设计约定：

1. **首次碰浏览器自动起守护进程**（`ensure({serve:true})`），不需要先手动 `sc_up`；
   `sc_doctor` 例外——它只报告，不替你修。
2. **工具调用串行化**：导航/点击并发会互相踩页面，所以 server 用 Promise 链排队。
3. **stdout 只写协议**：任何诊断走 stderr，直跑时连 `console.log` 都重定向到 stderr。

#### resources / prompts：AI 不用先问「你会什么」

tools 解决「能做什么」，resources 解决「现在的世界长什么样」，prompts 解决「这类活儿按什么套路干」。
三者都由 `mcp-catalog.mjs` 提供，纯内存静态数据，不依赖守护进程 / 浏览器，所以冒烟能离线校验。

| 类型 | 名字 | 内容 |
|---|---|---|
| resource | `socialcoach://guide` | 排查顺序 / 断言纪律 / 三条禁区，AI 一上来就有用法，不必先 `tools/list` |
| resource | `socialcoach://scenarios` | 现有场景清单（名字 / 描述 / requires / 步数） |
| resource | `socialcoach://fixtures/models` | 模型夹具清单（路由 / 形状 / `by`） |
| resource | `socialcoach://fixtures/states` | 状态夹具清单 |
| resource | `socialcoach://failures` | 最近失败包目录 |
| resource | `socialcoach://contracts` | API × 夹具覆盖报告 |
| template | `socialcoach://scenarios/{name}` | 读单个场景的完整 JSON |
| template | `socialcoach://fixtures/models/{name}` | 读单个模型夹具 |
| prompt | `debug-repro`（`symptom` / `route`） | 产出复现步骤：装哪个夹具、导航到哪、断言什么 |
| prompt | `debug-regression` | 把刚修好的 bug 落成场景 |
| prompt | `debug-new-scenario`（`name`） | 按锚点纪律生成场景骨架 |
| prompt | `debug-api-fixture`（`route`） | 按现有夹具形状生成新夹具规格 |

能力随 catalog 在场与否切换：`createMcpServer({catalog: null})` 时 `initialize` 只声明 `tools`，
`resources/*` 与 `prompts/*` 返回 `-32602 not available`——不假装成功，也不悄悄返回空数组。

返回形状：`{content:[{type:"text", text:<紧凑 JSON>}], isError}`。
失败不抛协议错误，而是 `isError:true` + 人能读的原因（带最多 5 条 `console` 事件），
这样 AI 能看见失败细节而不是只拿到一个 JSON-RPC error。

### 4.16 3D canvas：证明它真的在画

| 命令 | 作用 |
|---|---|
| `debug canvas stats [--ms=1000]` | 采样窗口内的 `canvases` / `contexts` / `frames` / `draws` |
| 场景 `assert.canvas` | 至少一个带尺寸的 webgl/webgl2 canvas，且帧数、绘制数达标 |

插桩在页面脚本执行前注入（`canvas-stub.mjs`）：包 `WebGL(2)RenderingContext.prototype` 的
`drawArrays` / `drawElements` / `drawArraysInstanced` / `drawElementsInstanced` 只累计次数（不记参数），
包 `requestAnimationFrame` 数帧，包 `getContext` 登记 canvas。

`canvases` 只含 webgl/webgl2。Next 和 three.js 会造几百个 1×1 的 2d 画布，全登记会把输出淹掉
（实测单页 749 条）；2d 只按类型计数，放在 `contexts`，例如 `{"2d":628,"webgl2":1}`。
`dinner-turn` 实测：`{canvases:[{w:1256,h:745,type:"webgl2"}], frames:246, draws:17398}`（1500ms 窗口）。

边界：只证明「`draw*` 被调用 + rAF 在跑 + canvas 有尺寸」，**不验证 GPU 画对了像素**，
也看不到 three.js 内部对象数 / 纹理上传 / shader 编译状态。

### 4.17 断言原语：请求、状态、数量

`assert.text` / `assert.exists` 只能证明「页面显示了什么」，证明不了「应用发了什么」。
三种原语补齐这一层（场景里直接写，MCP 走 `sc_assert`）：

| 命令 | 参数 | 断言什么 |
|---|---|---|
| `assert.api` | `route` `method` `body` `count` / `min` `timeout` | 应用向 `/api/<route>` 发出的请求：次数 + 请求体（`deepMatch` 部分匹配最后一条） |
| `assert.state` | `key="socialcoach.v1"` `path` `equals` / `contains` / `exists` | localStorage 里某个路径的值（点号 + 数组下标） |
| `assert.count` | `target` `equals` / `min` / `max` | 匹配选择器或 `data-debug` 锚点的元素数量 |

`assert.api` 的次数**优先用 `min` 不用 `count`**：实测同一场景 `/api/roleplay` 一轮发 1 次、
下一轮发 2 次（StrictMode 双调用 / 重试），`count: 1` 会随机假红。`count` 只用于「多发一次就是 bug」的场合。
请求记录来自 Fetch 拦截层（`model.use` / `model.record` 开启时才有），环形缓冲 200 条，
`trace.clear` 同时清空——`pnpm debug api.calls [--limit]` 可随时看最近被拦到的请求与 body。

`assert.count` 传锚点名时会先按选择器数，0 命中再回退到 `[data-debug="…"]`；
所以 `practice.message` 与 `.bubble-me` 两种写法都能用，返回里会带实际用的选择器。

活体验证：`assert-primitives` 场景——`assert.state` 读 `state.profile.name`、`assert.api` 断言
`/api/roleplay` 带了 `lang=zh`、`assert.count` 数到 5 条消息。

### 4.18 失败包离线分诊

失败包已经落盘（`report.json` / `trace.json` / `snapshot.json` / `page.html` / `screen.png`），
但以前每次判断还要重跑。现在两条命令不启浏览器、不需要守护进程：

| 命令 | 作用 |
|---|---|
| `debug why --bundle[=<dir>]` | 读指定（或最近）失败包：分类、证据、按置信度排序的假设、每条假设的下一条命令 |
| `debug triage [--limit=N]` | 所有失败包按签名聚合（`kind@cmd:anchor`），count 降序，每组给「下一步」 |

分类共 12 种：`selector-missing` / `timeout` / `model-missing` / `model-unexpected` / `console-error` /
`assertion-mismatch` / `http-error` / `lock-conflict` / `storage` / `navigation` / `studio-unavailable` / `unknown`。
判定先看失败 step 的 error 文本，trace 只做兜底——否则 GLTFLoader 之类的环境噪声会劫持分类。
`assertion-mismatch` 的假设还会按断言类型分支：`assert.api` → 看 `api.calls`、考虑 `min`；
`assert.count` → 看锚点是不是只挂在容器上；`assert.state` → `state.dump` 看实际值。

MCP 侧是 `sc_report {kind:"bundle"|"triage"|"coverage"}`。

### 4.19 场景覆盖与 flaky 定位

| 命令 | 作用 |
|---|---|
| `debug coverage` | 代码里的 `data-debug` 锚点 vs 场景引用；夹具路由 vs 场景 `model.use` 加载 / `assert.api` 断言 |
| `debug run <file> --repeat=N` | 结果里带 `divergence`（第一个分叉步骤）与 `flake`（每步 okRate） |

`coverage` 是**引用级**覆盖：锚点出现在场景里不等于场景真的触发了它（`assert.text target=body`
不会让任何锚点变绿）。路由分三层看：`routesUnused` = 夹具里有、没有场景加载；
`routesUnasserted` = 场景加载了、但没有 `assert.api` 证明它真被调用；`routesAsserted` 才是硬证据。
当前实测（2026-10-23）：30 个代码锚点、27 个被引用、3 个未用（`studio.creatorTab` / `studio.save` /
`studio.stop`）；14 条夹具路由全部被加载，11 条被 `assert.api` 断言，剩下 `health`（回放模式下由 harness
自己回 `{"state":"available"}`，没有夹具文件可算）、`rehearse`、`track`（遥测默认关）。
模板值锚点（`love.option-${i}`）与条件值锚点（`studio.lastReply`）
扫不到，会进 `anchorsUnknown`——这是已知盲区，不是漏报。数字随功能增长，以 `debug coverage` 当次输出为准。

`divergence` 比较按 step index 对齐，忽略 `ms` 与易变时间戳；**非导航步骤的 `data.url` 也忽略**
（场景共享同一个浏览器，`state.load` 的 url 会带着上一轮停留的页面，那不是 flake）。
只有 `nav` / `reload` 的 url 参与比较。

### 4.20 录制 → 断言草稿

`debug record stop` 除了写 `steps`，还会按录制期真实观测生成 `suggested` 断言草稿：

| 观测 | 建议 |
|---|---|
| `/api/<route>` 被调用 n 次 | `assert.api {route, method, min:n}`（不用 `count`，理由见 §4.17） |
| 请求体里有稳定标量（跳过 id/时间戳/uuid） | 附 `body: {字段: 值}`，最多 2 个 |
| 操作过的 `data-debug` 锚点 | `assert.exists`，最多 6 条 |
| 锚点元素数量从 a 变到 b | `assert.count {target, min:b}` |

草稿放在 `suggested` 字段，**不自动插进 `steps`**——按项目约定「只出骨架，断言自己补」，
但草稿是现成可粘贴的。文本类（`assert.text`）、`assert.trace`、`assert.audio` 生成不了：
录制只记锚点与请求，不记渲染后的文案，也不回放 TTS。

## 5. 覆盖矩阵

| 功能面 | 覆盖方式 | 状态 |
|---|---|---|
| 首页 / 学习 / 进度 / 设置 / 恋爱入口 / 3D / 排练等 14 条路由 | `debug smoke` 逐路由 | ✅ 全绿 |
| 恋爱 Galgame 回合（选项 / 自由输入 / 模型夹具 / trace） | `love-happy` 场景 | ✅ 连续 3 次全绿 |
| 文字练习（active 会话 / 流式 roleplay / 转写区） | `practice-chat` 场景 | ✅ |
| 练习复盘（`@@final` 报告 → 报告面板） | `practice-debrief` + `assess-flow` | ✅ |
| 练习提示按钮（`hint` 路由 + 教练气泡追加） | `practice-hint` 场景（`assert.api hint` + 计数 3→4） | ✅ |
| 复盘追问与反思（`debrief-chat` / `reflect`） | `practice-debrief-ask` 场景（真点发送 → 断言回复） | ✅ |
| 成长页行为模式卡（3 条历史 → `pattern` 回放） | `practice-pattern` 场景 + `practice-history` 状态夹具 | ✅ |
| 全局反馈面板（GET 可用性 → 选类型 → POST） | `practice-feedback` 场景（`assert.api` GET + POST） | ✅ |
| 语音输入（假 SpeechRecognition → 转写落进输入框） | `practice-voice` 场景 | ✅ |
| 3D 饭局（开场 / 输入 / `dinner/direct` 回放 / 反应） | `dinner-turn` 场景 | ✅ 连续 3 次全绿 |
| 3D 存档冲突（另一窗口改写 → 停存 → 下载重读恢复） | `dinner-conflict` 场景（多标签页） | ✅ 连续 2 次全绿 |
| Love Studio（SQLite 种子 → 创作者控制台 → 发送 → mock 回复） | `studio-chat` 场景（锚点驱动 + `reset` 幂等） | ✅ 连续 2 次全绿 |
| 设置开关（错字） | `ui.click --text` + 读 localStorage | ✅ 手工验证 |
| onboarding / 模型接入 | `state.load` 跳过；`health` 夹具伪造可用 | ✅ 间接 |
| API 接口 × 夹具覆盖率 | `debug contracts` | ✅ 14 路由 / 14 覆盖 / 0 待补 |
| 夹具「真能回放」 | `debug fixture probe <name>`（逐路由真发请求） | ✅ 8 个夹具全 2xx |
| 首页推荐练习（真点按钮 → schedule 回放 → 渲染） | `coach-flows` 场景 | ✅ |
| 断言原语（请求体 / localStorage 路径 / 元素数量） | `assert-primitives` 场景 + `sc_assert` | ✅ |
| 失败包离线分诊（12 类 + 排序假设 + 下一条命令） | `debug why --bundle` / `debug triage` / `sc_report` | ✅ 20 个真实包分类吻合 |
| 场景覆盖（锚点 / 夹具路由使用率） | `debug coverage` | ✅ 30 锚点 / 27 用 / 3 未用；路由 14/14 加载、11 断言 |
| flaky 定位（repeat 第一个分叉步骤） | `debug run --repeat=N` 的 `divergence` / `flake` | ✅ |
| 录制 → 断言草稿 | `debug record stop` 写 `suggested` | ✅ 5 步 → 4 条草稿 |
| MCP 层（33 个 `sc_*` 工具） | `pnpm debug:mcp:smoke` + 真实工具调用 | ✅ 握手/工具表/导航/场景/契约全通 |
| MCP resources / prompts（6 资源 + 2 模板 + 4 提示词） | `pnpm debug:mcp:smoke`（离线）+ 26 个协议单测 | ✅ |
| 3D canvas 渲染活动（draw 调用 / 帧数 / 画布尺寸） | `canvas stats` + `assert.canvas`（`dinner-turn`） | ✅ |
| 3D 镜头 / 走动 / 手势的内部状态 | 只能验「在画 + 无异常」，断言不到具体动作 | ⏳ 部分 |
| TTS 播放（PCM → `decodeAudioData` → source.start） | `audio log` + `assert.audio`（`practice-tts`） | ✅ |
| 真机麦克风 / 真实音频输出 | 无头 Chrome 没有真实音频设备 | ⏳ 不可覆盖 |
| Studio 真实 BYOK（建连接 → 真实模型回复） | `debug studio byok`（mock 路径已自检；真实 provider 需 key） | ⏳ 待 key |
| 真实模型输出质量 | 夹具只能验结构；质量要人读 | ⏳ 不可覆盖 |

「全功能」的边界要诚实：**能被状态和 DOM 表达的，都能覆盖；依赖真实设备、音频输出、WebGL 像素、
真实模型文风的，只能覆盖到「不报错、结构对」，不能覆盖到「听起来 / 看起来 / 读起来对」**。
后者仍需人耳 / 人眼验收。

`debug contracts` 的当前结论（2026-10-23）：14 条 API 路由 **14 条都有夹具、都能离线回放**
（`missing` / `unknown` 为空，8 个夹具全部 `fixture probe` 2xx）。早期「9 条没有夹具」的状态已结束；
其中 5 条练习侧路由（`hint` / `feedback` / `pattern` / `reflect` / `debrief-chat`）现在各有一条
UI 场景用 `assert.api` 证明真被调用，不再只是「夹具文件存在」。

## 6. AI 工作流

### 6.1 第一次进入项目

```bash
cd app
node scripts/debug.mjs up --serve     # 起 dev + Chrome，之后复用
node scripts/debug.mjs doctor         # 确认 base / Chrome / server
node scripts/debug.mjs smoke          # 先确认没有全局性错误
```

### 6.2 复现一个具体问题

```bash
node scripts/debug.mjs state.load love-start
node scripts/debug.mjs nav love/play/love-approach-cafe --wait='[data-debug="love.options"]'
node scripts/debug.mjs why          # 页面长什么样 + 请求了什么 + 错在哪，一次看完
```

不要先截图。`why` 已经把「显示了什么、请求了什么、返回了什么、谁写了存档」放在一起。
需要更细的某一条时才用 `ui.text` / `trace` / `errors` / `eval`。

### 6.3 改完代码做回归

```bash
node scripts/debug.mjs suite              # 七条主路径
node scripts/debug.mjs run debug/scenarios/dinner-turn.json --repeat=3   # 抓不稳定
node scripts/debug.mjs smoke              # 全站路由
node scripts/debug.mjs contracts          # 新接口有没有夹具
```

改文案 / 样式这类「只想看变化」的改动，用快照 diff 代替重读整页：

```bash
node scripts/debug.mjs nav love --wait=body
node scripts/debug.mjs diff --save
# …改代码，等 HMR…
node scripts/debug.mjs diff
```

### 6.4 需要真实模型时

```bash
node scripts/debug.mjs model.record my-flow
node scripts/debug.mjs nav love/play/…
node scripts/debug.mjs ui.click love.option-0
node scripts/debug.mjs model.stop     # 写 debug/fixtures/models/my-flow.json
```

录一次，之后用 `model.use my-flow` 无限回放。

### 6.5 手工跑通之后固化成场景

```bash
node scripts/debug.mjs record start my-flow
# …正常点一遍（导航 / 点选项 / 输入都可以）…
node scripts/debug.mjs record stop
# 打开 debug/scenarios/my-flow.json 补 assert.text / assert.trace
node scripts/debug.mjs run debug/scenarios/my-flow.json --repeat=2
```

录出来的是**骨架**：导航、装夹具、点击、输入都在，断言要自己补。

## 7. 边界与安全

- 守护进程只监听 `127.0.0.1`；session 文件在 `app/.debug/`，已进 `.gitignore`。
- 不引入生产依赖、不在 `app/src` 里留调试入口；`data-debug` 只是静态属性，生产构建里无副作用。
- 调试基址默认 `http://localhost:3000`。**不要用 `127.0.0.1`**：Next 16 dev 会把它的
  `/_next/hmr` 当跨源拦掉，页面永远不 hydration（详见 `80-known-pitfalls.md`）。
- 状态夹具是**虚构数据**，不得写入真实用户记录；`debug-seed.ts` 里的姓名 / 台词都是占位。

## 8. 已知缺口

1. **Studio 的三个锚点没有场景驱动**：`studio.creatorTab` / `studio.save` 需要先从素材库打开卡编辑器
   （`studio.save` 还会触发浏览器下载，无头环境没有断言面）；`studio.stop` 只在流式回复进行中渲染，
   mock provider 一秒内结束，没有稳定点击窗口。主站的「排练真实对话」仍是 输入 → 审阅弹层 → 确认
   三步，只有 API 层夹具自检覆盖，UI 路径未进场景。
2. **3D / 音频的边界**：`canvas stats` 能证明「在画」，`audio log` 能证明「解码并 start 了」，
   但 GPU 画对像素、声音听起来对不对仍不可断言。
   3D 场景在贴图还没解码完就 reload 时，旧文档会报 `THREE.GLTFLoader: Couldn't load texture blob:`；
   `dinner-conflict` 用 `assert.noErrors.ignore` 声明这条，属于重载竞态而非功能缺陷。
3. **真实模型与真机未验**：夹具证明的是「结构正确」，不是「模型这么说」；
   `speech.stub` 替换的是识别服务，麦克风硬件与真实引擎的停顿 / 重试行为不复现。
   Studio 的真实 BYOK 只验到「harness 能跑」（mock 路径），真实 provider 需要 key 才能跑
   `pnpm debug studio byok --api-type=openai --model=…`。
4. **首次编译**：`up --serve` 冷启动 20–40s；守护进程常驻后命令是毫秒级。不要每条命令 up/down。
5. **场景之间共享同一个浏览器**：上一场景留下的页面状态会带到下一场景。
   `state.load` 会清掉 `socialcoach*`，但页面卸载时的存档写入仍可能与新页面抢同一把 Web Lock
   （已修：`createDinnerStorage` 在首次拿锁时会短暂重试，见 `80-known-pitfalls.md`）。
6. **录制只记动作，不记断言**：`record stop` 产出的是骨架；语义断言必须人补。
7. **GitHub runner 已跑通**（2026-10-23，run 39853577091）：`doctor` / `smoke` / `suite` / `contracts` 全通，
   `studio-chat` 按 `requires: studio` 跳过——Studio 侧仍只有本地验证，
   runner 上没有 Python venv，也没有把 Studio 装进 CI（成本与收益都还不划算）。

## 9. 验收

- `node scripts/debug.mjs suite`：14 条场景全绿——`assert-primitives`、`coach-flows`、`dinner-conflict`、
  `dinner-turn`、`love-happy`、`practice-chat`、`practice-debrief`、`practice-debrief-ask`、
  `practice-feedback`、`practice-hint`、`practice-pattern`、`practice-tts`、`practice-voice`、`studio-chat`
  （退出码 0；缺 Studio venv 时后者跳过）。
- GitHub Actions `debug harness` 工作流在真实 runner 上通过（run 39853577091，`studio-chat` 跳过）。
- `node scripts/debug.mjs smoke`：14 条路由全绿，无控制台错误（失败时退出码 1）。
- `node scripts/debug.mjs contracts`：`missing` 与 `unknown` 都为空（14/14 覆盖，没有拼错的夹具键）。
- `node scripts/debug.mjs fixture probe practice-side,coach-side,speech-flow`：全部 2xx。
- `node scripts/debug.mjs canvas stats --ms=1500`：`draws.count > 0`、`frames.count > 0`、有 webgl canvas。
- `pnpm debug:mcp:smoke`：握手 + 33 个工具 + resources/templates/prompts + `sc_contracts` 真实调用全通（退出码 0）。
- `pnpm debug run debug/scenarios/assert-primitives.json --repeat=2`：两轮全绿且 `divergence.stable === true`。
- `pnpm debug coverage`：`routesUnused` 为空；`routesUnasserted` 只剩 `health` / `rehearse` / `track`；
  `anchorsUnused` 只剩三个 Studio 锚点（`creatorTab` / `save` / `stop`）。
- `pnpm debug triage` 能读最近失败包并给出下一步；`pnpm debug why --bundle` 对最近失败包输出分类 + 排序假设（不启浏览器）。
- `node scripts/debug.mjs record start/stop` 产出的场景能直接 `run` 通过。
- 设置页错字开关：点击后 `socialcoach.v1` 的 `settings.imperfection === true`。
- `pnpm check`：lint / typegen / tsc / retrieval / core / dinner / **debug（270 个单测）** 全绿。
