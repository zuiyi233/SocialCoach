/**
 * Smoke test the assembled runtime bundle without the Tauri shell: spawn
 * `runtime/node.exe server.js` on the release port, poll /api/health, then
 * kill the child. Exit 0 only if the server actually answers 200.
 *
 * Run from desktop/: `pnpm desktop:smoke`
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(__dirname, "..", "sidecar", "runtime");
const PORT = 3210;
const nodeExe = join(RUNTIME, "node.exe");

if (!existsSync(nodeExe)) {
  console.error(`[smoke] missing ${nodeExe} — run \`pnpm desktop:runtime\` first`);
  process.exit(1);
}

console.log(`[smoke] starting ${nodeExe} server.js on 127.0.0.1:${PORT}…`);
const child = spawn(nodeExe, ["server.js"], {
  cwd: RUNTIME,
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(PORT) },
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

const waitReady = (timeoutMs) =>
  new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = () => {
      if (Date.now() > deadline) return resolve(false);
      fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })
        .then((res) => {
          if (res.ok) resolve(true);
          else setTimeout(tryOnce, 400);
        })
        .catch(() => setTimeout(tryOnce, 400));
    };
    tryOnce();
  });

const ok = await waitReady(30000);
if (!ok) {
  console.error("[smoke] server did not become ready within 30s");
  child.kill();
  process.exit(1);
}
console.log("[smoke] /api/health answered 200 — runtime bundle OK");
child.kill();
process.exit(0);
