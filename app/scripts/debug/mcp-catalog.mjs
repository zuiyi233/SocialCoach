/**
 * MCP resources + prompts 目录：给 sc_* 工具补「事实层」。
 *
 * createCatalog({ appRoot, debugRoot }) 返回 { resources, prompts }（全部只读，不起进程、不写文件）：
 * - resources.list() 列 6 条静态资源（guide / scenarios / fixtures / failures / contracts），
 *   templates() 列 2 条 {name} 动态资源；read(uri) 现场读仓库文件。
 * - 目录不存在 / 坏 JSON 时跳过该文件继续，不让单条坏数据拖垮整份清单。
 * - prompts.list() / get(name, args) 提供 4 条常用工作流模板。
 *
 * 事实来源：wiki/specs/spec-ai-debug-harness.md §4（命令表）与 §6（AI 工作流）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditContracts } from "./api-contracts.mjs";

const MD_MIME = "text/markdown";
const JSON_MIME = "application/json";

/** 按 name 字典序的稳定比较器（各处索引共用）。 */
function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** 目录下所有 *.json；解析失败的文件跳过，按文件名排序返回。 */
function readJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      out.push({ base: file.slice(0, -".json".length), file, data: JSON.parse(readFileSync(join(dir, file), "utf8")) });
    } catch {
      // 坏 JSON 不进清单，目录里其余文件照常列
    }
  }
  return out;
}

function scenarioIndex(dir) {
  return readJsonFiles(dir)
    .map(({ base, file, data }) => ({
      name: data.name ?? base,
      description: typeof data.description === "string" ? data.description : "",
      requires: data.requires ?? null,
      // steps 是条数不是数组：清单只报规模，逐条步骤走 templates 拿全文
      steps: Array.isArray(data.steps) ? data.steps.length : 0,
      file,
    }))
    .sort(byName);
}

function modelIndex(dir) {
  return readJsonFiles(dir)
    .map(({ base, file, data }) => ({ name: data.name ?? base, file, routes: Object.keys(data.routes ?? {}).sort() }))
    .sort(byName);
}

function stateIndex(dir) {
  return readJsonFiles(dir)
    .map(({ base, file, data }) => ({ name: data.name ?? base, file, keys: Object.keys(data.keys ?? {}).sort() }))
    .sort(byName);
}

/** 最近 10 个失败包：时间戳目录字典序倒排即最新在前；目录不存在返回 []。 */
function failurePackages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, 10)
    .map((name) => ({
      dir: name,
      hasReport: existsSync(join(dir, name, "report.json")),
      hasTrace: existsSync(join(dir, name, "trace.json")),
      hasSnapshot: existsSync(join(dir, name, "snapshot.json")),
    }));
}

/** 模板 URI 前缀匹配：socialcoach://scenarios/love-happy → "love-happy"；不匹配返回 null。 */
function nameFrom(uri, prefix) {
  return uri.startsWith(`${prefix}/`) ? uri.slice(prefix.length + 1) : null;
}

/** 读单个命名 JSON；不存在 / 坏 JSON 都抛带下一步提示的错误。 */
function readNamedJson(dir, name, noun) {
  const file = join(dir, `${name}.json`);
  if (!existsSync(file)) throw new Error(`no ${noun} named ${name}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${noun} ${name} (${file}) 不是合法 JSON：${error.message}`);
  }
}

