import { z } from "zod";
import type { Lang } from "@/data/taxonomy";
import type { Profile } from "./types";
import { LOVE_PLAY_PREFIX } from "./love-carry-store";
import { notifyLoveSlotsChanged } from "./love-slot-events";
import { readLoveStoryStore } from "./love-story";
import {
  LOVE_PERSONA_SERIALIZED_MAX_BYTES,
  PersonaSchema,
  parsePersona,
  preferLanguage,
  type Persona,
  type PersonaKind,
} from "./love-persona";

/**
 * 恋爱域的设备端人设库（spec-love-persona §5）。
 *
 * 单 slot：`socialcoach.love-play.personas`，落在 `LOVE_PLAY_PREFIX` 下，导出/擦除的前缀扫描
 * 自动覆盖。纪律逐条抄 `love-story.ts`：读取永不抛错（坏 JSON / 形状不对 / 版本未知都保留 raw，
 * 不静默当空）；写入带 revision，期望值与磁盘不一致返回 conflict；坏档拒绝覆盖；配额失败可辨。
 *
 * 分表纪律（§5、§7 已拍板）：恋爱 persona 只存这里，**绝不读写教练档案 `socialcoach.v1`**。
 * 唯一跨表动作是用户确认后的「复制到教练档案」——由 UI 提供 apply 回调落盘，本模块只做纯构建。
 *
 * 资产策略：这一 slot 主要放文本人设。若 pack 带参考图/立绘，按单张与总量预算裁剪，
 * 被裁掉的资产**显式回报**（write 结果里的 warning 点名），绝不静默丢弃。
 *
 * 草稿：编辑器刷新后要能续上（§9 验收）。落在 sessionStorage（同标签页刷新仍在，且不进导出），
 * 与 `socialcoach.draft.*` 的既有约定一致。
 */

export const LOVE_PERSONA_KEY = `${LOVE_PLAY_PREFIX}personas`;
export const LOVE_PERSONA_STORE_VERSION = 1 as const;
/** 人设库条目上限。 */
export const LOVE_PERSONA_COUNT_MAX = 100;
/** 整个 slot 的序列化字节上限。 */
export const LOVE_PERSONA_STORE_MAX_BYTES = 4 * 1024 * 1024;
/** 单张资产（data URL）的字节上限。 */
export const LOVE_PERSONA_STORE_ASSET_MAX_BYTES = 512 * 1024;
/** 整个 slot 资产（data URL）的字节上限。 */
export const LOVE_PERSONA_STORE_ASSETS_TOTAL_MAX_BYTES = 2 * 1024 * 1024;
/** 草稿 key：sessionStorage，编辑器刷新恢复用。 */
export const LOVE_PERSONA_DRAFT_KEY = "socialcoach.draft.love-persona";

export interface LovePersonaStore {
  v: 1;
  revision: number;
  /** 按稳定 id 索引（绝不按显示名）。 */
  personas: Record<string, Persona>;
  /** 可选：personaId → 资产 id → data URL。文本 slot 默认不带，带则受预算约束。 */
  assets?: Record<string, Record<string, string>>;
  activePlayerId?: string;
  updatedAt: number;
}

export type LovePersonaRead =
  | { status: "empty" }
  | { status: "ok"; store: LovePersonaStore; raw: string }
  | { status: "corrupt"; raw: string; reason: "json" | "shape" }
  | { status: "incompatible"; raw: string }
  | { status: "unavailable" };

/** 写入时被降级的内容：点名哪些资产因超预算被丢弃。 */
export type LovePersonaStoreWarning = { code: "assets-dropped"; dropped: string[] };

export type LovePersonaFailure = {
  ok: false;
  reason: "conflict" | "quota" | "unavailable" | "invalid";
  diskRevision?: number;
};

export type LovePersonaWrite =
  | { ok: true; store: LovePersonaStore; warnings: LovePersonaStoreWarning[] }
  | LovePersonaFailure;

export type LovePersonaDelete =
  | { ok: true; store: LovePersonaStore; links: LovePersonaLinkReport }
  | LovePersonaFailure;

/** 删除 persona 前要提示的关联故事/关系档案（§5：只提示，不代删）。 */
export interface LovePersonaLinkReport {
  seriesIds: string[];
  scenarioIds: string[];
}

