# 调试引擎摩擦日志

> 用途：在真实调试过程中记录「AI 调用很绕 / 卡住 / 需要人肉猜」的点。
> 每条写清：现象、为什么拖慢、当前绕过方式、建议改法。改完划掉并注明提交。
> 这不是 backlog 的替代品；稳定后的改进项再挪进 `wiki/85-backlog.md`。

## 2026-10-22 首轮自举

### F1. Next dev 的 HMR WebSocket 噪声污染 `assert.noErrors`

- **现象**：无头 Chrome 打开任意页面，`/api/*` 还没动，控制台先刷
  `WebSocket connection to 'ws://127.0.0.1:3000/_next/hmr…' failed: ERR_INVALID_HTTP_RESPONSE`，
  每 5 秒一条。
- **拖慢**：场景里只要断言「无控制台错误」就必然失败，AI 会误判成功能 bug。
- **当前绕过**：无。跑 `assert.noErrors` 前要人工忽略。
- **建议**：引擎侧把 `_next/hmr` / `ERR_INVALID_HTTP_RESPONSE` 归为 dev 噪声，
  默认从 `assert.noErrors` 与 `smoke` 的 errors 里剔除；保留在 `trace` 原始事件里可查。

### F2. 每条命令回传整段控制台，输出不可读

- **现象**：`nav /` 的 JSON 里 `console` 数组几十条，真正的 `data` 被挤到最前面，
  用 `head` / `tail` 都看不全。
- **拖慢**：AI 需要二次过滤才能拿到结论。
- **当前绕过**：`head -20` 只看到 `ok`，`tail` 只看到噪声。
- **建议**：默认只回传错误/警告，最多 20 条；`--console=all` 才回传全部。
  命令结果固定为 `{ok, data, console}`，`data` 在前。

### F3. 首屏等待没有「业务就绪」信号

- **现象**：`waitIdle` 只等 `document.readyState === complete` 和 body 有字；
  Next 的 hydration、模型首回合、选项渲染都在其后。
- **拖慢**：场景必须显式 `ui.wait` 某个选择器，写错选择器就超时 15s。
- **当前绕过**：`nav --wait='[data-debug="love.options"]'`。
- **建议**：给关键页面加统一的 `data-debug-ready="love|practice|dinner"` 标记，
  `nav` 默认等到它；没有标记的页面再退回 `waitIdle`。

### F4. 无头 Chrome 的启动与 dev 首次编译叠加，反馈慢

- **现象**：`up --serve` 从调用到返回约 20–40s（Next 首次编译 + Chrome 启动）。
- **拖慢**：迭代时每条命令本身是毫秒级，但冷启动一次很贵。
- **当前绕过**：守护进程常驻，后续命令复用。
- **建议**：保持常驻；`down` 只在真正需要重置状态时用。文档里明确「不要每条命令 up/down」。

### F5. 调试用状态夹具需要跟 schema 走

- **现象**：`practice-active` 等夹具是 `buildSession` 生成的快照；ArchiveSchema 一改，
  `state.load` 会让页面进恢复/隔离分支。
- **拖慢**：夹具坏了表现为「页面空白」，不是校验错误。
- **当前绕过**：`scripts/debug-seed.ts` 重新生成。
- **建议**：`state.load` 在客户端先做一次 `parseArchive` 预检（页面内不好做），
  或让 CLI 读夹具时用 zod 校验并报字段路径。优先做后者。

### F6. 模型夹具的路由键是 URL path，不是 body.task

- **现象**：`/api/love-play` 的请求体没有 `task` 字段，任务名只在 URL 上。
- **拖慢**：最初按 `task` 匹配会全部落空。
- **当前绕过**：夹具键用 `love-play`（去掉 `/api/`）。
- **建议**：文档写死这条；`model.use` 加载时打印实际路由键，避免猜。

### F7. Git Bash 会把 `/` 开头的路由参数转成 Windows 路径

- **现象**：`node scripts/debug.mjs nav /` 实际导航到
  `http://127.0.0.1:3000/C:/Program%20Files/Git`，页面 404，等待超时。
  MSYS 把 `/` 当成 Git 安装根目录，`/love` 会变成 `C:/Program Files/Git/love`。
- **拖慢**：表现成「页面没就绪」，而不是参数错误，第一眼会怀疑 dev server。
- **当前绕过**：`normalizeRoute()` 在引擎入口识别 `C:/Program Files/Git` 前缀并还原；
  也可以写 `nav love/play/...`（不带前导斜杠）或 `nav home`。
