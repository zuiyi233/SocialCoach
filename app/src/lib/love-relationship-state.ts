import { z } from "zod";
import type { L } from "@/data/taxonomy";

/**
 * Rio 六幕关系账本（spec-love-rio-route §3–§4）。
 *
 * 这里只记录「发生过什么、答应过什么、还悬着什么、双方确认了什么」——
 * 不记录好感度、熟练度或任何计数型关系值。所有解析、迁移、结局判定
 * 都是纯函数：不读 localStorage、不依赖 React，也不读会话内的开放程度或投递计数。
 */

export const RIO_SERIES_ID = "love-arc-rio-clarify" as const;

export type RioAct = 1 | 2 | 3 | 4 | 5 | 6;
export type RioLang = "zh" | "en";
export type RioOutcome = "success" | "partial" | "failure";
export type RioEndingId = "said-it-plain" | "clean-parting";

export type RioUnknown =
  | "secondmentDisclosed"
  | "familyHalfPromiseDisclosed"
  | "paceAgreed"
  | "decisionReclaimed";

export type RioEvidence =
  | { kind: "quote"; quoteId: string }
  | { kind: "option"; optionId: string; text: L }
  | { kind: "npc"; quoteId: string };

export type RioPromiseKind =
  | "call"
  | "visit"
  | "ritual"
  | "answer-with-date"
  | "family-talk"
  | "secondment-answer"
  | "reply-to-family"
  | "final-decision"
  | "other";
export type RioPromiseStatus = "open" | "kept" | "broken" | "released";

export interface RioPromise {
  id: string;
  kind: RioPromiseKind;
  by: "learner" | "rio";
  madeAtAct: RioAct;
  dueByAct: RioAct | null;
  status: RioPromiseStatus;
  evidence: RioEvidence;
  resolution?: RioEvidence;
  carryId?: string;
}

export type RioBoundaryTopic =
  | "pace"
  | "contact"
  | "family"
  | "wedding"
  | "secondment"
  | "privacy"
  | "decision-ownership";
export type RioBoundaryStatus = "proposed" | "agreed" | "crossed" | "repaired" | "withdrawn";

export interface RioBoundary {
  id: string;
  topic: RioBoundaryTopic;
  by: "learner" | "rio";
  atAct: RioAct;
  status: RioBoundaryStatus;
  evidence: RioEvidence;
  acceptedBy: Array<"learner" | "rio">;
  repair?: RioEvidence;
}

export type RioConflictTopic =
  | "availability"
  | "exclusivity"
  | "pace"
  | "family-expectation"
  | "wedding-timeline"
  | "secondment"
  | "decision-ownership";
export type RioConflictStatus = "open" | "narrowed" | "resolved" | "shelved";
export type RioConflictShape =
  | "soft-no-unverified"
  | "secondment-undecided"
  | "secondment-accepted-no-plan"
  | "secondment-declined"
  | "wedding-date-set-by-family"
  | "wedding-date-withdrawn"
  | "family-half-promise-open"
  | "family-half-promise-withdrawn"
  | "pace-undefined"
  | "pace-dated"
  | "exclusivity-undefined"
  | "exclusivity-agreed"
  | "exclusivity-declined";

export interface RioConflict {
  id: string;
  topic: RioConflictTopic;
  shape: RioConflictShape;
  status: RioConflictStatus;
  openedAtAct: RioAct;
  lastTouchedAtAct: RioAct;
  hasMutualNextStep: boolean;
  evidence: RioEvidence;
  resolution?: RioEvidence;
}

export interface RioRitual {
  id: string;
  kind: "weekly-talk" | "check-in" | "family-boundary-signal" | "other";
  status: "proposed" | "agreed" | "kept" | "skipped" | "dropped";
  atAct: RioAct;
  evidence: RioEvidence;
  acceptedBy: Array<"learner" | "rio">;
}

export type RioHarm =
  | "pressed-after-soft-no"
  | "read-silence-as-betrayal"
  | "pressed-secondment"
  | "used-half-promise-as-weapon"
  | "committed-for-rio"
  | "rio-committed-for-you";

export interface RioRepair {
  harm: RioHarm;
  atAct: RioAct;
  evidence: RioEvidence;
}

export interface RioFlags {
  secondmentDisclosed: boolean;
  secondmentPreference: "unknown" | "go" | "stay" | "undecided";
  secondmentDecision: "undecided" | "accept" | "decline" | "defer-with-date";
  familyHalfPromiseDisclosed: boolean;
  familyHalfPromiseWithdrawn: boolean;
  familyDecisionAnnounced: boolean;
  decisionReclaimed: boolean;
  exclusivity: "undefined" | "agreed" | "declined";
  pace: "undefined" | "dated" | "open-ended";
  weddingTimeline: "unset" | "shelved" | "set-by-family" | "withdrawn";
  finalDecisionMade: boolean;
  unrepairedHarm: RioHarm[];
}