/** 复制到教练档案时**只**要合并的字段（§7 分表；教练 profile 是 `Profile`）。 */
export type LoveCoachProfilePatch = Partial<Pick<Profile, "name" | "bio" | "lang">>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

function storage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== "function" || typeof ls.setItem !== "function") return null;
    return ls;
  } catch {
    return null;
  }
}

function sessionStore(): StorageLike | null {
  try {
    const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!ss || typeof ss.getItem !== "function" || typeof ss.setItem !== "function") return null;
    return ss;
  } catch {
    return null;
  }
}

const assetString = z.string().max(LOVE_PERSONA_STORE_ASSET_MAX_BYTES * 2);

/** `z.looseObject` 的 Persona 原样内嵌：未知字段穿过 store 与备份往返（§2「未知字段原样保留」）。 */
export const LovePersonaStoreSchema: z.ZodType<LovePersonaStore> = z
  .object({
    v: z.literal(LOVE_PERSONA_STORE_VERSION),
    revision: z.number().int().nonnegative(),
    personas: z.record(z.string().min(1).max(100), PersonaSchema),
    assets: z.record(z.string().min(1).max(100), z.record(z.string().max(120), assetString)).optional(),
    activePlayerId: z.string().min(1).max(100).optional(),
    updatedAt: z.number(),
  })
  .superRefine((store, ctx) => {
    const entries = Object.entries(store.personas);
    if (entries.length > LOVE_PERSONA_COUNT_MAX) {
      ctx.addIssue({ code: "custom", path: ["personas"], message: "too many personas" });
    }
    for (const [key, persona] of entries) {
      if (persona.id !== key) ctx.addIssue({ code: "custom", path: ["personas", key], message: "a persona is keyed by its id" });
    }
    if (store.activePlayerId && store.personas[store.activePlayerId]?.kind !== "player") {
      ctx.addIssue({ code: "custom", path: ["activePlayerId"], message: "active player must be a player persona" });
    }
    if (store.assets) {
      let total = 0;
      for (const [pid, group] of Object.entries(store.assets)) {
        if (!store.personas[pid]) ctx.addIssue({ code: "custom", path: ["assets", pid], message: "assets belong to a persona" });
        for (const value of Object.values(group)) total += byteLength(value);
      }
      if (total > LOVE_PERSONA_STORE_ASSETS_TOTAL_MAX_BYTES) {
        ctx.addIssue({ code: "custom", path: ["assets"], message: "asset budget exceeded" });
      }
    }
  }) as unknown as z.ZodType<LovePersonaStore>;

export function emptyLovePersonaStore(): LovePersonaStore {
  return { v: LOVE_PERSONA_STORE_VERSION, revision: 0, personas: {}, updatedAt: 0 };
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014 ||
    (typeof e.message === "string" && /quota/i.test(e.message))
  );
}

