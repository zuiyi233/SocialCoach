import { z } from "zod";
import type { Lang } from "@/data/taxonomy";
import type { LovePlayEmotion, LovePlayOutcome } from "./love-play-client";
import { LOVE_PLAY_PREFIX } from "./love-carry-store";

/**
 * 恋爱 Galgame 的设备端存档（spec-love-galgame-foundation §3、§3.5）。
 *
 * 整个模式只有一个 slot：`socialcoach.love-play.story`。它落在 `LOVE_PLAY_PREFIX` 下，
 * 导出/擦除的前缀扫描自动覆盖；不按场景拆 key，跨标签页、恢复与清理都只有一套分支。
 *
 * 读取永不抛错：坏 JSON / 形状不对 / 版本未知都保留 raw 交给恢复 UI，不静默当空。
 * 写入带 revision：期望值与磁盘不一致时返回 conflict，不做静默的最后写入者覆盖。
 */

export const LOVE_STORY_KEY = `${LOVE_PLAY_PREFIX}story`;
export const LOVE_STORY_VERSION = 1;

export interface LovePlaySaveMessage {
  id: string;
  role: "npc" | "learner";
  characterId?: string;
  text: string;
  lang: Lang;
  ts: number;
}

export interface LovePlaySave {
  v: 1;
  scenarioId: string;
  seriesId: string | null;
  lang: Lang;
  status: "playing" | "ended";
  history: LovePlaySaveMessage[];
  currentLineId: string;
  options: { zh: string; en: string }[] | null;
  emotion: LovePlayEmotion;
  stance: number | null;
  carryover: boolean;
  learnerLines: { via: "pick" | "type"; text: string }[];
  outcome: LovePlayOutcome | null;
  endingId?: string | null;
  routeState?: unknown;
  recorded: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface LovePlayRecord {
  id: string;
  scenarioId: string;
  seriesId: string | null;
  outcome: LovePlayOutcome;
  endingId?: string | null;
  startedAt: number;
  endedAt: number;
  lang: Lang;
}

export interface LoveStoryStore {
  v: 1;
  revision: number;
  saves: Record<string, LovePlaySave>;
  records: LovePlayRecord[];
  routes: Record<string, unknown>;
  updatedAt: number;
}

export type LoveStoryRead =
  | { status: "empty" }
  | { status: "ok"; store: LoveStoryStore; raw: string }
  | { status: "corrupt"; raw: string; reason: "json" | "shape" }
  | { status: "incompatible"; raw: string }
  | { status: "unavailable" };

export type LoveStoryWrite =
  | { ok: true; store: LoveStoryStore }
  | { ok: false; reason: "conflict" | "quota" | "unavailable" | "invalid"; diskRevision?: number };

/** 单份存档的序列化上限（§3.4）。 */
const SAVE_MAX_BYTES = 512 * 1024;
/** 整个 story slot 的序列化上限（§3.4）。 */
const STORE_MAX_BYTES = 2 * 1024 * 1024;
const HISTORY_MAX = 40;
const LINE_MAX = 4000;
const OPTIONS_MAX = 4;
/** `records` 只留最近的 100 条，防止 63 场全部累积。 */
const RECORDS_MAX = 100;
/** 已结束场景的 save 只留最近 12 个；进行中的一律保留。 */
const ENDED_SAVES_MAX = 12;

const langSchema = z.enum(["zh", "en"]);
const emotionSchema = z.enum(["neutral", "smile", "tight", "teary"]);
const outcomeSchema = z.enum(["success", "partial", "failure"]);
const optionSchema = z.object({ zh: z.string().min(1).max(LINE_MAX), en: z.string().min(1).max(LINE_MAX) });

/** 单条台词只保存已经确认、已经显示过的原文；逐字，不翻译、不摘要。 */
const saveMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["npc", "learner"]),
  characterId: z.string().min(1).optional(),
  text: z.string().max(LINE_MAX),
  lang: langSchema,
  ts: z.number(),
});