export interface RioFinalDecision {
  kind: "continue" | "pause" | "end";
  agreedBy: "both" | "one-sided";
  atAct: 6;
  evidence: RioEvidence;
  acceptance?: RioEvidence;
  hasDatedNextStep: boolean;
  revisit: "two-weeks" | "after-secondment-answer" | null;
  reason: "secondment" | "pace" | "family" | null;
}

export interface RioQuote {
  id: string;
  atAct: RioAct;
  speaker: "learner" | "rio";
  text: string;
  lang: RioLang;
  via: "type" | "npc";
}

export interface RioRelationshipState {
  v: 1;
  seriesId: typeof RIO_SERIES_ID;
  lastAct: 0 | RioAct;
  lastOutcome: RioOutcome | null;
  legacy: boolean;
  stale: boolean;
  unknown: RioUnknown[];
  promises: RioPromise[];
  boundaries: RioBoundary[];
  conflicts: RioConflict[];
  rituals: RioRitual[];
  flags: RioFlags;
  finalDecision: RioFinalDecision | null;
  quotes: RioQuote[];
  updatedAt: number;
}

/** 第 N 幕的场景 id；迁移时把旧 completed 归到幕号。 */
const ACT_SCENES: Record<RioAct, string> = {
  1: "love-approach-soft-decline-reinvite",
  2: "love-define-rio-pace-talk",
  3: "love-family-expectation-clash",
  4: "love-rio-secondment-deadline",
  5: "love-rio-family-settled",
  6: "love-rio-deadline-night",
};

const SCENE_ACTS: Record<string, RioAct> = Object.fromEntries(
  (Object.entries(ACT_SCENES) as Array<[string, string]>).map(([act, sceneId]) => [sceneId, Number(act) as RioAct]),
);

const UNKNOWN_KEYS = [
  "secondmentDisclosed",
  "familyHalfPromiseDisclosed",
  "paceAgreed",
  "decisionReclaimed",
] as const;

const OUTCOMES = ["success", "partial", "failure"] as const;
const HARM_KEYS = [
  "pressed-after-soft-no",
  "read-silence-as-betrayal",
  "pressed-secondment",
  "used-half-promise-as-weapon",
  "committed-for-rio",
  "rio-committed-for-you",
] as const;

export function emptyRioFlags(): RioFlags {
  return {
    secondmentDisclosed: false,
    secondmentPreference: "unknown",
    secondmentDecision: "undecided",
    familyHalfPromiseDisclosed: false,
    familyHalfPromiseWithdrawn: false,
    familyDecisionAnnounced: false,
    decisionReclaimed: false,
    exclusivity: "undefined",
    pace: "undefined",
    weddingTimeline: "unset",
    finalDecisionMade: false,
    unrepairedHarm: [],
  };
}

/** 空账本：没有任何已发生事实，用于新开局与迁移兜底。 */
export function emptyRioState(): RioRelationshipState {
  return {
    v: 1,
    seriesId: RIO_SERIES_ID,
    lastAct: 0,
    lastOutcome: null,
    legacy: false,
    stale: false,
    unknown: [],
    promises: [],
    boundaries: [],
    conflicts: [],
    rituals: [],
    flags: emptyRioFlags(),
    finalDecision: null,
    quotes: [],
    updatedAt: 0,
  };
}

const LocalizedSchema = z.object({ zh: z.string(), en: z.string() });

const EvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("quote"), quoteId: z.string() }),
  z.object({ kind: z.literal("option"), optionId: z.string(), text: LocalizedSchema }),
  z.object({ kind: z.literal("npc"), quoteId: z.string() }),
]);

const ActSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

const SideSchema = z.enum(["learner", "rio"]);

const UnknownKeySchema = z.enum(UNKNOWN_KEYS);
const HarmSchema = z.enum(HARM_KEYS);

const PromiseSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "call",
    "visit",
    "ritual",
    "answer-with-date",
    "family-talk",
    "secondment-answer",
    "reply-to-family",
    "final-decision",
    "other",
  ]),
  by: SideSchema,
  madeAtAct: ActSchema,
  dueByAct: ActSchema.nullable().catch(null),
  status: z.enum(["open", "kept", "broken", "released"]).catch("open"),
  evidence: EvidenceSchema,
  resolution: EvidenceSchema.optional(),
  carryId: z.string().optional(),
});

const BoundarySchema = z.object({
  id: z.string(),
  topic: z.enum(["pace", "contact", "family", "wedding", "secondment", "privacy", "decision-ownership"]),
  by: SideSchema,
  atAct: ActSchema,
  status: z.enum(["proposed", "agreed", "crossed", "repaired", "withdrawn"]).catch("proposed"),
  evidence: EvidenceSchema,
  acceptedBy: z.array(SideSchema).catch([]),
  repair: EvidenceSchema.optional(),
});