function serialize(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** 读取整个库；无 key = empty，坏数据保留 raw，永不抛错。 */
export function readLovePersonaStore(): LovePersonaRead {
  const ls = storage();
  if (!ls) return { status: "unavailable" };

  let raw: string | null | undefined;
  try {
    raw = ls.getItem(LOVE_PERSONA_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw == null) return { status: "empty" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "corrupt", raw, reason: "json" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = (value as { v?: unknown }).v;
    if (typeof v === "number" && v !== LOVE_PERSONA_STORE_VERSION) return { status: "incompatible", raw };
  }
  const parsed = LovePersonaStoreSchema.safeParse(value);
  if (!parsed.success) return { status: "corrupt", raw, reason: "shape" };
  return { status: "ok", store: parsed.data, raw };
}

/** 写入整个库。坏档/版本未知拒绝覆盖；revision 冲突返回 conflict；超限 invalid；配额 quota。 */
export function writeLovePersonaStore(store: LovePersonaStore, expectedRevision?: number): LovePersonaWrite {
  const ls = storage();
  if (!ls) return { ok: false, reason: "unavailable" };

  const disk = readLovePersonaStore();
  if (disk.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (disk.status === "corrupt" || disk.status === "incompatible") return { ok: false, reason: "invalid" };

  const diskRevision = disk.status === "ok" ? disk.store.revision : 0;
  if (expectedRevision !== undefined && expectedRevision !== diskRevision) {
    return { ok: false, reason: "conflict", diskRevision };
  }

  const parsed = LovePersonaStoreSchema.safeParse(store);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const next = parsed.data;

  for (const persona of Object.values(next.personas)) {
    const raw = serialize(persona);
    if (raw === null || byteLength(raw) > LOVE_PERSONA_SERIALIZED_MAX_BYTES) return { ok: false, reason: "invalid" };
  }

  const writable: LovePersonaStore = {
    ...next,
    revision: Math.max(diskRevision, expectedRevision ?? diskRevision) + 1,
    updatedAt: Date.now(),
  };
  const raw = serialize(writable);
  if (raw === null || byteLength(raw) > LOVE_PERSONA_STORE_MAX_BYTES) return { ok: false, reason: "invalid" };

  try {
    ls.setItem(LOVE_PERSONA_KEY, raw);
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable" };
  }
  notifyLoveSlotsChanged(LOVE_PERSONA_KEY);
  return { ok: true, store: writable, warnings: [] };
}

/** 回合级写入的公共前置：损坏/版本未知拒绝覆盖，存储不可用原样返回。 */
function loadForWrite(): { ok: true; store: LovePersonaStore } | { ok: false; result: LovePersonaFailure } {
  const read = readLovePersonaStore();
  if (read.status === "unavailable") return { ok: false, result: { ok: false, reason: "unavailable" } };
  if (read.status === "corrupt" || read.status === "incompatible") return { ok: false, result: { ok: false, reason: "invalid" } };
  return { ok: true, store: read.status === "ok" ? read.store : emptyLovePersonaStore() };
}

/** 单张资产超上限、或整库资产超总预算时，丢弃超限项并点名。 */
function acceptIncomingAssets(
  store: LovePersonaStore,
  personaId: string,
  incoming: Record<string, string>,
): { accepted: Record<string, string>; dropped: string[] } {
  const dropped: string[] = [];
  let used = 0;
  for (const [pid, group] of Object.entries(store.assets ?? {})) {
    if (pid === personaId) continue;
    for (const value of Object.values(group)) used += byteLength(value);
  }
  const kept: Record<string, string> = {};
  for (const [id, value] of Object.entries(incoming)) {
    if (byteLength(value) > LOVE_PERSONA_STORE_ASSET_MAX_BYTES) {
      dropped.push(id);
      continue;
    }
    kept[id] = value;
  }
  const accepted: Record<string, string> = {};
  // 大的先算：总预算不够时优先丢掉最占地方的资产。
  for (const [id, value] of Object.entries(kept).sort((a, b) => byteLength(b[1]) - byteLength(a[1]))) {
    if (used + byteLength(value) > LOVE_PERSONA_STORE_ASSETS_TOTAL_MAX_BYTES) {
      dropped.push(id);
      continue;
    }
    used += byteLength(value);
    accepted[id] = value;
  }
  return { accepted, dropped };
}

export interface LovePersonaUpsertOptions {
  expectedRevision?: number;
  /** 可选：随人设一起写入的资产（data URL）；超预算会被裁剪并回报。 */
  assets?: Record<string, string>;
}

/**
 * 新增或覆盖一份 Persona。id 是唯一键：同 id 覆盖并递增 `persona.revision`（内容版本），
 * 不改 `createdAt`。资产按预算裁剪，被丢的资产在 `warnings` 里点名。
 */
export function upsertLovePersona(persona: Persona, opts: LovePersonaUpsertOptions = {}): LovePersonaWrite {
  const parsed = parsePersona(persona);
  if (!parsed.ok) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const id = parsed.persona.id;
  const prev = current.store.personas[id];
  const next: Persona = {
    ...parsed.persona,
    revision: prev ? Math.max(prev.revision, parsed.persona.revision) + 1 : Math.max(1, parsed.persona.revision),
    createdAt: prev ? prev.createdAt : parsed.persona.createdAt,
    updatedAt: Date.now(),
  };

  const { accepted, dropped } = opts.assets ? acceptIncomingAssets(current.store, id, opts.assets) : { accepted: {}, dropped: [] };

  const personas = { ...current.store.personas, [id]: next };
  const nextAssets = { ...(current.store.assets ?? {}) };
  if (Object.keys(accepted).length) nextAssets[id] = accepted;
  else delete nextAssets[id];
  const assets = Object.keys(nextAssets).length ? nextAssets : undefined;

  const result = writeLovePersonaStore(
    assets ? { ...current.store, personas, assets } : { ...current.store, personas },
    opts.expectedRevision,
  );
  if (!result.ok) return result;
  const warnings: LovePersonaStoreWarning[] = dropped.length ? [{ code: "assets-dropped", dropped }] : [];
  return { ...result, warnings };
}

/**
 * 删除一份 Persona。返回关联故事/关系档案的报告供 UI 提示（§5）——**不代删**任何别的东西。
 */
export function deleteLovePersona(id: string, expectedRevision?: number): LovePersonaDelete {
  if (!id) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const existing = current.store.personas[id];
  const links = existing ? findPersonaLinkReport(existing) : { seriesIds: [], scenarioIds: [] };

  const personas = { ...current.store.personas };
  delete personas[id];
  const nextAssets = { ...(current.store.assets ?? {}) };
  delete nextAssets[id];
  const assets = Object.keys(nextAssets).length ? nextAssets : undefined;
  const activePlayerId = current.store.activePlayerId === id ? undefined : current.store.activePlayerId;

  const next: LovePersonaStore = { ...current.store, personas, ...(assets ? { assets } : { assets: undefined }), activePlayerId };
  const result = writeLovePersonaStore(next, expectedRevision);
  if (!result.ok) return result;
  return { ok: true, store: result.store, links };
}

/** 按 kind 列出人设；读不到（损坏/不可用）返回空数组，不抛错。 */
export function listLovePersonas(kind?: PersonaKind): Persona[] {
  const read = readLovePersonaStore();
  if (read.status !== "ok") return [];
  const all = Object.values(read.store.personas);
  const filtered = kind ? all.filter((p) => p.kind === kind) : all;
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getLovePersona(id: string): Persona | null {
  const read = readLovePersonaStore();
  if (read.status !== "ok") return null;
  return read.store.personas[id] ?? null;
}

/** 设置当前玩家 persona；id 必须指向一份 player。 */
export function setActivePlayer(id: string, expectedRevision?: number): LovePersonaWrite {
  if (!id) return { ok: false, reason: "invalid" };
  const current = loadForWrite();
  if (!current.ok) return current.result;
  if (current.store.personas[id]?.kind !== "player") return { ok: false, reason: "invalid" };
  return writeLovePersonaStore({ ...current.store, activePlayerId: id }, expectedRevision);
}

/* ------------------------------------------------------------------ *
 * 关联报告（只读，绝不触碰教练档案）
 * ------------------------------------------------------------------ */

/** 从人设自身的身份键推出候选：id、跨系统包身份、characterKey 的线部分。 */
function personaCandidateKeys(persona: Persona): Set<string> {
  const keys = new Set<string>([persona.id]);
  if (persona.characterPackId) keys.add(persona.characterPackId);
  if (persona.characterKey) {
    const sep = persona.characterKey.indexOf(":");
    if (sep > 0) keys.add(persona.characterKey.slice(0, sep));
  }
  return keys;
}

/** 扫描恋爱域的已存进度，列出引用了这份人设的线与场景（只读，用于删除前提示）。 */
export function findPersonaLinkReport(persona: Persona): LovePersonaLinkReport {
  const candidates = personaCandidateKeys(persona);
  const seriesIds = new Set<string>();
  const scenarioIds = new Set<string>();

  const collectSave = (save: { seriesId?: string | null; scenarioId?: string }) => {
    if (save.seriesId && candidates.has(save.seriesId)) seriesIds.add(save.seriesId);
    if (save.scenarioId && candidates.has(save.scenarioId)) scenarioIds.add(save.scenarioId);
  };

  const story = readLoveStoryStore();
  if (story.status === "ok") {
    for (const [key, save] of Object.entries(story.store.saves)) {
      scenarioIds.add(key);
      collectSave(save);
    }
    for (const record of story.store.records) collectSave(record);
    for (const key of Object.keys(story.store.slots)) scenarioIds.add(key);
  }

  const ls = storage();
  if (ls) {
    const prefix = `${LOVE_PLAY_PREFIX}series.`;
    try {
      const store = ls as unknown as { length: number; key(index: number): string | null };
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.startsWith(prefix) && candidates.has(key.slice(prefix.length))) seriesIds.add(key.slice(prefix.length));
      }
    } catch {
      // 读不到 key 列表就只报 story 里能确认的部分，不抛错。
    }
  }

  // scenarios 里最后只保留真正被候选命中的（上面 add(key) 的键本就在候选集里时不加）。
  for (const id of scenarioIds) {
    if (!candidates.has(id)) scenarioIds.delete(id);
  }
  return { seriesIds: [...seriesIds].sort(), scenarioIds: [...scenarioIds].sort() };
}

/* ------------------------------------------------------------------ *
 * 复制到教练档案（纯构建 + 显式确认；本模块不读写 socialcoach.v1）
 * ------------------------------------------------------------------ */

/**
 * 纯构建：只产出要合并进教练 profile 的字段。没有诚实对应的字段一律不填
 * （goals/contexts/createdAt 都不在恋爱 persona 里，不凭空造）。
 */
export function buildCoachProfilePatch(persona: Persona): LoveCoachProfilePatch {
  if (persona.kind !== "player") return {};
  const lang: Lang = persona.language === "en" ? "en" : "zh";
  const patch: LoveCoachProfilePatch = {};
  const name = preferLanguage(persona.name, lang).trim();
  if (name) patch.name = name;
  if (persona.bio) {
    const bio = preferLanguage(persona.bio, lang).trim();
    if (bio) patch.bio = bio;
  }
  if (persona.language === "zh" || persona.language === "en") patch.lang = persona.language;
  return patch;
}

export type LovePersonaCoachCopy =
  | { ok: true; patch: LoveCoachProfilePatch }
  | { ok: false; code: "not-confirmed" | "not-player" | "empty" };

/**
 * 用户确认后的显式复制。**本模块不写教练档案**：`apply` 由 UI 提供（通常是
 * `useApp.updateProfile`），只有 `confirmed === true` 才会调用它，杜绝自动双向同步（§7）。
 */
export function copyLovePersonaToCoachProfile(
  persona: Persona,
  opts: { confirmed: boolean; apply: (patch: LoveCoachProfilePatch) => void },
): LovePersonaCoachCopy {
  if (!opts.confirmed) return { ok: false, code: "not-confirmed" };
  if (persona.kind !== "player") return { ok: false, code: "not-player" };
  const patch = buildCoachProfilePatch(persona);
  if (!Object.keys(patch).length) return { ok: false, code: "empty" };
  opts.apply(patch);
  return { ok: true, patch };
}

/* ------------------------------------------------------------------ *
 * 编辑草稿（sessionStorage：刷新可续，不进导出）
 * ------------------------------------------------------------------ */

export interface LovePersonaDraft {
  kind: PersonaKind;
  persona: Persona;
  /** 编辑器自己的额外状态（未校验）；草稿只为刷新恢复，不参与入库。 */
  editor?: unknown;
  updatedAt: number;
}

/** 写入草稿；返回是否真的写成功（隐私模式下 sessionStorage 可能不可用）。 */
export function savePersonaDraft(draft: LovePersonaDraft): boolean {
  const ss = sessionStore();
  if (!ss) return false;
  try {
    ss.setItem(LOVE_PERSONA_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** 读取草稿；坏数据 / 认不出的 persona 一律返回 null，永不抛错。 */
export function readPersonaDraft(): LovePersonaDraft | null {
  const ss = sessionStore();
  if (!ss) return null;
  let raw: string | null;
  try {
    raw = ss.getItem(LOVE_PERSONA_DRAFT_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<LovePersonaDraft>;
  const parsed = parsePersona(record.persona);
  if (!parsed.ok) return null;
  if (record.kind !== "player" && record.kind !== "npc") return null;
  const draft: LovePersonaDraft = {
    kind: record.kind,
    persona: parsed.persona,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : parsed.persona.updatedAt,
  };
  if ("editor" in record) draft.editor = record.editor;
  return draft;
}

export function clearPersonaDraft(): void {
  const ss = sessionStore();
  if (!ss) return;
  try {
    ss.removeItem(LOVE_PERSONA_DRAFT_KEY);
  } catch {
    return;
  }
}