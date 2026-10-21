import { z } from "zod";
import { LOVE_PLAY_PREFIX } from "./love-carry-store";
import { notifyLoveSlotsChanged } from "./love-slot-events";
import { LoveRelationshipStateSchema, deriveStage, type LoveRelationshipState } from "./love-relationship";

/**
 * 关系档案（spec-love-bridge §3）。
 *
 * 单 slot：`socialcoach.love-play.archive`，落在 `LOVE_PLAY_PREFIX` 下，导出/擦除的前缀扫描
 * 自动覆盖。与 story slot 分开：story slot 只放对局存档与半教练关系状态，archive 只放
 * 「玩家 persona × 角色分支」的跨系统关系档案（人物快照、故事收藏、解锁图鉴）。
 *
 * 纪律逐条抄 `love-story.ts`：
 * - 读取永不抛错：坏 JSON / 形状不对 / 版本未知都保留 raw，不静默当空；
 * - 写入带 revision，期望值与磁盘不一致返回 conflict，不做静默覆盖；
 * - 坏档 / 版本未知拒绝覆盖（raw 是恢复界面的证据）；
 * - zod 严格校验，未知键 strip：任何能力分 / 星级 / 熟练度字段都不会落盘。
 *
 * 上限（spec §9）：stories ≤ 200、characters ≤ 100、unlocks 各数组写入前去重且 ≤ 500、
 * 整份序列化 ≤ 2 MB。超出返回 `quota` 且不动磁盘——「不截断用户已有内容」：数据满了
 * 是拒绝新写入，不是替用户删旧数据。若未来真要裁剪 stories，保留规则按 createdAt 取新。
 */

export const LOVE_ARCHIVE_KEY = `${LOVE_PLAY_PREFIX}archive`;
export const LOVE_ARCHIVE_VERSION = 1 as const;
/** stories 上限：超限写入返回 quota，不按「谁最后写」猜着删旧故事。 */
export const LOVE_ARCHIVE_STORIES_MAX = 200;
/** characters 上限（按 `${characterPackId}:${branchId}` 计数）。 */
export const LOVE_ARCHIVE_CHARACTERS_MAX = 100;
/** unlocks 每个数组的上限（去重后判定）。 */
export const LOVE_ARCHIVE_UNLOCKS_MAX = 500;
/** 整份档案的序列化字节上限（与 story slot 同量级）。 */
export const LOVE_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024;

/** 档案键：`characterPackId:branchId`；缺省分支一律归 `main`（spec §3「默认 branchId = main」）。 */
export function archiveKey(characterPackId: string, branchId?: string): string {
  return `${characterPackId}:${branchId ?? "main"}`;
}

export interface LoveArchive {
  v: 1;
  revision: number;
  playerPersonaId: string;
  /** key = `${characterPackId}:${branchId}`；不同分支不共享关系状态。 */
  characters: Record<string, CharacterArchive>;
  stories: StoryRecord[];
  unlocks: { endings: string[]; characters: string[]; scenes: string[]; cgs: string[] };
  updatedAt: number;
}

export interface CharacterArchive {
  characterPackId: string;
  branchId: string;
  personaSnapshot: {
    name: { zh: string; en: string };
    bio?: { zh: string; en: string };
    appearance?: string;
    voiceProfileId?: string;
    cardHash?: string;
    source: "builtin" | "studio" | "love-custom";
  };
  relationship: LoveRelationshipState;
  /** 只存引用与摘要，正文在 story/memory 记录里。 */
  memoryIds: string[];
  activeStoryId?: string;
}

export interface StoryRecord {
  id: string;
  origin: "studio" | "love";
  title: { zh: string; en: string };
  /** 用户可见；不自动包含 hidden/secret。 */
  summary: { zh: string; en: string };
  keyChoices: {
    at: number;
    /** 用户实际选择或说出的那句。 */
    choice: { zh: string; en: string };
    consequence?: { zh: string; en: string };
    /** 仅自由输入可存逐字原话；进入档案前由 `parseStoryPack` 按 quoteSource 过滤。 */
    quote?: { zh: string; en: string };
  }[];
  endingId?: string;
  characterPackIds: string[];
  parentStoryId?: string;
  /** 默认 "main"；what-if 用独立分支。 */
  branchId?: string;
  branchOf?: string;
  canonical: boolean;
  packRef?: string;
  createdAt: number;
}