- **建议**：文档默认示例不用前导斜杠；`nav` 报错时把实际 URL 打进错误消息。

### F8. Next 16 dev 把 `127.0.0.1` 当跨源，页面永远不 hydration

- **现象**：页面 `readyState=complete`、`title` 正确，但 `body.innerText` 为空，
  DOM 只有 `<div class="sheet"><div class="min-h-dvh"></div></div>`。
  dev server 日志：
  `Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1"`。
- **拖慢**：看起来像应用渲染坏了；实际是调试基址用了 `127.0.0.1`，而 Next 只放行 `localhost`。
- **当前绕过**：调试基址统一用 `http://localhost:3000`。
- **建议**：不要为了调试去改 `next.config.ts` 的 `allowedDevOrigins`（会改变所有人的 dev 行为）；
  基址默认值就写 `localhost`，并在 `doctor` 里提示当前基址。

### F9. 新会话停在 `about:blank`，第一条 `state.load` 必然 SecurityError

- **现象**：`state.load` 直接报
  `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied`。
- **拖慢**：场景第一步就挂，看起来像夹具坏了。
- **当前绕过**：`ensureAppOrigin()` 在读写设备状态前先导航到应用源。
- **建议**：守护进程启动后直接把页面导航到 `base`，别停在 `about:blank`；
  所有 `state.*` 命令保留 `ensureAppOrigin` 作为兜底。

### F10. 按「第几次调用」取模型夹具，在 StrictMode 下会错位

- **现象**：同一场景第一次跑全绿，第二次在第 2 回合失败——拿到的是第 3 条夹具。
  React StrictMode 在 dev 会重复触发首回合 effect，队列被多消费一条。
- **拖慢**：间歇性失败，最容易被误判成产品 bug；而且越重跑越乱。
- **当前绕过**：夹具支持 `"by": "learnerTurns"`，按请求体里 `messages` 的学习者条数选响应；
  同一回合的重复请求拿到同一条。恋爱流程已改用这个模式。
- **建议**：新夹具默认按语义键（learnerTurns / turnIndex）而不是调用序号；
  只有确实无法从请求体推导时才退回 counter。

### F11. 练习 / 饭局 / 结算走流式协议，JSON 夹具套不进去

- **现象**：`/api/roleplay` 用 `taskStream` 回 `text/plain` + `\n@@final\n<JSON 字符串>`，
  而 `model.use` 默认把夹具对象 `JSON.stringify` 后按 `application/json` 返回。
- **拖慢**：恋爱流程能全离线跑，练习只能跑到输入框，一发送就打到真实模型。
- **当前绕过**：夹具项支持 `{"__raw": "...", "__contentType": "text/plain; charset=utf-8"}`
  原样回放；`fixture build` 用 spec 自动包 `@@meta` / `@@final`；`model.record` 自动识别流式响应。
- **建议**：已落地。新增流式接口时，在 `fixture-build.mjs` 里加一种 spec 形状即可。

### F12. 绝对 URL 被当成站内路由拼接，Studio 打不开

- **现象**：`nav http://127.0.0.1:5180/debug.html` 实际导航到
  `http://localhost:3000/http://127.0.0.1:5180/debug.html`。
- **拖慢**：Studio 与主站不同源，必须用绝对 URL；这个 bug 让 Studio 完全进不去。
- **当前绕过**：`normalizeRoute()` 对 `^https?:` 原样返回。
- **建议**：跨运行时调试统一用绝对 URL；`nav` 的错误消息要带最终 URL（已带）。

### F13. 同名按钮在遮罩后面，`--text` 点到的是不可见的那个

- **现象**：Studio 标题页和角色选择面板各有一个「新的故事」；`ui.click --text="新的故事"`
  报 “no clickable element contains”，但 `ui.list` 里明明有。
- **拖慢**：`findText` 只取第一个匹配，正好是遮罩后 disabled 的那个；AI 会以为按钮不存在。
- **当前绕过**：`clickTextReady` 遍历所有同名元素，点第一个 **enabled 且可见** 的；
  `findText` 也优先返回可见元素。
- **建议**：场景里尽量用 `data-debug` 锚点；没有锚点时，`ui.click --text` 的语义就是
  「点当前可见的那个同名按钮」，与人的行为一致。

### F14. 3D 存档的 Web Lock 被「自己上一轮实例」占着，第二次跑饭局判「另一窗口修改」

- **现象**：`dinner-turn` 第一次通过，第二次必挂；页面显示「另一窗口修改了这场练习」，
  `dinner.send` 一直 disabled，`ui.click` 等满 15s 报 “still disabled”。
