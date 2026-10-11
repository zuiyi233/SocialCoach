/** Local and CI only — never a deployment target.
 *
 * The budget client speaks the HTTP shape a hosted Redis endpoint uses: one POST
 * carrying a JSON array of Redis arguments, one `{result}` back. This turns that
 * shape into a real `redis-cli` call so the reserve and settle Lua can be proven
 * against an actual Redis instead of a stub that agrees with whatever we assert.
 *
 * It binds to loopback and requires the bearer token, because a port that runs
 * arbitrary Redis commands on someone's machine is not a test fixture.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const port = Number(process.env.REDIS_HTTP_PORT || 6399);
const token = process.env.REDIS_HTTP_TOKEN || "";
const host = process.env.REDIS_CLI_HOST || "127.0.0.1";
const redisPort = process.env.REDIS_CLI_PORT || "6379";

if (!token) throw new Error("REDIS_HTTP_TOKEN is required: this shim executes arbitrary Redis commands");

const run = (args) => new Promise((resolve, reject) => {
  execFile("redis-cli", ["--json", "-h", host, "-p", String(redisPort), ...args.map(String)], { maxBuffer: 32 << 20 }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr || error.message));
    else resolve(JSON.parse(stdout || "null"));
  });
});

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
    try { send(200, { result: await run(args) }); }
    catch (error) { send(502, { error: String(error?.message ?? error) }); }
  });
}).listen(port, "127.0.0.1", () => console.log(`redis http shim on http://127.0.0.1:${port}`));