type Localized = { zh: string; en: string };
type LocalizedSchema = z.ZodType<Localized>;

/** 用户可见文本：双语都非空。归档里的 title / summary / quote 都走这里。 */
const locText: LocalizedSchema = z.object({ zh: z.string().min(1).max(5000), en: z.string().min(1).max(5000) });

const PERSONA_SOURCES = ["builtin", "studio", "love-custom"] as const;
const personaSnapshotSchema = z.object({
  name: locText,
  bio: locText.optional(),
  appearance: z.string().max(2000).optional(),
  voiceProfileId: z.string().max(200).optional(),
  cardHash: z.string().max(128).optional(),
  source: z.enum(PERSONA_SOURCES),
});

export const CharacterArchiveSchema: z.ZodType<CharacterArchive> = z.object({
  characterPackId: z.string().min(1).max(100),
  branchId: z.string().max(100).default("main"),
  personaSnapshot: personaSnapshotSchema,
  relationship: LoveRelationshipStateSchema,
  memoryIds: z.array(z.string().min(1).max(200)).max(500).default([]),
  activeStoryId: z.string().max(200).optional(),
});

const keyChoiceSchema = z.object({
  at: z.number().int().nonnegative(),
  choice: locText,
  consequence: locText.optional(),
  quote: locText.optional(),
});

export const LoveStoryRecordSchema: z.ZodType<StoryRecord> = z.object({
  id: z.string().min(1).max(200),
  origin: z.enum(["studio", "love"]),
  title: locText,
  summary: locText,
  keyChoices: z.array(keyChoiceSchema).max(100).default([]),
  endingId: z.string().max(200).optional(),
  characterPackIds: z.array(z.string().min(1).max(200)).max(50).default([]),
  parentStoryId: z.string().max(200).optional(),
  branchId: z.string().max(200).optional(),
  branchOf: z.string().max(200).optional(),
  canonical: z.boolean(),
  packRef: z.string().max(400).optional(),
  createdAt: z.number().int().nonnegative(),
});

const unlockListSchema = z.array(z.string().min(1).max(200));

/**
 * 整份档案。`z.object` 默认 strip 未知键，所以「好感/熟练度/星级」类字段不会落盘；
 * 恢复备份时复用同一个 schema，绝不 mint 出 store 自己写不出的形状。
 * 跨字段不变量：characters 的键必须等于 `characterPackId:branchId`；stories 不得重 id。
 */
