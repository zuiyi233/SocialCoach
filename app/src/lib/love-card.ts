import { L, type Lang } from "@/data/taxonomy";
import { pick } from "./i18n";

/**
 * 用户卡（spec-love-user-cards §2.1）：主站恋爱模式承认的 Tavern 卡子集。
 *
 * 与 `.scpersona` 不同：卡是外部格式，主站只取它认识的字段，未知字段一概丢弃
 * （§2.1「未知字段：丢弃，不报错」）。所有文本按原样保存、不翻译；`L={zh,en}`
 * 只用于解析错误这类界面文案，卡片内容永远是单语原文。
 *
 * 字段名与 spec §2.1 逐字一致；导入时将 Tavern 的 snake_case（`first_mes`、
 * `insertion_order`…）落成这里的 camelCase。`characterBook` 只保留 `enabled`
 * 的条目参与提示（§2.1），禁用在解析时就被掉。
 *
 * 上限：单个文件（JSON 字节 / PNG 字节）8 MiB，超限直接报 `too-large`，不去读
 * 完整内容。
 */

/** 单个卡文件（JSON 文本 / PNG 字节）的上限。 */
export const LOVE_CARD_MAX_BYTES = 8 * 1024 * 1024;

export interface LoveCard {
  /** 本地生成：`card-` + 8 位 base36，导入时分配，不沿用文件里的 id。 */
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  alternateGreetings: string[];
  tags: string[];
  /** 只含 `enabled` 的条目（解析时已过滤）。 */
  characterBook?: { entries: LoveCardWorldEntry[] };
  source: "tavern-json" | "tavern-png" | "manual";
  spec: "chara_card_v2" | "chara_card_v3" | "unknown";
  license?: string;
  importedAt: number;
  updatedAt: number;
}

export interface LoveCardWorldEntry {
  keys: string[];
  content: string;
  enabled: boolean;
  insertionOrder: number;
}

/**
 * 送进提示词的卡子集（spec-love-user-cards §2.3）：去掉 id / 来源 / 时间戳这些只对本地
 * 存储有意义的东西，世界书只带已启用的条目。上限由 `task-input` 的 schema 兜住。
 */
export interface LoveCardPayload {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  tags: string[];
  worldEntries: { keys: string[]; content: string }[];
}

export function loveCardPayload(card: LoveCard): LoveCardPayload {
  return {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    firstMes: card.firstMes,
    mesExample: card.mesExample,
    tags: [...card.tags],
    worldEntries: (card.characterBook?.entries ?? [])
      .filter((e) => e.enabled && e.content.trim() && e.keys.length > 0)
      .map((e) => ({ keys: [...e.keys], content: e.content })),
  };
}

/** 统一解析结果：失败时 `message` 是 `pick(L, lang)` 选好的双语文案。 */
export type LoveCardParse =
  | { ok: true; card: LoveCard }
  | { ok: false; code: "bad-format" | "too-large" | "missing-field" | "bad-json"; message: string };

const LC_MSG = {
  "bad-format": L(
    "认不出这是一张可用的角色卡：请选择 Tavern 卡文件（PNG）或角色卡 JSON。",
    "This doesn't look like a usable character card — choose a Tavern PNG or a card JSON.",
  ),
  "too-large": L(
    "文件超过 8 MiB 上限，没有读取。",
    "The file is over the 8 MiB limit and was not read.",
  ),
  "missing-field": L(
    "卡片缺少必要字段：需要名字；描述与开场白不能同时留空。",
    "The card is missing required fields: a name, and a description or a first message.",
  ),
  "missing-name": L(
    "卡片缺少名字（name）。",
    "The card is missing its name.",
  ),
  "missing-body": L(
    "描述与开场白（first_mes）不能同时为空。",
    "A description or a first message (first_mes) is required.",
  ),
  "bad-json": L(
    "卡片内容读不出来：JSON 损坏，或 PNG 里的卡片数据解不开。",
    "The card content can't be read — the JSON is damaged or the PNG payload can't be decoded.",
  ),
} as const;

type LoveCardErrorCode = "bad-format" | "too-large" | "missing-field" | "bad-json";

function parseFail(code: LoveCardErrorCode, messageKey: keyof typeof LC_MSG, lang: Lang): LoveCardParse {
  return { ok: false, code, message: pick(LC_MSG[messageKey], lang) };
}

/** 已知的卡字段，用于「有没有任何可取内容」的判定（spec 认不出但 data/扁平字段也取不到才拒）。 */
const CARD_FIELDS = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "alternate_greetings",
  "tags",
  "character_book",
] as const;