export function createCatalog({ appRoot, debugRoot }) {
  const scenariosDir = join(appRoot, "debug", "scenarios");
  const modelsDir = join(appRoot, "debug", "fixtures", "models");
  const statesDir = join(appRoot, "debug", "fixtures", "states");
  const failuresDir = join(debugRoot, "failures");

  const resources = [
    { uri: "socialcoach://guide", name: "guide", title: "使用指南",
      description: "排查顺序（先 sc_why）/ 断言纪律（先锚点后文案）/ 场景、夹具、录制、语音、多标签页入口 / 三条禁区。开始任何排查前先读它。",
      mimeType: MD_MIME },
    { uri: "socialcoach://scenarios", name: "scenarios", title: "场景清单",
      description: "debug/scenarios/ 全部场景的 name / description / requires / steps / file，按 name 排序。",
      mimeType: JSON_MIME },
    { uri: "socialcoach://fixtures/models", name: "fixtures/models", title: "模型夹具清单",
      description: "debug/fixtures/models/ 可离线回放的模型夹具及其路由键，按 name 排序。",
      mimeType: JSON_MIME },
    { uri: "socialcoach://fixtures/states", name: "fixtures/states", title: "状态夹具清单",
      description: "debug/fixtures/states/ 的 localStorage 状态夹具及其写入键，按 name 排序。",
      mimeType: JSON_MIME },
    { uri: "socialcoach://failures", name: "failures", title: "最近失败包",
      description: ".debug/failures/ 最近 10 个失败现场（report / trace / snapshot 是否齐全），最新在前。",
      mimeType: JSON_MIME },
    { uri: "socialcoach://contracts", name: "contracts", title: "接口契约巡检",
      description: "真实 API 路由 × 模型夹具对账：routes / covered / missing / unknown / errors。",
      mimeType: JSON_MIME },
  ];
  const templates = [
    { uriTemplate: "socialcoach://scenarios/{name}", name: "scenarios/{name}", title: "单个场景全文",
      description: "某个场景的完整 JSON（name / description / requires / steps），name 填场景名，如 love-happy。",
      mimeType: JSON_MIME },
    { uriTemplate: "socialcoach://fixtures/models/{name}", name: "fixtures/models/{name}", title: "单个模型夹具全文",
      description: "某个模型夹具的完整 JSON（name / routes 响应），name 填夹具名，如 love-flow。",
      mimeType: JSON_MIME },
  ];

  const read = (uri) => {
    if (uri === "socialcoach://guide") return { uri, mimeType: MD_MIME, text: GUIDE };
    if (uri === "socialcoach://scenarios") return jsonResult(uri, scenarioIndex(scenariosDir));
    if (uri === "socialcoach://fixtures/models") return jsonResult(uri, modelIndex(modelsDir));
    if (uri === "socialcoach://fixtures/states") return jsonResult(uri, stateIndex(statesDir));
    if (uri === "socialcoach://failures") return jsonResult(uri, failurePackages(failuresDir));
    if (uri === "socialcoach://contracts") return jsonResult(uri, auditContracts({ appRoot, fixtureDir: modelsDir }));
    const scenario = nameFrom(uri, "socialcoach://scenarios");
    if (scenario !== null) return jsonResult(uri, readNamedJson(scenariosDir, scenario, "scenario"));
    const model = nameFrom(uri, "socialcoach://fixtures/models");
    if (model !== null) return jsonResult(uri, readNamedJson(modelsDir, model, "model fixture"));
    throw new Error(`unknown resource: ${uri}`);
  };

  return {
    resources: {
      list: () => [...resources],
      templates: () => [...templates],
      read,
    },
    prompts: {
      list: () => PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })),
      get(name, args = {}) {
        const def = PROMPTS.find((p) => p.name === name);
        if (!def) throw new Error(`unknown prompt: ${name}`);
        for (const arg of def.arguments) {
          if (arg.required && (args[arg.name] === undefined || args[arg.name] === null || args[arg.name] === "")) {
            throw new Error(`${name} needs ${arg.name}`);
          }
        }
        return {
          description: def.description,
          messages: [{ role: "user", content: { type: "text", text: def.render(args) } }],
        };
      },
    },
  };
}

/** 单个 JSON 资源：2 空格缩进，AI 要能直接读。 */
function jsonResult(uri, data) {
  return { uri, mimeType: JSON_MIME, text: JSON.stringify(data, null, 2) };
}

const GUIDE = `# SocialCoach 调试引擎 · 使用指南

> 事实来源：wiki/specs/spec-ai-debug-harness.md §4 / §6。

## 排查顺序
新问题一律先 \`sc_why\`：一条命令给全局面——url / 可见文本 / 可交互元素 / 错误事件 / 模型回放 / storage / lock，输出量固定封顶。看完再决定要不要 \`sc_trace\` / \`sc_errors\` / \`sc_eval\` 深挖，不要一上来就截图。跑场景前先 \`sc_state load\` 装好状态，再 \`sc_nav\` 并等关键锚点；有模型参与的流程先 \`sc_model use\` 离线回放，不联网、可复现。

## 断言纪律
先锚点后文案：操作与断言默认用 \`data-debug\` 锚点名（如 \`love.option-0\`）；没有锚点才用可见文字——文案一改场景就断。断言前先等条件落地（\`sc_wait\` / \`sc_text --contains\`），别拿渲染前的空状态。
断言要断在证据上：\`sc_assert kind=api\` 看应用真正发出的请求（次数用 \`min\`，StrictMode 双调用会让 \`count\` 随机假红）、\`kind=state\` 看 localStorage 路径、\`kind=count\` 看元素数量（重复发送 / 漏渲染只有计数能抓）。

## 各入口
场景 \`debug/scenarios/\`：\`sc_suite\` 全跑、\`sc_run <file> --repeat=2\` 抓不稳定。
状态夹具 \`debug/fixtures/states/\`：\`sc_state load\` / \`dump --save\` 落成夹具。
模型夹具 \`debug/fixtures/models/\`：\`sc_model use\` 回放、\`record / stop\` 录制。
录制：\`sc_record start\` → 操作 → \`stop\`，产出骨架 + 按录制期请求/锚点生成的 \`suggested\` 断言草稿（用前人工核对）。
离线报告：\`sc_report kind=coverage\` 看哪些锚点/路由没被任何场景用到；\`kind=triage\` 把失败包按签名聚合；\`kind=bundle\` 读单个失败包并给排序假设——三条都不启浏览器。
语音 \`sc_speech stub / say / log / off\`；多标签页 \`sc_tab open/list/use/close/eval\`，测跨窗口改存档。
Studio（独立运行时，状态在 SQLite）：\`sc_studio up/seed/down/status\`；场景里 seed 必须带 \`reset: true\`，否则断言会被上一轮对话命中而假绿。
夹具自检 \`sc_fixture_probe <name>\`——文件存在不等于能回放；3D 看 \`sc_canvas stats\`（帧数 / draw 次数）；TTS 看 \`sc_audio log\`（sourcesStarted 才是真的开始播）。

## 三条禁区
1. 不用截图识别按钮、不模拟坐标点击：语义命令直接驱动 DOM。
2. 不用页面文案 / Tailwind class 当选择器：先给控件补 \`data-debug\` 锚点。
3. 不全局过滤噪声：\`assert.noErrors.ignore\` 必须写清接受理由。

## 收尾
改完代码跑 \`sc_suite\` + \`sc_smoke\` + \`sc_contracts\`，新接口必须配夹具；红了先 \`sc_report kind=bundle\`（离线），别急着重跑。覆盖率矩阵与已知缺口见 spec §5 / §8。`;