export const LoveArchiveSchema: z.ZodType<LoveArchive> = z
  .object({
    v: z.literal(LOVE_ARCHIVE_VERSION),
    revision: z.number().int().nonnegative(),
    playerPersonaId: z.string().max(200),
    characters: z.record(z.string().min(1).max(240), CharacterArchiveSchema),
    stories: z.array(LoveStoryRecordSchema),
    unlocks: z
      .object({
        endings: unlockListSchema,
        characters: unlockListSchema,
        scenes: unlockListSchema,
        cgs: unlockListSchema,
      })
      .default({ endings: [], characters: [], scenes: [], cgs: [] }),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((archive, ctx) => {
    for (const [key, char] of Object.entries(archive.characters)) {
      if (archiveKey(char.characterPackId, char.branchId) !== key) {
        ctx.addIssue({ code: "custom", path: ["characters", key], message: "a character archive is keyed by packId:branchId" });
      }
    }
    const ids = new Set<string>();
    for (const story of archive.stories) {
      if (ids.has(story.id)) {
        ctx.addIssue({ code: "custom", path: ["stories"], message: "duplicate story ids" });
        break;
      }
      ids.add(story.id);
    }
  }) as unknown as z.ZodType<LoveArchive>;

export type LoveArchiveRead =
  | { status: "empty" }
  | { status: "ok"; archive: LoveArchive; raw: string }
  | { status: "corrupt"; raw: string; reason: "json" | "shape" }
  | { status: "incompatible"; raw: string }
  | { status: "unavailable" };

export type LoveArchiveWrite =
  | { ok: true; archive: LoveArchive }
  | {
      ok: false;
      reason: "conflict" | "invalid" | "quota" | "unavailable" | "corrupt" | "incompatible";
      diskRevision?: number;
    };

export function emptyLoveArchive(playerPersonaId?: string, now?: number): LoveArchive {
  return {
    v: LOVE_ARCHIVE_VERSION,
    revision: 0,
    playerPersonaId: playerPersonaId ?? "",
    characters: {},
    stories: [],
    unlocks: { endings: [], characters: [], scenes: [], cgs: [] },
    updatedAt: now ?? 0,
  };
}

/** 叙事阶段 = familiarity 与 trust 的最小值（spec-love-bridge §6.0）；直接复用半教练派生。 */
export function deriveNarrativeStage(relationship: LoveRelationshipState): 0 | 1 | 2 | 3 {
  return deriveStage(relationship);
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

/** 读取整个 archive slot；无 key = empty，坏数据保留 raw，永不抛错。 */
export function readLoveArchive(): LoveArchiveRead {
  const ls = storage();
  if (!ls) return { status: "unavailable" };

  let raw: string | null | undefined;
  try {
    raw = ls.getItem(LOVE_ARCHIVE_KEY);
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

  // 版本先判：v ≠ 1 是「未来写的」，不是「写坏了」。
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = (value as { v?: unknown }).v;
    if (typeof v === "number" && v !== LOVE_ARCHIVE_VERSION) return { status: "incompatible", raw };
  }

  const parsed = LoveArchiveSchema.safeParse(value);
  if (!parsed.success) return { status: "corrupt", raw, reason: "shape" };
  return { status: "ok", archive: parsed.data, raw };
}

/** 上限判定：stories / characters / unlocks 任一超限都算 quota（不动磁盘）。 */
function withinCaps(archive: LoveArchive): boolean {
  if (Object.keys(archive.characters).length > LOVE_ARCHIVE_CHARACTERS_MAX) return false;
  if (archive.stories.length > LOVE_ARCHIVE_STORIES_MAX) return false;
  for (const key of ["endings", "characters", "scenes", "cgs"] as const) {
    if (archive.unlocks[key].length > LOVE_ARCHIVE_UNLOCKS_MAX) return false;
  }
  return true;
}

/**
 * 写入整个 archive slot。
 *
 * - 磁盘损坏/版本未知：拒绝写入并保留原始字节，不让正常回合静默覆盖恢复线索；
 * - `expectedRevision` 与磁盘不一致：conflict，附 diskRevision；
 * - 形状不合法：invalid；任一上限或序列化字节超限：quota（**不截断**用户已有内容）；
 * - 配额失败：quota；存储不可用：unavailable。
 *
 * 成功时 revision = max(diskRevision, expectedRevision ?? diskRevision) + 1（与 story slot 同口径）。
 */
export function writeLoveArchive(archive: LoveArchive, expectedRevision?: number): LoveArchiveWrite {
  const ls = storage();
  if (!ls) return { ok: false, reason: "unavailable" };

  const disk = readLoveArchive();
  if (disk.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (disk.status === "corrupt") return { ok: false, reason: "corrupt" };
  if (disk.status === "incompatible") return { ok: false, reason: "incompatible" };

  const diskRevision = disk.status === "ok" ? disk.archive.revision : 0;
  if (expectedRevision !== undefined && expectedRevision !== diskRevision) {
    return { ok: false, reason: "conflict", diskRevision };
  }

  const parsed = LoveArchiveSchema.safeParse(archive);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const next = parsed.data;
  if (!withinCaps(next)) return { ok: false, reason: "quota" };

  const writable: LoveArchive = {
    ...next,
    revision: Math.max(diskRevision, expectedRevision ?? diskRevision) + 1,
    updatedAt: Date.now(),
  };
  const raw = serialize(writable);
  if (raw === null || byteLength(raw) > LOVE_ARCHIVE_MAX_BYTES) return { ok: false, reason: "quota" };

  try {
    ls.setItem(LOVE_ARCHIVE_KEY, raw);
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable" };
  }
  // 成功落盘才通知：冲突/配额/损坏都在上面 return，失败的写入不触发跨页刷新。
  notifyLoveSlotsChanged(LOVE_ARCHIVE_KEY);
  return { ok: true, archive: writable };
}

type Loaded = { ok: true; archive: LoveArchive } | { ok: false; result: LoveArchiveWrite };

/** 回合级写入的公共前置：损坏/版本未知时拒绝覆盖，存储不可用原样返回。 */
function loadForWrite(): Loaded {
  const read = readLoveArchive();
  if (read.status === "unavailable") return { ok: false, result: { ok: false, reason: "unavailable" } };
  if (read.status === "corrupt") return { ok: false, result: { ok: false, reason: "corrupt" } };
  if (read.status === "incompatible") return { ok: false, result: { ok: false, reason: "incompatible" } };
  return { ok: true, archive: read.status === "ok" ? read.archive : emptyLoveArchive() };
}

/** 新增或覆盖一位角色的档案；同 `characterPackId:branchId` 覆盖，其他角色不动。 */
export function upsertCharacterArchive(entry: CharacterArchive, expectedRevision?: number): LoveArchiveWrite {
  const parsed = CharacterArchiveSchema.safeParse(entry);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const key = archiveKey(parsed.data.characterPackId, parsed.data.branchId);
  return writeLoveArchive(
    { ...current.archive, characters: { ...current.archive.characters, [key]: parsed.data } },
    expectedRevision,
  );
}

/**
 * 追加一段故事记录。append-only：同 id 已存在 → 幂等成功、不覆盖（也**不**写盘，
 * revision 不递增——重放同一段导入不该制造新版本）；超过 stories 上限 → quota。
 */
export function appendStoryRecord(record: StoryRecord, expectedRevision?: number): LoveArchiveWrite {
  const parsed = LoveStoryRecordSchema.safeParse(record);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  if (current.archive.stories.some((s) => s.id === parsed.data.id)) {
    return { ok: true, archive: current.archive };
  }
  return writeLoveArchive({ ...current.archive, stories: [...current.archive.stories, parsed.data] }, expectedRevision);
}

/**
 * 切换主线标记。设为 canonical 时，同 `characterPackIds` + 同 `branchId` 的其它故事
 * 一并被标为非主线（spec §5.3「canonical 只标当前主线」）；不同分支的记录不碰、不删。
 */
export function setCanonicalStory(storyId: string, canonical: boolean, expectedRevision?: number): LoveArchiveWrite {
  if (!storyId) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const target = current.archive.stories.find((s) => s.id === storyId);
  if (!target) return { ok: false, reason: "invalid" };

  const packIds = new Set(target.characterPackIds);
  const branch = target.branchId ?? "main";
  const stories = current.archive.stories.map((s) => {
    if (s.id === storyId) return { ...s, canonical };
    if (canonical && (s.branchId ?? "main") === branch && s.characterPackIds.some((id) => packIds.has(id))) {
      return { ...s, canonical: false };
    }
    return s;
  });
  return writeLoveArchive({ ...current.archive, stories }, expectedRevision);
}

/** 追加解锁收藏；同值去重。去重后任一数组超限 → quota。 */
export function addUnlocks(unlocks: Partial<LoveArchive["unlocks"]>, expectedRevision?: number): LoveArchiveWrite {
  const keys = ["endings", "characters", "scenes", "cgs"] as const;
  for (const key of keys) {
    const value = unlocks[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((s) => typeof s !== "string")) return { ok: false, reason: "invalid" };
  }

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const unlocksNext = { ...current.archive.unlocks };
  for (const key of keys) {
    const incoming = unlocks[key];
    if (incoming === undefined) continue;
    unlocksNext[key] = [...new Set([...unlocksNext[key], ...incoming])];
  }
  return writeLoveArchive({ ...current.archive, unlocks: unlocksNext }, expectedRevision);
}

/** 删除一位角色的档案；幂等，缺键也算成功。分支独立的键各自删。 */
export function deleteCharacterArchive(characterPackId: string, branchId?: string, expectedRevision?: number): LoveArchiveWrite {
  if (!characterPackId) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const characters = { ...current.archive.characters };
  delete characters[archiveKey(characterPackId, branchId)];
  return writeLoveArchive({ ...current.archive, characters }, expectedRevision);
}

/** 删除一段故事记录；幂等，缺 id 也算成功。分支记录各自删，不连带其它分支。 */
export function deleteStoryRecord(storyId: string, expectedRevision?: number): LoveArchiveWrite {
  if (!storyId) return { ok: false, reason: "invalid" };

  const current = loadForWrite();
  if (!current.ok) return current.result;

  const stories = current.archive.stories.filter((s) => s.id !== storyId);
  return writeLoveArchive({ ...current.archive, stories }, expectedRevision);
}