const asString = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** 导入时分配：`card-` + 8 位 base36（规范 §2.1「本地生成，导入时分配」）。 */
export function newCardId(): string {
  return `card-${Math.random().toString(36).slice(2, 10)}`;
}

function hasCardFields(obj: Record<string, unknown>): boolean {
  return CARD_FIELDS.some((key) => key in obj);
}

/** 世界书条目：只把 enabled 的收进来（§2.1「只保留 enabled 的条目参与提示」）。 */
function worldEntryFromRaw(raw: unknown): LoveCardWorldEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  // 缺省视为启用（Tavern 语义：写进 character_book 就是要用的）；明确 false/"false"/0 才排除。
  const enabledRaw = r.enabled;
  const enabled =
    enabledRaw == null ||
    enabledRaw === true ||
    enabledRaw === "true" ||
    enabledRaw === 1 ||
    enabledRaw === "1";
  if (!enabled) return null;
  const keys = Array.isArray(r.keys) ? r.keys.filter((k): k is string => typeof k === "string") : [];
  const content = asString(r.content);
  const rawOrder = r.insertion_order !== undefined ? r.insertion_order : r.insertionOrder;
  const insertionOrder = typeof rawOrder === "number" && Number.isFinite(rawOrder) ? Math.trunc(rawOrder) : 0;
  return { keys, content, enabled: true, insertionOrder };
}

function parseCharacterBook(v: unknown): { entries: LoveCardWorldEntry[] } | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const entriesRaw = (v as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) return undefined;
  const entries: LoveCardWorldEntry[] = [];
  for (const entry of entriesRaw) {
    const parsed = worldEntryFromRaw(entry);
    if (parsed) entries.push(parsed);
  }
  return entries.length ? { entries } : undefined;
}

/**
 * 从已解出的 JSON 值构造 LoveCard。
 *
 * - `{ spec, data }` 信封优先取 `data`；扁平 `{ name, description, … }` 直接取外层；
 * - `spec` 是 v2/v3 → 按字面；`spec` 认不出但有 data/扁平字段 → 标 `"unknown"`；
 * - 没有 spec 字段时用入参 `fallbackSpec`（JSON 导入 = 不知道，标 unknown；PNG 由
 *   tEXt 的 keyword 提示 v2/v3）。
 */
function cardFromValue(
  raw: unknown,
  fallbackSpec: LoveCard["spec"],
  source: LoveCard["source"],
  lang: Lang,
): LoveCardParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return parseFail("bad-format", "bad-format", lang);
  const rec = raw as Record<string, unknown>;
  const specRaw = rec.spec;
  const specRecognized = specRaw === "chara_card_v2" || specRaw === "chara_card_v3";
  const dataIsObj = !!rec.data && typeof rec.data === "object" && !Array.isArray(rec.data);
  const dataObj = dataIsObj ? (rec.data as Record<string, unknown>) : rec;

  let spec: LoveCard["spec"];
  if (specRecognized) spec = specRaw as LoveCard["spec"];
  else if (typeof specRaw === "string" && specRaw.trim() !== "") spec = "unknown";
  else spec = fallbackSpec;

  if (!hasCardFields(dataObj)) return parseFail("bad-format", "bad-format", lang);

  const name = asString(dataObj.name).trim();
  if (!name) return parseFail("missing-field", "missing-name", lang);
  const description = asString(dataObj.description);
  const firstMes = asString(dataObj.first_mes);
  if (!description.trim() && !firstMes.trim()) return parseFail("missing-field", "missing-body", lang);

  const personality = asString(dataObj.personality);
  const scenario = asString(dataObj.scenario);
  const mesExample = asString(dataObj.mes_example);
  const alternateGreetings = Array.isArray(dataObj.alternate_greetings)
    ? dataObj.alternate_greetings.filter((g): g is string => typeof g === "string")
    : [];
  const tags = Array.isArray(dataObj.tags) ? dataObj.tags.filter((t): t is string => typeof t === "string") : [];
  const characterBook = parseCharacterBook(dataObj.character_book);
  const license = asString(dataObj.license).trim() || undefined;

  const now = Date.now();
  const card: LoveCard = {
    id: newCardId(),
    name,
    description,
    personality,
    scenario,
    firstMes,
    mesExample,
    alternateGreetings,
    tags,
    source,
    spec,
    importedAt: now,
    updatedAt: now,
  };
  if (characterBook) card.characterBook = characterBook;
  if (license) card.license = license;
  return { ok: true, card };
}

