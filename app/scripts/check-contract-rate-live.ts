/** Opt-in 真实模型测量：node --env-file=.env.local --import tsx scripts/check-contract-rate-live.ts [flags]
 *
 * Measures how often the two BOUNDED CONTRACTS fail on the hosted model pool — the
 * `schedule` role-match step and the `roleplay` turn step — and, for every failure,
 * whether the task's own call budget was still unspent. That distinction is the whole
 * decision ("give these steps one extra repair budget" vs "move the hosted default"),
 * so it is recorded per sample rather than inferred.
 *
 * It exercises the REAL server path, not a reimplementation:
 *   serverLLM -> taskLLM(serverLLM, task, signal, onCall, lang) -> runSchedule / runRoleplay
 * exactly as `src/app/api/schedule/route.ts` and `src/app/api/roleplay/route.ts` do, so
 * each sample is subject to the same `TASK_LIMITS` deadline and call budget. Calling the
 * raw `serverLLM` (as `eval-practice-continuation.ts` does) would skip the budget.
 * A failed sample stays a failed sample. Every further attempt — a wait-and-retry after a
 * provider throttle, or one fresh-budget probe of the same input — is written as its own
 * record (`attempt`, `attemptKind`, `retryOf`) and is never folded back into the first one.
 *
 * Flags:
 *   --arm=schedule|roleplay|both   default both
 *   --concurrency=N                default 3, hard-capped at 4. Measured: 3-wide ran
 *                                  clean over hundreds of calls; 4-wide returned gateway
 *                                  "429 rpm exhausted", and a throttle is not a contract
 *                                  failure, so a 4-wide pass produces data that has to be
 *                                  corrected before it can be read. Above all, do not run
 *                                  two of these at once against one gateway.
 *   --retry=0|1                    default 1: after a failed step/turn, probe the SAME input
 *                                  once with a fresh budget, so "would another attempt have
 *                                  fixed it" is measured instead of assumed
 *   --roleplay-sessions=N          cap the number of roleplay sessions (0 = all)
 *   --schedule-samples=N           cap the number of schedule samples (0 = all)
 *   --bands=office,open,...        run only these schedule bands (office|open|campus|social|love|wide)
 *   --dry                          print the plan + deterministic pool sizes, no calls
 *
 * Raw records are appended as JSONL to CONTRACT_RATE_DIR (default <tmpdir>/sc-contract-rate),
 * deliberately OUTSIDE the repository — nothing here writes into docs/ or any git-tracked
 * path. `.env.local` is loaded by --env-file only: the key is never printed, and every
 * string is passed through `redact()` before it is written or logged.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAST_MODEL, hasServerCredential, serverLLM } from "../src/lib/llm";
import { TASK_LIMITS, taskLLM } from "../src/lib/task-runtime";
import { runRoleplay } from "../src/lib/tasks/roleplay";
import { runSchedule } from "../src/lib/tasks/schedule";
import { TaskInputSchemas, taskInput } from "../src/lib/task-input";
import { SCENARIOS, scenarioById } from "../src/data/corpus";
import { parseRoleplay } from "../src/lib/client-api";
import { extractJSON, systemParts, type LLM } from "../src/lib/llm-core";
import { hasQuote } from "../src/lib/practice-policy";
import { textPlayFixtures } from "./text-play-fixtures";
import type { Scenario } from "../src/data/corpus/types";
import type { ChatMessage, Profile, Proficiency, RoleplayMeta } from "../src/lib/types";
import type { HistoryItem } from "../src/lib/tasks/types";
import type { ContextId, Lang, SkillId } from "../src/data/taxonomy";

/* ────────────────────────────────── options ────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ARM = flag("arm", "both");
const CONCURRENCY = Math.max(1, Math.min(4, Number(flag("concurrency", "3")) || 3));
const RETRY = flag("retry", "1") === "1";
const RP_SESSION_CAP = Number(flag("roleplay-sessions", "0")) || Infinity;
const SCHEDULE_CAP = Number(flag("schedule-samples", "0")) || Infinity;
/** Restrict the schedule arm to named pool bands, e.g. `--bands=wide,love` for the stress set. */
const BAND_FILTER = flag("bands", "").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = argv.includes("--dry");

const outDir = process.env.CONTRACT_RATE_DIR?.trim() || join(tmpdir(), "sc-contract-rate");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonlPath = join(outDir, `samples-${stamp}.jsonl`);

const SECRETS = [process.env.LLM_API_KEY, process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN, process.env.LLM_BUDGET_REDIS_TOKEN]
  .filter((v): v is string => !!v && v.length > 4);
/** Nothing leaves this process — including the JSONL — carrying the gateway key. */
const redact = (text: string) => SECRETS.reduce((acc, key) => acc.split(key).join("[redacted]"), text);

/* ───────────────────────────────── buckets ─────────────────────────────────── */

type Bucket = "ok" | "budget_exhausted" | "role_fit_incomplete" | "json_unparseable" | "schema_rejected" | "interrupted" | "no_match" | "timeout" | "http_error" | "other";
const BUCKETS: Bucket[] = ["ok", "no_match", "budget_exhausted", "role_fit_incomplete", "json_unparseable", "schema_rejected", "interrupted", "timeout", "http_error", "other"];
/** `ok` worked; `no_match` is a legitimate product answer (the 422 path), not a defect. */
const NON_DEFECT: Bucket[] = ["ok", "no_match"];

/** Maps our own user-facing failure text back onto the contract that produced it. */
function classify(error: unknown): { outcome: Bucket; detail: string; status?: number; throttled?: boolean } {
  const err = error as { message?: string; name?: string; status?: number };
  const message = String(err?.message ?? error ?? "");
  const name = String(err?.name ?? "");
  const status = typeof err?.status === "number" ? err.status : undefined;
  // The gateway throttles this tier too ("429 rpm exhausted"). A throttle says nothing
  // about our contract, so it is marked and kept out of the defect rate — but every
  // throttled attempt is still recorded as its own sample, never folded into a success.
  const throttled = status === 429 || /429|rpm exhausted|rate.?limit|too many requests|quota/i.test(message) || err?.name === "RateLimitError";
  if (/调用上限|call budget/i.test(message)) return { outcome: "budget_exhausted", detail: "taskLLM maxCalls reached", status };
  if (/角色匹配结果不完整|Role matching was incomplete/i.test(message)) return { outcome: "role_fit_incomplete", detail: "fitRoles rejected the match rows", status };
  if (/暂时没有同时匹配|No practice currently matches/i.test(message)) return { outcome: "no_match", detail: "422 retrieval answer, not a defect", status };
  if (/回复中断了|reply was interrupted/i.test(message)) return { outcome: "interrupted", detail: "visible partial line; repair not allowed", status };
  if (/came back garbled|Model returned no JSON/i.test(message)) return { outcome: "json_unparseable", detail: message.slice(0, 120), status };
  if (/incomplete scene information|场景信息不完整/i.test(message)) return { outcome: "schema_rejected", detail: "reply contract (meta/utterances)", status };
  if (/outside the scene|越出了剧情边界/i.test(message)) return { outcome: "schema_rejected", detail: "boundary guard", status };
  if (/unconfirmed arrangement|未确认的安排/i.test(message)) return { outcome: "schema_rejected", detail: "fact guard", status };
  if (/Use an allowed learner/i.test(message)) return { outcome: "schema_rejected", detail: "adaptation refine", status };
  if (/allowed playable character|Transcript is too long|practice context is invalid|练习资料不完整/i.test(message)) return { outcome: "schema_rejected", detail: "input contract", status };
  // The 256KB guard in taskLLM's prepare(): a size ceiling, not a contract failure.
  if (/exceeds the model budget|这段资料超过本次处理上限/i.test(message)) return { outcome: "other", detail: "taskLLM inputBytes ceiling (413)", status };
  if (name === "AbortError" || name === "TimeoutError" || /abort/i.test(name) || /was aborted|timed ?out|timeout/i.test(message)) return { outcome: "timeout", detail: `${name || message.slice(0, 120)} (task deadline)`, status };
  if (throttled) return { outcome: "http_error", detail: `provider throttle: ${message.slice(0, 120)}`, status, throttled: true };
  if (status && status >= 400) return { outcome: "http_error", detail: message.slice(0, 160), status };
  return { outcome: "other", detail: message.slice(0, 160), status };
}

