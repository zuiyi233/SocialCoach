import { LOVE_PLAY_PREFIX } from "./love-carry-store";
import { notifyLoveSlotsChanged } from "./love-slot-events";

/**
 * 已读索引（skip-read 的证据）。
 *
 * 传统视觉小说按脚本行 id 跳过；我们的 NPC 台词由模型生成，每局 line.id 都是新的。
 * 因此这里只认**逐字相同**的文本：`scenarioId + 文本哈希`。重开时模型若生成不同句子，
 * 不会被误判为已读；作者拍点/开场白等固定文本则可以正常跳过。
 */
export const LOVE_READ_KEY = `${LOVE_PLAY_PREFIX}read`;
const LOVE_READ_VERSION = 1;
/** 上限按时间保留最近 8000 条，约数百 KB；超出时丢最旧的。 */
const LOVE_READ_MAX = 8000;

export interface LoveReadStore {
  v: 1;
  seen: Record<string, number>;
  updatedAt: number;
}

export type LoveReadRead =
  | { status: "empty" | "unavailable"; seen: Set<string>; seenAt: Record<string, number> }
  | { status: "ok"; seen: Set<string>; seenAt: Record<string, number>; raw: string }
  | { status: "corrupt"; seen: Set<string>; seenAt: Record<string, number>; raw: string };

/** FNV-1a 32 位 + 文本长度；同步、稳定，不依赖 crypto。 */
export function loveContentKey(scenarioId: string, text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${scenarioId}:${hash.toString(16)}:${text.length}`;
}

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.getItem === "function" && typeof ls.setItem === "function" ? ls : null;
  } catch {
    return null;
  }
}

function parse(raw: string): { store: LoveReadStore; corrupt: boolean } {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { store: { v: 1, seen: {}, updatedAt: 0 }, corrupt: true };
    }
    const v = (value as { v?: unknown }).v;
    if (v !== LOVE_READ_VERSION) return { store: { v: LOVE_READ_VERSION, seen: {}, updatedAt: 0 }, corrupt: true };
    const seenRaw = (value as { seen?: unknown }).seen;
    if (!seenRaw || typeof seenRaw !== "object" || Array.isArray(seenRaw)) {
      return { store: { v: 1, seen: {}, updatedAt: 0 }, corrupt: true };
    }
    const seen: Record<string, number> = {};
    let corrupt = false;
    for (const [key, ts] of Object.entries(seenRaw)) {
      if (!key || typeof ts !== "number" || !Number.isFinite(ts)) {
        corrupt = true;
        continue;
      }
      seen[key] = ts;
    }
    return { store: { v: 1, seen, updatedAt: typeof (value as { updatedAt?: unknown }).updatedAt === "number" ? (value as { updatedAt: number }).updatedAt : 0 }, corrupt };
  } catch {
    return { store: { v: 1, seen: {}, updatedAt: 0 }, corrupt: true };
  }
}

export function readLoveReadState(): LoveReadRead {
  const ls = storage();
  if (!ls) return { status: "unavailable", seen: new Set(), seenAt: {} };
  let raw: string | null;
  try {
    raw = ls.getItem(LOVE_READ_KEY);
  } catch {
    return { status: "unavailable", seen: new Set(), seenAt: {} };
  }
  if (raw == null) return { status: "empty", seen: new Set(), seenAt: {} };
  const parsed = parse(raw);
  const seenAt = parsed.store.seen;
  const seen = new Set(Object.keys(seenAt));
  if (parsed.corrupt) return { status: "corrupt", seen, seenAt, raw };
  return { status: "ok", seen, seenAt, raw };
}

export function isLoveTextSeen(scenarioId: string, text: string): boolean {
  return readLoveReadState().seen.has(loveContentKey(scenarioId, text));
}

/**
 * 标记已读。坏 slot 不覆盖（与 story slot 同一口径）；写失败只影响 skip，
 * 不影响剧情。返回 false 时调用方可提示“已读记录没保存”。
 */
export function markLoveTextSeen(scenarioId: string, keys: readonly string[]): boolean {
  if (!scenarioId || !keys.length) return false;
  const ls = storage();
  if (!ls) return false;
  const state = readLoveReadState();
  if (state.status === "corrupt" || state.status === "unavailable") return false;

  const seen: Record<string, number> = { ...state.seenAt };
  const now = Date.now();
  for (const key of keys) {
    if (key.startsWith(`${scenarioId}:`)) seen[key] = now;
  }
  const entries = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, LOVE_READ_MAX);
  const next: LoveReadStore = { v: 1, seen: Object.fromEntries(entries), updatedAt: now };
  try {
    ls.setItem(LOVE_READ_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  notifyLoveSlotsChanged(LOVE_READ_KEY);
  return true;
}

/** 显式清除已读索引（导出/擦除与“清除阅读记录”入口）。 */
export function clearLoveReadSlot(): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(LOVE_READ_KEY);
  } catch {
    return;
  }
  notifyLoveSlotsChanged(LOVE_READ_KEY);
}
