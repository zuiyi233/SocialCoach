import type { LoveCard, LoveCardWorldEntry } from "./love-card";

/**
 * 用户卡设备端存储（spec-love-user-cards §2.2）。
 *
 * 单 slot：`socialcoach.love-cards.v1`，形状 `{ version: 1, revision, cards: LoveCard[] }`。
 *
 * 纪律抄 `love-archive.ts`：
 * - 读取永不抛错；坏 JSON / 形状不对 / 版本不认识都算 corrupt，原字节留在存储里
 *   供导出与恢复界面的证据，绝不静默当空、绝不自动清；
 * - 写入带 revision，期望值与磁盘不一致返回 conflict，不做静默覆盖；
 * - corrupt 上任何写入都拒绝（覆盖会丢掉恢复线索）；
 * - 上限 50 张 / 1 MiB，超限返回 quota，**不截断已有内容**。
 *
 * 上限口径：`JSON.stringify(store).length`（UTF-16 code units）当作序列化大小估算——
 * 与存储实际占用的 UTF-16 编码一致（每 BMP 字符 2 字节、代理对 4 字节），因此按
 * `.length` 计就是直接可比的上限，注释在此以免后人改成 `TextEncoder` 字节数。
 *
 * 注意：本 slot 不在 `LOVE_PLAY_PREFIX`（`socialcoach.love-play.`）下，所以
 * `lovePlayBackup()` 的前缀扫描和「重置全部数据」的 `clearLovePlaySlots()` 都碰不到
 * 它。G3 接 backup.ts/设置页时必须显式接 `loveCardBackup()` 与 `clearLoveCards()`
 * （spec §2.2「导出 / 擦除必须一起交付」就是在说这件事）。
 */

export const LOVE_CARDS_KEY = "socialcoach.love-cards.v1";
export const LOVE_CARDS_VERSION = 1 as const;
/** 卡片张数上限：超过返回 quota，不按「谁最后写」猜着删别人的卡。 */
export const LOVE_CARDS_MAX = 50;
/** 整份 slot 序列化后的 UTF-16 长度上限（1 MiB）。 */
export const LOVE_CARDS_MAX_CHARS = 1024 * 1024;

export type LoveCardsRead =
  | { status: "empty"; cards: LoveCard[]; revision: number }
  | { status: "ok"; cards: LoveCard[]; revision: number }
  | { status: "corrupt"; cards: LoveCard[]; revision: number };

export type LoveCardWrite =
  | { ok: true; revision: number }
  | { ok: false; code: "conflict" | "quota" | "corrupt" | "not-found" };

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

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strArray = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
};

/** 存量卡的形状校验：任何必填字段类型不对都判坏——宁可整份 corrupt，也不静默丢半张卡。 */
function normalizeCard(raw: unknown): LoveCard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  if (!id || !name) return null;
  const alternateGreetings = strArray(r.alternateGreetings);
  const tags = strArray(r.tags);
  if (!alternateGreetings || !tags) return null;
  if (typeof r.importedAt !== "number" || typeof r.updatedAt !== "number") return null;
  if (r.source !== "tavern-json" && r.source !== "tavern-png" && r.source !== "manual") return null;
  if (r.spec !== "chara_card_v2" && r.spec !== "chara_card_v3" && r.spec !== "unknown") return null;

  const card: LoveCard = {
    id,
    name,
    description: str(r.description),
    personality: str(r.personality),
    scenario: str(r.scenario),
    firstMes: str(r.firstMes),
    mesExample: str(r.mesExample),
    alternateGreetings,
    tags,
    source: r.source,
    spec: r.spec,
    importedAt: r.importedAt,
    updatedAt: r.updatedAt,
  };
  if (r.characterBook !== undefined) {
    const book = r.characterBook;
    if (!book || typeof book !== "object" || Array.isArray(book)) return null;
    const entriesRaw = (book as { entries?: unknown }).entries;
    if (!Array.isArray(entriesRaw)) return null;
    const entries: LoveCardWorldEntry[] = [];
    for (const entryRaw of entriesRaw) {
      const entry = normalizeWorldEntry(entryRaw);
      if (!entry) return null;
      entries.push(entry);
    }
    card.characterBook = { entries };
  }
  if (typeof r.license === "string") card.license = r.license;
  return card;
}

function normalizeWorldEntry(raw: unknown): LoveCardWorldEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const keys = strArray(r.keys);
  if (!keys) return null;
  // 存储里只存在 enabled 条目（解析时已过滤）；出现非 true 说明被外部改过，按坏档处理。
  if (r.enabled !== true) return null;
  const insertionOrder = typeof r.insertionOrder === "number" ? Math.trunc(r.insertionOrder) : 0;
  return { keys, content: str(r.content), enabled: true, insertionOrder };
}

/** 解析整个 slot；任何一条卡或版本/形状不对 → null（corrupt）。 */
function parseSlot(raw: string): { cards: LoveCard[]; revision: number } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  // v ≠ 1 是「别的版本写的」不是「写坏了」，但对 G1 都按 corrupt 处理：拒绝覆盖、保留字节。
  if (obj.version !== LOVE_CARDS_VERSION) return null;
  if (typeof obj.revision !== "number" || !Number.isFinite(obj.revision) || obj.revision < 0) return null;
  if (!Array.isArray(obj.cards)) return null;
  const cards: LoveCard[] = [];
  for (const entry of obj.cards) {
    const card = normalizeCard(entry);
    if (!card) return null;
    cards.push(card);
  }
  return { cards, revision: obj.revision };
}