/* ───────────────────── real-call capture (observation only) ─────────────────────
 * Wraps serverLLM BEFORE taskLLM wraps it, so the deadline and call budget under test
 * stay in taskLLM and this layer only watches. `thinkingTier` is copied deliberately:
 * taskLLM reads it to size the deadline, and dropping it would change what we measure. */

/** The first check `fitRoles` would have tripped on, in its own order. `instruction_echo` and
 * `prose_no_json` are NOT row-count problems: the model answered with a copy of the task's own
 * instruction text (which contains a literal `{"scenarioId":"..."}` template row, so a naive
 * row count reads it as one real row) or with its planning prose, and stopped before the JSON. */
type RoleFitCause =
  | "none"
  | "no_json"
  | "bare_array_no_fits_wrapper"
  | "no_fits_array"
  | "row_count_per_scenario"
  | "character_id_not_offered"
  | "fit_value"
  | "reason_missing"
  | "conflict_evidence_not_quoted"
  | "instruction_echo"
  | "prose_no_json";

/** What kind of text came back at all — the shape is usually the whole story. */
type ReplyShape = "empty" | "instruction_echo" | "bare_array" | "json_contract" | "prose_or_other";

type RoleFitAnalysis = {
  rowsReturned: number;
  poolSize: number;
  shortfall: number;
  missingIds: string[];
  duplicateIds: string[];
  unknownIds: string[];
  /** Rows whose `characterId` is not one of the role ids offered for that scenario (role-fit.ts:36). */
  characterIdNotOffered: number;
  badFitValue: number;
  missingReason: number;
  conflictRows: number;
  /** `conflict` rows whose evidence is not a verbatim biography quote (role-fit.ts:38). */
  conflictWithoutQuote: number;
  /** The parsed reply carried a `fits` array — precisely the check at role-fit.ts:32. */
  fitsArrayFound: boolean;
  jsonParsed: boolean;
  /** The reply was a bare `[...]` instead of `{"fits":[...]}`: valid JSON, still rejected. */
  bareArray: boolean;
  /** Whether what came back is a contract, a copy of the instruction, or free text. */
  shape: ReplyShape;
  truncatedTail: boolean;
  rejectionCause: RoleFitCause;
};

type Capture = {
  call: number;
  step: "role-fit" | "other";
  mode: "text" | "stream";
  ms: number;
  promptChars: number;
  rawChars: number;
  /** Crude ceiling check against the step's `maxTokens`: a CJK character is about one token,
   * other scripts about four characters per token. `fitRoles` asks for one row per scenario
   * with `maxTokens: 6000`, so this is what decides whether the tail can land at all. */
  tokensApprox: number;
  /** The `maxTokens` this call asked for — the ceiling `tokensApprox` is compared against. */
  maxOutput?: number;
  endsWithBrace: boolean;
  /** `endsWithBrace` alone misleads: a bare-array reply closes with `]`, not `}`. This is the
   * truncation signal the hypothesis actually needs — did the JSON close at all? */
  endsWithBracket: boolean;
  tail: string;
  /** What the call threw, when it threw. Without this a `budget_exhausted` turn is opaque:
   * the third attempt never happens, and the reason the repair call failed is lost inside
   * `repairTwice` (`roleplay.ts:94`), so "the model wrote a bad draft" and "the gateway
   * refused the call" would look identical here. */
  error?: string;
  errorStatus?: number;
  /** role-fit only. */
  poolSize?: number;
  rolesPerScenario?: number;
  rowsReturned?: number;
  analysis?: RoleFitAnalysis;
  /** Full model text for the role-fit call; head/tail only for everything else. */
  raw?: string;
  rawHead?: string;
};

type CallEvent = { task: string; call: number; durationMs: number; ok: boolean; inputBytes: number; maxOutput: number };

const ROLE_FIT_SYSTEM = /Judge whether practice roles fit/;

function makeRecordingLLM(captures: Capture[]): LLM {
  let call = 0;
  const failureOf = (error: unknown) => ({
    error: redact(String((error as Error)?.message ?? error)).slice(0, 300),
    errorStatus: typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined,
  });
  return {
    thinkingTier: serverLLM.thinkingTier,
    async chatText(o) {
      const id = ++call;
      const system = systemParts(o.system).map((p) => p.text).join("\n");
      const prompt = o.messages.map((m) => m.content).join("\n");
      const started = Date.now();
      let raw = "";
      let failure: Record<string, string | number | undefined> | undefined;
      try { raw = await serverLLM.chatText(o); return raw; }
      catch (error) { failure = failureOf(error); throw error; }
      finally { captures.push(buildCapture({ id, system, prompt, mode: "text", ms: Date.now() - started, raw, maxOutput: o.maxTokens, ...failure })); }
    },
    chatStream(o) {
      const id = ++call;
      const system = systemParts(o.system).map((p) => p.text).join("\n");
      const prompt = o.messages.map((m) => m.content).join("\n");
      const started = Date.now();
      const run = serverLLM.chatStream(o);
      let acc = "";
      return {
        refused: run.refused,
        text: run.text,
        deltas: (async function* () {
          let failure: Record<string, string | number | undefined> | undefined;
          try { for await (const d of run.deltas) { acc += d; yield d; } }
          catch (error) { failure = failureOf(error); throw error; }
          finally { captures.push(buildCapture({ id, system, prompt, mode: "stream", ms: Date.now() - started, raw: acc, maxOutput: o.maxTokens, ...failure })); }
        })(),
      };
    },
  };
}

/** Cheap token ceiling estimate for one reply, used only to judge how close a call came to
 * its own `maxTokens`: CJK counts as ~1 token per character, everything else ~4 per token.
 * Not a billing number — the gateway's `usage` is, and the task layer never sees it. */
