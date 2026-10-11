// Captures real product screens against a live deployment, phone-sized
// (390×844 @3x = 1170×2532), light theme, driving Chrome over the DevTools protocol.
//
// UI copy is NOT duplicated here: labels come from the app's i18n dict
// (app/src/lib/i18n.ts, t/pick), the model-connection banner (app/src/lib/model-copy.ts)
// and the scenario corpus title (app/src/data/corpus/scenarios-a.ts). A wording
// change surfaces at type-check time instead of a 2–4 min live timeout.
//
// Run from the repo root so --out and other relative args keep their meaning;
// tsx needs the app's tsconfig.json to resolve the app's `@/*` path alias.
// The file is .mts (not .ts) because site/ has no package.json "type" field,
// so a plain .ts file would load as CommonJS and reject top-level await:
//
//   ./app/node_modules/.bin/tsx --tsconfig=app/tsconfig.json site/scripts/screenshots.mts [--base=https://socialcoach-ai.vercel.app] [--lang=zh] [--out=docs/screenshots]
//   ./app/node_modules/.bin/tsx --tsconfig=app/tsconfig.json site/scripts/screenshots.mts --arena-only --lang=zh --out=docs/screenshots
//   ./app/node_modules/.bin/tsx --tsconfig=app/tsconfig.json site/scripts/screenshots.mts --home-only --lang=zh --out=docs/screenshots
//
// (Alternative: `cd app && npx tsx ../site/scripts/screenshots.mts …` also works,
// but a relative --out then resolves under app/ — pass --out=../docs/screenshots.)
// Type-check without launching Chrome (the local extends-config wires the app's
// tsconfig + node types, since `tsc <file>` on the command line ignores tsconfig):
//   cd app && npx tsc -p ../site/scripts/tsconfig.screenshots.json
//
// Flow: seed a demo profile → home (today's pick + "why this one") → start →
// briefing → chat: one soft reply, the character pushes back → one clear
// reply with an alternative → end → debrief. Names and lines are demo data.
// Spends four or five model calls on the target deployment.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { t, pick } from "../../app/src/lib/i18n";
import { M } from "../../app/src/lib/model-copy";
import { SCENARIOS_A } from "../../app/src/data/corpus/scenarios-a";
import type { Lang } from "../../app/src/data/taxonomy";

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v = "true"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const BASE = (opt.base || "https://socialcoach-ai.vercel.app").replace(/\/$/, "");
const LANG = (opt.lang || "zh") as Lang;
const OUT = opt.out || "docs/screenshots";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const zh = LANG === "zh";
mkdirSync(join(OUT, "raw"), { recursive: true });

// The demo lines below belong to this one scene; the daily pick is asked again
// until it shows. Reading the title from the corpus keeps it in sync.
const wantedScene = SCENARIOS_A.find((s) => s.id === "declining-extra-hours");
if (!wantedScene) throw new Error("demo scene declining-extra-hours is missing from the corpus");

const S = {
  plan: t(LANG, "home_plan_action"),
  start: t(LANG, "home_start"),
  why: t(LANG, "home_why"),
  retry: t(LANG, "retry"),
  checking: pick(M.checking, LANG),
  another: [t(LANG, "home_pick_other"), t(LANG, "home_another")],
  enter: t(LANG, "pr_enter"),
  send: t(LANG, "rp_send"),
  end: t(LANG, "pr_review_action"),
  endReview: t(LANG, "pr_end_review"),
  toReport: t(LANG, "pr_reveal_to_report"),
  writing: t(LANG, "rp_writing"),
  stillWriting: t(LANG, "rp_writing_more"),
  wantTitle: pick(wantedScene.title, LANG),
} as const;

const profile = zh
  ? { name: "小周", bio: "工作两年的产品经理，不太会拒绝别人，最近总被临时加活。", goals: ["seeking-help", "communication", "goal-setting"], contexts: ["workplace"], lang: "zh", createdAt: Date.now() }
  : { name: "Sam", bio: "Product manager, two years in. Bad at saying no; keeps getting last-minute asks.", goals: ["seeking-help", "communication", "goal-setting"], contexts: ["workplace"], lang: "en", createdAt: Date.now() };
const proficiency = { "seeking-help": 2.5, communication: 3, "goal-setting": 3 };

