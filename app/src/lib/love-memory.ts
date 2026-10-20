import { z } from "zod";
import type { Lang } from "@/data/taxonomy";
import type { ChatMessage } from "./types";
import { uid } from "./format";
import { LOVE_PLAY_PREFIX, readLoveCarries, type LoveCarry } from "./love-carry-store";
import { notifyLoveSlotsChanged } from "./love-slot-events";
import { readLoveStoryStore, type LovePlaySave } from "./love-story";
import type { RioRelationshipState } from "./love-relationship-state";

/**
 * 陪伴层的设备端记忆档案（spec-love-interactive-story §4.4「记忆档案」）。
 *
 * 单 slot：`socialcoach.love-play.memory`，按 `seriesId:characterKey` 分组。作用域纪律是硬约束：
 * 跨线、跨 NPC 一律不可见——换人的线里让另一个角色「记得」，是对「谁在说话」的假话。
 *
 * 原文是唯一真相：每条记忆快照 `sourceText`（学习者逐字原话 / 承诺原话 / 作者拍点文本）。
 * sourceText 在 story slot 的 learner 台词与 carry 承诺文本里都找不到时，条目标记 `invalid`：
 * 不喂提示、不计数，仅留审计，用户可手动删。「编辑即确认」落在整理行为上——用户改过的 text
 * 永远不会被整理改写；sourceText 仍在，原文消失时同样失效（spec §4.4「不保留无源记忆」）。
 *
 * 抽取是纯函数、零模型调用（`collectLoveMemoryDrafts`）：来源只有已确认的 carry 承诺、
 * 学习者自己打的台词（via=type，点选项不是学习者的表达）与 Rio 账本里学习者立下的边界。
 * 时机 = 一幕收束（PlayScene 收尾处）或用户点「整理这段记忆」；抽取失败不影响剧情。
 *
 * 读取永不抛错：坏 JSON / 形状不对 / 版本未知都保留 raw，不静默当空；写入带 revision，
 * 期望值与磁盘不一致返回 conflict；坏档一律拒绝覆盖——口径与 `love-story.ts` 一致。
 */

export const LOVE_MEMORY_KEY = `${LOVE_PLAY_PREFIX}memory`;
export const LOVE_MEMORY_VERSION = 1;
/** 单条记忆的长度上限（与 carry 原话共用一个量级；超长原话不记，裁剪会破坏「逐字」）。 */
export const LOVE_MEMORY_TEXT_MAX = 500;
/** 每个作用域（一条线 × 一个角色）的条目上限。 */
export const LOVE_MEMORY_SCOPE_MAX = 40;
/** 整个记忆 slot 的条目上限。 */
export const LOVE_MEMORY_TOTAL_MAX = 200;
/** 单条序列化上限的字节量级；超限整个写入拒绝，与 story slot 同口径。 */
const LOVE_MEMORY_STORE_MAX_BYTES = 512 * 1024;
/** 回归开场的「离开」门槛：不足一天不算回归，只影响一句开场，不做 streak、不做惩罚。 */
export const LOVE_RETURN_MIN_AWAY_MS = 24 * 60 * 60 * 1000;

export type LoveMemoryKind = "fact" | "preference" | "promise" | "boundary" | "event";

export interface LoveMemoryEntry {
  id: string;
  kind: LoveMemoryKind;
  /** 记忆内容；用户可编辑。整理永远不覆盖已存在的条目（locked 与否都一样）。 */
  text: string;
  /** 原文快照：记忆的唯一真相。 */
  sourceText: string;
  /** 证据指针：history 里的消息 id，或 `carry:<id>` / `beat:<id>` 这样的跨存储指针。 */
  sourceMessageIds: string[];
  seriesId: string;
  characterKey: string;
  createdAt: number;
  updatedAt: number;
  locked: boolean;
  /** 原文已删除：不喂提示、不计数，仅留审计。 */
  invalid?: boolean;
}

export interface LoveMemoryStore {
  v: 1;
  revision: number;
  /** 按 `seriesId:characterKey` 分组。 */
  entries: Record<string, LoveMemoryEntry[]>;
  updatedAt: number;
}

export type LoveMemoryRead =
  | { status: "empty" }
  | { status: "ok"; store: LoveMemoryStore; raw: string }
  | { status: "corrupt"; raw: string }
  | { status: "incompatible"; raw: string }
  | { status: "unavailable" };