function estimateTokens(text: string): number {
  const wide = (text.match(/[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/gu) ?? []).length;
  return wide + Math.round((text.length - wide) / 4);
}

function buildCapture(input: { id: number; system: string; prompt: string; mode: Capture["mode"]; ms: number; raw: string; maxOutput: number; error?: string; errorStatus?: number }): Capture {
  const trimmed = input.raw.trim();
  const base: Capture = {
    call: input.id,
    step: stepOf(input),
    mode: input.mode,
    ms: input.ms,
    promptChars: input.prompt.length,
    rawChars: input.raw.length,
    tokensApprox: estimateTokens(input.raw),
    maxOutput: input.maxOutput,
    endsWithBrace: trimmed.endsWith("}"),
    endsWithBracket: trimmed.endsWith("}") || trimmed.endsWith("]"),
    tail: redact(trimmed.slice(-240)),
    rawHead: redact(trimmed.slice(0, 200)),
    ...(input.error ? { error: input.error, errorStatus: input.errorStatus } : {}),
  };
  if (base.step !== "role-fit") return base;
  // The pool `fitRoles` must answer row-per-entry is the `scenarios` array of this very
  // call's user JSON — read it out of the request instead of trusting a local recount, and
  // read it with the same lenient parser the task uses, because the nudge retry appends
  // prose after that JSON and a strict `JSON.parse` would then report an empty pool.
  let pool: { id: string; roles: string[] }[] = [];
  let biography = "";
  try {
    const parsed = extractJSON<{ scenarios?: { id: string; roles?: { id: string }[] }[]; biography?: string }>(input.prompt);
    pool = (parsed.scenarios ?? []).map((s) => ({ id: s.id, roles: (s.roles ?? []).map((r) => r.id) }));
    biography = typeof parsed.biography === "string" ? parsed.biography : "";
  } catch { /* a malformed request is not our bug; the analysis degrades to literal counts */ }
  const analysis = analyseRoleFit(input.raw, pool, biography, input.system);
  return {
    ...base,
    poolSize: pool.length,
    rolesPerScenario: Math.max(0, ...pool.map((p) => p.roles.length)),
    rowsReturned: analysis.rowsReturned,
    analysis,
    raw: redact(input.raw),
  };
}

function stepOf(c: { system: string }): Capture["step"] {
  return ROLE_FIT_SYSTEM.test(c.system) ? "role-fit" : "other";
}

type Row = { scenarioId?: unknown; characterId?: unknown; fit?: unknown; evidence?: unknown; reason?: unknown };

/** Reads a role-match reply the way a human would after a rejection: what shape came back,
 * how many rows, and which of `fitRoles`' own checks it would have tripped — so a row-count
 * shortfall can be told apart from a wrong envelope, an unoffered role id, a rejected
 * conflict quote, or a tail that never landed. Forensics only: the sample's verdict stands. */
function analyseRoleFit(raw: string, pool: { id: string; roles: string[] }[], biography: string, system: string): RoleFitAnalysis {
  const poolIds = pool.map((p) => p.id);
  const offered = new Map(pool.map((p) => [p.id, new Set(p.roles)]));
  const literalIds: string[] = [];
  const re = /"scenarioId"\s*:\s*"([^"]*)"/gu;
  for (let m = re.exec(raw); m; m = re.exec(raw)) literalIds.push(m[1] ?? "");
  let jsonParsed = false;
  let value: unknown;
  try { value = extractJSON(raw); jsonParsed = true; } catch { value = undefined; }
  const rows = Array.isArray((value as { fits?: unknown } | null)?.fits) ? (value as { fits: Row[] }).fits : null;
  // The instruction's own example row is the literal placeholder `{"scenarioId":"...", ...}`.
  // Counting it as an answer is how an echoed prompt reads as "one row returned", so the
  // placeholder is dropped here and the echo is reported as its own shape below.
  const placeholder = (id: string) => !id || id === "..." || id.includes("|");
  const rowIds = (rows ? rows.map((r) => String(r?.scenarioId ?? "")) : literalIds).filter((id) => !placeholder(id));
  const head = raw.trim().slice(0, 120);
  const echoed = raw.trim().length > 0 && system.includes(head);
  // `extractJSON` will salvage the instruction's own example object out of a paragraph of
  // planning prose, which would otherwise look like a one-row answer. If the reply did not
  // even open with a brace and produced no real row, it is prose, not a contract attempt.
  const startsJson = /^[{[]/u.test(raw.trim());
  const shape: ReplyShape = !raw.trim() ? "empty" : echoed ? "instruction_echo" : jsonParsed && rows && (rowIds.length || startsJson) ? "json_contract" : jsonParsed && Array.isArray(value) ? "bare_array" : "prose_or_other";
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const id of rowIds) { if (seen.has(id)) duplicateIds.push(id); seen.add(id); }
  let characterIdNotOffered = 0, badFitValue = 0, missingReason = 0, conflictRows = 0, conflictWithoutQuote = 0;
  const inspect = (id: string, character: unknown, fit: unknown, reason: unknown, evidence: unknown) => {
    if (placeholder(id)) return;
    const allowed = offered.get(id);
    if (allowed?.size && !allowed.has(String(character))) characterIdNotOffered++;
    if (!["compatible", "uncertain", "conflict"].includes(String(fit))) badFitValue++;
    if (typeof reason !== "string") missingReason++;
    if (fit === "conflict") { conflictRows++; if (!hasQuote(typeof evidence === "string" ? evidence : "", [biography])) conflictWithoutQuote++; }
  };
  if (rows) for (const r of rows) inspect(String(r?.scenarioId ?? ""), r?.characterId, r?.fit, r?.reason, r?.evidence);
  else {
    // A reply we cannot parse is still read row by row, so a truncated final row shows up as
    // a missing `reason` instead of silently vanishing from the count.
    for (const chunk of raw.split(/(?="scenarioId"\s*:)/u).filter((c) => /"scenarioId"\s*:/u.test(c))) {
      const field = (name: string) => new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "u").exec(chunk)?.[1];
      inspect(field("scenarioId") ?? "", field("characterId"), field("fit"), field("reason"), field("evidence"));
    }
  }
  let rejectionCause: RoleFitCause = "none";
  if (shape === "instruction_echo") rejectionCause = "instruction_echo";
  else if (!jsonParsed) rejectionCause = "no_json";
  else if (shape === "prose_or_other") rejectionCause = "prose_no_json";
  else if (shape === "bare_array") rejectionCause = "bare_array_no_fits_wrapper";
  else {
    for (const entry of pool) {
      const matching = rows!.filter((r) => !placeholder(String(r?.scenarioId ?? "")) && r?.scenarioId === entry.id);
      if (matching.length !== 1) { rejectionCause = "row_count_per_scenario"; break; }
      const row = matching[0]!;
      if (!entry.roles.includes(String(row.characterId))) { rejectionCause = "character_id_not_offered"; break; }
      if (!["compatible", "uncertain", "conflict"].includes(String(row.fit))) { rejectionCause = "fit_value"; break; }
      if (typeof row.reason !== "string") { rejectionCause = "reason_missing"; break; }
      if (row.fit === "conflict" && !hasQuote(typeof row.evidence === "string" ? row.evidence : "", [biography])) { rejectionCause = "conflict_evidence_not_quoted"; break; }
    }
  }
  return {
    rowsReturned: rowIds.length,
    poolSize: poolIds.length,
    shortfall: poolIds.length - rowIds.length,
    missingIds: poolIds.filter((id) => !seen.has(id)).slice(0, 12),
    duplicateIds: duplicateIds.slice(0, 12),
    unknownIds: rowIds.filter((id) => !poolIds.includes(id)).slice(0, 12),
    characterIdNotOffered,
    badFitValue,
    missingReason,
    conflictRows,
    conflictWithoutQuote,
    fitsArrayFound: !!rows,
    jsonParsed,
    bareArray: jsonParsed && Array.isArray(value),
    shape,
    truncatedTail: !raw.trim().endsWith("}"),
    rejectionCause,
  };
}

/* ───────────────────────────── Arm 1 — schedule ───────────────────────────── */

type BioKind = "detailed" | "ambiguous" | "empty";

const BIOS: Record<BioKind, { zh: string; en: string }> = {
  detailed: {
    zh: "我 34 岁，在一家中型软件公司做后端工程师，带两个实习生已经两年；结婚五年，有一个四岁的女儿。上个月我们组和运营部门一起做一个数据迁移，我需要向运营负责人要排期，也要在周会上说清进度。我清楚自己的问题是被人反驳时容易打断对方。",
    en: "I am 34, a backend engineer at a mid-sized software company, and I have supervised two interns for two years. Married five years, one four-year-old daughter. Last month my team and the operations team started a joint data migration: I have to ask the operations lead for a schedule and report progress in the weekly meeting. I know I interrupt people when I am contradicted.",
  },
  ambiguous: {
    zh: "我在公司上班，最近和同事有点别扭，想把话说清楚一点。",
    en: "I work at a company and things have been awkward with a colleague lately. I want to say things more clearly.",
  },
  empty: { zh: "", en: "" },
};