/**
 * 备份恢复用：校验备份里的卡槽，返回可直接写回 localStorage 的规范化 JSON。
 * 形状不对返回 null —— 调用方按 invalid 处理并保留原字节，不静默丢卡。
 */
export function parseLoveCardsBackup(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = parseSlot(JSON.stringify(raw));
  if (!parsed || parsed.cards.length > LOVE_CARDS_MAX) return null;
  return JSON.stringify({ version: LOVE_CARDS_VERSION, revision: parsed.revision, cards: parsed.cards });
}

/**
 * 读取整份用户卡。
 *
 * 存储不可用 / slot 损坏都返回 `corrupt`（cards 为空）：拿不准磁盘状态时绝不假装
 * 读空——写路径靠它拒绝覆盖。损坏的原字节留在 localStorage 里不动，恢复界面可直接
 * `localStorage.getItem(LOVE_CARDS_KEY)` 取原件展示/导出。
 */
export function readLoveCards(): LoveCardsRead {
  const ls = storage();
  if (!ls) return { status: "corrupt", cards: [], revision: 0 };
  let raw: string | null | undefined;
  try {
    raw = ls.getItem(LOVE_CARDS_KEY);
  } catch {
    return { status: "corrupt", cards: [], revision: 0 };
  }
  if (raw == null) return { status: "empty", cards: [], revision: 0 };
  const parsed = parseSlot(raw);
  if (!parsed) return { status: "corrupt", cards: [], revision: 0 };
  return { status: "ok", cards: parsed.cards, revision: parsed.revision };
}

/**
 * 落盘公共前置：corrupt 拒绝覆盖（坏字节是恢复线索）；revision 对不上返回 conflict；
 * 张数或序列化大小超限返回 quota（**不动磁盘**）。成功时 revision = diskRevision + 1。
 */
function writeStore(cards: LoveCard[], expectedRevision?: number): LoveCardWrite {
  const ls = storage();
  if (!ls) return { ok: false, code: "corrupt" };
  const disk = readLoveCards();
  if (disk.status === "corrupt") return { ok: false, code: "corrupt" };
  const diskRevision = disk.status === "ok" ? disk.revision : 0;
  if (expectedRevision !== undefined && expectedRevision !== diskRevision) return { ok: false, code: "conflict" };
  if (cards.length > LOVE_CARDS_MAX) return { ok: false, code: "quota" };

  const next = { version: LOVE_CARDS_VERSION, revision: diskRevision + 1, cards };
  let raw: string;
  try {
    raw = JSON.stringify(next);
  } catch {
    return { ok: false, code: "corrupt" };
  }
  if (raw.length > LOVE_CARDS_MAX_CHARS) return { ok: false, code: "quota" };

  try {
    ls.setItem(LOVE_CARDS_KEY, raw);
  } catch (error) {
    // quota 之外（隐私模式、安全策略）都是「状态未知、没写进去」→ corrupt，不假装成功。
    return { ok: false, code: isQuotaError(error) ? "quota" : "corrupt" };
  }
  return { ok: true, revision: diskRevision + 1 };
}

/**
 * 新增一张卡。id 已存在时覆盖同 id 的那张（幂等，不产生重复 id）；id 不存在则追加。
 * id 是本地生成的唯一值，重复只会在「误点两次导入」时出现。
 */
export function addLoveCard(card: LoveCard, expectedRevision?: number): LoveCardWrite {
  const disk = readLoveCards();
  const existing = disk.status === "ok" ? disk.cards : [];
  const idx = existing.findIndex((c) => c.id === card.id);
  const cards = idx >= 0 ? existing.map((c, i) => (i === idx ? card : c)) : [...existing, card];
  return writeStore(cards, expectedRevision);
}

/** 覆盖同 id 的卡内容；找不到该 id → not-found。 */
export function updateLoveCard(card: LoveCard, expectedRevision?: number): LoveCardWrite {
  const disk = readLoveCards();
  if (disk.status === "corrupt") return { ok: false, code: "corrupt" };
  const existing = disk.status === "ok" ? disk.cards : [];
  const idx = existing.findIndex((c) => c.id === card.id);
  if (idx < 0) return { ok: false, code: "not-found" };
  return writeStore(existing.map((c, i) => (i === idx ? card : c)), expectedRevision);
}

/** 删除一张卡；id 不存在 → not-found。 */
export function removeLoveCard(id: string, expectedRevision?: number): LoveCardWrite {
  const disk = readLoveCards();
  if (disk.status === "corrupt") return { ok: false, code: "corrupt" };
  const existing = disk.status === "ok" ? disk.cards : [];
  if (!existing.some((c) => c.id === id)) return { ok: false, code: "not-found" };
  return writeStore(existing.filter((c) => c.id !== id), expectedRevision);
}

/**
 * 备份载荷（G3 接 `backup.ts` 用）：只带可读的卡与 revision。corrupt 时是空壳——
 * 坏字节仍留在原 slot，backup.ts 要不要额外保留原件由 G3 的接线决定。
 */
export function loveCardBackup(): { version: typeof LOVE_CARDS_VERSION; cards: LoveCard[]; revision: number } {
  const read = readLoveCards();
  return {
    version: LOVE_CARDS_VERSION,
    cards: read.status === "ok" ? read.cards : [],
    revision: read.status === "ok" ? read.revision : 0,
  };
}

/** 擦除（G3「重置全部数据」时调用）：只删自己一个 key，绝不越界碰别的 slot。 */
export function clearLoveCards(): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(LOVE_CARDS_KEY);
  } catch {
    // 与读同一口径：删不掉就当没删，不抛错。
  }
}