// Two learner turns: a polite reply with no boundary, then a clear no with an alternative and a question.
const lines = zh
  ? [
      "啊……好的，我看看。不过我今晚其实有点事，可能会晚一点开始，可以吗？",
      "Michael，今晚我确实不行，答应了家里的事。我现在可以花二十分钟把第三部分的问题先标出来，明早七点半到公司改完，九点前一定给你。客户明早最需要看的是哪几页？",
    ]
  : [
      "Oh… okay, let me take a look. I do have something tonight though, so I might start a bit late, is that all right?",
      "Michael, tonight really doesn't work, I've promised my family. I can spend twenty minutes now flagging what's wrong in section three, be in at 7:30 tomorrow and have it to you before nine. Which slides does the client actually need first thing?",
    ];

/* ------------------------------ CDP plumbing ------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const chrome = spawn(CHROME, [
  "--headless", "--remote-debugging-port=0", `--user-data-dir=/tmp/sc-shots-${Date.now()}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
  "--disable-background-networking", "--disable-component-update", "--disable-sync",
  "--window-size=390,844", "--lang=" + (zh ? "zh-CN" : "en-US"), "about:blank",
]);
let chromeLog = "";
chrome.stderr.on("data", (d) => { chromeLog = (chromeLog + d).slice(-4000); });
chrome.stdout.on("data", () => {});
let chromeGone = false;
chrome.on("exit", (code, sig) => { chromeGone = true; if (!shuttingDown) console.error(`chrome exited (${code ?? sig}); last stderr:\n${chromeLog.slice(-800)}`); });
let shuttingDown = false;
const cleanup = () => { shuttingDown = true; try { chrome.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const port = await new Promise<string>((resolve, reject) => {
  let buf = "";
  const onData = (d: Buffer) => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) { chrome.stderr.off("data", onData); resolve(m[1]); } };
  chrome.stderr.on("data", onData);
  chrome.on("exit", (c) => reject(new Error("chrome exited " + c + "\n" + buf)));
  setTimeout(() => reject(new Error("no DevTools banner\n" + buf)), 20000);
});

// The DevTools socket occasionally drops (close 1006) mid-flow while Chrome and
// the tab live on, so every command reconnects to the same tab if needed.
let ws: WebSocket | null = null, wsClosed = true, seq = 0;
const pending = new Map<number, { res: (v: unknown) => void; rej: (e: unknown) => void }>();
const setupPage = async () => {
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
};
const connect = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t: { type: string; webSocketDebuggerUrl: string }) => t.type === "page");
      if (!page) throw new Error("no page target");
      const sock = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((r, j) => { sock.onopen = r; sock.onerror = () => j(new Error("ws open failed")); });
      ws = sock; wsClosed = false;
      sock.onclose = (e) => { if (ws !== sock) return; wsClosed = true; console.error(`devtools socket closed (${e.code})`); for (const { rej } of pending.values()) rej(new Error("devtools socket closed")); pending.clear(); };
      sock.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id)!; pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
      if (attempt > 1) log("reconnected to the tab");
      await setupPage();
      return;
    } catch (e) {
      if (chromeGone || attempt >= 5) throw e;
      await sleep(800 * attempt);
    }
  }
};
// CDP replies are loosely shaped JSON; `any` keeps the plumbing honest instead
// of inventing a protocol schema here.
const cdp = async (method: string, params: Record<string, unknown> = {}): Promise<any> => {
  if (chromeGone) throw new Error("chrome is gone");
  if (wsClosed && method !== "__noop") await connect();
  return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws!.send(JSON.stringify({ id, method, params })); });
};
// setupPage runs inside connect(); guard against recursion on first connect.
{
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t: { type: string; webSocketDebuggerUrl: string }) => t.type === "page");
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { sock.onopen = r; sock.onerror = () => j(new Error("ws open failed")); });
  ws = sock; wsClosed = false;
  sock.onclose = (e) => { if (ws !== sock) return; wsClosed = true; console.error(`devtools socket closed (${e.code})`); for (const { rej } of pending.values()) rej(new Error("devtools socket closed")); pending.clear(); };
  sock.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id)!; pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  await setupPage();
}

const evaluate = async (expression: string) => {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("page error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
// Helpers injected into every evaluate: find by selector and (optionally) visible text.
const H = `
const $$ = (sel, text) => [...document.querySelectorAll(sel)].filter(e => !text || (e.textContent || "").replace(/\\s+/g," ").includes(text));
const $ = (sel, text) => $$(sel, text)[0] || null;
const body = () => (document.body?.innerText || "").replace(/\\s+/g, " ");
`;
const ev = (js: string) => evaluate(`(() => { ${H} return (${js}); })()`);
const waitFor = async (js: string, label: string, timeout = 60000, interval = 300) => {
  const t0 = Date.now(); let lastLog = 0, lastErr = "";
  for (;;) {
    if (chromeGone) throw new Error(`chrome gone while waiting: ${label}`);
    let v = null; try { v = await ev(`!!(${js})`); } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (msg !== lastErr) { lastErr = msg; log(`  (${label}) eval error:`, msg.slice(0, 160)); } }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${label}`);
    if (Date.now() - lastLog > 20000) { lastLog = Date.now(); log(`  waiting: ${label} …`, (await ev("body()").catch(() => "")).slice(0, 90)); }
    await sleep(interval);
  }
};
const click = (js: string) => ev(`(() => { const el = ${js}; if (!el) return false; el.scrollIntoView({block:"center"}); el.click(); return true; })()`);
const goto = async (url: string) => { await cdp("Page.navigate", { url }); await waitFor(`document.readyState === "complete"`, "load " + url); await sleep(400); };

const shot = async (name: string, { full = false }: { full?: boolean } = {}) => {
  let params: Record<string, unknown> = { format: "png" };
  if (full) {
    const { contentSize } = await cdp("Page.getLayoutMetrics");
    params = { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: Math.ceil(contentSize.height), scale: 1 } };
  }
  const { data } = await cdp("Page.captureScreenshot", params);
  const file = join(OUT, full ? "raw" : "", `${name}${full ? "-full" : ""}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  log("saved", file);
};

/* --------------------------------- flow ---------------------------------- */