type Band = { id: string; goals: SkillId[]; contexts: ContextId[] };
/** Which scenarios reach `fitRoles` is decided by the profile's goals (at most 2 survive
 * `runSchedule`) and preferred contexts, so the band choice is the pool-size choice. The
 * corpus caps this: 142 non-custom scenarios, and the widest goal pair the taxonomy allows
 * (`communication` + `building-relationships`, no context filter) still matches 124 of them. */
const BANDS: Record<string, Band> = {
  office: { id: "office", goals: ["communication", "leadership"], contexts: ["workplace"] },
  open: { id: "open", goals: ["empathy", "perspective-taking"], contexts: [] },
  campus: { id: "campus", goals: ["standing-up", "ethical-responsibility"], contexts: ["education", "public"] },
  social: { id: "social", goals: ["sense-of-belonging", "expressing-gratitude"], contexts: ["friendship", "party"] },
  love: { id: "love", goals: ["empathy", "sense-of-purpose"], contexts: ["romantic"] },
  wide: { id: "wide", goals: ["communication", "building-relationships"], contexts: [] },
};

/** Mirrors runSchedule's own derivation (matchesCore + the goals/contexts it forces into
 * core_constraints) so the dry plan can show the pool each sample will hand the model. */
function predictedPool(band: Band) {
  const target = band.goals.slice(0, 2);
  return SCENARIOS.filter((s) => !s.custom && target.some((k) => s.skills.includes(k) || s.relatedSkills?.includes(k)) && (!band.contexts.length || band.contexts.includes(s.context)));
}

const HISTORY_SEED: { scenarioId: string; title: { zh: string; en: string }; skills: string[]; context: ContextId; outcome: string; stars: number; skill: SkillId; deficit: "acquisition" | "performance"; evidence: { zh: string; en: string }; nextStep: { zh: string; en: string }; reflection: { question: { zh: string; en: string }; answer: { zh: string; en: string } } }[] = [
  {
    scenarioId: "office-quick-favor", title: { zh: "同事的「五分钟」", en: "The five-minute favour" }, skills: ["seeking-help", "communication"], context: "workplace", outcome: "partial", stars: 2, skill: "communication", deficit: "performance",
    evidence: { zh: "我最多帮你看一页的逻辑，不替你重做。", en: "I can review one page, not rewrite six." },
    nextStep: { zh: "先把范围写下来再答复对方。", en: "State the scope before you answer." },
    reflection: { question: { zh: "这次最难说出口的是哪一句？", en: "Which line was hardest to say?" }, answer: { zh: "我说「不行」的时候喉咙发紧。", en: "Saying no made my throat tighten." } },
  },
  {
    scenarioId: "class-chat-screenshot", title: { zh: "被转发的私聊", en: "The forwarded screenshot" }, skills: ["resolving-conflicts", "social-norms"], context: "education", outcome: "success", stars: 3, skill: "resolving-conflicts", deficit: "acquisition",
    evidence: { zh: "我不会拿接下全部修改来换删帖。", en: "I will not trade taking the edits for deleting the post." },
    nextStep: { zh: "先分公开误解和分工两件事。", en: "Separate the public misunderstanding from the workload." },
    reflection: { question: { zh: "对方真正想被听见的是什么？", en: "What did they want you to hear?" }, answer: { zh: "他怕任务最后没人接。", en: "That nobody would own the rest." } },
  },
  {
    scenarioId: "partner-location-pressure", title: { zh: "定位共享的要求", en: "The location-sharing demand" }, skills: ["emotion-regulation", "impulse-control"], context: "romantic", outcome: "failure", stars: 1, skill: "emotion-regulation", deficit: "performance",
    evidence: { zh: "你今天不说清楚，我们没法继续。", en: "If you will not explain, we cannot continue." },
    nextStep: { zh: "先把边界说完，再回应情绪。", en: "Finish the boundary before answering the feeling." },
    reflection: { question: { zh: "哪一句话让对话升级了？", en: "Which line escalated it?" }, answer: { zh: "我反问那句「你是不是觉得我在隐瞒」。", en: "My counter-question about hiding something." } },
  },
  {
    scenarioId: "group-chat-blame", title: { zh: "群里的公开指责", en: "Blame in the group chat" }, skills: ["communication", "initiative"], context: "workplace", outcome: "partial", stars: 2, skill: "initiative", deficit: "acquisition",
    evidence: { zh: "我昨天 17:00 已交原清单。", en: "I sent the original list at 17:00 yesterday." },
    nextStep: { zh: "先给出时间线，再问对方要什么。", en: "Give the timeline first, then ask what they need." },
    reflection: { question: { zh: "如果重来你会先说什么？", en: "What would you say first next time?" }, answer: { zh: "先说已经交付了什么。", en: "What was already delivered." } },
  },
];

function historyFor(depth: number, lang: Lang): HistoryItem[] {
  const now = Date.now();
  return Array.from({ length: depth }, (_, i) => {
    const src = HISTORY_SEED[i % HISTORY_SEED.length]!;
    return {
      sessionId: `measure-session-${i}`,
      practiceId: `measure-practice-${i}`,
      scenarioId: src.scenarioId,
      title: src.title[lang],
      skills: src.skills,
      context: src.context,
      outcome: src.outcome,
      stars: src.stars,
      scoringVersion: 2 as const,
      at: now - (depth - i) * 86_400_000,
      diagnosis: [{ skill: src.skill, level: 2, evidence: src.evidence[lang], deficit: src.deficit }],
      nextStep: src.nextStep[lang],
      reflections: [{ question: src.reflection.question[lang], answer: src.reflection.answer[lang] }],
    };
  });
}

function profileFor(bioKind: BioKind, band: Band, lang: Lang): Profile {
  return {
    name: lang === "zh" ? "受测样本" : "Measured Learner",
    bio: BIOS[bioKind][lang],
    goals: band.goals,
    contexts: band.contexts,
    lang,
    createdAt: Date.now() - 40 * 86_400_000,
  };
}

const proficiencyFor = (band: Band): Proficiency => Object.fromEntries(band.goals.map((g, i) => [g, 2 + i]));

type SchedulePlan = { id: string; bioKind: BioKind; band: Band; depth: number; lang: Lang };

function schedulePlan(): SchedulePlan[] {
  const plans: SchedulePlan[] = [];
  const push = (bioKind: BioKind, band: Band, depth: number, lang: Lang) => plans.push({ id: `sched-${band.id}-${lang}-h${depth}-${bioKind}`, bioKind, band, depth, lang });
  // 2 langs x 3 bio kinds x {first session, 12-item returner} x {small pool, wide-ish pool} = 24
  for (const lang of ["zh", "en"] as Lang[]) {
    for (const bioKind of ["detailed", "ambiguous", "empty"] as BioKind[]) {
      for (const depth of [0, 12]) {
        for (const band of [BANDS.office!, BANDS.open!]) push(bioKind, band, depth, lang);
      }
    }
  }
  // 6-item returners on the two narrow bands: 12 more samples, 36 total
  for (const lang of ["zh", "en"] as Lang[]) {
    for (const bioKind of ["detailed", "ambiguous", "empty"] as BioKind[]) {
      for (const band of [BANDS.campus!, BANDS.social!]) push(bioKind, band, 6, lang);
    }
  }
  // The pool-size stress set: a 60+ and a 100+ scenario pool, where one row per scenario
  // under `maxTokens: 6000` is the case the truncated-tail hypothesis predicts. 24 more.
  for (const lang of ["zh", "en"] as Lang[]) {
    for (const bioKind of ["detailed", "ambiguous", "empty"] as BioKind[]) {
      for (const depth of [0, 12]) {
        for (const band of [BANDS.love!, BANDS.wide!]) push(bioKind, band, depth, lang);
      }
    }
  }
  return BAND_FILTER.length ? plans.filter((p) => BAND_FILTER.includes(p.band.id)) : plans;
}

