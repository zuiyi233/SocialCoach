/**
 * MCP over stdio 服务器：把 mcp-tools.mjs 的 sc_* 工具表包装成 JSON-RPC 2.0 行协议。
 *
 * 线协议约定（客户端即 MCP host 的 stdio transport）：
 * - 请求 / 响应均为一行 JSON，换行分隔（不是 Content-Length 头）；
 * - stdout 只写协议帧，任何诊断 / 异常一律走 stderr；
 * - 通知（无 id）不写任何响应；tools/call 之间用 Promise 链串行
 *   （导航 / 点击并发会互相踩页面），tools/list / ping / resources / prompts 不排队。
 * - catalog（resources / prompts 提供方）可选注入：为 null 时只宣告 tools 能力，
 *   resources / prompts 相关方法回空列表，read / get 回 -32602。
 *
 * createMcpServer({ toolset, catalog, input, output, version }) 返回
 * { handle(message), start(), stop() }；CLI 直跑时按
 * daemon → commands → toolset → catalog 顺序自动组装并 start()。
 */
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createDaemonClient } from "./daemon-client.mjs";
import { createCommands } from "./commands.mjs";
import { createToolset } from "./mcp-tools.mjs";

/** MCP 客户端可能协商的 protocolVersion；其余一律回落默认值。 */
const PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const DEFAULT_PROTOCOL = "2025-06-18";

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** 把抛出的东西还原成可读文本：Error 取 message，其余字符串化。 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createMcpServer({ toolset, catalog = null, input, output, version = "0.1.0" }) {
  if (!toolset || typeof toolset.list !== "function" || typeof toolset.call !== "function") {
    throw new TypeError("createMcpServer requires a toolset exposing list() and call()");
  }

  // 工具调用串行化：链上任意时刻只有一个 tools/call 在跑。
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    const next = chain.then(fn);
    chain = next.catch(() => undefined); // 单次失败不弄脏整条链
    return next;
  };

  let reader = null;

  /** 一条已解析请求 → 响应对象；通知返回 null。handle 本身永不抛错。 */
  async function handle(message) {
    if (message === null || typeof message !== "object" || Array.isArray(message)) {
      return errorResponse(null, -32600, "Invalid Request");
    }
    // notifications/initialized 无论带不带 id 都不写任何东西（协议要求）。
    if (message.method === "notifications/initialized") return null;
    if (message.id === undefined) return null; // 其他通知同样不响应
    try {
      return await dispatch(message);
    } catch (error) {
      process.stderr.write(`mcp-server: ${error?.stack ?? String(error)}\n`);
      return errorResponse(message.id, -32603, "Internal error");
    }
  }

  async function dispatch(message) {
    const id = message.id;
    const method = message.method;
    if (method === "initialize") {
      const requested = message.params?.protocolVersion;
      const protocolVersion = PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      const capabilities = { tools: { listChanged: false } };
      if (catalog !== null) {
        capabilities.resources = { subscribe: false, listChanged: false };
        capabilities.prompts = { listChanged: false };
      }
      return response(id, {
        protocolVersion,
        capabilities,
        serverInfo: { name: "socialcoach-debug", version },
      });
    }
    if (method === "tools/list") return response(id, { tools: toolset.list() });
    if (method === "tools/call") {
      const name = message.params?.name;
      if (typeof name !== "string" || !name) {
        return errorResponse(id, -32602, "Invalid params: tools/call requires a non-empty string name");
      }
      const args = message.params?.arguments ?? {};
      const result = await enqueue(() => toolset.call(name, args));
      return response(id, {
        content: [{ type: "text", text: String(result?.text ?? "") }],
        isError: Boolean(result?.isError),
      });
    }
    if (method === "resources/list") {
      return response(id, { resources: catalog === null ? [] : catalog.resources.list() });
    }
    if (method === "resources/templates/list") {
      return response(id, { resourceTemplates: catalog === null ? [] : catalog.resources.templates() });
    }
    if (method === "resources/read") {
      if (catalog === null) return errorResponse(id, -32602, "resources are not available");
      const uri = message.params?.uri;
      if (typeof uri !== "string" || !uri) {
        return errorResponse(id, -32602, "Invalid params: resources/read requires a non-empty string uri");
      }
      try {
        const content = await catalog.resources.read(uri);
        return response(id, { contents: [content] });
      } catch (error) {
        // 原样透传错误文本，客户端据此能区分「URI 拼错」之类的原因。
        return errorResponse(id, -32602, errorMessage(error));
      }
    }
    if (method === "prompts/list") {
      return response(id, { prompts: catalog === null ? [] : catalog.prompts.list() });
    }
    if (method === "prompts/get") {
      if (catalog === null) return errorResponse(id, -32602, "prompts are not available");
      const name = message.params?.name;
      if (typeof name !== "string" || !name) {
        return errorResponse(id, -32602, "Invalid params: prompts/get requires a non-empty string name");
      }
      const args = message.params?.arguments ?? {};
      try {
        return response(id, await catalog.prompts.get(name, args));
      } catch (error) {
        return errorResponse(id, -32602, errorMessage(error));
      }
    }
    if (method === "ping") return response(id, {});
    return errorResponse(id, -32601, `Method not found: ${String(method ?? "")}`);
  }

  /** 一行原始输入 → 写一行响应。非法 JSON 回 Parse error 但继续处理后续行。 */
  async function handleLine(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      output.write(JSON.stringify(errorResponse(null, -32700, "Parse error")) + "\n");
      return;
    }
    const reply = await handle(message);
    if (reply !== null) output.write(JSON.stringify(reply) + "\n");
  }

  /** 从 input 按行读、结果按行写 output；重复调用是幂等的。 */
  function start() {
    if (reader) return;
    const rl = createInterface({ input, crlfDelay: Infinity });
    reader = rl;
    rl.on("line", (raw) => {
      if (!raw.trim()) return; // 空行（含 EOF 尾随换行）不是请求
      void handleLine(raw).catch((error) => process.stderr.write(`mcp-server: ${error?.stack ?? String(error)}\n`));
    });
    rl.on("close", () => {
      if (reader === rl) reader = null;
    });
  }

  /** 停止读取：关掉行接口；已入队的工具调用照常完成。 */
  function stop() {
    if (!reader) return;
    reader.close();
    reader = null;
  }

  return { handle, start, stop };
}

