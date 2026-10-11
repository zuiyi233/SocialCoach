/** Local and CI only — never a deployment target.
 *
 * The budget client speaks the HTTP shape a hosted Redis endpoint uses: one POST
 * carrying a JSON array of Redis arguments, one `{result}` back. This turns that
 * shape into a real Redis round trip so the reserve and settle Lua can be proven
 * against an actual Redis instead of a stub that agrees with whatever we assert.
 *
 * Two transports:
 *  - default: shell out to `redis-cli` (CI, where the binary exists);
 *  - `REDIS_RESP_HOST`/`REDIS_RESP_PORT`: speak RESP directly over a socket —
 *    for machines that have a Redis container but no local redis-cli (spawning
 *    `docker exec` per command is both slow and unreliable on Windows).
 *
 * It binds to loopback and requires the bearer token, because a port that runs
 * arbitrary Redis commands on someone's machine is not a test fixture.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import net from "node:net";

const port = Number(process.env.REDIS_HTTP_PORT || 6399);
const token = process.env.REDIS_HTTP_TOKEN || "";
const host = process.env.REDIS_CLI_HOST || "127.0.0.1";
const redisPort = process.env.REDIS_CLI_PORT || "6379";
// Machines without a local redis-cli can still reach a containerized Redis:
// REDIS_CLI_CMD="docker" REDIS_CLI_PREFIX="exec -i <container> redis-cli" runs
// the same call through `docker exec`. Defaults keep the plain local binary.
const cmd = process.env.REDIS_CLI_CMD || "redis-cli";
const prefix = (process.env.REDIS_CLI_PREFIX || "").split(" ").filter(Boolean);
const respHost = process.env.REDIS_RESP_HOST;
const respPort = Number(process.env.REDIS_RESP_PORT || 6379);

if (!token) throw new Error("REDIS_HTTP_TOKEN is required: this shim executes arbitrary Redis commands");

const cliRun = (args) => new Promise((resolve, reject) => {
  execFile(cmd, [...prefix, "--json", "-h", host, "-p", String(redisPort), ...args.map(String)], { maxBuffer: 32 << 20 }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr || error.message));
    else resolve(JSON.parse(stdout || "null"));
  });
});

/** Minimal RESP client: one command per connection is plenty for a test shim. */
const respRun = (args) => new Promise((resolve, reject) => {
  const payload = [`*${args.length}\r\n`, ...args.map((a) => {
    const s = String(a);
    return [`$${Buffer.byteLength(s)}\r\n`, s, "\r\n"];
  }).flat()].join("");
  const socket = net.connect({ host: respHost, port: respPort });
  let buf = Buffer.alloc(0);
  const trace = process.env.REDIS_SHIM_TRACE ? (m) => console.error(`[resp] ${args[0]} ${m}`) : () => {};
  const fail = (error) => { trace(`FAIL ${String(error?.message ?? error)}`); socket.destroy(); reject(error); };
  socket.on("error", fail);
  socket.setTimeout(10_000, () => fail(new Error("redis RESP timeout")));
  socket.on("connect", () => { trace("connect, writing"); socket.write(payload); });
  socket.on("data", (chunk) => {
    trace(`data ${chunk.length}B buf=${buf.length + chunk.length}`);
    buf = Buffer.concat([buf, chunk]);
    try { const value = parseResp(); if (value !== undefined) { trace(`resolved ${JSON.stringify(value)?.slice(0, 40)}`); socket.end(); resolve(value); } } catch (error) { fail(error); }
  });
  socket.on("close", () => trace("close"));
  function parseResp(depth = 0) {
    if (depth > 32) throw new Error("resp nesting too deep");
    const lineEnd = buf.indexOf("\r\n");
    if (lineEnd === -1) return undefined;
    const type = String.fromCharCode(buf[0]);
    const head = buf.slice(1, lineEnd).toString("utf8");
    if (type === "-") throw new Error(`redis: ${head}`);
    if (type === "+" || type === ":") {
      buf = buf.slice(lineEnd + 2);
      return type === ":" ? Number(head) : head;
    }
    if (type === "$") {
      const len = Number(head);
      if (len === -1) { buf = buf.slice(lineEnd + 2); return null; }
      const total = lineEnd + 2 + len + 2;
      if (buf.length < total) return undefined;
      const value = buf.slice(lineEnd + 2, lineEnd + 2 + len).toString("utf8");
      buf = buf.slice(total);
      return value;
    }
    if (type === "*") {
      const count = Number(head);
      if (count === -1) { buf = buf.slice(lineEnd + 2); return null; }
      const saved = buf;
      buf = buf.slice(lineEnd + 2);
      const items = [];
      for (let i = 0; i < count; i++) {
        const item = parseResp(depth + 1);
        if (item === undefined) { buf = saved; return undefined; }
        items.push(item);
      }
      return items;
    }
    throw new Error(`resp: unknown type ${type}`);
  }
});

const run = respHost ? respRun : cliRun;

createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method !== "POST") return send(405, { error: "method not allowed" });
  if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { body += chunk; if (body.length > 1 << 20) req.destroy(); });
  req.on("end", async () => {
    let args;
    try { args = JSON.parse(body); } catch { return send(400, { error: "expected a JSON array" }); }
    if (!Array.isArray(args) || !args.length || args.some((a) => typeof a !== "string" && typeof a !== "number")) return send(400, { error: "expected a JSON array of scalars" });
    try { const value = await run(args); if (process.env.REDIS_SHIM_TRACE) console.error(`[shim] ${args[0]} ${args[1] ?? ""} -> ${JSON.stringify(value)?.slice(0, 60)}`); send(200, { result: value }); }
    catch (error) { if (process.env.REDIS_SHIM_TRACE) console.error(`[shim] ${args[0]} FAILED: ${String(error?.message ?? error).slice(0, 120)}`); send(502, { error: String(error?.message ?? error) }); }
  });
}).listen(port, "127.0.0.1", () => console.log(`redis http shim on http://127.0.0.1:${port}`));
