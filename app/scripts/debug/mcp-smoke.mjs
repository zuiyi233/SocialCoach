/**
 * MCP 冒烟：验证 mcp-server.mjs 能被真实客户端拉起并正确应答。
 *   node scripts/debug/mcp-smoke.mjs
 *   node scripts/debug/mcp-smoke.mjs --call sc_contracts
 * --call 需要守护进程和 Chrome；不加只验证握手、工具表与 resources/prompts 目录。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROTOCOL_VERSION = '2025-06-18';
const STEP_TIMEOUT_MS = 15000;
const MIN_TOOLS = 20;
const MIN_RESOURCES = 5;
const MIN_TEMPLATES = 2;
const MIN_PROMPTS = 3;
const MIN_GUIDE_CHARS = 200;
const STDERR_TAIL_LINES = 20;
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
let callTool = '';
let callArgs = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--call') {
    callTool = argv[++i] ?? '';
    if (!callTool) { console.error('✘ --call 缺少工具名'); process.exit(1); }
  } else if (argv[i] === '--args') {
    const raw = argv[++i];
    if (raw === undefined) { console.error('✘ --args 缺少 JSON'); process.exit(1); }
    try { callArgs = JSON.parse(raw); } catch { console.error(`✘ --args 不是合法 JSON: ${raw}`); process.exit(1); }
  } else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log('用法: node scripts/debug/mcp-smoke.mjs [--call <tool> --args <json>]');
    process.exit(0);
  } else {
    console.error(`✘ 未知参数: ${argv[i]}`);
    process.exit(1);
  }
}
if (!existsSync(serverPath)) {
  console.error(`✘ mcp-server.mjs 不存在: ${serverPath}`);
  console.error('  服务器文件尚未就绪时，冒烟停在握手前（预期失败，不是脚本问题）。');
  process.exit(1);
}
let failures = 0;
let stderrTail = [];
const pending = new Map(); // id -> { resolve, reject, timer }
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {}); // 子进程退出后再写 stdin 会 EPIPE，忽略
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => {
  for (const line of d.split(/[\r\n]+/)) {
    if (line.trim()) stderrTail.push(line);
  }
  if (stderrTail.length > STDERR_TAIL_LINES) stderrTail = stderrTail.slice(-STDERR_TAIL_LINES);
});

let stdoutBuf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  stdoutBuf += d;
  let nl;
  while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg = null;
    try { msg = JSON.parse(line); } catch { /* 非 JSON 行（调试日志）忽略 */ }
    if (msg && msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg);
    }
  }
});