/**
 * 一份幕内存档。除形状外还校验跨字段不变量：
 * - `currentLineId` 必须指向 history 里的 NPC 行（恢复后要能重新显示这一句）；
 * - `learnerLines` 必须按顺序能在 history 的 learner 行里找到（不得出现没说过的话）；
 * - playing = 没有结局、未记分、有 2–4 个选项；ended = 有结局、没有选项。
 *
 * `z.object` 默认 strip 未知字段：`proficiency` / `loveProficiency` / `stars` /
 * `practiceDays` 之类的分数字段即使被写进对象，也不会落盘。
 */
const saveShape = z.object({
  v: z.literal(LOVE_STORY_VERSION),
  scenarioId: z.string().min(1),
  seriesId: z.string().min(1).nullable(),
  lang: langSchema,
  status: z.enum(["playing", "ended"]),
  history: z.array(saveMessageSchema).max(HISTORY_MAX),
  currentLineId: z.string().min(1),
  options: z.array(optionSchema).max(OPTIONS_MAX).nullable(),
  emotion: emotionSchema,
  stance: z.number().nullable(),
  carryover: z.boolean(),
  learnerLines: z.array(z.object({ via: z.enum(["pick", "type"]), text: z.string().max(LINE_MAX) })),
  outcome: outcomeSchema.nullable(),
  endingId: z.string().nullable().optional(),
  routeState: z.unknown().optional(),
  recorded: z.boolean(),
  startedAt: z.number(),
  updatedAt: z.number(),
});

export const LovePlaySaveSchema: z.ZodType<LovePlaySave> = saveShape.superRefine((save, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

  if (!save.history.some((m) => m.id === save.currentLineId && m.role === "npc")) {
    issue(["currentLineId"], "currentLineId must point at an npc line in history");
  }

  // 按发生顺序匹配，而不是「历史里出现过」。未送达/未进入 history 的发言不得出现。
  let cursor = 0;
  for (let i = 0; i < save.learnerLines.length; i++) {
    const line = save.learnerLines[i];
    let found = -1;
    for (let j = cursor; j < save.history.length; j++) {
      const m = save.history[j];
      if (m.role === "learner" && m.text === line.text) {
        found = j;
        break;
      }
    }
    if (found < 0) {
      issue(["learnerLines", i, "text"], "learner line was not said in history, in order");
      break;
    }
    cursor = found + 1;
  }

  if (save.status === "playing") {
    if (save.outcome !== null) issue(["outcome"], "a playing save has no outcome");
    if (save.recorded) issue(["recorded"], "a playing save is not recorded yet");
    if (!save.options || save.options.length < 2 || save.options.length > OPTIONS_MAX) {
      issue(["options"], "a playing save has 2-4 options");
    }
  } else {
    if (save.outcome === null) issue(["outcome"], "an ended save needs an outcome");
    if (save.options !== null) issue(["options"], "an ended save has no options");
  }
});

const recordShape = z.object({
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  seriesId: z.string().min(1).nullable(),
  outcome: outcomeSchema,
  endingId: z.string().nullable().optional(),
  startedAt: z.number(),
  endedAt: z.number(),
  lang: langSchema,
});

export const LoveStoryStoreSchema: z.ZodType<LoveStoryStore> = z
  .object({
    v: z.literal(LOVE_STORY_VERSION),
    revision: z.number().int().nonnegative(),
    saves: z.record(z.string(), LovePlaySaveSchema),
    records: z.array(recordShape),
    routes: z.record(z.string(), z.unknown()),
    updatedAt: z.number(),
  })
  .superRefine((store, ctx) => {
    for (const [key, save] of Object.entries(store.saves)) {
      if (key !== save.scenarioId) {
        ctx.addIssue({ code: "custom", path: ["saves", key], message: "a save is keyed by its scenarioId" });
      }
    }
  });