- **诊断过程**：先怀疑 bfcache（关掉后仍复现），再给 `trace` 加 `lock` / `storage` 两种事件，
  才看到真相：`#2 request` → `#2 acquired` → `#3 request` → `#3 NULL`。
  同一个页面里有两个 `createDinnerStorage` 实例（StrictMode 双挂载 / 路由重挂），
  后一个请求落在前一个「已获取但还没释放」的窗口里，`ifAvailable` 直接返回 null，应用判成冲突。
- **拖慢**：表象是「存储坏了 / 另一个窗口在改」，实际是自己跟自己抢锁；只看截图永远查不出来。
- **当前绕过**：`createDinnerStorage` 首次拿锁失败会短暂重试（5 × 60ms）再判冲突，
  把「自己的收尾」和「真有另一个窗口在写」分开。`trace` 保留 `lock` / `storage` 事件。
- **建议**：凡是 `ifAvailable` 拿锁就判冲突的地方，都要区分「首次挂载的瞬时占用」和「持续占用」；
  调试引擎要能回答「谁在什么时候写了 localStorage / 拿了哪把锁」，别让 AI 去猜。

### F15. CLI 参数形态不统一：`ui.type` 只吃位置参数，`--target` 被静默忽略

- **现象**：`pnpm debug ui.type --target=dinner.input --text="…"` 返回
  `selector not found or still disabled: undefined`——`--target` 根本没被映射，`text` 也是空串。
- **拖慢**：报错信息说的是「选择器找不到」，看着像页面问题；实际是命令行写法问题，
  AI 会去翻 DOM 而不是改命令。
- **当前绕过**：已落地。位置参数与 `--target` / `--text` 两种写法等价；缺参数直接报
  「needs a target」。
- **建议**：新增命令时先想清楚「参数缺失」的报错文案，报错是给下一个人看的接口。

### F16. `smoke` 的默认路由表会过期，而且失败也返回 0

- **现象**：`/scenarios`、`/library` 渲染「这一页不存在」并带一条 404 控制台错误——
  这两个路由只有 `[slug]` 动态页，没有索引页；而 `smoke` 仍报 `ok: true`。
- **拖慢**：默认路由表是手写的，页面重构后没人回来改；退出码 0 让门禁形同虚设。
- **当前绕过**：默认表改成真实存在的 14 条路由；`smoke` 失败时 `process.exitCode = 1`。
- **建议**：默认路由表从 `src/app/**/page.tsx` 推导（排除动态段），别手写；
  任何「全站检查」类命令都必须能用退出码表达失败。


### F17. 录制时 CLI 与页面记的 target 不是同一种东西，去重失效

- **现象**：录一遍恋爱流程，`ui.click` 被录成两条——`[data-debug="love.option-0"]` 和 `love.option-0`。
- **原因**：CLI 在发 rpc 之前就把别名解析成了 CSS 选择器，页面侧记的是 `data-debug` 属性值。
  两侧字符串不同，`mergeRecording` 的「同 cmd + 同 target」判定自然不命中。
- **拖慢**：录出来的场景能跑，但同一个动作重复两遍；多看几眼才反应过来是形态不一致。
- **当前绕过**：引擎在 `#noteCliCommand` 里用 `anchorName()` 把选择器归一成锚点名，
  页面侧本来就记锚点名，两边对齐后去重正常（5 步：state.load / model.use / nav / click / type）。
- **建议**：**录制用的键永远是 `data-debug` 锚点名**，别把解析后的选择器当身份。

### F18. 3D 场景在贴图没解码完就被 reload，控制台报 GLTFLoader 纹理失败

- **现象**：`dinner-conflict` 里点「已下载，重新读取」触发 `location.reload()`，
  `assert.noErrors` 抓到两条 `THREE.GLTFLoader: Couldn't load texture blob:…`。
- **原因**：旧文档还在解码 blob 纹理，导航把它的 blob URL 回收了；这是重载竞态，不是功能缺陷。
  单独 `nav 3d` 或 `reload`（等 3s）都复现不出来。
- **拖慢**：一条预期内的噪声会让整条场景红，而全局过滤又会掩盖真正的加载失败。
- **当前绕过**：`assert.noErrors` 支持按场景声明 `ignore`（正则），被忽略的条数记在 `ignored` 里。
- **建议**：噪声必须在**场景里**声明并写清原因；不要往全局 `DEV_NOISE` 里塞。

### F19. `suite` 会把需要 Studio venv 的场景一起跑，CI 里必红

- **现象**：`studio-chat` 第 0 步 `studio.up` 在没装 venv 的机器上直接抛
  `Studio venv not found`，整条 `pnpm debug suite` 变红。
