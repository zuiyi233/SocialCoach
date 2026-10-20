import { z } from "zod";
import type { L, Lang } from "@/data/taxonomy";
import { uid } from "./format";

/**
 * 共享人设的单一数据模型（spec-love-persona §2、§3、§4.2）。
 *
 * 一个人设 schema，两个编辑器：Studio 是完整 Tavern 工作台，恋爱系统只吃 `.scpersona` +
 * 基础 JSON。两边共用 schema 版本、fixtures 与错误码（§4.2「单一契约」），字段名/语义不许分叉。
 *
 * 与 `love-story.ts` 的一条关键差异：**未知字段必须原样保留**（§2「未知字段原样保留」是本模块的
 * 验收项）。story 刻意用 `z.object` strip 掉越权字段；Persona 反过来用 `z.looseObject`，
 * 顶层、嵌套与 `tavern.raw` 里的未知键都要能穿过一次 parse→serialize 往返。
 *
 * 这里**不做** Tavern PNG 的 `chara`/`ccv3` 解析、世界书解析或预设解析（§3 硬边界）：识别只用来
 * 路由（分类 + `guide: "studio"`），绝不据此填充 Persona 字段。恋爱系统只映射「基础 JSON」的一小撮
 * 核心字段。
 */

export type LocalizedText = L;

export type PersonaKind = "player" | "npc";
export type PersonaLanguage = "zh" | "en" | "ja" | "other";
export type PersonaSource = "builtin" | "tavern-import" | "studio-generated" | "love-created";
export type PersonaVoiceProvider = "device" | "studio" | "external";
export type TavernSpec = "chara_card_v2" | "chara_card_v3" | "v1";

/** 世界书条目：只做到「常驻/关键词/预算」的子集（§3），完整语义留给 Studio。 */
export interface PersonaWorldbookEntry {
  keys?: string[];
  content?: string;
  enabled?: boolean;
  constant?: boolean;
  insertionOrder?: number;
}

/** spec-love-persona §2 的 Persona，字段名逐字对齐，不新增平行字段。 */
export interface Persona {
  v: 1;
  /** 稳定 id：绝不按显示名反查（`tess` 撞名教训，§5）。 */
  id: string;
  characterPackId?: string;
  revision: number;
  kind: PersonaKind;
  name: LocalizedText;
  aliases?: string[];
  language?: PersonaLanguage;
  bio?: LocalizedText;
  personality?: LocalizedText;
  goals?: LocalizedText;
  boundaries?: LocalizedText;
  preferences?: LocalizedText;
  speechStyle?: LocalizedText;
  greetings?: LocalizedText[];
  appearance?: { text?: string; refImageAssetId?: string; hue?: number };
  voice?: { profileId?: string; provider?: PersonaVoiceProvider };
  role?: LocalizedText;
  characterKey?: string;
  storyConstraints?: { goal?: LocalizedText; redLine?: LocalizedText; secret?: LocalizedText };
  tavern?: {
    spec?: TavernSpec;
    raw: unknown;
    cardHash: string;
    worldbook?: PersonaWorldbookEntry[];
    styleBlocks?: string[];
    sourceFile?: string;
  };
  assets?: { portraits?: Record<string, string>; sprites?: string[]; scenes?: string[] };
  source: PersonaSource;
  license?: string;
  createdAt: number;
  updatedAt: number;
}

export const LOVE_PERSONA_VERSION = 1 as const;
/** 单个本地化字符串的上限（§3「卡文本上限」）。超限拒绝而不是裁剪。 */
export const LOVE_PERSONA_TEXT_MAX = 20_000;
export const LOVE_PERSONA_GREETINGS_MAX = 20;
export const LOVE_PERSONA_ALIASES_MAX = 20;
export const LOVE_PERSONA_STYLE_BLOCKS_MAX = 20;
/** 基础 JSON 单文件的字节上限（§3「文件大小上限」）。 */
export const LOVE_PERSONA_JSON_MAX_BYTES = 4 * 1024 * 1024;
/** 序列化后一份 Persona 的字节上限。 */
export const LOVE_PERSONA_SERIALIZED_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 导入失败的错误码：两个编辑器共用（§4.2）。字符串常量 + 联合类型，两边不许各造一套。
 */