export function emptyLoveStoryStore(): LoveStoryStore {
  return { v: LOVE_STORY_VERSION, revision: 0, saves: {}, records: [], routes: {}, updatedAt: 0 };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** 存储不可用（无 localStorage / 隐私模式 / 访问 getter 抛错）时返回 null，与读取同一口径。 */
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

/** 读取整个 story slot；无 key = empty，坏数据保留 raw，永不抛错。 */
export function readLoveStoryStore(): LoveStoryRead {
  const ls = storage();
  if (!ls) return { status: "unavailable" };

  let raw: string | null | undefined;
  try {
    raw = ls.getItem(LOVE_STORY_KEY);
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

  // 版本先判：v2+ 是「未来写的」，不是「写坏了」，恢复 UI 的文案与处理不同。
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = (value as { v?: unknown }).v;
    if (typeof v === "number" && v !== LOVE_STORY_VERSION) return { status: "incompatible", raw };
  }

  const parsed = LoveStoryStoreSchema.safeParse(value);
  if (!parsed.success) return { status: "corrupt", raw, reason: "shape" };
  return { status: "ok", store: parsed.data, raw };
}

/** 按场景读取一份存档；store 级损坏/版本不兼容原样透出，slot 为空或没有该场景都返回 empty。 */
export function readLovePlaySave(scenarioId: string): {
  status: "empty" | "ok" | "corrupt" | "incompatible" | "unavailable";
  save?: LovePlaySave;
  raw?: string;
} {
  const read = readLoveStoryStore();
  switch (read.status) {
    case "empty":
      return { status: "empty" };
    case "unavailable":
      return { status: "unavailable" };
    case "corrupt":
      return { status: "corrupt", raw: read.raw };
    case "incompatible":
      return { status: "incompatible", raw: read.raw };
    default: {
      const save = read.store.saves[scenarioId];
      return save ? { status: "ok", save, raw: read.raw } : { status: "empty" };
    }
  }
}

/** 只保留所有进行中的 save + 最近 12 个已结束的（按 updatedAt）。 */
function pruneStore(store: LoveStoryStore): LoveStoryStore {
  const entries = Object.entries(store.saves);
  const ended = entries
    .filter(([, save]) => save.status === "ended")
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const keep = new Set(ended.slice(Math.max(0, ended.length - ENDED_SAVES_MAX)).map(([key]) => key));
  const saves: Record<string, LovePlaySave> = {};
  for (const [key, save] of entries) {
    if (save.status === "playing" || keep.has(key)) saves[key] = save;
  }
  const records =
    store.records.length > RECORDS_MAX
      ? [...store.records].sort((a, b) => a.endedAt - b.endedAt).slice(-RECORDS_MAX)
      : store.records;
  return { ...store, saves, records };
}

/**
 * 写入整个 story slot。
 *
 * - 磁盘损坏/版本未知：拒绝写入并保留原始字节，不让正常回合静默覆盖恢复线索；
 * - `expectedRevision` 与磁盘不一致：conflict，附 diskRevision；
 * - 超过单 save / 整 store 的字节上限或任何字段不合法：invalid，磁盘原样保留；
 * - 配额失败：quota；存储不可用：unavailable。
 *
 * 成功时 revision = max(diskRevision, expectedRevision ?? diskRevision) + 1。
 * 写入前先做保留策略：playing 全留、ended 只留最近 12 个、records 只留最近 100 条。
 */
export function writeLoveStoryStore(store: LoveStoryStore, expectedRevision?: number): LoveStoryWrite {
  const ls = storage();
  if (!ls) return { ok: false, reason: "unavailable" };

  const disk = readLoveStoryStore();
  if (disk.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (disk.status === "corrupt" || disk.status === "incompatible") return { ok: false, reason: "invalid" };

  const diskRevision = disk.status === "ok" ? disk.store.revision : 0;
  if (expectedRevision !== undefined && expectedRevision !== diskRevision) {
    return { ok: false, reason: "conflict", diskRevision };
  }

  const parsed = LoveStoryStoreSchema.safeParse(store);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const next = pruneStore(parsed.data);
  for (const save of Object.values(next.saves)) {
    const raw = serialize(save);
    if (raw === null || byteLength(raw) > SAVE_MAX_BYTES) return { ok: false, reason: "invalid" };
  }

  const writable: LoveStoryStore = {
    ...next,
    revision: Math.max(diskRevision, expectedRevision ?? diskRevision) + 1,
    updatedAt: Date.now(),
  };
  const raw = serialize(writable);
  if (raw === null || byteLength(raw) > STORE_MAX_BYTES) return { ok: false, reason: "invalid" };

  try {
    ls.setItem(LOVE_STORY_KEY, raw);
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable" };
  }
  return { ok: true, store: writable };
}

type Loaded =
  | { ok: true; store: LoveStoryStore }
  | { ok: false; result: LoveStoryWrite };

/** 回合级写入的公共前置：损坏/版本未知时拒绝覆盖，存储不可用原样返回。 */
function loadForWrite(): Loaded {
  const read = readLoveStoryStore();
  if (read.status === "unavailable") return { ok: false, result: { ok: false, reason: "unavailable" } };
  if (read.status === "corrupt" || read.status === "incompatible") {
    return { ok: false, result: { ok: false, reason: "invalid" } };
  }
  return { ok: true, store: read.status === "ok" ? read.store : emptyLoveStoryStore() };
}

/** 保存（或覆盖）一场戏的幕内存档；key 永远是 save.scenarioId。 */
export function saveLovePlayScene(save: LovePlaySave, expectedRevision?: number): LoveStoryWrite {
  const parsed = LovePlaySaveSchema.safeParse(save);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const scene = parsed.data;
  return writeLoveStoryStore(
    { ...current.store, saves: { ...current.store.saves, [scene.scenarioId]: scene } },
    expectedRevision,
  );
}

/** 删除一场戏的存档（「重新开始本幕」先走这里）。幂等；冲突检查与其他写入一致。 */
export function deleteLovePlayScene(scenarioId: string, expectedRevision?: number): LoveStoryWrite {
  if (!scenarioId) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const saves = { ...current.store.saves };
  delete saves[scenarioId];
  return writeLoveStoryStore({ ...current.store, saves }, expectedRevision);
}

/** 追加一条已完成的恋爱记录。同 id 重放不新增；只保留最近 100 条。 */
export function appendLovePlayRecord(record: LovePlayRecord, expectedRevision?: number): LoveStoryWrite {
  const parsed = recordShape.safeParse(record);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const next = parsed.data;
  const records = [...current.store.records.filter((r) => r.id !== next.id), next];
  return writeLoveStoryStore({ ...current.store, records }, expectedRevision);
}

/** 同系列里最近更新的进行中存档；损坏/不可用一律返回 null，不抛错。 */
export function latestPlayingSaveForSeries(seriesId: string): LovePlaySave | null {
  const read = readLoveStoryStore();
  if (read.status !== "ok") return null;

  let latest: LovePlaySave | null = null;
  for (const save of Object.values(read.store.saves)) {
    if (save.status !== "playing" || save.seriesId !== seriesId) continue;
    if (!latest || save.updatedAt > latest.updatedAt) latest = save;
  }
  return latest;
}

export function hasLovePlaySave(scenarioId: string): boolean {
  return readLovePlaySave(scenarioId).status === "ok";
}

/**
 * 回想 / 转录的唯一投影：只取 history 的稳定 id、说话人与原文。
 * 选项、结局、hidden、routeState、时间戳都不在这里出现——回想不许剧透。
 */
export function buildLovePlayTranscript(
  save: LovePlaySave,
): { id: string; role: "npc" | "learner"; characterId?: string; text: string }[] {
  return save.history.map((m) =>
    m.characterId ? { id: m.id, role: m.role, characterId: m.characterId, text: m.text } : { id: m.id, role: m.role, text: m.text },
  );
}