export type LoveMemoryWrite =
  | { ok: true; store: LoveMemoryStore; /** 本次整理新记下的条数（仅 integrate 有意义）。 */ added: number; changed: boolean }
  | { ok: false; reason: "conflict" | "quota" | "unavailable" | "invalid"; diskRevision?: number };

const kindSchema = z.enum(["fact", "preference", "promise", "boundary", "event"]);

const entrySchema = z.object({
  id: z.string().min(1).max(100),
  kind: kindSchema,
  text: z.string().min(1).max(LOVE_MEMORY_TEXT_MAX),
  sourceText: z.string().min(1).max(LOVE_MEMORY_TEXT_MAX),
  sourceMessageIds: z.array(z.string().min(1).max(200)).max(8),
  seriesId: z.string().min(1).max(100),
  characterKey: z.string().min(1).max(100),
  createdAt: z.number(),
  updatedAt: z.number(),
  locked: z.boolean(),
  invalid: z.boolean().optional(),
});

export const LoveMemoryStoreSchema: z.ZodType<LoveMemoryStore> = z
  .object({
    v: z.literal(LOVE_MEMORY_VERSION),
    revision: z.number().int().nonnegative(),
    entries: z.record(z.string().max(240), z.array(entrySchema).max(LOVE_MEMORY_SCOPE_MAX)),
    updatedAt: z.number(),
  })
  .superRefine((store, ctx) => {
    const total = Object.values(store.entries).reduce((n, list) => n + list.length, 0);
    if (total > LOVE_MEMORY_TOTAL_MAX) {
      ctx.addIssue({ code: "custom", path: ["entries"], message: "too many memories" });
    }
  });

export const loveMemoryScopeKey = (seriesId: string, characterKey: string): string => `${seriesId}:${characterKey}`;

export function emptyLoveMemoryStore(): LoveMemoryStore {
  return { v: LOVE_MEMORY_VERSION, revision: 0, entries: {}, updatedAt: 0 };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== "function" || typeof ls.setItem !== "function") return null;
    return ls;
  } catch {
    return null;
  }
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

function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

/** 读取整个记忆 slot；无 key = empty，坏数据保留 raw，永不抛错。 */
export function readLoveMemoryStore(): LoveMemoryRead {
  const ls = storage();
  if (!ls) return { status: "unavailable" };

  let raw: string | null | undefined;
  try {
    raw = ls.getItem(LOVE_MEMORY_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw == null) return { status: "empty" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "corrupt", raw };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = (value as { v?: unknown }).v;
    if (v !== LOVE_MEMORY_VERSION) return { status: "incompatible", raw };
  }
  const parsed = LoveMemoryStoreSchema.safeParse(value);
  if (!parsed.success) return { status: "corrupt", raw };
  return { status: "ok", store: parsed.data, raw };
}

/**
 * 写入整个记忆 slot。坏档 / 版本未知：拒绝并保留原始字节；
 * `expectedRevision` 不一致：conflict；形状或上限不合法：invalid；配额：quota。
 * 成功时 revision = max(diskRevision, expectedRevision ?? diskRevision) + 1，并通知订阅者。
 */
export function writeLoveMemoryStore(store: LoveMemoryStore, expectedRevision?: number): LoveMemoryWrite {
  const ls = storage();
  if (!ls) return { ok: false, reason: "unavailable" };

  const disk = readLoveMemoryStore();
  if (disk.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (disk.status === "corrupt" || disk.status === "incompatible") return { ok: false, reason: "invalid" };

  const diskRevision = disk.status === "ok" ? disk.store.revision : 0;
  if (expectedRevision !== undefined && expectedRevision !== diskRevision) {
    return { ok: false, reason: "conflict", diskRevision };
  }

  const parsed = LoveMemoryStoreSchema.safeParse(store);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const writable: LoveMemoryStore = {
    ...parsed.data,
    revision: Math.max(diskRevision, expectedRevision ?? diskRevision) + 1,
    updatedAt: Date.now(),
  };
  const raw = serialize(writable);
  if (raw === null || byteLength(raw) > LOVE_MEMORY_STORE_MAX_BYTES) return { ok: false, reason: "invalid" };

  try {
    ls.setItem(LOVE_MEMORY_KEY, raw);
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable" };
  }
  notifyLoveSlotsChanged(LOVE_MEMORY_KEY);
  return { ok: true, store: writable, added: 0, changed: true };
}

/** 显式恢复入口：只给用户在恢复 UI 里主动确认后调用；读失败时不要自动清 slot。 */
export function clearLoveMemorySlot(): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(LOVE_MEMORY_KEY);
  } catch {
    return;
  }
  notifyLoveSlotsChanged(LOVE_MEMORY_KEY);
}

