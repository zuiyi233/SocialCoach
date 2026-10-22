// API 契约巡检：对账真实路由（src/app/api/**/route.ts）与模型夹具（debug/fixtures/models/*.json）。
// 回答「哪些功能还不能离线回放」（missing）与「哪些夹具键拼错」（unknown）。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const ROUTE_FILE = "route.ts";
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);

// 括号分组目录不参与 URL：目录要进去扫，但段不进 route 键。
function isGroupSegment(name) {
  return name.startsWith("(") && name.endsWith(")");
}

function isDynamicSegment(name) {
  return name.startsWith("[") && name.endsWith("]");
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function cmpRoute(a, b) {
  return a.route < b.route ? -1 : a.route > b.route ? 1 : 0;
}

// 从 route.ts 源码提取 HTTP 方法：export [async] function METHOD( 与 export const METHOD = 两种写法。
function extractMethods(source) {
  const found = new Set();
  const fnRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const constRe = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g;
  for (const m of source.matchAll(fnRe)) found.add(m[1]);
  for (const m of source.matchAll(constRe)) found.add(m[1]);
  return HTTP_METHODS.filter((m) => found.has(m));
}

function walkApiDir(dir, segments, results, appRoot) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_")) continue; // Next 把 _folder 视为非路由
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      const next = isGroupSegment(entry.name) ? segments : [...segments, entry.name];
      walkApiDir(join(dir, entry.name), next, results, appRoot);
    } else if (entry.isFile() && entry.name === ROUTE_FILE) {
      const file = toPosix(relative(appRoot, join(dir, entry.name)));
      const source = readFileSync(join(dir, entry.name), "utf8");
      results.push({
        route: segments.join("/"),
        file,
        methods: extractMethods(source),
        dynamic: segments.some(isDynamicSegment),
      });
    }
  }
}

export function scanApiRoutes(appRoot) {
  const apiDir = join(appRoot, "src", "app", "api");
  if (!existsSync(apiDir)) return [];
  const results = [];
  walkApiDir(apiDir, [], results, appRoot);
  return results.sort(cmpRoute);
}

export function readFixtureRoutes(fixtureDir) {
  if (!existsSync(fixtureDir)) return [];
  const fixtures = [];
  for (const file of readdirSync(fixtureDir)) {
    if (!file.endsWith(".json")) continue;
    const base = file.slice(0, -".json".length);
    try {
      const parsed = JSON.parse(readFileSync(join(fixtureDir, file), "utf8"));
      fixtures.push({
        file,
        name: parsed.name ?? base,
        routes: Object.keys(parsed.routes ?? {}),
      });
    } catch (err) {
      fixtures.push({ file, name: base, routes: [], errors: [{ file, message: err.message }] });
    }
  }
  return fixtures;
}

export function auditContracts({ appRoot, fixtureDir }) {
  const routes = scanApiRoutes(appRoot);
  const fixtures = readFixtureRoutes(fixtureDir);
  const coveredBy = new Map(routes.map((r) => [r.route, []]));
  const byRoute = new Set(routes.map((r) => r.route));
  const unknown = [];
  for (const fx of fixtures) {
    for (const route of fx.routes) {
      if (byRoute.has(route)) coveredBy.get(route).push(fx.name);
      else unknown.push({ fixture: fx.name, route });
    }
  }
  const covered = routes
    .filter((r) => coveredBy.get(r.route).length > 0)
    .map((r) => ({ route: r.route, methods: r.methods, fixtures: coveredBy.get(r.route).sort() }))
    .sort(cmpRoute);
  const missing = routes
    .filter((r) => coveredBy.get(r.route).length === 0)
    .map((r) => ({ route: r.route, methods: r.methods, dynamic: r.dynamic }))
    .sort(cmpRoute);
  const errors = fixtures.flatMap((fx) => fx.errors ?? []);
  unknown.sort((a, b) => cmpRoute(a, b) || (a.fixture < b.fixture ? -1 : a.fixture > b.fixture ? 1 : 0));
  return { routes, fixtures, covered, missing, unknown, errors };
}
