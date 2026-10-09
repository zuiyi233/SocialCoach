/**
 * Assemble the desktop runtime bundle consumed by the Tauri shell:
 *
 *   desktop/sidecar/runtime/
 *     node.exe            (vendored Node — fixed version, downloaded once)
 *     server.js           (Next.js standalone server)
 *     node_modules/...    (standalone tree)
 *     .next/static/       (copied from the real build — the classic standalone gotcha)
 *     public/             (copied from the real build)
 *
 * Steps: build the Next app (standalone output) → copy the standalone tree →
 * copy static/public → ensure node.exe. Run from desktop/: `pnpm desktop:runtime`.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(__dirname, "..");
const APP = join(DESKTOP, "..", "app");
const RUNTIME = join(DESKTOP, "sidecar", "runtime");
const VENDOR = join(DESKTOP, "vendor");

// Fixed Node version for reproducible desktop bundles (matches the Dockerfile's node:22 line).
const NODE_VERSION = "v22.17.0";
const NODE_ZIP_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;

const shell = { shell: process.platform === "win32" };
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { ...shell, ...opts, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[runtime] failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
};

function ensureNodeExe() {
  const cached = join(VENDOR, "node.exe");
  if (existsSync(cached)) return cached;
  console.log(`[runtime] downloading Node ${NODE_VERSION} (once, cached in vendor/)…`);
  mkdirSync(VENDOR, { recursive: true });
  const zip = join(VENDOR, `node-${NODE_VERSION}-win-x64.zip`);
  // PowerShell is guaranteed on Windows and handles the download + unzip reliably.
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Invoke-WebRequest -Uri '${NODE_ZIP_URL}' -OutFile '${zip}'; ` +
      `Expand-Archive -Path '${zip}' -DestinationPath '${VENDOR}' -Force; ` +
      `Copy-Item '${join(VENDOR, `node-${NODE_VERSION}-win-x64`, "node.exe")}' '${cached}' -Force`,
  ]);
  if (!existsSync(cached)) {
    console.error("[runtime] node.exe download failed — set DESKTOP_NODE_EXE to a local node.exe and re-run");
    process.exit(1);
  }
  console.log(`[runtime] node.exe ready: ${cached}`);
  return cached;
}

/**
 * Flatten pnpm's virtual store into a flat top-level node_modules so Node's
 * plain CJS resolution finds every dependency. Entries are copied from
 * `node_modules/.pnpm/<name>/node_modules/*`; the first version seen wins
 * (the standalone trace already pinned the versions Next actually needs).
 */
function flattenPnpmStore(nm) {
  const store = join(nm, ".pnpm");
  if (!existsSync(store)) return;
  let n = 0;
  for (const pkg of readdirSync(store)) {
    const inner = join(store, pkg, "node_modules");
    if (!existsSync(inner)) continue;
    for (const name of readdirSync(inner)) {
      const src = join(inner, name);
      const dst = join(nm, name);
      if (existsSync(dst)) continue; // first version wins
      cpSync(src, dst, { recursive: true, dereference: true });
      n += 1;
    }
  }
  console.log(`[runtime] flattened ${n} virtual-store packages into node_modules/`);
}

function main() {
  // 1. Build the Next.js app (standalone output lands in app/.next/standalone).
  console.log("[runtime] building Next.js app (standalone)…");
  run("pnpm", ["--dir", APP, "build"]);

  // 2. Rebuild the runtime bundle directory.
  console.log("[runtime] assembling runtime bundle…");
  rmSync(RUNTIME, { recursive: true, force: true });
  mkdirSync(RUNTIME, { recursive: true });

  const standalone = join(APP, ".next", "standalone");
  if (!existsSync(join(standalone, "server.js"))) {
    console.error(`[runtime] ${standalone}/server.js missing — standalone build did not produce it`);
    process.exit(1);
  }
  // 3. Copy the standalone tree (server.js + minimal node_modules + package.json).
  //
  //    Gotcha: with pnpm the standalone node_modules is a symlink farm —
  //    `next`/`react`/`react-dom` link into `node_modules/.pnpm/<pkg>/node_modules/…`,
  //    and those packages resolve their own deps from *sibling* virtual-store
  //    directories. Copying with `cpSync` (no dereference) keeps dead absolute
  //    symlinks; the server then fails with `Cannot find module '@swc/helpers/…'`.
  //    Fix: dereference on copy, then flatten every virtual-store entry into
  //    the top-level node_modules so plain `require` resolution works anywhere
  //    (matches the Dockerfile's flat npm layout).
  for (const entry of readdirSync(standalone)) {
    cpSync(join(standalone, entry), join(RUNTIME, entry), { recursive: true, dereference: true });
  }
  flattenPnpmStore(join(RUNTIME, "node_modules"));
  // 4. Copy static assets + public — deliberately omitted by `next build` (Dockerfile gotcha).
  cpSync(join(APP, ".next", "static"), join(RUNTIME, ".next", "static"), { recursive: true });
  if (existsSync(join(APP, "public"))) {
    cpSync(join(APP, "public"), join(RUNTIME, "public"), { recursive: true });
  }
  // 5. Vendored Node runtime.
  const nodeExe = ensureNodeExe();
  cpSync(nodeExe, join(RUNTIME, "node.exe"));

  // 6. Fingerprint for diagnostics.
  writeFileSync(
    join(RUNTIME, "RUNTIME_VERSION.json"),
    JSON.stringify(
      { node: NODE_VERSION, builtAt: new Date().toISOString(), appVersion: appVersion() },
      null,
      2,
    ),
  );

  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  walk(RUNTIME);
  console.log(`[runtime] bundle ready: ${RUNTIME} (~${Math.round(total / 1024 / 1024)} MB)`);
}

function appVersion() {
  const req = createRequire(join(APP, "package.json"));
  return req("./package.json").version ?? "unknown";
}

main();