/**
 * 解析 Tavern JSON：接受 `{ spec, data:{…} }` 信封与扁平 `{ name, description, … }`。
 * `data` 优先。未知字段丢弃；缺 name、或描述与 first_mes 同时为空 → missing-field。
 */
export function parseLoveCardJson(text: string, lang: Lang = "zh"): LoveCardParse {
  if (byteLength(text) > LOVE_CARD_MAX_BYTES) return parseFail("too-large", "too-large", lang);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return parseFail("bad-json", "bad-json", lang);
  }
  return cardFromValue(value, "unknown", "tavern-json", lang);
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** tEXt 数据 = `keyword\0text`；text 是 base64(JSON)。 */
function textFromChunk(data: Uint8Array, dataStart: number, dataEnd: number): { keyword: string; text: string } | null {
  let nul = -1;
  for (let i = dataStart; i < dataEnd; i++) {
    if (data[i] === 0) {
      nul = i;
      break;
    }
  }
  if (nul < 0) return null;
  const keyword = new TextDecoder("latin1").decode(data.subarray(dataStart, nul));
  const text = new TextDecoder("latin1").decode(data.subarray(nul + 1, dataEnd));
  return { keyword, text };
}

function base64ToBytes(input: string): Uint8Array | null {
  try {
    const bin = atob(input);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * 解析 Tavern PNG：校验 8 字节签名后按 `length/type/data/crc` 遍历块，只认 `tEXt`
 * 且 keyword 为 `chara`（V2）或 `ccv3`（V3），内容是 base64(JSON)。CRC 不校验
 * （不是识别卡的分量）。超过 8 MiB 直接拒绝，不读完整内容。
 */
export function parseLoveCardPng(input: ArrayBuffer | Uint8Array, lang: Lang = "zh"): LoveCardParse {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > LOVE_CARD_MAX_BYTES) return parseFail("too-large", "too-large", lang);
  if (bytes.length < PNG_SIGNATURE.length) return parseFail("bad-format", "bad-format", lang);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return parseFail("bad-format", "bad-format", lang);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    // 单块声明就超上限：整份必然超限，别把声明长度当真去读。
    if (length > LOVE_CARD_MAX_BYTES) return parseFail("too-large", "too-large", lang);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return parseFail("bad-format", "bad-format", lang); // 数据或 CRC 被截断
    if (type === "IEND") break;
    if (type === "tEXt") {
      const parsed = textFromChunk(bytes, dataStart, dataEnd);
      if (parsed && (parsed.keyword === "chara" || parsed.keyword === "ccv3")) {
        const decoded = base64ToBytes(parsed.text);
        if (!decoded) return parseFail("bad-json", "bad-json", lang);
        let value: unknown;
        try {
          value = JSON.parse(new TextDecoder().decode(decoded));
        } catch {
          return parseFail("bad-json", "bad-json", lang);
        }
        return cardFromValue(value, parsed.keyword === "ccv3" ? "chara_card_v3" : "chara_card_v2", "tavern-png", lang);
      }
    }
    offset = dataEnd + 4;
  }
  return parseFail("bad-format", "bad-format", lang); // 是 PNG 但没有卡负载
}

/**
 * 导出（Tavern V2 信封，字段顺序固定，便于对比与重导入）：`{ spec, spec_version, data }`。
 * `spec` 非 v3 一律导出为 v2——导出文件只含主站认识的那部分字段，它事实就是一张 V2 卡；
 * `unknown` / `manual` 的卡因此也能带回其它工具。
 */
export function loveCardToJson(card: LoveCard): string {
  const v3 = card.spec === "chara_card_v3";
  const data: Record<string, unknown> = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.firstMes,
    mes_example: card.mesExample,
    alternate_greetings: card.alternateGreetings,
    tags: card.tags,
  };
  if (card.characterBook && card.characterBook.entries.length) {
    data.character_book = {
      entries: card.characterBook.entries.map((entry) => ({
        keys: entry.keys,
        content: entry.content,
        enabled: entry.enabled,
        insertion_order: entry.insertionOrder,
      })),
    };
  }
  if (card.license) data.license = card.license;
  return JSON.stringify(
    {
      spec: v3 ? "chara_card_v3" : "chara_card_v2",
      spec_version: v3 ? "3.0" : "2.0",
      data,
    },
    null,
    2,
  );
}