/* ───────────────────────────── Arm 2 — roleplay ───────────────────────────── */

/** Learner lines copied verbatim from `scripts/eval-practice-continuation.ts` (`longRuns`),
 * so this arm meets the same synthetic learner and the same deep-history shape already used
 * for contract review. A snapshot on purpose: importing that script would run its whole eval. */
const LONG_RUNS: { id: string; lang: Lang; lines: string[] }[] = [
  { id: "office-quick-favor", lang: "zh", lines: [
    "先别把电脑推过来。我自己的报告16:30要交。你说的修改具体是内容还是排版？",
    "如果内容还没定，我不能接全部六页。你能给我看一下老板原来的反馈吗？",
    "我最多帮你看一页的逻辑，不替你重做。你最需要讨论的是哪一页？",
    "先别把只看一页变成改完六页。剩余内容你准备找谁确认？",
    "我还没有说一定能替你找人。你现在最担心的是交不上，还是方向不对？",
    "我想先理解这点，不急着结束。老板到底希望这份材料证明什么？",
    "如果现在没有明确反馈，就保留待确认。你愿意先整理现有问题吗？",
    "我刚才语气急了，抱歉。不过16:30的报告和只看一页的范围不变。你听到的承诺是什么？",
    "如果一页也讨论不完，我们应该怎样告诉负责人剩余问题？",
    "我不想现在再承诺今晚继续改。我能提供的只是眼下有限讨论，你还希望澄清什么？",
    "我改变一下安排，只帮你列出问题，不直接改稿。你觉得会有哪些实际影响？",
    "这不是要结束，我还有疑问：你准备怎样解释内容尚未确认，而不是说我没帮忙？",
    "我们已经谈了不少，但我还想确认：哪些是你自己决定的，哪些必须问老板？",
    "最后再核实一项，前面说的16:30和不接六页有没有被误解？",
  ] },
  { id: "class-chat-screenshot", lang: "zh", lines: [
    "我说的是不包办最后修改，不是不合作。你能把原话和群里的解释放在一起再看一下吗？",
    "删不删是另一件事。你为什么把私聊发进班群，还加上不愿配合的解释？",
    "我不会拿接下全部修改来换删帖。你愿意先更正那句话吗？",
    "沈星，我不是让你只判谁对谁错。公开误解和任务分工是两件事，你先想处理哪一个？",
    "如果更正文字需要商量，先明确哪些是我的原话，哪些是程凡自己的判断，行吗？",
    "程凡，你自己对最后修改有什么担心？我还想听具体的，不急着收尾。",
    "我现在没有说老师看到了，别替我确认外传。你知道截图还发给过谁吗？",
    "不知道就保留未知。沈星，现在有哪些工作还没人承担？",
    "我愿意讨论分工，但没有答应包办。你能把需要做的部分先说明白吗？",
    "我刚才只顾着反驳了，语气可以缓一点。私聊转发的边界不变，你以后准备如何确认？",
    "即使帖子删除了，已被别人看到还是事实。你觉得怎样更正才不会继续被误解？",
    "我还没说结束：原任务和最后修改分别是谁负责，这两件事现在真的确认了吗？",
    "如果有人不同意，我们先列出仍有分歧的事项，你会怎样表述我的意思？",
    "再确认一个问题，我们谈妥的部分有哪些，哪些还要其他组员同意？",
  ] },
  { id: "partner-location-pressure", lang: "en", lines: [
    "I replied thirty minutes late. I haven't agreed to tracking. What exactly did you fear had happened?",
    "I can listen to the worry without agreeing to constant location sharing. What situation makes it hardest for you?",
    "Please don't treat a late reply as proof I'm hiding something. What do you actually know about this evening?",
    "For an agreed meeting, I could message if I'm delayed. That isn't a promise to report every movement. How would that work for you?",
    "You can disagree with that limit. What would be left unresolved for you?",
    "I'm not trying to finish yet. I want to understand why knowing my location seems necessary to you.",
    "If you don't know the answer, say that. I don't want either of us to invent a past betrayal. What happened today?",
    "I sounded impatient earlier; I'm sorry for that tone. My privacy limit remains. What do you hear me actually offering?",
    "I could tell you about a delay to a plan we've made together, but not give constant updates. What concern would that address?",
    "I don't want to promise an exact reply time whenever I'm busy. How can we handle an ordinary gap without accusations?",
    "Let me change my proposal: first let's clarify which meetings need an update. What would count as an agreed plan?",
    "I'm still asking a question, not saying goodbye: which parts of this have we accepted, and which do you reject?",
    "If I decline location sharing, can you say what choice you would make without assuming I've done something wrong?",
    "One more thing before I decide whether to stop: is there an unanswered concern you want to state plainly?",
  ] },
];

type RpSession = { key: string; scenarioId: string; lang: Lang; kind: "long-history" | "fixture-route"; route?: string; lines: string[] };

function roleplayPlan(): RpSession[] {
  const planned: RpSession[] = LONG_RUNS.map((run) => ({ key: `long-${run.id}`, scenarioId: run.id, lang: run.lang, kind: "long-history", lines: run.lines }));
  for (const fixture of textPlayFixtures) {
    for (const [route, lines] of Object.entries(fixture.routes)) {
      planned.push({ key: `${fixture.id}-${route}`, scenarioId: fixture.id, lang: fixture.lang, kind: "fixture-route", route, lines });
    }
  }
  const known = planned.filter((s) => !!scenarioById(s.scenarioId));
  for (const dropped of planned) if (!scenarioById(dropped.scenarioId)) console.log(`[plan] dropped ${dropped.key}: scenario id not in the corpus`);
  return known.slice(0, RP_SESSION_CAP);
}

const learnerIdFor = (scenario: Scenario) => (scenario.characters.find((c) => c.id === "you" && c.playable) ?? scenario.characters.find((c) => c.playable) ?? scenario.characters[0]).id;

/* ─────────────────────────────── sample records ─────────────────────────────── */

/** Why this attempt was made. Every attempt is its own sample: a crash is never rewritten
 * into a later success, and a gateway throttle never becomes a contract defect. */
type AttemptKind = "first" | "throttle-retry" | "fresh-budget-probe";
const MAX_ATTEMPTS = 4;
const THROTTLE_WAIT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sample = {
  kind: "sample";
  arm: "schedule" | "roleplay";
  id: string;
  attempt: number;
  attemptKind: AttemptKind;
  /** The sample id of the attempt that caused this one, when it is a retry. */
  retryOf?: string;
  labels: Record<string, string | number>;
  outcome: Bucket;
  detail?: string;
  message?: string;
  status?: number;
  /** Provider-side throttle: kept out of the contract defect rate, reported separately. */
  throttled?: boolean;
  /** Logical taskLLM calls consumed — the budget the route handler would have charged. */
  calls: number;
  maxCalls: number;
  spareCallBudget: boolean;
  /** calls > 1 on a roleplay turn means the bounded repair at roleplay.ts:94 fired. Only
   * meaningful there — a successful `schedule` sample spends its 3 steps by design. */
  repairUsed?: boolean;
  wallMs: number;
  callEvents: CallEvent[];
  /** Per-call provider-side failures inside this task's budget — the reason a repair call
   * returned nothing, which the outer `outcome` message cannot show. */
  callErrors?: { call: number; step: Capture["step"]; mode: Capture["mode"]; ms: number; error: string; status?: number }[];
  roleFit?: Capture[];
  /** roleplay: was an NPC line already on screen when this turn failed (roleplay.ts:113). */
  streamedChars?: number;
  streamedBefore?: boolean;
  rawCharsOnFailure?: number;
  rawTailOnFailure?: string;
  rawHeadOnFailure?: string;
};