export const LOVE_PERSONA_ERROR = {
  badJson: "persona/bad-json",
  badShape: "persona/bad-shape",
  badVersion: "persona/bad-version",
  textTooLong: "persona/text-too-long",
  tooLarge: "persona/too-large",
  assetTooLarge: "persona/asset-too-large",
  assetBudget: "persona/asset-budget",
  unsupported: "persona/unsupported",
  packUnreadable: "persona/pack-unreadable",
  packMissing: "persona/pack-missing",
  packManifest: "persona/pack-manifest",
  packHash: "persona/pack-hash",
  packTooLarge: "persona/pack-too-large",
} as const;
export type LovePersonaErrorCode = (typeof LOVE_PERSONA_ERROR)[keyof typeof LOVE_PERSONA_ERROR];

const textMax = LOVE_PERSONA_TEXT_MAX;
const locText = z.looseObject({ zh: z.string().max(textMax), en: z.string().max(textMax) });

const worldbookEntrySchema = z.looseObject({
  keys: z.array(z.string().max(200)).max(200).optional(),
  content: z.string().max(textMax).optional(),
  enabled: z.boolean().optional(),
  constant: z.boolean().optional(),
  insertionOrder: z.number().optional(),
});

/**
 * `z.looseObject`（不是 `z.object`）：未知键原样保留。嵌套对象同样用 loose，否则
 * `appearance` / `tavern` / `storyConstraints` 里的未知键会被 strip 掉，往返即丢字段。
 */
const personaShape = {
  v: z.literal(LOVE_PERSONA_VERSION),
  id: z.string().min(1).max(100),
  characterPackId: z.string().max(100).optional(),
  revision: z.number().int().nonnegative(),
  kind: z.enum(["player", "npc"]),
  name: locText,
  aliases: z.array(z.string().max(120)).max(LOVE_PERSONA_ALIASES_MAX).optional(),
  language: z.enum(["zh", "en", "ja", "other"]).optional(),
  bio: locText.optional(),
  personality: locText.optional(),
  goals: locText.optional(),
  boundaries: locText.optional(),
  preferences: locText.optional(),
  speechStyle: locText.optional(),
  greetings: z.array(locText).max(LOVE_PERSONA_GREETINGS_MAX).optional(),
  appearance: z
    .looseObject({
      text: z.string().max(textMax).optional(),
      refImageAssetId: z.string().max(200).optional(),
      hue: z.number().optional(),
    })
    .optional(),
  voice: z
    .looseObject({ profileId: z.string().max(200).optional(), provider: z.enum(["device", "studio", "external"]).optional() })
    .optional(),
  role: locText.optional(),
  characterKey: z.string().max(200).optional(),
  storyConstraints: z
    .looseObject({ goal: locText.optional(), redLine: locText.optional(), secret: locText.optional() })
    .optional(),
  tavern: z
    .looseObject({
      spec: z.enum(["chara_card_v2", "chara_card_v3", "v1"]).optional(),
      raw: z.unknown().optional(),
      cardHash: z.string().max(128).optional(),
      worldbook: z.array(worldbookEntrySchema).optional(),
      styleBlocks: z.array(z.string().max(textMax)).max(LOVE_PERSONA_STYLE_BLOCKS_MAX).optional(),
      sourceFile: z.string().max(300).optional(),
    })
    .optional(),
  assets: z
    .looseObject({
      portraits: z.record(z.string().max(120), z.string().max(400)).optional(),
      sprites: z.array(z.string().max(200)).optional(),
      scenes: z.array(z.string().max(200)).optional(),
    })
    .optional(),
  source: z.enum(["builtin", "tavern-import", "studio-generated", "love-created"]),
  license: z.string().max(400).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
};

export const PersonaSchema: z.ZodType<Persona> = z.looseObject(personaShape) as unknown as z.ZodType<Persona>;

/** 单语卡用同一个字符串填 `zh` / `en`（§2「不要伪造第二语言」）。 */
export function localizedFromSingle(value: string): LocalizedText {
  return { zh: value, en: value };
}

/** 原文是否只有一种语言（编辑器据此标记「原文」并给翻译入口）。 */
export function isSingleLanguage(value: LocalizedText): boolean {
  return value.zh === value.en;
}

/** 取 UI/教练档案可用的单语值：优先声明语言，缺省 zh。 */
export function preferLanguage(value: LocalizedText, lang: Lang): string {
  return value[lang] ?? value.zh;
}

export type PersonaParse = { ok: true; persona: Persona } | { ok: false; code: LovePersonaErrorCode; detail?: string };