- **原因**：场景目录是扁平遍历的，没有任何「这条场景需要什么环境」的声明。
- **当前绕过**：场景加 `"requires": "studio"`；`suite` 检测不到 venv 就跳过并标 `skipped`，
  `--all` 可以强制跑。
- **建议**：新场景只要依赖外部运行时（Studio / 真机 / 特定模型），都写 `requires`；
  让「环境不具备」表现为跳过，而不是失败。

### F20. CI 只能做到 YAML 校验，真实跑一次之前都是假设

- **现象**：`.github/workflows/debug-harness.yml` 写好了，但本地没有 GitHub runner。
- **拖慢**：Chrome 是否在 `/usr/bin/google-chrome`、冷启动 `next dev` 是否够 20 分钟预算、
  runner 上无头 Chrome 要不要额外参数，全都无法在本地证伪。
- **当前绕过**：用 `python -c "import yaml; yaml.safe_load(...)"` 校验结构；
  Chrome 检查步骤在找不到浏览器时明确 `exit 1`，不留静默通过。
- **建议**：第一次真实跑要盯；如果 `suite` 超时，把 smoke 拆成独立 job 或按标签分组跑。

### F21. 分层之后 `appRoot` 算错一层，工具不报错、只返回空数组

- **现象**：MCP 的 `sc_contracts` 返回 `{"routes":[],"fixtures":[],...}` 全是空数组，`isError:false`。
- **原因**：`mcp-server.mjs` 在 `app/scripts/debug/` 下，却照抄了 `debug.mjs`（在 `app/scripts/`）的
  `resolve(HERE, "..")`。于是 `appRoot` 变成 `app/scripts`，扫 `src/app/api` 自然扫不到；
  `debugRoot` 也跟着错到 `app/scripts/.debug`，`sc_logs` / `sc_diff` 会读写错目录。
- **拖慢**：不报错、不抛异常，只是「空」。看 `isError:false` 很容易以为功能没数据。
- **当前绕过**：改成 `resolve(HERE, "../..")`。单元测试全绿也抓不到——因为测的是假 `commands`。
- **建议**：跨层复制的路径常量是最高危的复制；每加一层目录，就用一次**真实调用**验证
  （`pnpm debug:mcp:smoke --call sc_contracts`），别只靠单测。工具返回空集合时先怀疑根路径。

### F22. trace 存在 sessionStorage，跨导航不清，上一轮的错误算到下一轮头上

- **现象**：手工在 `/3d` 逛过之后跑 `sc_suite`，`love-happy` / `practice-chat` 的
  `assert.noErrors` 报 `THREE.GLTFLoader: Couldn't load texture blob:`——跟这两条场景毫无关系。
- **原因**：`trace` 的环形缓冲放在 sessionStorage，同一标签页跨导航一直累积；
  `assert.noErrors` 读的是整段缓冲，于是把上一轮手工浏览的噪声算进本轮。
- **拖慢**：场景「刚才还好好的，现在红了」，而且只在人工操作过之后复现，极难联想。
- **当前绕过**：`runScenario` 在第一步之前 `trace.clear`，每条场景从干净缓冲开始。
- **建议**：任何「断言全局状态」的检查都要先显式重置该状态；隐式共享的缓冲是排查噪声的头号来源。

### F23. Studio 的 seed 不重置对话，断言命中上一轮历史——场景假绿

- **现象**：`studio-chat` 连跑之后，`assert.text` 在 20ms 内就绿了，而正文里已经有
  12 组一模一样的「旅行者 / 甘雨」对话，消息数从 11 一路涨到 33。这一轮其实只多发了一条，
  断言匹配到的是历史里任意一条。
- **原因**：Studio 的对话存在 SQLite（`animabackend.db`），`app.debug_seed` 早就支持 `--reset`
  删掉「调试对话」，但 `commands.mjs` 的 `studioSeed(card)` 没有透传这个开关，
  场景 JSON 里也没有地方声明。种子本身幂等（按名字查重），于是每轮都往同一条对话里追加。
- **拖慢**：这是最坏的一类失败——**看起来绿**。如果不看返回的 `text`，会以为发送链路通过了；
  真出问题（比如发送按钮坏了）也照样绿。
- **当前绕过**：`studioSeed(card, {reset})` 透传 `--reset`；场景写 `"reset": true`；
  断言改锚到 `studio.lastReply`（最后一条 assistant），只读这一条回复。