type SessionRecord = { kind: "session"; session: string; ended: "completed" | "abandoned_after_failure"; lastSample: string; learnerTurnsPlanned: number; learnerTurnsMeasured: number };

let written = 0;
async function emit(record: Sample | SessionRecord) {
  await appendFile(jsonlPath, `${redact(JSON.stringify(record))}\n`);
  if (record.kind === "sample") {
    written++;
    const label = Object.entries(record.labels).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`[${written}] arm=${record.arm} ${label} attempt=${record.attempt}(${record.attemptKind}) outcome=${record.outcome} calls=${record.calls}/${record.maxCalls} wall=${record.wallMs}ms${record.message ? ` msg="${redact(record.message).slice(0, 80)}"` : ""}`);
  } else console.log(`[session] ${record.session} ${record.ended} after ${record.learnerTurnsMeasured}/${record.learnerTurnsPlanned} turns`);
}

const samples: Sample[] = [];

async function recordSample(fields: Omit<Sample, "kind">) {
  const sample: Sample = { kind: "sample", ...fields };
  samples.push(sample);
  await emit(sample);
  return sample;
}

/* ─────────────────────────────── arm runners ─────────────────────────────── */

async function runScheduleSample(plan: SchedulePlan) {
  let attemptKind: AttemptKind = "first";
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const sample = await scheduleAttempt(plan, n, attemptKind);
    if (sample.outcome === "ok" || sample.outcome === "no_match") return;
    if (sample.throttled && n < MAX_ATTEMPTS) { attemptKind = "throttle-retry"; await sleep(THROTTLE_WAIT_MS); continue; }
    // One fresh-budget probe on the same input, recorded as its own sample: this is the
    // number that says whether the step is flaky rather than systematically broken.
    if (RETRY && attemptKind === "first") { attemptKind = "fresh-budget-probe"; continue; }
    return;
  }
}

const callErrorsOf = (captures: Capture[]) => {
  const failed = captures.filter((c) => c.error);
  return failed.length
    ? failed.map((c) => ({ call: c.call, step: c.step, mode: c.mode, ms: c.ms, error: c.error!, status: c.errorStatus }))
    : undefined;
};

async function scheduleAttempt(plan: SchedulePlan, attempt: number, attemptKind: AttemptKind): Promise<Sample> {
  const profile = profileFor(plan.bioKind, plan.band, plan.lang);
  const raw = { profile, proficiency: proficiencyFor(plan.band), history: historyFor(plan.depth, plan.lang), lang: plan.lang };
  const captures: Capture[] = [];
  const events: CallEvent[] = [];
  const started = Date.now();
  let outcome: Bucket = "ok";
  let message: string | undefined;
  let detail: string | undefined;
  let status: number | undefined;
  let throttled: boolean | undefined;
  try {
    const input = taskInput(TaskInputSchemas.schedule, raw);
    const llm = taskLLM(makeRecordingLLM(captures), "schedule", undefined, (e) => events.push(e), plan.lang);
    const out = await runSchedule(input, llm, FAST_MODEL);
    if (!out?.scenario || !out?.adaptation) { outcome = "other"; detail = "harness"; message = "runSchedule resolved without a scenario/adaptation"; }
  } catch (error) {
    const c = classify(error);
    outcome = c.outcome; detail = c.detail; status = c.status; throttled = c.throttled;
    message = String((error as Error)?.message ?? error);
    if (c.outcome === "other") console.log(`[other] ${redact(message).slice(0, 300)}`);
  }
  const calls = events.reduce((n, e) => Math.max(n, e.call), 0);
  const roleFit = captures.filter((c) => c.step === "role-fit");
  const failed = outcome !== "ok";
  return recordSample({
    arm: "schedule",
    id: attempt === 1 ? plan.id : `${plan.id}#a${attempt}`,
    attempt,
    attemptKind,
    ...(attempt > 1 ? { retryOf: plan.id } : {}),
    labels: { bio: plan.bioKind, band: plan.band.id, history: plan.depth, lang: plan.lang, poolPredicted: predictedPool(plan.band).length, roleFitCalls: roleFit.length },
    outcome, detail, message, status, throttled,
    calls,
    maxCalls: TASK_LIMITS.schedule[1],
    spareCallBudget: calls < TASK_LIMITS.schedule[1],
    wallMs: Date.now() - started,
    callEvents: events,
    callErrors: callErrorsOf(captures),
    ...(roleFit.length ? { roleFit } : {}),
    ...(failed && captures.length ? { rawCharsOnFailure: captures.at(-1)!.rawChars, rawTailOnFailure: captures.at(-1)!.tail, rawHeadOnFailure: captures.at(-1)!.rawHead } : {}),
  });
}

async function runRoleplaySession(session: RpSession) {
  const scenario = scenarioById(session.scenarioId)!;
  const learnerId = learnerIdFor(scenario);
  const messages: ChatMessage[] = [{ id: "opening", role: "npc", characterId: scenario.opening.characterId, text: scenario.opening.text[session.lang], ts: 0 }];
  let lastSample = "";
  let measured = 0;
  let abandoned = false;
  for (const [i, line] of session.lines.entries()) {
    const learnerTurn = messages.filter((m) => m.role === "learner").length + 1;
    messages.push({ id: `${session.key}-l${i}`, role: "learner", text: line, ts: i * 2 + 1 });
    // Same segment-boundary rule eval-practice-continuation uses.
    const turnLimit = learnerTurn > 12 ? 20 : 12;
    let attemptKind: AttemptKind = "first";
    let ok: RoleplayResult | undefined;
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const result = await runRoleplayTurn({ session, scenario, learnerId, messages: [...messages], learnerTurn, turnLimit, attempt: n, attemptKind });
      measured++;
      lastSample = result.id;
      if (result.outcome === "ok") { ok = result; break; }
      if (result.throttled && n < MAX_ATTEMPTS) { attemptKind = "throttle-retry"; await sleep(THROTTLE_WAIT_MS); continue; }
      if (RETRY && attemptKind === "first") { attemptKind = "fresh-budget-probe"; continue; }
      break;
    }
    if (!ok) { abandoned = true; break; }
    for (const [n, u] of ok.utterances!.entries()) {
      messages.push({ id: `${session.key}-n${i}-${n}`, role: "npc", characterId: u.characterId, text: u.text, ts: i * 2 + 2 + n, ...(n === ok.utterances!.length - 1 ? { meta: ok.meta! } : {}) });
    }
  }
  await emit({ kind: "session", session: session.key, ended: abandoned ? "abandoned_after_failure" : "completed", lastSample, learnerTurnsPlanned: session.lines.length, learnerTurnsMeasured: measured });
}

type RoleplayResult = { id: string; outcome: Bucket; utterances?: { characterId: string; text: string }[]; meta?: RoleplayMeta };

type TurnArgs = { session: RpSession; scenario: Scenario; learnerId: string; messages: ChatMessage[]; learnerTurn: number; turnLimit: number; attempt: number; attemptKind: AttemptKind };