const ConflictSchema = z.object({
  id: z.string(),
  topic: z.enum([
    "availability",
    "exclusivity",
    "pace",
    "family-expectation",
    "wedding-timeline",
    "secondment",
    "decision-ownership",
  ]),
  shape: z.enum([
    "soft-no-unverified",
    "secondment-undecided",
    "secondment-accepted-no-plan",
    "secondment-declined",
    "wedding-date-set-by-family",
    "wedding-date-withdrawn",
    "family-half-promise-open",
    "family-half-promise-withdrawn",
    "pace-undefined",
    "pace-dated",
    "exclusivity-undefined",
    "exclusivity-agreed",
    "exclusivity-declined",
  ]),
  status: z.enum(["open", "narrowed", "resolved", "shelved"]).catch("open"),
  openedAtAct: ActSchema,
  lastTouchedAtAct: ActSchema,
  hasMutualNextStep: z.boolean().catch(false),
  evidence: EvidenceSchema,
  resolution: EvidenceSchema.optional(),
});

const RitualSchema = z.object({
  id: z.string(),
  kind: z.enum(["weekly-talk", "check-in", "family-boundary-signal", "other"]),
  status: z.enum(["proposed", "agreed", "kept", "skipped", "dropped"]).catch("proposed"),
  atAct: ActSchema,
  evidence: EvidenceSchema,
  acceptedBy: z.array(SideSchema).catch([]),
});

const FlagsSchema = z
  .object({
    secondmentDisclosed: z.boolean().catch(false),
    secondmentPreference: z.enum(["unknown", "go", "stay", "undecided"]).catch("unknown"),
    secondmentDecision: z.enum(["undecided", "accept", "decline", "defer-with-date"]).catch("undecided"),
    familyHalfPromiseDisclosed: z.boolean().catch(false),
    familyHalfPromiseWithdrawn: z.boolean().catch(false),
    familyDecisionAnnounced: z.boolean().catch(false),
    decisionReclaimed: z.boolean().catch(false),
    exclusivity: z.enum(["undefined", "agreed", "declined"]).catch("undefined"),
    pace: z.enum(["undefined", "dated", "open-ended"]).catch("undefined"),
    weddingTimeline: z.enum(["unset", "shelved", "set-by-family", "withdrawn"]).catch("unset"),
    finalDecisionMade: z.boolean().catch(false),
    unrepairedHarm: z.array(HarmSchema).catch([]),
  })
  .catch(() => emptyRioFlags());

const FinalDecisionSchema = z.object({
  kind: z.enum(["continue", "pause", "end"]),
  agreedBy: z.enum(["both", "one-sided"]),
  atAct: z.literal(6),
  evidence: EvidenceSchema,
  acceptance: EvidenceSchema.optional(),
  hasDatedNextStep: z.boolean(),
  revisit: z.enum(["two-weeks", "after-secondment-answer"]).nullable().catch(null),
  reason: z.enum(["secondment", "pace", "family"]).nullable().catch(null),
});

const QuoteSchema = z.object({
  id: z.string(),
  atAct: ActSchema,
  speaker: SideSchema,
  text: z.string(),
  lang: z.enum(["zh", "en"]),
  via: z.enum(["type", "npc"]),
});

/**
 * 存档 schema。zod 对象默认 strip 未知字段，所以序列化结果不会带
 * 好感度/熟练度一类字段；缺失或损坏的可选块回安全默认，身份
 * （v / seriesId）不合法则整条 parse 失败，由调用方走 legacy 兜底。
 */
export const RioRelationshipStateSchema: z.ZodType<RioRelationshipState> = z.object({
  v: z.literal(1),
  seriesId: z.literal(RIO_SERIES_ID),
  lastAct: z.union([z.literal(0), ActSchema]).catch(0),
  lastOutcome: z.enum(OUTCOMES).nullable().catch(null),
  legacy: z.boolean().catch(false),
  stale: z.boolean().catch(false),
  unknown: z.array(UnknownKeySchema).catch([]),
  promises: z.array(PromiseSchema).catch([]),
  boundaries: z.array(BoundarySchema).catch([]),
  conflicts: z.array(ConflictSchema).catch([]),
  rituals: z.array(RitualSchema).catch([]),
  flags: FlagsSchema,
  finalDecision: FinalDecisionSchema.nullable().catch(null),
  quotes: z.array(QuoteSchema).catch([]),
  updatedAt: z.number().int().nonnegative().catch(0),
});