- **建议**：场景里任何「断言某段文本出现」的步骤，都要先问「这段文本会不会在别处/上一轮也存在」。
  有状态的存储（SQLite / localStorage）必须在场景开头显式重置，别指望种子的幂等性。

### F24. initialize 里声明的能力没人断言，缺了也不知道

- **现象**：MCP 服务器 `initialize` 已经声明 `resources` + `prompts`，`mcp-smoke` 却只验
  `tools/list`。`resources/templates/list` 是否可用、`resources/read` 是否真返回内容，全靠人工试。
- **原因**：冒烟脚本是跟着第一版（只有 tools）写的，后来加能力时没人回头补断言；
  协议单测也一直只覆盖 tools。
- **拖慢**：能力表是 AI 客户端决定「要不要用 resource」的唯一依据。声明了但实际坏掉时，
  客户端会一直拿到错误，而本地自检全绿。
- **当前绕过**：冒烟补 `resources/list` / `resources/templates/list` / `resources/read` / `prompts/list`
  四步（离线、不碰浏览器）；`mcp-server.test.mjs` 补 11 个 resources/prompts 协议测试（共 26 个）。
- **建议**：`initialize` 的 capabilities 是契约，声明几条就要有几条冒烟断言；
  加能力时把冒烟脚本和单测一起改，别只改实现。

### F25. CI 的步骤在 workflow 里另写了一份，本地跑的是另一套

- **现象**：`debug-harness.yml` 里逐步写了 `pnpm debug up --serve` / `doctor` / `suite` / `smoke`，
  本地验证时又是自己敲一遍命令。两边一旦有一边改了参数（比如加 `contracts`），另一边不会跟着变。
- **拖慢**：CI 红了要先判断「是产品坏了还是 workflow 和本地不一致」；改步骤要改两处。
- **当前绕过**：步骤收进 `app/scripts/debug/ci-steps.sh`，workflow 只做 `bash scripts/debug/ci-steps.sh`；
  脚本自己探测浏览器（找不到 `exit 1`）、自己 `trap EXIT` 收守护进程。本地用同一个脚本在
  `node:22-bookworm` 冷容器里跑，等于验证了 Linux 路径。
- **建议**：凡是「CI 干的事」，都只写一份可执行脚本；YAML 只负责装环境与上传产物。

### F26. 夹具「文件存在」就绿了，但从来没发过一次请求

- **现象**：`contracts` 只看 `debug/fixtures/models/*.json` 里的路由键，文件在就报 covered。
  9 条路由补了夹具后覆盖率 14/14，但没有任何证据表明请求真被拦到、响应真能被解析。
- **拖累**：形状写错（少字段、类型不对）也能让 `contracts` 全绿，直到某个场景用到才炸，
  而且报错点在业务代码里，看起来像产品 bug。
- **当前绕过**：夹具顶层加 `probes`，`debug fixture probe <name>` 装上夹具后在页面里逐条真发请求，
  断言 2xx；`sc_fixture_probe` 同步暴露给 MCP。8 个夹具、14 条路由全部实测 2xx。
- **建议**：「存在性检查」和「可用性检查」要分开命名。前者便宜但只防拼错，后者才证明能用。

### F27. canvas 插桩把几百个 1×1 的 2d 画布也登记了，输出被淹

- **现象**：`dinner-turn` 的 `canvas.stats` 返回 `canvases` 749 条，几乎全是 `{w:1,h:1,type:"2d"}`；
  真正想看的 `webgl2 1256×745` 埋在中间，AI 读结果要先过滤。
- **原因**：`getContext` 对所有上下文类型都登记，而 Next / three.js 会造大量离屏 2d canvas；
  插桩还持有元素引用，长会话里既污染输出又白占内存。
- **当前绕过**：`canvases` 只留 webgl/webgl2；2d 只按类型计数放 `contexts`（`{"2d":628,"webgl2":1}`）。
  断言只读 webgl 子集。
- **建议**：观测型插桩先想清楚「谁会读这个输出」；把噪声和信号分开计数，别指望调用方自己过滤。

### F28. 真实 BYOK 没有 key，最容易写成一个假绿的检查

- **现象**：Studio 的真实模型一局生成一直没验，因为需要用户的 key。很容易写成「有 key 就测，
  没 key 就 return 成功」，于是这个检查永远是绿的。
- **当前绕过**：`debug studio byok` 把「没 key」表达成 `{skipped:true, reason}`，和「通过」分开；
  `--api-type=mock` 走同一套代码（建临时连接 → `test-message` → 断言回复 → 删连接）自检 harness，
  所以流程本身是验过的，剩下没验的只有真实 provider 那一步。key 只从环境变量读，不落库、不回显。