async function runRoleplayTurn(args: TurnArgs): Promise<RoleplayResult & { throttled?: boolean }> {
  const { session, scenario, learnerId, messages, learnerTurn, turnLimit, attempt, attemptKind } = args;
  const captures: Capture[] = [];
  const events: CallEvent[] = [];
  let preview = "";
  const started = Date.now();
  let outcome: Bucket = "ok";
  let message: string | undefined;
  let detail: string | undefined;
  let status: number | undefined;
  let throttled: boolean | undefined;
  let utterances: { characterId: string; text: string }[] | undefined;
  let meta: RoleplayMeta | undefined;
  const baseId = `${session.key}-t${learnerTurn}`;
  const id = attempt === 1 ? baseId : `${baseId}#a${attempt}`;
  try {
    const input = taskInput(TaskInputSchemas.roleplay, { scenario, learnerCharacterId: learnerId, messages, lang: session.lang, turnLimit });
    const llm = taskLLM(makeRecordingLLM(captures), "roleplay", undefined, (e) => events.push(e), session.lang);
    const raw = await runRoleplay(input, llm, FAST_MODEL, (d) => { preview += d; });
    const parsed = parseRoleplay(raw, scenario.characters.filter((c) => c.id !== learnerId).map((c) => c.id));
    if (!parsed.meta || !parsed.utterances.length) { outcome = "schema_rejected"; detail = "resolved turn carries no meta or no utterance"; message = detail; }
    else { utterances = parsed.utterances; meta = parsed.meta as RoleplayMeta; }
  } catch (error) {
    const c = classify(error);
    outcome = c.outcome; detail = c.detail; status = c.status; throttled = c.throttled;
    message = String((error as Error)?.message ?? error);
    if (c.outcome === "other") console.log(`[other] ${redact(message).slice(0, 300)}`);
  }
  const calls = events.reduce((n, e) => Math.max(n, e.call), 0);
  const failed = outcome !== "ok";
  const lastCapture = captures.at(-1);
  await recordSample({
    arm: "roleplay",
    id,
    attempt,
    attemptKind,
    ...(attempt > 1 ? { retryOf: baseId } : {}),
    labels: { session: session.kind, scenario: session.scenarioId, route: session.route ?? "long", lang: session.lang, turn: learnerTurn, learnerChars: messages.at(-1)?.text.length ?? 0 },
    outcome, detail, message, status, throttled,
    calls,
    maxCalls: TASK_LIMITS.roleplay[1],
    spareCallBudget: calls < TASK_LIMITS.roleplay[1],
    repairUsed: calls > 1,
    wallMs: Date.now() - started,
    callEvents: events,
    callErrors: callErrorsOf(captures),
    streamedChars: preview.length,
    streamedBefore: preview.length > 0,
    ...(failed && lastCapture ? { rawCharsOnFailure: lastCapture.rawChars, rawTailOnFailure: lastCapture.tail, rawHeadOnFailure: lastCapture.rawHead } : {}),
  });
  return { id, outcome, utterances, meta, throttled };
}

/* ─────────────────────────────── summarising ─────────────────────────────── */

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row); else map.set(k, [row]);
  }
  return map;
}

function summarise() {
  const lines: string[] = [];
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    model: FAST_MODEL,
    provider: process.env.LLM_PROVIDER ?? "anthropic",
    gateway: process.env.LLM_BASE_URL ? new URL(process.env.LLM_BASE_URL).host : "direct",
    concurrency: CONCURRENCY,
    retry: RETRY,
    samples: samples.length,
    budgets: { roleplay: TASK_LIMITS.roleplay, schedule: TASK_LIMITS.schedule },
  };
  for (const arm of ["schedule", "roleplay"] as const) {
    const rows = samples.filter((s) => s.arm === arm);
    if (!rows.length) continue;
    // One planned unit = one attempt-1 sample: the schedule step, or one learner turn.
    const units = rows.filter((r) => r.attemptKind === "first");
    const throttled = rows.filter((r) => r.throttled);
    const contractDefect = (r: Sample) => !NON_DEFECT.includes(r.outcome) && !r.throttled;
    const counts = Object.fromEntries(BUCKETS.map((b) => [b, units.filter((r) => r.outcome === b).length])) as Record<Bucket, number>;
    const defects = units.filter(contractDefect);
    const walls = rows.map((r) => r.wallMs);
    lines.push(`\n== arm=${arm}  planned units=${units.length}  recorded samples=${rows.length} (incl. ${throttled.filter((r) => r.attemptKind === "throttle-retry").length} throttle retries, ${rows.filter((r) => r.attemptKind === "fresh-budget-probe").length} fresh-budget probes) ==`);
    for (const b of BUCKETS) if (counts[b]) lines.push(`   ${b.padEnd(21)} ${String(counts[b]).padStart(4)} / ${units.length}  ${((counts[b] / units.length) * 100).toFixed(1)}%  (first attempt per unit)`);
    lines.push(`   CONTRACT DEFECT RATE  ${String(defects.length).padStart(4)} / ${units.length}  ${((defects.length / units.length) * 100).toFixed(1)}%   (excludes ok, no_match and provider 429s)`);
    lines.push(`   provider-throttled calls anywhere: ${throttled.length} / ${rows.length} samples${throttled.length ? `  (statuses ${[...new Set(throttled.map((r) => r.status ?? "?"))].join(",")})` : ""}`);
    lines.push(`   wall ms p50=${percentile(walls, 50)}  p90=${percentile(walls, 90)}  max=${Math.max(...walls)}`);
    lines.push(`   failing while calls<maxCalls (one more repair was affordable): ${defects.filter((r) => r.spareCallBudget).length} / ${defects.length}`);
    lines.push(`   failing on call 1 (never reached its repair): ${defects.filter((r) => r.calls <= 1).length} / ${defects.length}`);
    lines.push(`   failing on the last allowed call (budget is the binding limit): ${defects.filter((r) => r.calls >= r.maxCalls).length} / ${defects.length}`);
    const keys: [string, (row: Sample) => string][] = arm === "schedule"
      ? [["bio", (r) => `bio=${r.labels.bio}`], ["band/pool", (r) => `band=${r.labels.band} poolPredicted=${r.labels.poolPredicted}`], ["history", (r) => `history=${r.labels.history}`], ["lang", (r) => `lang=${r.labels.lang}`]]
      : [["lang", (r) => `lang=${r.labels.lang}`], ["session kind", (r) => `session=${r.labels.session} route=${r.labels.route}`], ["turn band", (r) => turnBand(Number(r.labels.turn))]];
    for (const [title, key] of keys) {
      lines.push(`   -- by ${title} (first attempts, contract defects only) --`);
      for (const [k, group] of groupBy(units, key)) {
        const bad = group.filter(contractDefect);
        const throttles = group.filter((r) => r.throttled).length;
        lines.push(`      ${k.padEnd(34)} n=${String(group.length).padStart(3)}  defects=${String(bad.length).padStart(3)} (${((bad.length / group.length) * 100).toFixed(1)}%)  throttled=${throttles}  ${bad.map((r) => r.outcome).join(",")}`);
      }
    }
    const probes = rows.filter((r) => r.attemptKind === "fresh-budget-probe");
    if (probes.length) lines.push(`   fresh-budget probes (same input, new ${arm} budget): ok=${probes.filter((r) => r.outcome === "ok").length} / ${probes.length}; outcomes: ${[...groupBy(probes, (r) => r.outcome)].map(([k, g]) => `${k}=${g.length}`).join(" ")}`);
    if (arm === "roleplay") {
      const streamed = defects.filter((r) => r.streamedBefore).length;
      lines.push(`   first-attempt failures that had ALREADY streamed an NPC line: ${streamed} / ${defects.length} (${defects.length ? ((streamed / defects.length) * 100).toFixed(1) : "0.0"}%)  -> an extra repair call is not legal there (roleplay.ts:113)`);
      lines.push(`   ok turns that used a repair call: ${rows.filter((r) => r.outcome === "ok" && r.repairUsed).length} / ${units.filter((r) => r.outcome === "ok").length}`);
      const withCallErrors = rows.filter((r) => r.callErrors?.length);
      lines.push(`   samples with a provider-side call failure: ${withCallErrors.length} / ${rows.length}`);
      for (const r of withCallErrors.slice(0, 20)) lines.push(`      ${r.id} ${r.outcome} calls=${r.calls}/${r.maxCalls} -> ${r.callErrors!.map((e) => `call${e.call}(${e.step},${e.ms}ms): ${e.error.slice(0, 90)}`).join(" ; ")}`);
    }
    report[arm] = {
      units: units.length,
      samples: rows.length,
      counts,
      contractDefects: defects.length,
      contractDefectRate: defects.length / units.length,
      throttledSamples: throttled.length,
      p50: percentile(walls, 50),
      p90: percentile(walls, 90),
      freshBudgetProbes: probes.map((r) => ({ id: r.id, outcome: r.outcome })),
      failingWithSpareBudget: defects.filter((r) => r.spareCallBudget).map((r) => ({ id: r.id, outcome: r.outcome, calls: r.calls, maxCalls: r.maxCalls, streamedBefore: r.streamedBefore ?? null })),
    };
  }
  const fits = samples.flatMap((s) => (s.roleFit ?? []).map((c) => ({ sample: s.id, arm: s.arm, sampleOutcome: s.outcome, attemptKind: s.attemptKind, throttled: !!s.throttled, call: c.call, ms: c.ms, poolSize: c.poolSize ?? null, rowsReturned: c.rowsReturned ?? null, rawChars: c.rawChars, tokensApprox: c.tokensApprox, askedMaxTokens: c.maxOutput ?? null, analysis: c.analysis, endsWithBrace: c.endsWithBrace, endsWithBracket: c.endsWithBracket })));
  report.roleFitCalls = fits;
  if (fits.length) {
    lines.push(`\n== role-fit calls  n=${fits.length} (samples that did not short-circuit on an empty bio) ==`);
    for (const f of fits) {
      const a = f.analysis;
      lines.push(`   ${String(f.sample).padEnd(30)} call=${f.call} pool=${String(f.poolSize).padStart(3)} rows=${String(f.rowsReturned).padStart(3)} short=${String(a?.shortfall ?? "-").padStart(3)} dup=${a?.duplicateIds.length ?? "-"} unknown=${a?.unknownIds.length ?? "-"} badChar=${a?.characterIdNotOffered ?? "-"} badFit=${a?.badFitValue ?? "-"} noReason=${a?.missingReason ?? "-"} cnq=${a?.conflictWithoutQuote ?? "-"} brace=${f.endsWithBrace ? "Y" : "n"} closed=${f.endsWithBracket ? "Y" : "n"} shape=${a?.shape ?? "-"} cause=${a?.rejectionCause ?? "-"} ~tok=${f.tokensApprox}/${f.askedMaxTokens} ms=${f.ms} -> ${f.sampleOutcome}`);
    }
    lines.push(`   reply shape distribution: ${[...groupBy(fits, (f) => String(f.analysis?.shape))].map(([k, g]) => `${k}=${g.length}`).join("  ")}`);
    const shortfalls = fits.filter((f) => (f.analysis?.shortfall ?? 0) > 0);
    lines.push(`   row-shortfall calls: ${shortfalls.length} / ${fits.length};  of those, with a tail that never closed: ${shortfalls.filter((f) => !f.endsWithBracket).length}`);
    lines.push(`   tail never closed (not ending in } or ]): ${fits.filter((f) => !f.endsWithBracket).length} / ${fits.length};  ending with a brace: ${fits.filter((f) => f.endsWithBrace).length}`);
    lines.push(`   at/over the estimated token ceiling: ${fits.filter((f) => f.tokensApprox >= 0.9 * (f.askedMaxTokens ?? 6000)).length} / ${fits.length}`);
    lines.push(`   rejection cause among rejected calls: ${[...groupBy(fits.filter((f) => (f.analysis?.rejectionCause ?? "none") !== "none"), (f) => String(f.analysis?.rejectionCause))]
      .map(([k, group]) => `${k}=${group.length}`)
      .join("  ") || "none"}`);
    lines.push(`   rejection cause among samples that ended role_fit_incomplete: ${[...groupBy(fits.filter((f) => f.sampleOutcome === "role_fit_incomplete"), (f) => String(f.analysis?.rejectionCause))]
      .map(([k, group]) => `${k}=${group.length}`)
      .join("  ") || "none"}`);
    for (const [k, group] of groupBy(fits, (f) => String(f.poolSize))) {
      lines.push(`      pool=${k.padEnd(4)} calls=${String(group.length).padStart(3)} row-shortfalls=${group.filter((g) => (g.analysis?.shortfall ?? 0) > 0).length} truncatedTail=${group.filter((g) => !g.endsWithBrace).length} rejected=${group.filter((g) => g.sampleOutcome === "role_fit_incomplete").length}`);
    }
    lines.push(`   rows vs pool, every call (pool->rows): ${fits.map((f) => `${f.poolSize}->${f.rowsReturned}`).join("  ")}`);
  }
  console.log(lines.join("\n"));
  return { report, lines };
}