// 子进程提前退出/拉起失败：让所有在等的步骤失败而不是挂死
child.on('exit', (code, signal) => {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(`服务器提前退出 (code=${code}, signal=${signal})`));
  }
  pending.clear();
});
child.on('error', (err) => {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(`无法拉起服务器: ${err.message}`));
  }
  pending.clear();
});
function rpc(id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} 超时：${STEP_TIMEOUT_MS}ms 无响应`));
    }, STEP_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const msg = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}
function fail(step, reason) { failures += 1; console.error(`✘ ${step}  ${reason}`); }
function ok(line) { console.log(`✔ ${line}`); }
function dumpStderr() {
  if (!stderrTail.length) return;
  console.error('\n子进程 stderr 末尾 20 行:');
  for (const l of stderrTail) console.error(`  > ${l}`);
}

async function main() {
  // 1. initialize 握手
  const init = await rpc(1, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'mcp-smoke', version: '0.0.1' },
  });
  if (init.error) {
    fail('initialize', `服务器返回错误: ${init.error.message ?? JSON.stringify(init.error)}`);
    return;
  }
  const r = init.result;
  if (
    !r ||
    typeof r.serverInfo?.name !== 'string' ||
    !r.serverInfo.name.trim() ||
    typeof r.protocolVersion !== 'string' ||
    !r.protocolVersion ||
    !r.capabilities?.tools
  ) {
    fail('initialize', 'result 缺 serverInfo.name / protocolVersion / capabilities.tools');
    return;
  }
  ok(`initialize  ${r.serverInfo.name} v${r.serverInfo.version ?? '?'} protocol=${r.protocolVersion}`);

  // 2. initialized 通知：notification 没有响应，发完即算过
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  ok('initialized  notification 已写入 stdin（无响应预期）');

  // 3. 工具表
  const list = await rpc(2, 'tools/list');
  if (list.error) {
    fail('tools/list', `服务器返回错误: ${list.error.message ?? JSON.stringify(list.error)}`);
    return;
  }
  const tools = list.result?.tools;
  if (!Array.isArray(tools) || tools.length < MIN_TOOLS) {
    fail('tools/list', `tools 缺失或数量不足：${Array.isArray(tools) ? tools.length : 'N/A'} < ${MIN_TOOLS}`);
    return;
  }
  const badNames = [];
  const badDescs = [];
  const badSchemas = [];
  for (const t of tools) {
    if (typeof t.name !== 'string' || !t.name.startsWith('sc_')) badNames.push(t.name ?? '(无 name)');
    if (typeof t.description !== 'string' || !t.description) badDescs.push(t.name ?? '?');
    if (!t.inputSchema || t.inputSchema.type !== 'object') badSchemas.push(t.name ?? '?');
  }
  if (badNames.length || badDescs.length || badSchemas.length) {
    fail(
      'tools/list',
      `契约不符: 非 sc_* 名 [${badNames.slice(0, 5).join(', ')}] ` +
        `缺描述 [${badDescs.slice(0, 5).join(', ')}] schema 非 object [${badSchemas.slice(0, 5).join(', ')}]`,
    );
    return;
  }
  ok(`tools/list  ${tools.length} tools`);

  // 4. 资源表（catalog 纯内存静态资源，不依赖守护进程 / 浏览器）
  const resList = await rpc(3, 'resources/list');
  if (resList.error) {
    fail('resources/list', `服务器返回错误: ${resList.error.message ?? JSON.stringify(resList.error)}`);
    return;
  }
  const resources = resList.result?.resources;
  if (!Array.isArray(resources) || resources.length < MIN_RESOURCES) {
    fail('resources/list', `resources 缺失或数量不足：${Array.isArray(resources) ? resources.length : 'N/A'} < ${MIN_RESOURCES}`);
    return;
  }
  const badRes = [];
  for (const r of resources) {
    if (typeof r.uri !== 'string' || !r.uri || typeof r.name !== 'string' || !r.name || typeof r.mimeType !== 'string' || !r.mimeType) {
      badRes.push(r.name ?? r.uri ?? '(无名字)');
    }
  }
  if (badRes.length) {
    fail('resources/list', `契约不符: 缺 uri/name/mimeType [${badRes.slice(0, 5).join(', ')}]`);
    return;
  }
  ok(`resources/list  ${resources.length} resources`);

  // 5. 资源模板表（initialize 里声明了 resources 能力就得把 templates 也答上）
  const tmplRes = await rpc(5, 'resources/templates/list');
  if (tmplRes.error) {
    fail('resources/templates/list', `服务器返回错误: ${tmplRes.error.message ?? JSON.stringify(tmplRes.error)}`);
    return;
  }
  const templates = tmplRes.result?.resourceTemplates;
  if (!Array.isArray(templates) || templates.length < MIN_TEMPLATES) {
    fail('resources/templates/list', `resourceTemplates 缺失或数量不足：${Array.isArray(templates) ? templates.length : 'N/A'} < ${MIN_TEMPLATES}`);
    return;
  }
  const badTmpl = [];
  for (const t of templates) {
    if (typeof t.uriTemplate !== 'string' || !t.uriTemplate.includes('{') || typeof t.name !== 'string' || !t.name) {
      badTmpl.push(t.name ?? t.uriTemplate ?? '(无名字)');
    }
  }
  if (badTmpl.length) {
    fail('resources/templates/list', `契约不符: 缺 uriTemplate(含 {var})/name [${badTmpl.slice(0, 5).join(', ')}]`);
    return;
  }
  ok(`resources/templates/list  ${templates.length} templates`);

  // 6. 读一份真实资源（guide 是内置长文本，不走磁盘 / 守护进程）
  const resRead = await rpc(6, 'resources/read', { uri: 'socialcoach://guide' });
  if (resRead.error) {
    fail('resources/read', `socialcoach://guide 返回错误: ${resRead.error.message ?? JSON.stringify(resRead.error)}`);
    return;
  }
  const content0 = resRead.result?.contents?.[0];
  if (!content0 || typeof content0.text !== 'string' || !content0.text.trim() || content0.text.length < MIN_GUIDE_CHARS) {
    fail('resources/read', `socialcoach://guide 的 text 缺失或过短：${content0 ? content0.text.length : 'N/A'} < ${MIN_GUIDE_CHARS}`);
    return;
  }
  if (content0.type !== undefined && content0.type !== 'text') {
    fail('resources/read', `socialcoach://guide 的 contents[0].type 不是 "text"：${content0.type}`);
    return;
  }
  ok(`resources/read  socialcoach://guide (${content0.text.length} chars, ${content0.mimeType ?? '?'})`);

  // 7. 提示词表（catalog 纯内存静态提示词，不依赖守护进程 / 浏览器）
  const promptsRes = await rpc(7, 'prompts/list');
  if (promptsRes.error) {
    fail('prompts/list', `服务器返回错误: ${promptsRes.error.message ?? JSON.stringify(promptsRes.error)}`);
    return;
  }
  const prompts = promptsRes.result?.prompts;
  if (!Array.isArray(prompts) || prompts.length < MIN_PROMPTS) {
    fail('prompts/list', `prompts 缺失或数量不足：${Array.isArray(prompts) ? prompts.length : 'N/A'} < ${MIN_PROMPTS}`);
    return;
  }
  const badPrompts = [];
  for (const p of prompts) {
    if (typeof p.name !== 'string' || !p.name || !Array.isArray(p.arguments)) badPrompts.push(p.name ?? '(无 name)');
  }
  if (badPrompts.length) {
    fail('prompts/list', `契约不符: 缺 name/arguments [${badPrompts.slice(0, 5).join(', ')}]`);
    return;
  }
  ok(`prompts/list  ${prompts.length} prompts`);

  // 8. 可选 tools/call
  if (callTool) {
    const callRes = await rpc(8, 'tools/call', { name: callTool, arguments: callArgs });
    if (callRes.error) {
      fail('tools/call', `${callTool} 返回错误: ${callRes.error.message ?? JSON.stringify(callRes.error)}`);
      return;
    }
    const content = callRes.result?.content;
    if (!Array.isArray(content) || !content[0] || content[0].type !== 'text') {
      fail('tools/call', `${callTool} 首块 content 不是 text`);
      return;
    }
    ok(`tools/call  ${callTool} (isError=${callRes.result.isError ?? false}, ${String(content[0].text).length} chars)`);
  }
}
main()
  .catch((err) => {
    failures += 1;
    console.error(`✘ 冒烟失败  ${err.message}`);
  })
  .finally(async () => {
    dumpStderr();
    child.stdin.end();
    child.kill();
    // 等子进程真正退出（最多 2s），避免留下孤儿进程
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const t = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });
    console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
