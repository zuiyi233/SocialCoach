import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonClient } from "../../scripts/debug/daemon-client.mjs";

// 守护进程把 engine.mjs 常驻在内存里：改了引擎不重启，跑的还是旧代码。
// 这些用例锁住「源码比会话新就重启」这条判定。

function makeRoot({ codeMtime, startedAt }) {
  const root = mkdtempSync(join(tmpdir(), "sc-daemon-"));
  const debugRoot = join(root, ".debug");
  mkdirSync(debugRoot, { recursive: true });
  const daemonPath = join(root, "daemon.mjs");
  writeFileSync(daemonPath, "// stub\n");
  utimesSync(daemonPath, codeMtime / 1000, codeMtime / 1000);
  writeFileSync(join(debugRoot, "session.json"), JSON.stringify({ pid: 1, port: 1, startedAt }));
  return { root, debugRoot, daemonPath };
}

function makeClient(root, { spawns }) {
  // 第一次探活成功（有旧会话），之后失败（模拟旧守护进程收到 shutdown 后退出）。
  let healthyCalls = 1;
  return createDaemonClient({
    appRoot: root.root,
    debugRoot: root.debugRoot,
    daemonPath: root.daemonPath,
    healthFn: async () => (healthyCalls-- > 0 ? { ok: true } : null),
    sleepFn: async () => {},
    spawnFn: () => {
      spawns.push(1);
      return { unref() {} };
    },
  });
}

test("源码没变：复用现有会话，不重启", async () => {
  const root = makeRoot({ codeMtime: 1_000_000, startedAt: 1_000_000 + 5000 });
  const spawns = [];
  const client = makeClient(root, { spawns });
  const session = await client.ensure({ timeout: 300 });
  assert.equal(session.startedAt, 1_000_000 + 5000);
  assert.equal(spawns.length, 0);
});

test("源码比会话新：不复用，重新拉起守护进程", async () => {
  const root = makeRoot({ codeMtime: 2_000_000, startedAt: 1_000_000 });
  const spawns = [];
  const client = makeClient(root, { spawns });
  // 新守护进程在测试里起不来：只关心它没有把旧会话当结果返回。
  await assert.rejects(client.ensure({ timeout: 200 }), /did not start within/);
  assert.equal(spawns.length, 1);
});