- **建议**：任何「需要外部凭据」的检查，都要有一条无凭据也能跑的路径来证明检查逻辑本身；
  「跳过」必须是显式字段，不能是静默 return。

### F29. 把 CI 步骤抽成脚本后，真跑一次才发现两处只在 Windows 上炸

- **现象**：`SKIP_INSTALL=1 bash scripts/debug/ci-steps.sh` 第一次报「找不到浏览器」——机器上明明装着 Chrome。
  修完再跑，`studio.up` 报 `spawn EINVAL`，整个 suite 红在第一条场景。
- **原因**：① 脚本只按 `google-chrome` / `chromium` 这些 Linux 名字查 PATH，而 Windows 的 Chrome 不在 PATH 上
  （引擎的 `CHROME_CANDIDATES` 里才有安装路径）；② 为了消 `DEP0190` 把 `shell:true` 去掉了，
  但 Node 24 在 Windows 上不允许直接 spawn `npm.cmd`。
- **拖慢**：这两个都只在「真的执行脚本」时出现。只做 YAML 校验、或只单独跑 `pnpm debug suite`，
  永远看不到——单独跑 suite 时 daemon 已经起来了，根本走不到 studio.up 的 spawn 分支。
- **当前绕过**：浏览器查找先按 PATH，再问引擎自己的 `findChrome()`（路径清单只有一份）；
  Windows 上显式 `cmd.exe /d /s /c npm run dev`，既不触发 EINVAL 也不打 DEP0190。
  `chrome --version` 在 Windows 上会真的拉起窗口，所以那边只打印路径。
- **建议**：「CI 能不能跑」必须用 CI 的入口本身去验，不能把步骤拆开分别跑再拼结论。

### F30. `assert.count` 把锚点名当 CSS 选择器，数到 0

- **现象**：场景写 `assert.count target=practice.message min=2`，报 `got 0`，但页面上明明有 5 条消息。
- **原因**：命令层把 `target` 过 `resolveTarget`，不在 `ALIASES` 里的名字原样返回；
  `assert.count` 直接 `querySelectorAll("practice.message")`——`practice.message` 被当成标签名，匹配不到。
  `assert.text` 没这个问题，因为页面侧的 `__sc` 查找会先试 `[data-debug="…"]`。
- **当前绕过**：`ALIASES` 补 `practice.message`；`assert.count` 在 0 命中且目标不含选择器标点时
  回退到 `[data-debug="…"]`，返回里带实际用的选择器。`body` 这类真选择器不受影响（它 0 命中才回退）。
- **建议**：新增锚点时顺手加 `ALIASES`；断言类命令对「锚点名 / 选择器」两种输入都要能兜住。

### F31. 实例字段和方法同名，方法被字段遮蔽

- **现象**：`pnpm debug api.calls` 报 `this.apiCalls is not a function`。
- **原因**：请求环形缓冲叫 `this.apiCalls`（数组），读取方法也叫 `apiCalls()`；实例属性遮蔽原型方法。
- **当前绕过**：字段改名 `this.apiLog`，方法保留 `apiCalls()`。
- **建议**：同一概念的数据字段和方法不要同名；Node 的报错（not a function）很容易被当成「命令没接线」。

### F32. repeat 分叉误报在 `state.load` 的 url 上

- **现象**：`run assert-primitives --repeat=2` 报 `divergence.stable=false, index=0, cmd=state.load, kind=data`，
  两轮都绿，却提示分叉。
- **原因**：场景共享同一个浏览器，第 2 轮开始时页面还停在第 1 轮结束的 `/practice/...`，
  `state.load` 返回的 `data.url` 因此不同。这不是 flake。
- **当前绕过**：`normalizeStep` 对**非 nav/reload** 步骤忽略 `data.url`；导航步骤的 url 仍参与比较。
- **建议**：比较「环境快照」类数据时，先问「这个字段是不是上一轮的残留」；共享浏览器的 url 最典型。

### F33. 分诊分类器漏了新断言的失败文本

- **现象**：`assert.api failed: ... expected exactly 99, got 1` 被分成 `unknown`；
  `assert.count failed: ... got 0` 被分成 `http-error`（因为 trace 里恰好有 health 5xx）。
- **原因**：分类规则只列了 `text does not contain` / `audio assert failed` 等老文案，
  新加的 `assert.api` / `assert.count` / `assert.state` 的 `assert.<kind> failed:` 没匹配上；
  http-error 是兜底分支，于是抢走了。