/* ------------------------------------------------------------------ *
 * 原文在场检查（invalid 的唯一依据）
 * ------------------------------------------------------------------ */

/** 一条线在两处存储里的全部已确认学习者文本：story save 的 learner 行 + carry 承诺原话。 */
export interface LoveMemorySources {
  learner: Set<string>;
  carry: Set<string>;
}

function learnerTextsOfSeries(seriesId: string): Set<string> {
  const out = new Set<string>();
  const read = readLoveStoryStore();
  if (read.status !== "ok") return out;
  const collect = (save: LovePlaySave) => {
    if (save.seriesId !== seriesId) return;
    for (const line of save.learnerLines) if (line.text) out.add(line.text);
    for (const m of save.history) if (m.role === "learner" && m.text) out.add(m.text);
  };
  for (const save of Object.values(read.store.saves)) collect(save);
  for (const slots of Object.values(read.store.slots)) {
    for (const save of Object.values(slots)) if (save) collect(save);
  }
  return out;
}

function carryTextsOfScope(seriesId: string, characterKey: string): Set<string> {
  const out = new Set<string>();
  for (const c of readLoveCarries()) {
    if (c.seriesId === seriesId && c.npcId === characterKey) out.add(c.text);
  }
  return out;
}

export function readLoveMemorySources(seriesId: string, characterKey: string): LoveMemorySources {
  return { learner: learnerTextsOfSeries(seriesId), carry: carryTextsOfScope(seriesId, characterKey) };
}

export function isLoveMemorySourced(entry: Pick<LoveMemoryEntry, "sourceText">, sources: LoveMemorySources): boolean {
  return sources.learner.has(entry.sourceText) || sources.carry.has(entry.sourceText);
}

function stripInvalidFlag(entry: LoveMemoryEntry): LoveMemoryEntry {
  if (entry.invalid === undefined) return entry;
  const rest = { ...entry };
  delete rest.invalid;
  return rest;
}

/**
 * 读取一个作用域的记忆，`invalid` 按当前存储现场重新判定（不信任盘上的旧标记）。
 * 顺序保持写入顺序；面板与提示装配都在这上面工作。
 */
export function resolveLoveMemoriesForScope(seriesId: string, characterKey: string): LoveMemoryEntry[] {
  const read = readLoveMemoryStore();
  if (read.status !== "ok") return [];
  const list = read.store.entries[loveMemoryScopeKey(seriesId, characterKey)] ?? [];
  if (!list.length) return [];
  const sources = readLoveMemorySources(seriesId, characterKey);
  return list.map((entry) =>
    isLoveMemorySourced(entry, sources) ? stripInvalidFlag(entry) : entry.invalid ? entry : { ...entry, invalid: true },
  );
}