/** 解析已提交状态；永不抛错，shape 不符时交给调用方用 legacy 兜底。 */
export function parseRioState(
  raw: unknown,
): { ok: true; state: RioRelationshipState } | { ok: false; reason: "shape" } {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, reason: "shape" };
    }
  }
  const parsed = RioRelationshipStateSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "shape" };
  return { ok: true, state: parsed.data };
}

function isOutcome(value: unknown): value is RioOutcome {
  return value === "success" || value === "partial" || value === "failure";
}

/**
 * 旧 3 幕进度 → 新账本。只迁「已完成到第几幕 + 那一幕 outcome」，
 * 不根据 success/failure 推断任何 hidden、承诺、边界或冲突；这些在
 * 旧档里没有证据，统一放进 unknown，第 4 幕用中性变体开场。
 */
export function migrateLegacyRioState(input: {
  completed: string[];
  lastScene: string;
  outcome: Record<string, RioOutcome>;
}): RioRelationshipState {
  const completed = Array.isArray(input?.completed)
    ? input.completed.filter((sceneId): sceneId is string => typeof sceneId === "string")
    : [];
  const acts = completed
    .map((sceneId) => SCENE_ACTS[sceneId])
    .filter((act): act is RioAct => typeof act === "number");
  const lastAct: 0 | RioAct = acts.reduce<0 | RioAct>((max, act) => (act > max ? act : max), 0);
  const lastScene = typeof input?.lastScene === "string" ? input.lastScene : "";
  const rawOutcome = input?.outcome && typeof input.outcome === "object" ? input.outcome[lastScene] : undefined;
  const lastOutcome = isOutcome(rawOutcome) ? rawOutcome : null;

  return {
    ...emptyRioState(),
    lastAct,
    lastOutcome,
    legacy: true,
    stale: false,
    unknown: [...UNKNOWN_KEYS],
  };
}

function closed(state: RioRelationshipState, topic: RioConflictTopic): boolean {
  const rows = state.conflicts.filter((conflict) => conflict.topic === topic);
  return rows.length > 0 && rows.every((conflict) => conflict.status === "resolved" || conflict.status === "shelved");
}

function noCrossedBoundary(state: RioRelationshipState): boolean {
  return state.boundaries.every((boundary) => boundary.status !== "crossed");
}

/**
 * 唯一决定命名结局的纯函数（spec §4.2）。只读 finalDecision、
 * flags、conflicts、boundaries；不读会话内的开放程度、计数或 LoveSeriesProgress。
 */
export function resolveRioEnding(state: RioRelationshipState): RioEndingId | null {
  const decision = state.finalDecision;
  if (!decision || !state.flags.finalDecisionMade) return null;
  if (decision.agreedBy !== "both" || !decision.acceptance) return null;
  if (state.flags.unrepairedHarm.length > 0) return null;
  if (!noCrossedBoundary(state)) return null;
  if (state.flags.weddingTimeline === "set-by-family") return null;
  if (state.flags.familyDecisionAnnounced && !state.flags.decisionReclaimed) return null;
  if (state.flags.secondmentDecision === "undecided") return null;
  if (!closed(state, "secondment")) return null;
  if (!closed(state, "wedding-timeline")) return null;
  if (!closed(state, "decision-ownership")) return null;

  if (
    decision.kind === "continue" &&
    decision.hasDatedNextStep &&
    state.flags.exclusivity !== "undefined" &&
    state.flags.pace === "dated" &&
    closed(state, "exclusivity") &&
    closed(state, "pace")
  ) {
    return "said-it-plain";
  }

  if (
    (decision.kind === "pause" || decision.kind === "end") &&
    decision.reason !== null &&
    (decision.kind === "end" ? !decision.hasDatedNextStep : decision.hasDatedNextStep && decision.revisit !== null) &&
    closed(state, "exclusivity") &&
    closed(state, "pace")
  ) {
    return "clean-parting";
  }

  return null;
}

/**
 * state 是否仍对得上旧进度。登录/恢复后如果进度已经往前走了，
 * 说明 state 写失败或来自旧设备：返回 false，开场切中性变体。
 */
export function isRioStateCurrent(
  state: RioRelationshipState,
  progress: { completed: string[]; outcome: Record<string, RioOutcome> },
): boolean {
  const act = state.lastAct;
  if (act === 0 || state.lastOutcome === null) return false;
  const completed = Array.isArray(progress?.completed) ? progress.completed : [];
  const sceneId = ACT_SCENES[act];
  if (!completed.includes(sceneId)) return false;

  const latestAct = completed.reduce<number>((max, id) => {
    const candidate = SCENE_ACTS[id];
    return candidate && candidate > max ? candidate : max;
  }, 0);
  if (latestAct !== act) return false;

  const outcome = progress?.outcome && typeof progress.outcome === "object" ? progress.outcome[sceneId] : undefined;
  return outcome === state.lastOutcome;
}