- **当前绕过**：断言分支加 `^(assert\.\w+|audio assert|canvas assert) failed`；
  假设文案按断言类型分支（api → `api.calls`，count → snapshot 数元素，state → `state.dump`）。
- **建议**：新增断言命令时同步更新分诊规则，否则失败会被归到「未知」或更泛的类；
  分类顺序里兜底分支永远最后，别让兜底吃掉已知模式。

### F34. 加了 `data-debug` 不等于场景能点到——还有一张别名表

- **现象**：给提示按钮加上 `data-debug="practice.hint"`，`eval` 能查到、手工点得到，
  但场景里 `ui.click target=practice.hint` 连续两次报 `selector not found or still disabled`。
- **原因**：命令层只把 `ALIASES` 表里的名字换成 `[data-debug="…"]`，表外的裸名字原样下发；
  `practice.hint` 被当成 CSS 标签选择器（非法）→ 永远找不到。`assert.count` 也踩过同类（F30）。
  两处（页面 `q()`、`assert.count`）各有一套「锚点名还是选择器」的判断，规则还不一致（`.` 一个当标点、一个当选择器）。
- **当前绕过**：页面侧 `q()` 在选择器 0 命中时，对 `a.b` 形态的名字回退查 `[data-debug="…"]`；
  `assert.count` 用同一条规则（带点、不含其它 CSS 元字符 = 锚点名）并吞掉非法选择器异常；
  `ui.click` 的失败信息区分 `not found` / `still disabled` / `still invisible`。
- **建议**：新增锚点后先跑一次场景，不要只 `eval` 验证存在；「元素存在」和「场景能寻址」是两件事。

### F35. `Promise was collected`：页面在等待中途重载

- **现象**：`suite` 里 `studio-chat` 的 `ui.click studio.card` 报 `Runtime.evaluate: Promise was collected`；
  单独跑同一场景却全绿。
- **原因**：`ui.click` 的轮询是一个 `awaitPromise` 的页面内 Promise。Vite dev server 刚起来时
  会再触发一次 reload/HMR，执行上下文被销毁，pending 的 evaluate 直接作废。
  `evaluate` 原本只对 `context/destroyed/navigat` 重试，没覆盖这条文案。
- **当前绕过**：重试正则加 `collected`（最多 3 次，每次间隔 150ms）。
- **建议**：凡是页面内长轮询，都要考虑「中途导航/重载会收走 Promise」；把这类 CDP 文案加进重试白名单。

### F36. 上一场景的页面把夹具写回去了（CI 慢机器上必现）

- **现象**：CI 上 `love-happy` 的 `nav` 等不到 `love.options`；本地复跑 `dinner-conflict → dinner-turn` 时，3D 页直接进入「回合 00/12」，没有「开始接话」。
- **原因**：场景共用一个浏览器。`state.load` 先写 localStorage 再 `reload` 当前页，而**上一页仍在运行**——
  3D 页卸载/收尾时会把 `socialcoach-dinner-v1` 与 `socialcoach.v1` 再写一次，晚于我们的写入，
  于是新页面拿到的是上一场景的档案（有正在进行的 3D 会话 ⇒ 自动续局）。
- **当前绕过**：`state.load` / `state.clear` 先 `settlePreviousPage()`（若不在 `/` 就先导航到 `/` 并等 150ms），
  写完再按语义校验（`profile.name` 对得上、`socialcoach-dinner-v1` 没有残留），不对就重写，最多 3 轮，仍不对就报错而不是带着脏状态继续。
- **建议**：跨场景共享浏览器时，「写状态」必须发生在旧页面卸载之后，并且要校验而不是假设写入生效。

### F37. 点击过程中页面换文档，`Runtime.evaluate` 报 Promise was collected

- **现象**：`suite` 里 `dinner-turn` 的 `ui.click 开始接话` 失败在「找不到按钮」，但失败时的页面已经进入对话（点击其实生效了）；
  另一些运行里同一位置报 `Runtime.evaluate: Promise was collected`。
- **原因**：点击触发整页重载（Next dev 重新编译、Studio 的 Vite 整页 reload）时，页面内未决的 Promise 被回收。
  早先给 `evaluate` 加的 `collected` 重试会把整个点击表达式重放一遍——第二次时按钮已经不在了，于是「点击成功」被改写成「找不到」。
- **当前绕过**：`evaluate` 不再对 `collected` 做通用重试；`uiClick` 自己处理：目标/文字已消失 ⇒ 视为点击生效（结果带 `afterNavigation: true`），
  目标还在 ⇒ 重试一次，仍失败才抛错。