function turnBand(turn: number) {
  return turn <= 1 ? "turn=1" : turn === 2 ? "turn=2" : turn <= 5 ? "turn=3-5" : turn <= 10 ? "turn=6-10" : "turn=11+";
}

/* ─────────────────────────────────── main ─────────────────────────────────── */

async function main() {
  const schedulePlanList = schedulePlan().slice(0, SCHEDULE_CAP);
  const roleplayPlanList = roleplayPlan().slice(0, RP_SESSION_CAP);
  if (DRY) {
    console.log("arm=schedule plan (no model calls)");
    for (const plan of schedulePlanList) console.log(`  ${plan.id} bio=${plan.bioKind.padEnd(9)} band=${plan.band.id.padEnd(7)} lang=${plan.lang} history=${String(plan.depth).padStart(2)} predictedPool=${predictedPool(plan.band).length}`);
    console.log("\narm=roleplay plan");
    for (const s of roleplayPlanList) console.log(`  ${s.key.padEnd(42)} lang=${s.lang} kind=${s.kind} learnerTurns=${s.lines.length} learner=${learnerIdFor(scenarioById(s.scenarioId)!)}`);
    console.log(`\nschedule samples=${schedulePlanList.length}  roleplay sessions=${roleplayPlanList.length} learner turns=${roleplayPlanList.reduce((n, s) => n + s.lines.length, 0)}`);
    return;
  }
  if (!hasServerCredential()) throw new Error("No configured provider in .env.local");
  await mkdir(outDir, { recursive: true });
  console.log(`model=${FAST_MODEL} concurrency=${CONCURRENCY} retry=${RETRY} arm=${ARM}`);
  console.log(`budgets: schedule=${JSON.stringify(TASK_LIMITS.schedule)} roleplay=${JSON.stringify(TASK_LIMITS.roleplay)} (wallMs, maxCalls)`);
  console.log(`raw JSONL -> ${jsonlPath}`);

  const pool = async <T>(items: T[], worker: (item: T) => Promise<void>) => {
    if (!items.length) return;
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) { const mine = index++; if (mine >= items.length) return; await worker(items[mine]!); }
    }));
  };

  if (ARM === "schedule" || ARM === "both") await pool(schedulePlanList, runScheduleSample);
  if (ARM === "roleplay" || ARM === "both") await pool(roleplayPlanList, runRoleplaySession);

  const { report, lines } = summarise();
  await writeFile(join(outDir, `summary-${stamp}.json`), `${redact(JSON.stringify({ ...report, jsonl: jsonlPath }, null, 2))}\n`);
  await writeFile(join(outDir, `summary-${stamp}.txt`), `${redact(lines.join("\n"))}\n`);
  console.log(`\nraw samples: ${jsonlPath}`);
  console.log(`summary:     ${join(outDir, `summary-${stamp}.json`)}`);
}

main().catch((e) => { console.error(redact(String((e as Error)?.message ?? e))); process.exitCode = 1; });
