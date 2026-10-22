import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditContracts, readFixtureRoutes, scanApiRoutes } from "../../scripts/debug/api-contracts.mjs";

// 造一个假的 app 目录树：files 为 { 相对路径: 内容 }。
function makeApp(t, files) {
  const root = mkdtempSync(join(tmpdir(), "api-contracts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const POST = "export async function POST(req: Request) { return Response.json({}); }\n";

test("scanApiRoutes 提取单方法路由", (t) => {
  const root = makeApp(t, { "src/app/api/practice/route.ts": POST });
  assert.deepEqual(scanApiRoutes(root), [
    { route: "practice", file: "src/app/api/practice/route.ts", methods: ["POST"], dynamic: false },
  ]);
});

test("scanApiRoutes 多方法去重并按固定顺序排序", (t) => {
  const root = makeApp(t, {
    "src/app/api/feedback/route.ts":
      "export async function POST(req: Request) {}\nexport function GET() {}\nexport async function POST(req: Request) {}\n",
  });
  const [route] = scanApiRoutes(root);
  assert.equal(route.route, "feedback");
  assert.deepEqual(route.methods, ["GET", "POST"]);
});

test("scanApiRoutes 识别 export const METHOD = 写法", (t) => {
  const root = makeApp(t, {
    "src/app/api/track/route.ts": "export const PUT = async (req: Request) => {};\nexport const DELETE = handler;\n",
  });
  const [route] = scanApiRoutes(root);
  assert.deepEqual(route.methods, ["PUT", "DELETE"]);
});

test("scanApiRoutes 嵌套路由键用 / 连接", (t) => {
  const root = makeApp(t, { "src/app/api/dinner/direct/route.ts": POST });
  const [route] = scanApiRoutes(root);
  assert.equal(route.route, "dinner/direct");
  assert.equal(route.file, "src/app/api/dinner/direct/route.ts");
  assert.equal(route.dynamic, false);
});

test("scanApiRoutes 动态段 [id] 保留并标记 dynamic", (t) => {
  const root = makeApp(t, { "src/app/api/rooms/[id]/route.ts": POST });
  const [route] = scanApiRoutes(root);
  assert.equal(route.route, "rooms/[id]");
  assert.equal(route.dynamic, true);
});

test("scanApiRoutes 跳过 (group) 段、_private 目录与 node_modules", (t) => {
  const root = makeApp(t, {
    "src/app/api/(group)/practice/route.ts": POST,
    "src/app/api/_private/route.ts": POST,
    "src/app/api/dinner/_private/route.ts": POST,
    "src/app/api/node_modules/fake/route.ts": POST,
    "src/app/api/.next/fake/route.ts": POST,
  });
  assert.deepEqual(scanApiRoutes(root).map((r) => r.route), ["practice"]);
});

test("scanApiRoutes 缺 src/app/api 返回空数组", (t) => {
  const root = makeApp(t, { "src/app/page.tsx": "" });
  assert.deepEqual(scanApiRoutes(root), []);
});

test("readFixtureRoutes 取 name 与 routes 键，缺 name 用文件名", (t) => {
  const root = makeApp(t, {
    "fixtures/models/practice-flow.json": JSON.stringify({ name: "practice-flow", routes: { health: {}, roleplay: {} } }),
    "fixtures/models/plain.json": JSON.stringify({ routes: { assess: {} } }),
    "fixtures/models/readme.txt": "not json",
  });
  assert.deepEqual(readFixtureRoutes(join(root, "fixtures", "models")), [
    { file: "plain.json", name: "plain", routes: ["assess"] },
    { file: "practice-flow.json", name: "practice-flow", routes: ["health", "roleplay"] },
  ]);
});

test("auditContracts 夹具命中进 covered、漏掉进 missing", (t) => {
  const root = makeApp(t, {
    "src/app/api/health/route.ts": "export async function GET() {}\n",
    "src/app/api/roleplay/route.ts": POST,
    "src/app/api/reflect/route.ts": POST,
    "fixtures/models/practice-flow.json": JSON.stringify({ name: "practice-flow", routes: { health: {}, roleplay: {} } }),
  });
  const audit = auditContracts({ appRoot: root, fixtureDir: join(root, "fixtures", "models") });
  assert.deepEqual(audit.covered, [
    { route: "health", methods: ["GET"], fixtures: ["practice-flow"] },
    { route: "roleplay", methods: ["POST"], fixtures: ["practice-flow"] },
  ]);
  assert.deepEqual(audit.missing, [{ route: "reflect", methods: ["POST"], dynamic: false }]);
  assert.deepEqual(audit.unknown, []);
  assert.deepEqual(audit.errors, []);
});

test("auditContracts 夹具键拼错进 unknown", (t) => {
  const root = makeApp(t, {
    "src/app/api/health/route.ts": "export async function GET() {}\n",
    "fixtures/models/practice-flow.json": JSON.stringify({ name: "practice-flow", routes: { health: {}, roleplays: {} } }),
  });
  const audit = auditContracts({ appRoot: root, fixtureDir: join(root, "fixtures", "models") });
  assert.deepEqual(audit.unknown, [{ fixture: "practice-flow", route: "roleplays" }]);
  assert.deepEqual(audit.covered, [{ route: "health", methods: ["GET"], fixtures: ["practice-flow"] }]);
});

test("auditContracts 坏 JSON 跳过并进 errors", (t) => {
  const root = makeApp(t, {
    "src/app/api/health/route.ts": "export async function GET() {}\n",
    "fixtures/models/broken.json": "{ not json",
    "fixtures/models/health-flow.json": JSON.stringify({ name: "health-flow", routes: { health: {} } }),
  });
  const audit = auditContracts({ appRoot: root, fixtureDir: join(root, "fixtures", "models") });
  assert.equal(audit.errors.length, 1);
  assert.equal(audit.errors[0].file, "broken.json");
  assert.match(audit.errors[0].message, /JSON/);
  assert.deepEqual(audit.fixtures.find((f) => f.file === "broken.json").routes, []);
  assert.deepEqual(audit.missing, []);
});

test("auditContracts 动态路由留在 missing 且带 dynamic 标记", (t) => {
  const root = makeApp(t, {
    "src/app/api/rooms/[id]/route.ts": "export async function GET() {}\n",
    "fixtures/models/room-flow.json": JSON.stringify({ name: "room-flow", routes: { health: {} } }),
  });
  const audit = auditContracts({ appRoot: root, fixtureDir: join(root, "fixtures", "models") });
  assert.deepEqual(audit.missing, [{ route: "rooms/[id]", methods: ["GET"], dynamic: true }]);
});

test("真实仓库：扫 src/app/api 至少 8 条路由且排序稳定", () => {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const routes = scanApiRoutes(appRoot);
  assert.ok(routes.length >= 8, `期望至少 8 条路由，实际 ${routes.length}`);
  for (const r of routes) {
    assert.ok(r.methods.length > 0, `${r.route} 没有可识别的方法`);
    assert.ok(!r.route.includes("\\"), `${r.route} 含反斜杠`);
  }
  const sorted = [...routes].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  assert.deepEqual(routes, sorted);
});