/** 全量重算 invalid 并落盘（给「整理」与导出前的对齐用）；没有变化就不写。 */
export function refreshLoveMemoryValidity(expectedRevision?: number): LoveMemoryWrite {
  const read = readLoveMemoryStore();
  if (read.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (read.status === "corrupt" || read.status === "incompatible") return { ok: false, reason: "invalid" };
  if (read.status !== "ok") return { ok: true, store: emptyLoveMemoryStore(), added: 0, changed: false };
  const { entries, changed } = refreshStoreEntries(read.store.entries);
  if (!changed) return { ok: true, store: read.store, added: 0, changed: false };
  return writeLoveMemoryStore({ ...read.store, entries }, expectedRevision);
}

function refreshStoreEntries(entries: Record<string, LoveMemoryEntry[]>): {
  entries: Record<string, LoveMemoryEntry[]>;
  changed: boolean;
} {
  const learnerCache = new Map<string, Set<string>>();
  const carryCache = new Map<string, Set<string>>();
  let changed = false;
  const out: Record<string, LoveMemoryEntry[]> = {};
  for (const [key, list] of Object.entries(entries)) {
    const sep = key.lastIndexOf(":");
    const seriesId = sep > 0 ? key.slice(0, sep) : key;
    const characterKey = sep > 0 ? key.slice(sep + 1) : "";
    if (!learnerCache.has(seriesId)) learnerCache.set(seriesId, learnerTextsOfSeries(seriesId));
    if (!carryCache.has(key)) carryCache.set(key, carryTextsOfScope(seriesId, characterKey));
    const learner = learnerCache.get(seriesId)!;
    const carry = carryCache.get(key)!;
    out[key] = list.map((entry) => {
      const valid = learner.has(entry.sourceText) || carry.has(entry.sourceText);
      if (valid) {
        if (entry.invalid === undefined) return entry;
        changed = true;
        return stripInvalidFlag(entry);
      }
      if (entry.invalid) return entry;
      changed = true;
      return { ...entry, invalid: true };
    });
  }
  return { entries: out, changed };
}

/* ------------------------------------------------------------------ *
 * 抽取（纯函数，零模型调用）
 * ------------------------------------------------------------------ */

export interface LoveMemoryDraft {
  kind: LoveMemoryKind;
  text: string;
  sourceText: string;
  sourceMessageIds: string[];
}

/** `dropped` 是学习者喊停的那句，不再翻出来；pending/open 还欠着，kept 已经办完但仍是关系事实。 */
const CARRY_PROMISE_STATES = new Set(["pending", "open", "kept"]);

/**
 * 从已确认的事实里收出这一趟要记的草稿。同一原文只记一条（先承诺、再边界、后事实），
 * 超长或空白的原文直接跳过——裁剪会破坏「逐字」，拒绝比改写诚实。
 */
export function collectLoveMemoryDrafts(input: {
  seriesId: string;
  characterKey: string;
  quotes: readonly { id: string; text: string }[];
  boundaries?: readonly { id: string; text: string }[];
  carries: readonly Pick<LoveCarry, "id" | "text" | "seriesId" | "npcId" | "state">[];
}): LoveMemoryDraft[] {
  const drafts: LoveMemoryDraft[] = [];
  const seenText = new Set<string>();
  const push = (kind: LoveMemoryKind, text: string, sourceMessageIds: string[]) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > LOVE_MEMORY_TEXT_MAX || seenText.has(trimmed)) return;
    seenText.add(trimmed);
    drafts.push({ kind, text: trimmed, sourceText: trimmed, sourceMessageIds });
  };
  for (const carry of input.carries) {
    if (carry.seriesId !== input.seriesId || carry.npcId !== input.characterKey) continue;
    if (!CARRY_PROMISE_STATES.has(carry.state)) continue;
    push("promise", carry.text, [`carry:${carry.id}`]);
  }
  for (const boundary of input.boundaries ?? []) {
    push("boundary", boundary.text, [`beat:${boundary.id}`]);
  }
  for (const quote of input.quotes) {
    push("fact", quote.text, [quote.id]);
  }
  return drafts;
}

/**
 * 本幕「自己打出来的」学习者发言（带消息 id）：learnerLines 里 via=type 的句子按发生顺序
 * 对回 history，拿到稳定的消息 id——每条记忆都必须有 `sourceMessageIds`。
 * 与 `fitLearnerLines` 同一条顺序匹配纪律：没说过的句子不会出现在这里。
 */
