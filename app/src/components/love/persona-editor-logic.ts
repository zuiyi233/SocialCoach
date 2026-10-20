import type { Lang } from "@/data/taxonomy";
import {
  isSingleLanguage,
  preferLanguage,
  type LocalizedText,
  type Persona,
  type PersonaFileClass,
  type PersonaImportCarry,
  type PersonaKind,
} from "@/lib/love-persona";
import type { LoveCoachProfilePatch } from "@/lib/love-persona-store";

/**
 * 聚焦人设编辑器的纯逻辑（spec-love-persona §4.2、§5）。
 *
 * 这一层不碰存储、不碰 DOM，只做三件编辑器必须做对的事：
 *  1. 导入路由：`.scpersona` / 基础 JSON 留在恋爱系统，完整 Tavern 制品引导到 Studio。
 *  2. 冲突裁决：同 id 给「保留 / 换新 / 合并」，同名不同 id 只并列、绝不按名字合并（`tess` 教训）。
 *  3. 导出预览与基础 JSON 导出：下载前先摆清楚会包含什么，且只映射恋爱系统能诚实映射的核心字段。
 *
 * 身份一律按 `id`（缺省回退 `characterPackId`），显示名只用于「有没有撞名」的提示。
 */

/* ------------------------------------------------------------------ *
 * 字段分组：玩家 / 角色各自的编辑面（§4.2 一字不多）
 * ------------------------------------------------------------------ */

export type PersonaFieldKey =
  | "name"
  | "language"
  | "bio"
  | "goals"
  | "boundaries"
  | "preferences"
  | "personality"
  | "speechStyle"
  | "role"
  | "appearance"
  | "voice"
  | "greetings"
  | "storyConstraints";

/** 玩家 persona 的字段（名字 / 语言 / 简介 / 目标 / 边界 / 偏好 / 外观 / 声线）。 */
export const PLAYER_FIELDS: readonly PersonaFieldKey[] = [
  "name",
  "language",
  "bio",
  "goals",
  "boundaries",
  "preferences",
  "appearance",
  "voice",
];

/** NPC 的字段（名字 / 定位 / 公开简介 / 性格 / 说话风格 / 外观 / 声线 + 可选约束）。 */
export const NPC_FIELDS: readonly PersonaFieldKey[] = [
  "name",
  "role",
  "bio",
  "personality",
  "goals",
  "boundaries",
  "speechStyle",
  "greetings",
  "appearance",
  "voice",
  "storyConstraints",
];

export function fieldsForKind(kind: PersonaKind): readonly PersonaFieldKey[] {
  return kind === "player" ? PLAYER_FIELDS : NPC_FIELDS;
}

/* ------------------------------------------------------------------ *
 * 导入路由
 * ------------------------------------------------------------------ */

export type PersonaImportRoute =
  | { kind: "pack" }
  | { kind: "basic-json" }
  | { kind: "studio"; carries: PersonaImportCarry[] }
  | { kind: "unknown" };

/** 把 `classifyPersonaFile` 的分类结果折成编辑器要走的四条路。绝不据此填字段。 */
export function routePersonaFile(cls: PersonaFileClass, carries: PersonaImportCarry[] = []): PersonaImportRoute {
  if (cls.guide === "studio") return { kind: "studio", carries };
  if (cls.kind === "scpersona") return { kind: "pack" };
  if (cls.kind === "basic-json") return { kind: "basic-json" };
  return { kind: "unknown" };
}

/* ------------------------------------------------------------------ *
 * 身份与撞名
 * ------------------------------------------------------------------ */

/** 跨系统身份键：优先 `characterPackId`，缺省用稳定 `id`（绝不按显示名）。 */
export function personaIdentityKey(persona: Persona): string {
  return persona.characterPackId ?? persona.id;
}

function nameTokens(persona: Persona): string[] {
  const tokens = [persona.name.zh.trim(), persona.name.en.trim()].filter(Boolean);
  for (const alias of persona.aliases ?? []) {
    if (alias.trim()) tokens.push(alias.trim());
  }
  return tokens;
}

/**
 * 同名不同 id 的其它人设：只用来**并列提示**，绝不据名字合并或覆盖。
 * 显示名完全相同才是撞名；空名不算撞名。
 */
export function sameNameCollisions(incoming: Persona, all: Persona[]): Persona[] {
  const tokens = new Set(nameTokens(incoming));
  if (!tokens.size) return [];
  return all.filter((p) => p.id !== incoming.id && nameTokens(p).some((token) => tokens.has(token)));
}

/* ------------------------------------------------------------------ *
 * 冲突裁决（§5）
 * ------------------------------------------------------------------ */

/** 导入/保存时用户能选的行动。 */
export type ConflictDecision = "keep" | "replace" | "merge" | "import-new";

export interface MergeChange {
  field: string;
  from: "current" | "incoming";
}

