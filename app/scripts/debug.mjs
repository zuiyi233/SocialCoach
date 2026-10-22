#!/usr/bin/env node
/**
 * AI 调试 CLI。用法见 wiki/specs/spec-ai-debug-harness.md。
 *
 *   pnpm debug up --serve          # 起 next dev + 无头 Chrome（后台常驻）
 *   pnpm debug state.load love-start
 *   pnpm debug nav /love/play/<id>
 *   pnpm debug model.use love-flow
 *   pnpm debug ui.wait love.options
 *   pnpm debug ui.click love.option-0
 *   pnpm debug ui.text love.line
 *   pnpm debug run debug/scenarios/love-happy.json
 *   pnpm debug smoke
 *   pnpm debug down
 *
 * 所有命令输出 JSON（{ok, data, console}），失败时退出码 1。
 * 命令实现拆在 ./debug/commands.mjs 与 ./debug/daemon-client.mjs；本文件只做
 * argv 解析 → 调命令 → print / 设退出码。这里不直接碰 CDP：真正的浏览器会话
 * 在守护进程里（./debug/daemon.mjs）。
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createDaemonClient } from "./debug/daemon-client.mjs";
import { createCommands } from "./debug/commands.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const DEBUG_ROOT = join(APP_ROOT, ".debug");
const DAEMON = join(HERE, "debug", "daemon.mjs");

/** 与 daemon 同口径的 dev 噪声过滤；commands.mjs 里也有一份，改动要同步。 */
const DEV_NOISE = /_next\/hmr|ERR_INVALID_HTTP_RESPONSE/;

/** 一条事件算不算「要人管」的失败：控制台错误、异常、夹具缺失。 */
function isBadEvent(e) {
  const bad = e.kind === "exception" || e.kind === "error" || e.kind === "console.error" || e.kind === "model.missing" || (e.kind === "log" && e.level === "error");
  return bad && !DEV_NOISE.test(String(e.text ?? ""));
}