export function loveMemoryQuoteSources(
  history: readonly ChatMessage[],
  learnerLines: readonly { via: "pick" | "type"; text: string }[],
): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  let cursor = 0;
  for (const line of learnerLines) {
    if (line.via !== "type") continue;
    for (let j = cursor; j < history.length; j++) {
      const m = history[j];
      if (m.role === "learner" && m.text === line.text) {
        out.push({ id: m.id, text: line.text });
        cursor = j + 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Rio 账本里学习者立下的边界（逐字文本，按当前剧情语言取）：只认学习者一侧、
 * 没有撤回的边界；证据是选项时用作者拍点原文，是原话时查账本里的学习者语录。
 */
export function loveMemoryBoundaryTexts(
  snapshot: { rio: RioRelationshipState } | null | undefined,
  lang: Lang,
): { id: string; text: string }[] {
  if (!snapshot) return [];
  const quotes = new Map(snapshot.rio.quotes.map((q) => [q.id, q]));
  const out: { id: string; text: string }[] = [];
  for (const boundary of snapshot.rio.boundaries) {
    if (boundary.by !== "learner" || boundary.status === "withdrawn") continue;
    let text: string | null = null;
    if (boundary.evidence.kind === "option") text = boundary.evidence.text[lang];
    else if (boundary.evidence.kind === "quote") {
      const quote = quotes.get(boundary.evidence.quoteId);
      text = quote && quote.speaker === "learner" ? quote.text : null;
    }
    if (text && text.trim()) out.push({ id: boundary.id, text: text.trim() });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 写入侧：整理 / 编辑 / 锁定 / 删除
 * ------------------------------------------------------------------ */

function pruneScopeList(list: LoveMemoryEntry[]): LoveMemoryEntry[] {
  if (list.length <= LOVE_MEMORY_SCOPE_MAX) return list;
  const droppable = list
    .filter((e) => !e.locked)
    .sort((a, b) => Number(!!a.invalid) - Number(!!b.invalid) || a.updatedAt - b.updatedAt);
  const drop = new Set<string>();
  for (const e of droppable) {
    if (list.length - drop.size <= LOVE_MEMORY_SCOPE_MAX) break;
    drop.add(e.id);
  }
  // 全是锁定条目时挤不回去：原样交由写入校验拒绝，绝不删锁定的记忆腾地方。
  if (list.length - drop.size > LOVE_MEMORY_SCOPE_MAX) return list;
  return list.filter((e) => !drop.has(e.id));
}

function pruneStoreEntries(entries: Record<string, LoveMemoryEntry[]>): Record<string, LoveMemoryEntry[]> {
  const pruned: Record<string, LoveMemoryEntry[]> = {};
  for (const [key, list] of Object.entries(entries)) pruned[key] = pruneScopeList(list);
  const total = Object.values(pruned).reduce((n, l) => n + l.length, 0);
  if (total <= LOVE_MEMORY_TOTAL_MAX) return pruned;
  const flat = Object.entries(pruned).flatMap(([key, list]) => list.map((e) => ({ key, e })));
  flat.sort((a, b) => Number(!!a.e.invalid) - Number(!!b.e.invalid) || a.e.updatedAt - b.e.updatedAt);
  const drop = new Set<string>();
  for (const { e } of flat) {
    if (total - drop.size <= LOVE_MEMORY_TOTAL_MAX) break;
    if (e.locked) continue;
    drop.add(e.id);
  }
  if (drop.size) {
    for (const key of Object.keys(pruned)) pruned[key] = pruned[key].filter((e) => !drop.has(e.id));
  }
  return pruned;
}

/**
 * 整理（幕末收尾或用户点按钮）：抽取草稿并入对应作用域。同一原文已有条目就跳过——
 * 锁定条目与用户编辑过的内容都不会被覆盖（「编辑即确认」落在这里）。
 * 并入后全量重算 invalid；坏档拒绝、配额拒绝，抽取失败由调用方兜住，不阻塞剧情。
 */
export function integrateLoveMemories(input: {
  seriesId: string;
  scenarioId: string;
  characterKey: string;
  quotes: readonly { id: string; text: string }[];
  boundaries?: readonly { id: string; text: string }[];
  expectedRevision?: number;
}): LoveMemoryWrite {
  if (!input.seriesId || !input.characterKey) return { ok: false, reason: "invalid" };
  const read = readLoveMemoryStore();
  if (read.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (read.status === "corrupt" || read.status === "incompatible") return { ok: false, reason: "invalid" };
  const store = read.status === "ok" ? read.store : emptyLoveMemoryStore();

  const drafts = collectLoveMemoryDrafts({
    seriesId: input.seriesId,
    characterKey: input.characterKey,
    quotes: input.quotes,
    boundaries: input.boundaries ?? [],
    carries: readLoveCarries(),
  });

  const scopeKey = loveMemoryScopeKey(input.seriesId, input.characterKey);
  const next = [...(store.entries[scopeKey] ?? [])];
  const now = Date.now();
  let added = 0;
  for (const draft of drafts) {
    if (next.some((e) => e.sourceText === draft.sourceText)) continue;
    next.push({
      id: uid(),
      kind: draft.kind,
      text: draft.text,
      sourceText: draft.sourceText,
      sourceMessageIds: [...draft.sourceMessageIds],
      seriesId: input.seriesId,
      characterKey: input.characterKey,
      createdAt: now,
      updatedAt: now,
      locked: false,
    });
    added += 1;
  }

  const { entries: refreshed } = refreshStoreEntries({ ...store.entries, [scopeKey]: next });
  const result = writeLoveMemoryStore(
    { v: LOVE_MEMORY_VERSION, revision: store.revision, entries: pruneStoreEntries(refreshed), updatedAt: store.updatedAt },
    input.expectedRevision,
  );
  return result.ok ? { ...result, added } : result;
}

function mutateScope(
  seriesId: string,
  characterKey: string,
  expectedRevision: number | undefined,
  mutate: (list: LoveMemoryEntry[]) => LoveMemoryEntry[] | null,
): LoveMemoryWrite {
  const read = readLoveMemoryStore();
  if (read.status !== "ok") {
    return read.status === "unavailable"
      ? { ok: false, reason: "unavailable" }
      : { ok: false, reason: "invalid" };
  }
  const scopeKey = loveMemoryScopeKey(seriesId, characterKey);
  const next = mutate(read.store.entries[scopeKey] ?? []);
  if (!next) return { ok: false, reason: "invalid" };
  const entries = { ...read.store.entries };
  if (next.length) entries[scopeKey] = next;
  else delete entries[scopeKey];
  return writeLoveMemoryStore({ ...read.store, entries }, expectedRevision);
}

/** 用户编辑：以用户为准。text 改成什么都行，sourceText 不动（原文仍是审计依据）。 */
export function updateLoveMemoryText(input: {
  seriesId: string;
  characterKey: string;
  id: string;
  text: string;
  expectedRevision?: number;
}): LoveMemoryWrite {
  const text = input.text.trim();
  if (!input.seriesId || !input.characterKey || !input.id || !text || text.length > LOVE_MEMORY_TEXT_MAX) {
    return { ok: false, reason: "invalid" };
  }
  return mutateScope(input.seriesId, input.characterKey, input.expectedRevision, (list) => {
    const index = list.findIndex((e) => e.id === input.id);
    if (index < 0) return null;
    const next = [...list];
    next[index] = { ...list[index], text, updatedAt: Date.now() };
    return next;
  });
}

/** 锁定/解锁：锁定的条目不会被后续整理覆盖，也不会被挤出上限。不改 updatedAt（不是内容改动）。 */
export function setLoveMemoryLocked(input: {
  seriesId: string;
  characterKey: string;
  id: string;
  locked: boolean;
  expectedRevision?: number;
}): LoveMemoryWrite {
  if (!input.seriesId || !input.characterKey || !input.id) return { ok: false, reason: "invalid" };
  return mutateScope(input.seriesId, input.characterKey, input.expectedRevision, (list) => {
    const index = list.findIndex((e) => e.id === input.id);
    if (index < 0) return null;
    const next = [...list];
    next[index] = { ...list[index], locked: input.locked };
    return next;
  });
}

/** 手动删除（含失效条目）；删空整个作用域时连分组键一起移除。 */
export function deleteLoveMemoryEntry(input: {
  seriesId: string;
  characterKey: string;
  id: string;
  expectedRevision?: number;
}): LoveMemoryWrite {
  if (!input.seriesId || !input.characterKey || !input.id) return { ok: false, reason: "invalid" };
  return mutateScope(input.seriesId, input.characterKey, input.expectedRevision, (list) => {
    if (!list.some((e) => e.id === input.id)) return null;
    return list.filter((e) => e.id !== input.id);
  });
}

/* ------------------------------------------------------------------ *
 * 提示两层装配（纯函数）：core 最多 5 条 + archive 按关键词检索最多 6 条
 * ------------------------------------------------------------------ */

const CORE_MAX = 5;
const ARCHIVE_MAX = 6;
const KIND_TIER: Record<LoveMemoryKind, number> = { promise: 0, boundary: 1, preference: 2, fact: 3, event: 4 };
const KIND_TIER_MAX = Object.keys(KIND_TIER).length;

function carryIdOf(entry: LoveMemoryEntry): string | null {
  for (const id of entry.sourceMessageIds) {
    if (id.startsWith("carry:")) return id.slice("carry:".length);
  }
  return null;
}

/** 已兑现/了结的承诺退出核心层：再拿它当「未兑现」点名是在编造。查不到指针的旧档按未兑现对待。 */
function promiseStillOpen(entry: LoveMemoryEntry, openCarryIds: ReadonlySet<string> | undefined): boolean {
  const id = carryIdOf(entry);
  if (!id || !openCarryIds) return true;
  return openCarryIds.has(id);
}

export function buildLoveMemoryCore(
  entries: readonly LoveMemoryEntry[],
  openCarryIds?: ReadonlySet<string>,
): LoveMemoryEntry[] {
  const scored = entries
    .filter((e) => !e.invalid)
    .map((e) => ({
      e,
      tier: e.kind === "promise" && !promiseStillOpen(e, openCarryIds) ? KIND_TIER_MAX : KIND_TIER[e.kind],
    }));
  scored.sort(
    (a, b) =>
      a.tier - b.tier || Number(b.e.locked) - Number(a.e.locked) || b.e.updatedAt - a.e.updatedAt,
  );
  return scored.slice(0, CORE_MAX).map((s) => s.e);
}

/** 关键词分词：拉丁按整词，CJK 连写补二元组，命中记忆的 text 或原文。 */
export function loveMemoryQueryTokens(query: string): string[] {
  const out = new Set<string>();
  for (const run of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (run.length < 2) continue;
    out.add(run);
    if (run.length <= 24 && /[\u3400-\u9fff]/.test(run)) {
      for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
    }
  }
  return [...out].slice(0, 24);
}

export function buildLoveMemoryArchive(
  entries: readonly LoveMemoryEntry[],
  query: string,
  exclude: readonly LoveMemoryEntry[] = [],
): LoveMemoryEntry[] {
  const tokens = loveMemoryQueryTokens(query);
  if (!tokens.length) return [];
  const skip = new Set(exclude.map((e) => e.id));
  const hits = entries.filter(
    (e) =>
      !e.invalid &&
      !skip.has(e.id) &&
      tokens.some((token) => e.text.toLowerCase().includes(token) || e.sourceText.toLowerCase().includes(token)),
  );
  hits.sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt);
  return hits.slice(0, ARCHIVE_MAX);
}

function rowLabel(entry: LoveMemoryEntry, openCarryIds: ReadonlySet<string> | undefined, lang: Lang): string {
  if (entry.kind === "promise") {
    const id = carryIdOf(entry);
    if (!id || !openCarryIds) {
      return lang === "zh" ? "承诺 · 学习者的原话" : "A promise, in the learner's own words";
    }
    return openCarryIds.has(id)
      ? lang === "zh"
        ? "还没兑现的承诺 · 学习者的原话"
        : "An unfulfilled promise, in the learner's own words"
      : lang === "zh"
        ? "兑现过的承诺 · 学习者的原话"
        : "A promise already kept, in the learner's own words";
  }
  switch (entry.kind) {
    case "boundary":
      return lang === "zh" ? "学习者立下的边界" : "A boundary the learner set";
    case "preference":
      return lang === "zh" ? "学习者说过的偏好" : "A preference the learner stated";
    case "fact":
      return lang === "zh" ? "学习者说过的事实" : "Something the learner said";
    default:
      return lang === "zh" ? "发生过的事" : "Something that happened";
  }
}

export function buildLoveMemoryDigest(
  core: readonly LoveMemoryEntry[],
  archive: readonly LoveMemoryEntry[],
  openCarryIds: ReadonlySet<string> | undefined,
  lang: Lang,
): string | null {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const entry of [...core, ...archive]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    rows.push(
      lang === "zh"
        ? `- ${rowLabel(entry, openCarryIds, lang)}：「${entry.text}」`
        : `- ${rowLabel(entry, openCarryIds, lang)}: “${entry.text}”`,
    );
  }
  if (!rows.length) return null;
  const head =
    lang === "zh"
      ? "【对方还记得的事 · 只在自然的时候用来接话，不许编造新事实】"
      : "[What they still remember — use it to pick up the thread when it fits; never invent]";
  return `${head}\n${rows.join("\n")}`;
}

/** 两层装配的总入口：core + archive；一个作用域里没有可用的记忆时返回 null。 */
export function buildLoveMemoryPrompt(input: {
  seriesId: string;
  characterKey: string;
  lang: Lang;
  /** 检索关键词：调用方传学习者最近的一句原话。 */
  query: string;
  /** 还没兑现的 carry 承诺 id 集合；缺省时承诺一律按未兑现对待。 */
  openCarryIds?: ReadonlySet<string>;
}): string | null {
  const entries = resolveLoveMemoriesForScope(input.seriesId, input.characterKey);
  if (!entries.length) return null;
  const core = buildLoveMemoryCore(entries, input.openCarryIds);
  const archive = buildLoveMemoryArchive(entries, input.query, core);
  return buildLoveMemoryDigest(core, archive, input.openCarryIds, input.lang);
}

/**
 * 恋爱剧情请求的记忆注入：按 seriesId + characterKey 装配，插在开场白之后作为一条
 * `event` 旁白（模型把 event 行当已发生的背景读，不会当成任何人的台词）。
 * 没有记忆 / 不在线 / 存储异常时**原样返回同一个数组**——请求体逐字不变。
 */
export function withLoveMemoryTurnMessages(input: {
  seriesId: string | null;
  characterKey: string | null;
  lang: Lang;
  history: ChatMessage[];
}): ChatMessage[] {
  if (!input.seriesId || !input.characterKey || input.history.length === 0) return input.history;
  try {
    const openCarryIds = new Set(
      readLoveCarries()
        .filter((c) => c.state === "pending" || c.state === "open")
        .map((c) => c.id),
    );
    const query = [...input.history].reverse().find((m) => m.role === "learner")?.text ?? "";
    const digest = buildLoveMemoryPrompt({
      seriesId: input.seriesId,
      characterKey: input.characterKey,
      lang: input.lang,
      query,
      openCarryIds,
    });
    if (!digest) return input.history;
    const note: ChatMessage = { id: "love-memory-context", role: "event", text: digest, ts: input.history[0].ts };
    return [input.history[0], note, ...input.history.slice(1)];
  } catch {
    // 存储的任何意外都不许打断回合请求。
    return input.history;
  }
}

/* ------------------------------------------------------------------ *
 * 回归开场（零模型）：离开时长 + 只引用已确认的原话
 * ------------------------------------------------------------------ */

export interface LoveReturnOpening {
  /** 逐字引用：未兑现的承诺原话，或最近一条仍有效的学习者原话记忆。 */
  quote: string;
  awayMs: number;
}

/**
 * 剧情线入口页的回归开场素材（纯读）。离开时长取代码里能确认的那个时间戳：
 * 本线的 story save / record / 记忆条目 / carry 承诺里最新的 updatedAt。
 * 槽位纪律：没有已确认、仍然有效的原话就不显示；不足一天不算回归；
 * 兑现过的承诺不再当「还欠着」引用。不编造、不惩罚、不做 streak。
 */
export function loveReturnOpening(seriesId: string, now: number = Date.now()): LoveReturnOpening | null {
  if (!seriesId) return null;
  const carries = readLoveCarries().filter((c) => c.seriesId === seriesId);
  let last = 0;
  for (const c of carries) last = Math.max(last, c.updatedAt);

  const story = readLoveStoryStore();
  if (story.status === "ok") {
    for (const save of Object.values(story.store.saves)) {
      if (save.seriesId === seriesId) last = Math.max(last, save.updatedAt);
    }
    for (const record of story.store.records) {
      if (record.seriesId === seriesId) last = Math.max(last, record.endedAt);
    }
  }

  const memory = readLoveMemoryStore();
  const seriesEntries: LoveMemoryEntry[] = [];
  if (memory.status === "ok") {
    const prefix = `${seriesId}:`;
    for (const [key, list] of Object.entries(memory.store.entries)) {
      if (!key.startsWith(prefix)) continue;
      for (const entry of list) {
        last = Math.max(last, entry.updatedAt);
        seriesEntries.push(entry);
      }
    }
  }

  if (!last) return null;
  const awayMs = now - last;
  if (!Number.isFinite(awayMs) || awayMs < LOVE_RETURN_MIN_AWAY_MS) return null;

  const openCarryIds = new Set(
    carries.filter((c) => c.state === "pending" || c.state === "open").map((c) => c.id),
  );
  // 首选：还没兑现的承诺（carry 链是承诺的源头），取最近更新的一条。
  let quote: string | null = null;
  let at = -1;
  for (const c of carries) {
    if (c.state !== "pending" && c.state !== "open") continue;
    if (c.updatedAt >= at) {
      quote = c.text;
      at = c.updatedAt;
    }
  }
  if (!quote) {
    const sources = { learner: learnerTextsOfSeries(seriesId), carry: new Set(carries.map((c) => c.text)) };
    for (const entry of seriesEntries) {
      if (entry.kind !== "promise" && entry.kind !== "fact") continue;
      if (entry.kind === "promise" && !promiseStillOpen(entry, openCarryIds)) continue;
      if (!isLoveMemorySourced(entry, sources)) continue;
      if (entry.updatedAt > at) {
        quote = entry.text;
        at = entry.updatedAt;
      }
    }
  }
  if (!quote) return null;
  return { quote, awayMs };
}