export interface ConflictContext {
  /** 库里同 id 的现有版本；null = 没有 id 冲突。 */
  current: Persona | null;
  incoming: Persona;
  /** 同名不同 id 的其它人设（只并列，不合并）。 */
  sameName: Persona[];
}

export type ConflictOutcome =
  | { ok: true; write: Persona | null }
  | { ok: false; code: "needs-new-id" | "not-mergeable" };

const LOC_FIELDS = [
  "name",
  "bio",
  "personality",
  "goals",
  "boundaries",
  "preferences",
  "speechStyle",
  "role",
] as const satisfies readonly (keyof Persona)[];

function locHas(value: LocalizedText | undefined): boolean {
  return !!value && (value.zh.trim().length > 0 || value.en.trim().length > 0);
}

function mergeSub(current: unknown, incoming: unknown): { value: unknown; from: "current" | "incoming" } {
  if (incoming === undefined) return { value: current, from: "current" };
  if (current === undefined || typeof current !== "object" || typeof incoming !== "object" || incoming === null) {
    return { value: incoming, from: "incoming" };
  }
  return { value: { ...(current as object), ...(incoming as object) }, from: "incoming" };
}

/**
 * 字段级合并：incoming 有内容就覆盖，没有就保留 current。返回变更清单，
 * 让「合并」不是一句空话——UI 能把哪几个字段来自新版本摆出来。
 */
export function mergePersona(current: Persona, incoming: Persona): { persona: Persona; changes: MergeChange[] } {
  const next: Persona = { ...current, id: current.id, createdAt: current.createdAt };
  const changes: MergeChange[] = [];

  for (const field of LOC_FIELDS) {
    const inc = incoming[field] as LocalizedText | undefined;
    if (locHas(inc)) {
      (next as unknown as Record<string, unknown>)[field] = inc;
      changes.push({ field, from: "incoming" });
    }
  }

  if (incoming.greetings?.length) {
    next.greetings = incoming.greetings;
    changes.push({ field: "greetings", from: "incoming" });
  }
  if (incoming.aliases?.length) {
    next.aliases = incoming.aliases;
    changes.push({ field: "aliases", from: "incoming" });
  }
  if (incoming.language) {
    next.language = incoming.language;
    changes.push({ field: "language", from: "incoming" });
  }
  if (incoming.characterKey) {
    next.characterKey = incoming.characterKey;
    changes.push({ field: "characterKey", from: "incoming" });
  }

  for (const field of ["appearance", "voice", "storyConstraints", "assets"] as const) {
    const merged = mergeSub(current[field], incoming[field]);
    if (merged.from === "incoming") {
      (next as unknown as Record<string, unknown>)[field] = merged.value;
      changes.push({ field, from: "incoming" });
    }
  }

  if (incoming.tavern) {
    next.tavern = incoming.tavern;
    changes.push({ field: "tavern", from: "incoming" });
  }
  if (incoming.license) {
    next.license = incoming.license;
    changes.push({ field: "license", from: "incoming" });
  }
  if (incoming.source !== current.source) {
    next.source = incoming.source;
    changes.push({ field: "source", from: "incoming" });
  }

  next.updatedAt = Math.max(current.updatedAt, incoming.updatedAt);
  return { persona: next, changes };
}

/**
 * 裁决一次冲突。`freshId` 只在 `import-new` 时需要——id 冲突时把新版本另存为一份，
 * 两份并列保留。没有 id 冲突时 `replace` / `merge` 无意义，退回直接写 incoming。
 */
export function resolveConflict(ctx: ConflictContext, decision: ConflictDecision, freshId?: string): ConflictOutcome {
  if (!ctx.current) {
    if (decision === "keep") return { ok: true, write: null };
    if (decision === "import-new" && freshId) return { ok: true, write: { ...ctx.incoming, id: freshId, revision: 1 } };
    return { ok: true, write: ctx.incoming };
  }
  if (decision === "keep") return { ok: true, write: null };
  if (decision === "import-new") {
    if (!freshId) return { ok: false, code: "needs-new-id" };
    return { ok: true, write: { ...ctx.incoming, id: freshId, revision: 1 } };
  }
  if (decision === "merge") return { ok: true, write: mergePersona(ctx.current, ctx.incoming).persona };
  // replace：换内容，但身份（id / createdAt）留在原来那份上。
  return { ok: true, write: { ...ctx.incoming, id: ctx.current.id, createdAt: ctx.current.createdAt } };
}