/** 反序列化结果。 */
export type PersonaSerialize = { ok: true; json: string } | { ok: false; code: LovePersonaErrorCode };

function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

/** 版本先判：未来版本是「不是坏数据」，不和形状错误混为一谈（§5 版本兼容）。 */
export function parsePersona(value: unknown): PersonaParse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: LOVE_PERSONA_ERROR.badShape, detail: "not an object" };
  }
  const v = (value as { v?: unknown }).v;
  if (typeof v === "number" && v !== LOVE_PERSONA_VERSION) {
    return { ok: false, code: LOVE_PERSONA_ERROR.badVersion, detail: `v=${v}` };
  }
  const parsed = PersonaSchema.safeParse(value);
  if (!parsed.success) {
    // 文本/数量上限单列一个可读错误码；其余归形状。
    const tooBig = parsed.error.issues.some((issue) => issue.code === "too_big");
    return { ok: false, code: tooBig ? LOVE_PERSONA_ERROR.textTooLong : LOVE_PERSONA_ERROR.badShape, detail: parsed.error.issues[0]?.message };
  }
  const size = checkPersonaSize(parsed.data);
  if (!size.ok) return size;
  return { ok: true, persona: parsed.data };
}

/** 序列化一份 Persona；超上限返回 too-large，不产出半截 JSON。 */
export function serializePersona(persona: Persona): PersonaSerialize {
  const parsed = parsePersona(persona);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  let json: string;
  try {
    json = JSON.stringify(parsed.persona);
  } catch {
    return { ok: false, code: LOVE_PERSONA_ERROR.badShape };
  }
  if (byteLength(json) > LOVE_PERSONA_SERIALIZED_MAX_BYTES) return { ok: false, code: LOVE_PERSONA_ERROR.tooLarge };
  return { ok: true, json };
}

export function checkPersonaSize(persona: Persona): { ok: true } | { ok: false; code: LovePersonaErrorCode } {
  let json: string;
  try {
    json = JSON.stringify(persona);
  } catch {
    return { ok: false, code: LOVE_PERSONA_ERROR.badShape };
  }
  if (byteLength(json) > LOVE_PERSONA_SERIALIZED_MAX_BYTES) return { ok: false, code: LOVE_PERSONA_ERROR.tooLarge };
  return { ok: true };
}

/** 空白人设：编辑器开新档用。name 留空由 UI 填，不在这里伪造。 */
export function createEmptyPersona(kind: PersonaKind, overrides: Partial<Persona> = {}): Persona {
  const now = Date.now();
  const base: Persona = {
    v: LOVE_PERSONA_VERSION,
    id: uid(),
    revision: 1,
    kind,
    name: localizedFromSingle(""),
    source: "love-created",
    createdAt: now,
    updatedAt: now,
  };
  return { ...base, ...overrides };
}

/* ------------------------------------------------------------------ *
 * 规范化 JSON 与 sha256（cardHash 的确定性来源）
 * ------------------------------------------------------------------ */

/**
 * 规范化 JSON：递归按键名排序、丢弃 `undefined`、数组保持顺序。
 * 同一张卡在任何序列化顺序下都得到同一段字节，`cardHash` 因此可比对（§5）。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "[" + value.map((item) => canonicalJson(item === undefined ? null : item)).join(",") + "]";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value as string);
  if (t === "number") return Number.isFinite(value as number) ? String(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
  }
  return "null";
}

// 自带的同步 SHA-256：浏览器与 Node 都在用，`crypto.subtle` 只有异步版本，
// 而本模块的读写契约整体是同步、永不抛错的（与 `love-story.ts` 同口径）。
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** SHA-256 → 小写 hex。同步、无环境依赖，用于 cardHash 与资产哈希。 */
export function sha256Hex(bytes: Uint8Array): string {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = bytes.length;
  const bitLen = len * 8;
  const padded = new Uint8Array((((len + 9) + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const w15 = w[j - 15];
      const w2 = w[j - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];
    for (let j = 0; j < 64; j++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[j] + w[j]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, "0");
  return out;
}

/**
 * 参与 cardHash 的「卡」：剥掉易变的元数据（`revision`、时间戳，以及派生的 `tavern.cardHash`）。
 * 卡内容不变 → hash 不变（§5：`revision` 管编辑次数，`cardHash` 管内容身份）。
 */
export function personaCardForHash(persona: Persona): Record<string, unknown> {
  const clone = { ...(persona as unknown as Record<string, unknown>) };
  delete clone.revision;
  delete clone.createdAt;
  delete clone.updatedAt;
  const tavern = clone.tavern;
  if (tavern && typeof tavern === "object") {
    const t = { ...(tavern as Record<string, unknown>) };
    delete t.cardHash;
    clone.tavern = t;
  }
  return clone;
}

/** 规范化 JSON → sha256 hex。确定性、可跨系统比对（§2.1 manifest.cardHash）。 */
export function computePersonaCardHash(persona: Persona): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(personaCardForHash(persona))));
}