/** 直跑入口：stdin/stdout 即协议管道。只在 argv[1] 是本文件时触发。 */
const HERE = dirname(fileURLToPath(import.meta.url));
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  // 防呆：stdout 只允许协议帧，任何模块误打 console.log 都转 stderr，免得客户端解析崩。
  console.log = (...args) => process.stderr.write(`${args.map(String).join(" ")}\n`);
  // 本文件在 app/scripts/debug/ 下，app 根要往上两层；少一层会让 contracts/diff/logs 扫到空目录。
  const appRoot = resolve(HERE, "../..");
  const debugRoot = join(appRoot, ".debug");
  const daemon = createDaemonClient({ appRoot, debugRoot, daemonPath: join(HERE, "daemon.mjs") });
  const commands = createCommands({ appRoot, debugRoot, daemon });
  const toolset = createToolset({ commands, daemon });
  // catalog 由 mcp-catalog.mjs 提供（resources / prompts）。动态 import：
  // 测试加载本文件时不会触发；直跑时加载失败必须明确退出，绝不静默降级成空 catalog。
  let catalog;
  try {
    const { createCatalog } = await import("./mcp-catalog.mjs");
    catalog = createCatalog({ appRoot, debugRoot });
  } catch (error) {
    process.stderr.write(`mcp-server: failed to load ./mcp-catalog.mjs — ${error?.message ?? String(error)}\n`);
    process.exit(1);
  }
  createMcpServer({ toolset, catalog, input: process.stdin, output: process.stdout }).start();
}