/** 同 id 两份是否内容不同：只比 `cardHash`，缺省再退回 JSON 比较。 */
export function personasDiffer(a: Persona, b: Persona): boolean {
  if (!isSingleLanguage(a.name) || !isSingleLanguage(b.name)) {
    if (a.name.zh !== b.name.zh || a.name.en !== b.name.en) return true;
  }
  try {
    return JSON.stringify(a) !== JSON.stringify(b);
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ *
 * 导出预览与基础 JSON 导出
 * ------------------------------------------------------------------ */

export interface ExportSummary {
  /** 有内容的 persona 字段（按编辑面顺序）。 */
  fields: string[];
  worldbookEntries: number;
  hasStyle: boolean;
  portraitCount: number;
  hasRefImage: boolean;
  /** 公开导出时 `storyConstraints.secret` 是否会被剥掉。 */
  secretStripped: boolean;
}

/** 下载前摆给用户看的「会包含什么」。`publicOnly` 反映今天的勾选状态。 */
export function summarizeExport(persona: Persona, publicOnly: boolean, refImage: boolean, portraitCount = 0): ExportSummary {
  const fields: string[] = [];
  for (const field of LOC_FIELDS) {
    if (locHas(persona[field] as LocalizedText | undefined)) fields.push(field);
  }
  if (persona.greetings?.length) fields.push("greetings");
  if (persona.appearance?.text?.trim()) fields.push("appearance");
  if (persona.voice?.profileId?.trim()) fields.push("voice");
  if (persona.storyConstraints?.goal) fields.push("storyConstraints.goal");
  if (persona.storyConstraints?.redLine) fields.push("storyConstraints.redLine");
  if (persona.storyConstraints?.secret) fields.push("storyConstraints.secret");

  return {
    fields,
    worldbookEntries: persona.tavern?.worldbook?.length ?? 0,
    hasStyle: !!persona.tavern?.styleBlocks?.length,
    portraitCount,
    hasRefImage: refImage,
    secretStripped: publicOnly && !!persona.storyConstraints?.secret,
  };
}

/**
 * 基础 JSON 导出：只映射恋爱系统能诚实读回的那一小撮核心字段（§3 映射表子集）。
 * `importBasicPersonaJson` 认得 `name` / `description` / `scenario` / `personality` /
 * `mes_example` / `first_mes` / `alternate_greetings`，所以这里只产出这些——
 * 不塞 `character_book` / `extensions` 之类会把文件变成「完整 Tavern 制品」的键。
 */
export function personaToBasicJson(persona: Persona, lang: Lang): Record<string, unknown> {
  const out: Record<string, unknown> = { name: preferLanguage(persona.name, lang).trim() };
  const bio = persona.bio ? preferLanguage(persona.bio, lang).trim() : "";
  if (bio) out.description = bio;
  const personality = persona.personality ? preferLanguage(persona.personality, lang).trim() : "";
  if (personality) out.personality = personality;
  const speech = persona.speechStyle ? preferLanguage(persona.speechStyle, lang).trim() : "";
  if (speech) out.mes_example = speech;
  const greetings = (persona.greetings ?? []).map((g) => preferLanguage(g, lang).trim()).filter(Boolean);
  if (greetings.length) {
    out.first_mes = greetings[0];
    if (greetings.length > 1) out.alternate_greetings = greetings.slice(1);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 教练档案副本预览（§7：唯一跨表动作）
 * ------------------------------------------------------------------ */

export interface CoachCopyRow {
  field: "name" | "bio" | "lang";
  value: string;
}

/** 把 `buildCoachProfilePatch` 的结果摆成可读的行，确认前先让人看清到底复制哪几个字段。 */
export function coachCopyRows(patch: LoveCoachProfilePatch): CoachCopyRow[] {
  const rows: CoachCopyRow[] = [];
  if (patch.name !== undefined) rows.push({ field: "name", value: patch.name });
  if (patch.bio !== undefined) rows.push({ field: "bio", value: patch.bio });
  if (patch.lang !== undefined) rows.push({ field: "lang", value: patch.lang });
  return rows;
}

/* ------------------------------------------------------------------ *
 * 预览
 * ------------------------------------------------------------------ */

/** 预览用的开场白：取 UI 语言，单语卡原样。最多 `limit` 条。 */
export function greetingPreviews(persona: Persona, lang: Lang, limit = 3): string[] {
  return (persona.greetings ?? [])
    .map((g) => preferLanguage(g, lang).trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** 预览用的主名；空名回退一个占位，绝不拿 id 冒充名字。 */
export function previewName(persona: Persona, lang: Lang): string {
  const name = preferLanguage(persona.name, lang).trim();
  return name || (lang === "zh" ? "未命名" : "Untitled");
}

/** 这份人设是否到了「能入库」的最低调：名字里至少有一种语言有内容。 */
export function personaSaveBlocked(persona: Persona): boolean {
  return !locHas(persona.name);
}

/** 单语标记：编辑器据此显示「原文」并给翻译入口（§2「不要伪造第二语言」）。 */
export function isOriginalOnly(value: LocalizedText | undefined): boolean {
  return !!value && isSingleLanguage(value) && (value.zh.trim().length > 0 || value.en.trim().length > 0);
}

/** 干净文件名：`<slug>.scpersona` / `<slug>.json`，slug 只留安全字符。 */
export function personaFileName(persona: Persona, lang: Lang, ext: string): string {
  const base = preferLanguage(persona.name, lang).trim() || persona.id;
  const slug = base
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || persona.id}.${ext}`;
}