/* ------------------------------------------------------------------ *
 * 文件分类（只用于路由，绝不据此填充字段）
 * ------------------------------------------------------------------ */

export type PersonaFileKind = "scpersona" | "basic-json" | "tavern-card" | "world-book" | "preset" | "unknown";

export interface PersonaFileClass {
  kind: PersonaFileKind;
  /** 完整 Tavern 制品：引导到 Studio，恋爱系统只报「去哪做」。 */
  guide?: "studio";
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const WEBP = [0x52, 0x49, 0x46, 0x46];

function decodeJson(bytes: Uint8Array): unknown | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 顶层键路由：Tavern V2/V3 卡、世界书、预设一眼分辨；其余对象算「基础 JSON」。 */
export function classifyPersonaJson(value: unknown): PersonaFileKind {
  if (!value || typeof value !== "object") return "unknown";
  if (Array.isArray(value)) {
    // 顶层数组只在像世界书条目时才认（keys/content），否则未知。
    return value.some((item) => item && typeof item === "object" && "content" in (item as object)) ? "world-book" : "unknown";
  }
  const obj = value as Record<string, unknown>;
  const spec = obj.spec;
  if (spec === "chara_card_v2" || spec === "chara_card_v3") return "tavern-card";
  if (obj.data && typeof obj.data === "object") return "tavern-card";
  if (obj.entries !== undefined || obj.world_info !== undefined) return "world-book";
  if (obj.prompts !== undefined || obj.prompt_order !== undefined) return "preset";
  return "basic-json";
}

/**
 * 按文件字节/扩展名分类。PNG/JPEG/图 = Tavern 卡（`guide: "studio"`）；
 * zip = `.scpersona`；JSON 交给 `classifyPersonaJson`。只做路由，不做字段映射。
 */
export function classifyPersonaFile(input: { name?: string; bytes?: Uint8Array }): PersonaFileClass {
  const name = (input.name ?? "").toLowerCase();
  const bytes = input.bytes;
  if (bytes) {
    if (startsWith(bytes, [0x50, 0x4b])) return { kind: "scpersona" };
    if (startsWith(bytes, PNG) || startsWith(bytes, JPG) || startsWith(bytes, GIF) || (startsWith(bytes, WEBP) && bytes.length > 12)) {
      return { kind: "tavern-card", guide: "studio" };
    }
    const json = decodeJson(bytes);
    if (json !== null) return classifyKind(classifyPersonaJson(json));
    return { kind: "unknown" };
  }
  if (name.endsWith(".scpersona")) return { kind: "scpersona" };
  if (/\.(png|apng|jpg|jpeg|gif|webp)$/.test(name)) return { kind: "tavern-card", guide: "studio" };
  if (name.endsWith(".json")) return { kind: "unknown" };
  return { kind: "unknown" };
}

function classifyKind(kind: PersonaFileKind): PersonaFileClass {
  if (kind === "tavern-card" || kind === "world-book" || kind === "preset") return { kind, guide: "studio" };
  return { kind };
}

/* ------------------------------------------------------------------ *
 * 基础 JSON 导入（只映射一小撮核心字段）
 * ------------------------------------------------------------------ */

export type PersonaImportCarry = "worldbook" | "sprites" | "preset";

export interface PersonaImportNotice {
  code: "studio-for-full";
  carries: PersonaImportCarry[];
}

export type PersonaImport =
  | { ok: true; persona: Persona; notices: PersonaImportNotice[] }
  | { ok: false; code: LovePersonaErrorCode; guide?: "studio"; detail?: string };

export interface PersonaImportOptions {
  /** 基础 JSON 没有 kind 线索；NPC 是默认（Tavern 卡基本都是角色）。 */
  kind?: PersonaKind;
  id?: string;
  now?: number;
  sourceFile?: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * 「基础 JSON」允许映射的全部字段（§3 映射表的核心子集）：
 * `name`、`description`→`bio`、`scenario`→`bio`（缺 description 时）、`personality`、
 * `mes_example`→`speechStyle`、`first_mes` / `alternate_greetings`→`greetings`。
 * 别的键（`system_prompt`、`post_history_instructions`、`character_book`、`extensions`…）
 * **不映射**——那属于完整 Tavern 制品，引导到 Studio。
 */
function coreGreetings(obj: Record<string, unknown>): LocalizedText[] {
  const out: LocalizedText[] = [];
  const first = str(obj.first_mes);
  if (first) out.push(localizedFromSingle(first));
  const alt = obj.alternate_greetings;
  if (Array.isArray(alt)) {
    for (const g of alt) {
      const s = str(g);
      if (s) out.push(localizedFromSingle(s));
      if (out.length >= LOVE_PERSONA_GREETINGS_MAX) break;
    }
  }
  return out;
}

/** 文件同时带着世界书/立绘包/预设时，非阻塞地提示「完整导入请用 Studio」（§4.2 验收）。 */
function extrasCarried(obj: Record<string, unknown>): PersonaImportCarry[] {
  const carries: PersonaImportCarry[] = [];
  if (obj.character_book !== undefined || obj.world_info !== undefined || obj.world !== undefined) carries.push("worldbook");
  const ext = obj.extensions;
  const hasSprites =
    obj.sprites !== undefined ||
    obj.assets !== undefined ||
    (ext !== undefined && ext !== null && typeof ext === "object" && "assets" in (ext as object));
  if (hasSprites) carries.push("sprites");
  if (obj.prompts !== undefined || obj.prompt_order !== undefined || obj.temperature !== undefined || obj.preset !== undefined) {
    carries.push("preset");
  }
  return carries;
}

/**
 * 基础 JSON → Persona。遇到完整 Tavern 制品（V2/V3 卡、世界书、预设）直接返回
 * `unsupported` + `guide: "studio"`，**不半成品解析**（§3 硬边界、§4.2 验收）。
 */
export function importBasicPersonaJson(value: unknown, opts: PersonaImportOptions = {}): PersonaImport {
  const kind = classifyPersonaJson(value);
  if (kind === "tavern-card" || kind === "world-book" || kind === "preset") {
    return { ok: false, code: LOVE_PERSONA_ERROR.unsupported, guide: "studio" };
  }
  if (kind !== "basic-json" || !value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: LOVE_PERSONA_ERROR.badShape, detail: "not a basic persona json" };
  }
  const obj = value as Record<string, unknown>;
  const name = str(obj.name);
  const description = str(obj.description);
  const scenario = str(obj.scenario);
  const personality = str(obj.personality);
  const mesExample = str(obj.mes_example);
  const greetings = coreGreetings(obj);
  const bioSource = description ?? scenario;