- **补充（2026-10-23，`studio-chat` 偶发）**：「目标还在」这个判据不够——`selectCard` 里有几个 `await`，
  `setCardView('editor')` 要等它们回来，卡片在点击后还会挂几百毫秒到一秒。于是重试判定「还在 ⇒ 没点到」，
  重跑表达式，最后干等满 timeout 报 `not found`（实测 step 用时 30.4s，而 `selectCard` 在点击后 218ms 就跑了）。
  现在 `ui.click` 生成一个 token，页面在点击前写进 `data-sc-click`；重跑看到同一个 token 直接返回 `already`，
  不点第二下，也不再依赖「目标是否立刻消失」。同时点击表达式用 `evaluate({ retries: 0 })`，
  重跑只由 `uiClick` 控制；重试预算压到 5s。
- **建议**：有副作用的页面内操作不要套用「幂等读取」的重试策略。重试前先在页面里留一个「这次副作用已经发生」的标记，
  而不是靠「目标还在不在」猜——UI 的副作用可能比点击晚几拍。

### F39. 改了调试引擎却跑出旧结果：守护进程常驻旧代码

- **现象**：改完 `engine.mjs` 再跑 `suite`，失败样子和改之前一模一样；手动 `down` 再跑就正常了。
- **原因**：`daemon-client.ensure()` 只按「端口能响应」复用会话，而 `engine.mjs` / `daemon.mjs` 是常驻在那个进程内存里的。
  源码改了、进程没重启，跑的就是旧代码——红和绿都可能是假的。
- **当前绕过**：`ensure()` 比较 `scripts/debug/*.mjs` 里最晚的 mtime 与 `session.startedAt`，源码更新就先关旧进程再拉起。
  关的时候要**等旧进程退干净**：它 `shutdown()` 会删 `session.json`，抢跑会把新会话文件删掉，
  接着整轮套件都报 `no daemon session`（本地复现过一次，14 个场景全红）。
- **建议**：常驻进程 + 热改代码的组合必须有「代码版本」概念；只探活不复用版本，迟早骗自己一次。
  查这类问题要先确认「我改的代码真的在跑」，否则会围绕不存在的因果改半天。

### F38. CI 失败包一个都没上传：upload-artifact 默认跳过隐藏目录

- **现象**：workflow 的「Upload failure bundles」显示 ✓，但 `gh run download` 报 `no valid artifacts`；日志里写着
  `No files were found with the provided path: app/.debug/failures/**`。
- **原因**：`.debug` 是隐藏目录，`actions/upload-artifact@v4` 默认 `include-hidden-files: false`；
  `if-no-files-found: ignore` 又把「没东西可传」变成成功，于是失败现场全部丢失。
- **当前绕过**：显式 `include-hidden-files: true`。另外 CI 改成先 `smoke`（逐路由预热 Next 的按需编译）再 `suite`，
  避免冷 runner 上 `/3d`、`/love/play` 的首次编译吃掉场景超时。
- **建议**：把产物上传当成断言来看——「上传成功」不等于「传了东西」，要么关掉 ignore，要么在日志里确认文件数。

### F40. 场景隐式依赖「本机配了模型 key」：本地全绿，runner 全红

- **现象**：`coach-flows` 在 GitHub runner 上卡在 `ui.click 推荐今日练习`（等满 90s 报
  `no clickable element contains`），本机同样的 commit 连续多轮全绿。runner 的失败截图里还开着一个
  API 设置弹窗，页面上的按钮是灰的。
- **原因**：首页那颗按钮是 `<Button requiresModel>`，`canUseModel` 来自 `/api/health` 或 BYOK。
  本机 `.env.local` 有 key，`/api/health` 回 `{serverKey:true,state:"available"}`，按钮可点；
  runner 没有 key → `unavailable` → 按钮 `disabled`，`clickTextReady` 只接受可点元素，于是「找不到」。
  `model.use` 的夹具只覆盖了 `rehearse/schedule/track`，`/api/health` 一直打的是真后端。
- **当前绕过**：回放模式下 harness 自己回答 `/api/health`（`{state:"available"}`），
  夹具里显式写 `health` 可以覆盖它（想测不可用路径就这么写）。
  验证办法是 A/B：夹具写 `available` → 按钮可点；写 `unavailable` → 按钮 `disabled` 且
  `title="接入可用的模型后继续"`。
- **建议**：凡是「点一下要能点」的场景，都会隐式依赖一堆「环境就绪」判定（模型、权限、开关）。
  这些判定必须有夹具来源，不能让它们落到真后端——否则本地绿只是因为你机器上恰好配过。