function parseArgv(argv) {
  const positionals = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, value = "true"] = arg.slice(2).split("=");
      flags[key] = value;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function print(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function fail(error, consoleEvents = []) {
  print({ ok: false, error: { message: String(error.message ?? error) }, console: consoleEvents });
  process.exitCode = 1;
}

async function main() {
  const { positionals, flags } = parseArgv(process.argv.slice(2));
  const [cmd = "doctor", ...rest] = positionals;

  const daemon = createDaemonClient({ appRoot: APP_ROOT, debugRoot: DEBUG_ROOT, daemonPath: DAEMON, base: flags.base });
  const commands = createCommands({ appRoot: APP_ROOT, debugRoot: DEBUG_ROOT, daemon });

  if (cmd === "down") {
    const result = await daemon.stop();
    if (!result.down) {
      print({ ok: true, data: { alreadyDown: true } });
      return;
    }
    print({ ok: true, data: { down: true, pid: result.pid } });
    return;
  }

  // 夹具生成不碰浏览器：先于守护进程处理，离线也能用。
  if (cmd === "fixture") {
    const [verb, arg] = rest;
    if (verb === "build") {
      if (!arg) throw new Error("fixture build needs a spec file");
      print({ ok: true, data: commands.fixtureBuild(arg) });
      return;
    }
    if (verb === "show") {
      if (!arg) throw new Error("fixture show needs a fixture name");
      print({ ok: true, data: commands.fixtureShow(arg) });
      return;
    }
    if (verb === "probe") {
      if (!arg) throw new Error("fixture probe needs a fixture name (or comma-separated names)");
      print({ ok: true, data: await commands.fixtureProbe(arg, { url: flags.url ?? "/" }) });
      return;
    }
    throw new Error("fixture needs build <spec.json> | show <name> | probe <name>");
  }

  if (cmd === "studio") {
    const [verb, arg] = rest;
    if (verb === "seed") {
      print({ ok: true, data: commands.studioSeed(arg, { reset: Boolean(flags.reset) }) });
      return;
    }
    if (verb === "up") { print({ ok: true, data: await commands.studioUp() }); return; }
    if (verb === "down") { print({ ok: true, data: commands.studioDown() }); return; }
    if (verb === "status") { print({ ok: true, data: await commands.studioStatus() }); return; }
    if (verb === "byok") {
      print({
        ok: true,
        data: await commands.studioByok({
          apiType: flags["api-type"] ?? "openai",
          baseUrl: flags["base-url"] ?? null,
          model: flags.model ?? "",
          keyEnv: flags["key-env"] ?? "STUDIO_BYOK_KEY",
        }),
      });
      return;
    }
    throw new Error("studio needs seed [card] | up | down | status | byok");
  }

  if (cmd === "logs") {
    print({ ok: true, data: commands.logs({ file: flags.file ?? "all", lines: Number(flags.lines ?? 80) }) });
    return;
  }

  // 离线分析：不启浏览器、不需要守护进程。放在 ensure 之前，
  // 这样「守护进程都起不来」的时候也能读失败包。
  if (cmd === "triage") {
    print({ ok: true, data: commands.triage({ limit: Number(flags.limit ?? 20) }) });
    return;
  }
  if (cmd === "coverage") {
    print({ ok: true, data: commands.coverage() });
    return;
  }
  if (cmd === "why" && flags.bundle !== undefined) {
    // `--bundle` 不带值时 parseArgv 给的是字符串 "true"：取最近一个失败包。
    const raw = String(flags.bundle);
    const dir = raw === "true" || raw === "" ? null : raw;
    print({ ok: true, data: commands.whyBundle(dir) });
    return;
  }

  const session = await daemon.ensure({
    serve: flags.serve === "true",
    headless: flags.headless ?? "1",
    timeout: flags.timeout ? Number(flags.timeout) : undefined,
  });

  if (cmd === "up") {
    const info = await daemon.health(session.port);
    print({ ok: true, data: info });
    return;
  }

  // 体检要能当门禁用：next dev 挂了或找不到 Chrome 时返回非零。
  if (cmd === "doctor") {
    const payload = await daemon.rpc("doctor", {});
    print(payload);
    const healthy = payload.data?.server?.ok && payload.data?.chromeExists;
    if (!healthy) process.exitCode = 1;
    return;
  }

  if (cmd === "errors") {
    const payload = await daemon.rpc("trace", {});
    const bad = payload.data.events.filter(isBadEvent);
    print({ ok: true, data: { count: bad.length, errors: bad } });
    return;
  }

  // 一条命令给全「现在是什么局面」：AI 不用连发 snapshot / trace / errors 再去拼。
  if (cmd === "why") {
    const [snapshot, trace] = await Promise.all([daemon.rpc("snapshot", {}), daemon.rpc("trace", { clear: false })]);
    const events = trace.data.events ?? [];
    const tail = (kind, n = 8) => events.filter((e) => e.kind === kind).slice(-n);
    print({
      ok: true,
      data: {
        url: snapshot.data.url,
        title: snapshot.data.title,
        ready: snapshot.data.ready,
        text: String(snapshot.data.text ?? "").slice(0, 1200),
        state: snapshot.data.state ?? {},
        interactive: (snapshot.data.interactive ?? []).slice(0, 40),
        errors: events.filter(isBadEvent).slice(-10),
        model: events.filter((e) => e.kind === "model.replay" || e.kind === "model.missing").slice(-8),
        storage: tail("storage", 10),
        lock: tail("lock", 10),
      },
    });
    return;
  }

  if (cmd === "anchors") {
    const route = rest[0];
    if (route) await daemon.rpc("nav", { path: route, wait: "body" });
    const data = await daemon.rpc("eval", {
      expression: `(() => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const nodes = Array.from(document.querySelectorAll("button,a,input,textarea,select,[role=button],[role=switch]")).filter(visible);
        const anchors = Array.from(document.querySelectorAll("[data-debug]")).map((el) => el.getAttribute("data-debug"));
        const unlabeled = nodes
          .filter((el) => !el.closest("[data-debug]") && !el.getAttribute("data-debug"))
          .map((el) => ({ tag: el.tagName.toLowerCase(), label: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.type || "").trim().slice(0, 40) }))
          .filter((item) => item.label);
        return { url: location.href, anchors, unlabeled };
      })()`,
    });
    print({ ok: true, data: data.data.value });
    return;
  }

  // 录制：人点一遍，落成可回放的场景 JSON。
  if (cmd === "record") {
    const [verb, name] = rest;
    if (verb === "start") {
      print({ ok: true, data: await commands.recordStart(name) });
      return;
    }
    if (verb === "stop") {
      print({ ok: true, data: await commands.recordStop() });
      return;
    }
    throw new Error("record needs start [name] or stop");
  }

  // 语义快照 diff：改代码前 `--save`，改完直接跑，只输出变化。
  if (cmd === "diff") {
    print({
      ok: true,
      data: await commands.diff({
        save: flags.save !== undefined,
        name: flags.name ?? "baseline",
        limit: Number(flags.limit ?? 40),
      }),
    });
    return;
  }

  // API 契约巡检：哪些路由还不能离线回放、哪些夹具键是拼错的。
  if (cmd === "contracts") {
    const data = commands.contracts();
    print({ ok: true, data });
    // --strict 当门禁：静态路由没夹具就算失败（动态路由需要具体 id，单独归类）。
    if ((flags.strict === "true" || flags.strict === true) && data.missing.some((row) => !row.dynamic)) process.exitCode = 1;
    return;
  }

  // 语音：假 SpeechRecognition，让转写文本可控。
  if (cmd === "speech") {
    const [verb, ...words] = rest;
    if (verb === "stub") {
      const data = await daemon.rpc("speech.stub", {
        transcript: words.join(" ") || flags.text || "",
        lang: flags.lang ?? "zh-CN",
        interim: flags.interim === "true" || flags.interim === true,
      });
      print({ ok: true, data });
      return;
    }
    if (verb === "say") {
      const data = await daemon.rpc("speech.say", {
        text: words.join(" "),
        delay: Number(flags.delay ?? 0),
        final: !(flags.final === "false" || flags.final === false),
      });
      print({ ok: true, data });
      return;
    }
    if (verb === "log") {
      print({ ok: true, data: await daemon.rpc("speech.log", {}) });
      return;
    }
    if (verb === "off") {
      print({ ok: true, data: await daemon.rpc("speech.off", {}) });
      return;
    }
    throw new Error("speech needs stub [text] | say <text> | log | off");
  }

  // 多标签页：验证「另一个窗口也在写」这类真实冲突。
  if (cmd === "tab") {
    const [verb, id, ...words] = rest;
    if (verb === "open") {
      if (!id) throw new Error("tab open needs a URL");
      print({ ok: true, data: await daemon.rpc("tab.open", { url: id }) });
      return;
    }
    if (verb === "list") {
      print({ ok: true, data: await daemon.rpc("tab.list", {}) });
      return;
    }
    if (verb === "close") {
      print({ ok: true, data: await daemon.rpc("tab.close", { id }) });
      return;
    }
    if (verb === "use") {
      print({ ok: true, data: await daemon.rpc("tab.use", { id }) });
      return;
    }
    if (verb === "eval") {
      print({ ok: true, data: await daemon.rpc("tab.eval", { id, expression: words.join(" ") }) });
      return;
    }
    throw new Error("tab needs open <url> | list | use <id> | close <id> | eval <id> <expr>");
  }

  // canvas 观测：WebGL 绘制调用 / rAF 帧数 / canvas 尺寸登记（证明 3D 在渲染）。
  if (cmd === "canvas") {
    const [verb] = rest;
    if (verb !== "stats") throw new Error("canvas needs stats [--ms=1000]");
    print({ ok: true, data: await daemon.rpc("canvas.stats", { ms: Number(flags.ms ?? 1000) }) });
    return;
  }

  // 音频观测：媒体元素 / new Audio() / WebAudio 的播放活动（TTS 链路验证）。
  if (cmd === "audio") {
    const [verb] = rest;
    if (verb === "log") {
      print({ ok: true, data: await daemon.rpc("audio.log", {}) });
      return;
    }
    if (verb === "clear") {
      print({ ok: true, data: await daemon.rpc("audio.clear", {}) });
      return;
    }
    throw new Error("audio needs log | clear");
  }

  if (cmd === "run") {
    const file = rest[0];
    if (!file) throw new Error("run needs a scenario file");
    const result = await commands.runScenario(file, { repeat: Number(flags.repeat ?? 1) });
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (cmd === "suite") {
    const result = await commands.suite({ all: Boolean(flags.all) });
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (cmd === "smoke") {
    const routes = rest.length ? rest : undefined;
    const payload = await commands.smoke(routes);
    print(payload);
    // 冒烟要能当门禁用：任何一条路由报错就返回非零，别让 CI 看着 ok:true 放过去。
    if (!payload.data?.ok) process.exitCode = 1;
    return;
  }

  // 参数映射：位置参数 → 命令字段。
  const args = { ...flags };
  const numeric = new Set(["nth", "timeout", "width", "height"]);
  for (const key of Object.keys(args)) {
    if (numeric.has(key)) args[key] = Number(args[key]);
    if (args[key] === "true" || args[key] === "false") args[key] = args[key] === "true";
  }
  // 位置参数与 --flag 两种写法等价：`ui.type dinner.input "…"` 和 `ui.type --target=… --text=…`。
  // 少了一半参数时直接说缺什么，别拿 undefined 去查选择器。
  if (rest[0] === undefined && flags.target) rest[0] = flags.target;
  if (rest[1] === undefined && flags.text !== undefined) rest[1] = flags.text;
  switch (cmd) {
    case "nav":
    case "reload":
      args.path = rest[0];
      break;
    case "eval":
      args.expression = rest.join(" ");
      break;
    case "state.load":
      args.fixture = rest[0];
      if (!args.fixture) throw new Error("state.load needs a fixture name");
      break;
    case "state.dump":
      if (rest[0]) args.save = rest[0];
      break;
    case "state.set":
      args.key = rest[0];
      args.value = rest[1];
      if (!args.key) throw new Error("state.set needs a key");
      break;
    case "api.calls":
      if (rest[0]) args.limit = Number(rest[0]);
      break;
    case "api.clear":
      break;
    case "ui.click":
      args.target = commands.resolveTarget(rest[0]);
      if (rest[1]) args.text = rest[1];
      if (!args.target && !args.text) throw new Error("ui.click needs a target or --text");
      break;
    case "ui.type":
      args.target = commands.resolveTarget(rest[0]);
      args.text = rest[1] ?? "";
      if (flags.submit) args.submit = commands.resolveTarget(flags.submit);
      if (!args.target) throw new Error("ui.type needs a target");
      break;
    case "ui.wait":
    case "ui.text":
    case "ui.value":
    case "ui.exists":
    case "ui.count":
      args.target = commands.resolveTarget(rest[0]);
      if (!args.target) throw new Error(`${cmd} needs a target`);
      break;
    case "model.use":
      args.fixtures = rest;
      break;
    case "model.record":
      args.name = rest[0];
      break;
    case "shot":
      if (rest[0]) args.path = rest[0];
      break;
    case "viewport":
      args.width = Number(rest[0] ?? 1280);
      args.height = Number(rest[1] ?? 900);
      break;
    default:
      break;
  }

  const payload = await daemon.rpc(cmd, args);
  print(payload);
}

main().catch((error) => fail(error, error.console));