/** 4 条提示词：arguments 走 MCP Prompt 规范；render 在 get() 时求值（嵌参数）。 */
const PROMPTS = [
  { name: "debug-repro", title: "复现一个 bug",
    description: "按步骤复现用户报的问题：装状态 → 导航 → sc_why → 必要时深挖，最后输出「哪一步、什么现象、证据来自哪条事件」。",
    arguments: [
      { name: "symptom", description: "要复现的问题现象（用户原话或你的观察）", required: true },
      { name: "route", description: "相关路由，不带前导斜杠，如 love/play/love-approach-cafe", required: false },
    ],
    render: (args) => `复现这个 bug：${args.symptom}

排查步骤（纪律见 socialcoach://guide）：
1. 准备状态与模型：sc_state load 装好需要的状态夹具；有模型参与的流程先 sc_model use 离线夹具。
2. 导航：sc_nav ${args.route ? `到 ${args.route}` : "到相关路由"}，等关键锚点（wait）出现。
3. 全局面：sc_why 一次看页面文案 / 可交互元素 / 错误事件 / 模型回放 / storage / lock；需要更细证据再用 sc_trace / sc_snapshot / sc_errors，不要一上来就截图。
4. 操作优先 data-debug 锚点（sc_click / sc_type / sc_wait），锚点缺失才用可见文字。

最后输出三段：
① 哪一步复现了问题（命令与步骤）；
② 什么现象（页面文案或错误事件原文，引用而不是转述）；
③ 证据来自哪条事件（trace 的 kind 或断言行），并给下一步建议。` },
  { name: "debug-regression", title: "改动回归",
    description: "改完代码跑 sc_suite + sc_smoke + sc_contracts 三层回归；失败时读最新失败包定位，报告含各条通过数与失败步骤。",
    arguments: [],
    render: () => `回归验证，改动落地前先跑：
1. sc_suite 跑全部场景（requires 外部依赖的场景会自动跳过）。
2. sc_smoke 逐路由冒烟。
3. sc_contracts 对账接口 × 夹具。

任一失败：读 socialcoach://failures 里最新一条失败包——先看 report.json 定位第几步，再看 snapshot.json 看当时页面状态。

报告必须包含：suite / smoke / contracts 各自的通过数与失败步骤清单（场景或路由名 + 第几步 + 失败原因）、失败包目录名、对根因的一句话判断。` },
  { name: "debug-new-scenario", title: "固化新场景",
    description: "把「手工跑通」录制成可回放场景并补断言，最后 --repeat=2 验证稳定性。",
    arguments: [{ name: "name", description: "场景名，如 dinner-take", required: true }],
    render: (args) => `把「手工跑通」固化成可回放场景 ${args.name}：
1. sc_record start ${args.name} 开始录制。
2. 手工点一遍目标流程（导航 / 装夹具 / 点击 / 输入都可以，CLI 与页面动作都会记）。
3. sc_record stop 落盘 debug/scenarios/${args.name}.json。
4. 打开生成的 JSON 补断言：assert.text（引用实际文案）/ assert.trace（model.replay 命中的路由）等。录制只出骨架，不会自动加断言，这步不能省。
5. sc_run debug/scenarios/${args.name}.json --repeat=2 验证稳定（只跑一次通过不代表稳定）。` },
  { name: "debug-api-fixture", title: "补齐模型夹具",
    description: "给尚无夹具的 API 路由录制真实响应并离线回放验证；提醒不要录真实密钥 / 用户数据。",
    arguments: [{ name: "route", description: "API 路由，不带 /api/ 前缀，如 love-play", required: true }],
    render: (args) => `给路由 ${args.route} 补模型夹具，让它能离线回放：
1. 先 sc_contracts 确认 ${args.route} 在 missing 列表（还没有夹具）；已有覆盖就直接 sc_model use，跳过录制。
2. sc_model record <name> 开启录制（先 record 再走真实流程，避免未命中请求打到真实模型；strict 下未命中回 503）。
3. 走一遍该路由的真实流程，触发目标 API 请求。
4. sc_model stop 落盘 debug/fixtures/models/<name>.json（JSON / 流式按 content-type 自动分流）。
5. sc_model use ["<name>"] 离线回放验证，页面表现应与录制时一致。

注意：不要把真实密钥 / 真实用户数据录进夹具——夹具入库且用于 CI 回放，内容必须虚构。` },
];