  if (!name && !bioSource && !personality && !mesExample && !greetings.length) {
    return { ok: false, code: LOVE_PERSONA_ERROR.badShape, detail: "no core persona fields" };
  }

  const now = opts.now ?? Date.now();
  const persona: Persona = {
    v: LOVE_PERSONA_VERSION,
    id: opts.id ?? uid(),
    revision: 1,
    kind: opts.kind ?? "npc",
    name: localizedFromSingle(name ?? ""),
    source: "tavern-import",
    // 原文原样保留在 tavern.raw：未知字段不丢（§3「extensions / creator_notes → tavern.raw」）。
    tavern: { spec: "v1", raw: obj, cardHash: "", sourceFile: opts.sourceFile },
    createdAt: now,
    updatedAt: now,
  };
  if (bioSource) persona.bio = localizedFromSingle(bioSource);
  if (personality) persona.personality = localizedFromSingle(personality);
  if (mesExample) persona.speechStyle = localizedFromSingle(mesExample);
  if (greetings.length) persona.greetings = greetings;
  // 先落一个占位再算 hash：`personaCardForHash` 会剥掉 `tavern.cardHash` 本身，所以结果稳定。
  persona.tavern = { ...persona.tavern!, cardHash: computePersonaCardHash(persona) };

  const carries = extrasCarried(obj);
  const notices: PersonaImportNotice[] = carries.length ? [{ code: "studio-for-full", carries }] : [];
  return { ok: true, persona, notices };
}