try {

  // Seed the demo learner so the app skips onboarding. The 3D announcement is a
  // one-time sheet per browser profile, and it would cover the home screen.
  await goto(`${BASE}/onboarding`);
  await evaluate(`localStorage.setItem("socialcoach.v1", ${JSON.stringify(JSON.stringify({ state: { profile, proficiency }, version: 0 }))}); localStorage.setItem("socialcoach.3d-launch.v1", "seen"); "ok"`);

  if (opt["arena-only"]) {
    // The catalogue is public product UI; this path does not call a model.
    await goto(`${BASE}/arena`);
    await waitFor(`document.querySelector("#catalog-title") && document.querySelectorAll("#catalog-title + div").length`, "scenario catalogue", 30000);
    await ev(`(() => { document.querySelector("#catalog-title").scrollIntoView({block:"start"}); window.scrollBy(0,-24); return true; })()`);
    await sleep(700);
    await shot(`screenshot-04-arena-${LANG}`);
    await shot(`screenshot-04-arena-${LANG}`, { full: true });
  } else {
  // 01 · home: today's pick, reason expanded.
  await goto(`${BASE}/`);
  // A profile with no practice yet sees the recommendation as a request, not as
  // a card that schedules itself, so ask for it before waiting for the card.
  // The card is inert while the model connection check is still running, and a
  // schedule can fail as a task error and leave the request behind — asking
  // again is what a learner would do.
  const todayCard = (ms: number) => waitFor(`$("button", ${JSON.stringify(S.start)})`, "today card", ms, 400);
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await ev(`!!$("button", ${JSON.stringify(S.start)})`)) break;
    await waitFor(`!body().includes(${JSON.stringify(S.checking)})`, "model check settled", 60000);
    if (await click(`$("button", ${JSON.stringify(S.plan)})`) || await click(`$("button", ${JSON.stringify(S.retry)})`)) log(`asking for today's pick (attempt ${attempt})`);
    await todayCard(100_000).catch(() => {});
  }
  await todayCard(240000);
  // The two demo lines belong to one specific scene. A card that is still
  // animating in can read as "not that scene", so let the title settle before
  // deciding, and never walk into a practice whose lines do not fit it.
  const onWantedScene = () => waitFor(`body().includes(${JSON.stringify(S.wantTitle)})`, "the wanted pick", 8000, 400).then(() => true, () => false);
  if (!opt["home-only"]) {
    for (let i = 0; i < 6 && !(await onWantedScene()); i++) {
      log("today's pick is not the overtime scene; asking for another");
      const before = await ev(`body()`);
      if (!(await click(`(${JSON.stringify(S.another)}).map(t => $("button", t)).find(Boolean)`))) break;
      // A swap can fail as a task error and leave the same card behind; that is
      // another attempt, not the end of the run.
      await waitFor(`$("button", ${JSON.stringify(S.start)}) && body() !== ${JSON.stringify(before)}`, "new pick", 90000).catch(() => {});
    }
    if (!(await onWantedScene())) throw new Error(`today's pick never became “${S.wantTitle}”; the demo lines would not fit`);
  }
  await click(`$("button", ${JSON.stringify(S.why)})`);
  await sleep(900);
  await evaluate(`window.scrollTo(0, 0); "ok"`);
  await sleep(300);

  if (opt["home-only"]) {
    await ev(`(() => { document.querySelector(".today-feature").scrollIntoView({block:"start"}); window.scrollBy(0,-24); return true; })()`);
    await sleep(500);
    await shot(`screenshot-05-next-${LANG}`);
    await shot(`screenshot-05-next-${LANG}`, { full: true });
  } else {
  await shot(`screenshot-01-home-${LANG}`);
  await shot(`screenshot-01-home-${LANG}`, { full: true });
  // Start → briefing → enter.
  await click(`$("button", ${JSON.stringify(S.start)})`);
  await waitFor(`location.pathname.startsWith("/practice/")`, "practice route", 30000);
  await waitFor(`(() => { const b = $("button", ${JSON.stringify(S.enter)}); return b && !b.disabled; })()`, "briefing adapted", 120000);
  await sleep(600);
  await click(`$("button", ${JSON.stringify(S.enter)})`);
  await waitFor(`document.querySelector("textarea")`, "chat input", 30000);
  await sleep(1500);

  // Chat: type a line, send, wait for the character to finish.
  const replied = (label: string, ms = 120000) => waitFor(`!document.querySelector("textarea")?.disabled`, label, ms, 300);
  const say = async (text: string) => {
    await evaluate(`document.querySelector("textarea").focus(); "ok"`);
    await cdp("Input.insertText", { text });
    await waitFor(`(() => { const b = $('button[aria-label=${JSON.stringify(S.send)}]'); return b && !b.disabled; })()`, "send enabled", 10000);
    await click(`$('button[aria-label=${JSON.stringify(S.send)}]')`);
    try { await waitFor(`document.querySelector("textarea")?.disabled`, "busy", 8000, 100); } catch {}
    try {
      await replied("character replied");
    } catch (e) {
      // A model turn can spend its own repair budget and stop with a retry
      // affordance; that is what a learner would press, so press it.
      if (!(await click(`$("button", ${JSON.stringify(S.retry)})`))) throw e;
      log("the turn hit its call budget; retried as a learner would");
      await replied("character replied after retry", 180000);
    }
    await sleep(1200);
  };
  await say(lines[0]);
  // 02 · pushback: the polite reply did not get a yes.
  await evaluate(`window.scrollTo(0, document.body.scrollHeight); "ok"`);
  await sleep(500);
  await shot(`screenshot-02-pushback-${LANG}`);
  await shot(`screenshot-02-pushback-${LANG}`, { full: true });

  await say(lines[1]);
  await shot(`screenshot-02b-after-boundary-${LANG}`, { full: true });

  // End → reveal → report.
  await click(`$("button", ${JSON.stringify(S.end)})`);
  await waitFor(`$("button", ${JSON.stringify(S.endReview)})`, "end sheet", 15000);
  await click(`$("button", ${JSON.stringify(S.endReview)})`);
  const reportReady = (ms: number) => waitFor(`(() => { const b = $("button", ${JSON.stringify(S.toReport)}); return b && !b.disabled; })()`, "report ready", ms, 500);
  try {
    await reportReady(180000);
  } catch (e) {
    // A debrief can fail its evidence check and offer a retry; that is a learner
    // action, not the end of the run.
    if (!(await click(`$("button", ${JSON.stringify(S.retry)})`))) throw e;
    log("the debrief failed its check; retried as a learner would");
    await reportReady(240000);
  }
  await sleep(800);
  await shot(`screenshot-03a-reveal-${LANG}`);
  await click(`$("button", ${JSON.stringify(S.toReport)})`);
  await waitFor(`!body().includes(${JSON.stringify(S.writing)}) && !body().includes(${JSON.stringify(S.stillWriting)})`, "report written", 180000, 500);
  await sleep(1500);
  await evaluate(`window.scrollTo(0, 0); "ok"`);
  await sleep(300);
  await shot(`screenshot-03-evidence-debrief-${LANG}`);
  await shot(`screenshot-03-evidence-debrief-${LANG}`, { full: true });
  // Second framing: scroll to the first quoted learner line so evidence leads the frame.
  await ev(`(() => { const q = $("blockquote") || $("q") || $("[class*=quote]"); if (q) { q.scrollIntoView({ block: "start" }); window.scrollBy(0, -96); } return true; })()`);
  await sleep(500);
  await shot(`screenshot-03b-evidence-scrolled-${LANG}`);
  log("done. practice url:", await ev(`location.href`));
  }
  }
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  try { await shot(`failure-${LANG}`); await shot(`failure-${LANG}`, { full: true }); } catch {}
  process.exitCode = 1;
} finally {
  cleanup();
}