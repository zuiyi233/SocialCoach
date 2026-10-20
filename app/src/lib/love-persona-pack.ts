import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  LOVE_PERSONA_ERROR,
  computePersonaCardHash,
  parsePersona,
  sha256Hex,
  type LovePersonaErrorCode,
  type Persona,
  type PersonaSource,
} from "./love-persona";

/**
 * `.scpersona` 打包格式（spec-love-persona §2.1）。
 *
 * zip 内含：`manifest.json`、`persona.json`，可选 `worldbook.json`、`style.json`，
 * 可选 `assets/portraits/*`、`assets/refs/*`。导入时校验 schema、版本与资产哈希；
 * 未知字段由 Persona schema 的 loose 语义原样保留。
 *
 * `cardHash` = 规范化（按键名排序）JSON 的 sha256，见 `persona.ts` 的 `computePersonaCardHash`。
 * 导出可选 `publicOnly`：剥掉 `storyConstraints.secret` 这类私有约束（§2.1「用户可只导出公开字段」）。
 *
 * 只用 zip（fflate 已在依赖里）；§2.1 允许的「JSON + base64 fallback」本次不实现——zip 路径已覆盖，
 * 少一条双向往返的测试面。
 */

export const LOVE_PERSONA_PACK_VERSION = 1 as const;
/** 单个 `.scpersona` 的字节上限。 */
export const LOVE_PERSONA_PACK_MAX_BYTES = 32 * 1024 * 1024;
/** 单个资产（解压后）的字节上限。 */
export const LOVE_PERSONA_ASSET_MAX_BYTES = 8 * 1024 * 1024;

export const LOVE_PERSONA_PACK_MEMBERS = {
  manifest: "manifest.json",
  persona: "persona.json",
  worldbook: "worldbook.json",
  style: "style.json",
  portraits: "assets/portraits/",
  refs: "assets/refs/",
} as const;

export interface PersonaPackAssetRef {
  path: string;
  hash: string;
  size: number;
  mime?: string;
}

export interface PersonaPackManifest {
  version: number;
  id: string;
  revision: number;
  cardHash: string;
  source: PersonaSource;
  license?: string;
  /** 资产清单：路径 → 哈希/大小/类型。读取时逐项复验。 */
  assets?: Record<string, PersonaPackAssetRef>;
}

/** 资产以 data URL 字符串进出（内部解码为二进制存入 zip，读取时还原）。 */
export interface PersonaPackAssets {
  portraits?: Record<string, string>;
  refs?: Record<string, string>;
}

export interface PersonaPackBuildOptions {
  /** 只导出公开字段：剥 `storyConstraints.secret`（§2.1）。 */
  publicOnly?: boolean;
  assets?: PersonaPackAssets;
  /** 可选单独打包的 `worldbook.json`。 */
  worldbook?: unknown;
  /** 可选单独打包的 `style.json`（风格块 / 采样参数）。 */
  style?: unknown;
  source?: PersonaSource;
  license?: string;
  now?: number;
}

export type PersonaPackBuild =
  | { ok: true; bytes: Uint8Array; manifest: PersonaPackManifest }
  | { ok: false; code: LovePersonaErrorCode; detail?: string };

export interface PersonaPack {
  manifest: PersonaPackManifest;
  persona: Persona;
  worldbook?: unknown;
  style?: unknown;
  assets?: PersonaPackAssets;
}

export type PersonaPackRead = { ok: true; pack: PersonaPack } | { ok: false; code: LovePersonaErrorCode; detail?: string };

/** zip 本地文件头魔数：用于在解压前判定「这是不是一个 pack」。 */
export function isPersonaPackBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

/** 剥掉私有约束，只留可公开导出的字段。只剥明确私有的 `secret`（§9「不导出 secret 到 Studio」）。 */
export function stripPrivateConstraints(persona: Persona): Persona {
  if (!persona.storyConstraints || persona.storyConstraints.secret === undefined) return persona;
  const sc = { ...persona.storyConstraints };
  delete sc.secret;
  const next: Persona = { ...persona };
  if (Object.keys(sc).length) next.storyConstraints = sc;
  else delete next.storyConstraints;
  return next;
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

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** `data:<mime>[;base64],<payload>`（或裸 base64）→ 字节 + mime。解不开就退回 UTF-8 文本。 */
function decodeAsset(value: string): { bytes: Uint8Array; mime: string } {
  const comma = value.indexOf(",");
  if (value.startsWith("data:") && comma >= 0) {
    const meta = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    const mime = meta.split(";")[0] || "application/octet-stream";
    if (meta.includes(";base64")) {
      const bytes = base64ToBytes(payload);
      if (bytes) return { bytes, mime };
    } else {
      return { bytes: strToU8(decodeURIComponent(payload)), mime };
    }
  }
  const bare = base64ToBytes(value);
  if (bare) return { bytes: bare, mime: "application/octet-stream" };
  return { bytes: strToU8(value), mime: "application/octet-stream" };
}

function sanitizeAssetId(id: string): string | null {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return id;
}

/**
 * 打包一份 Persona。`cardHash` 由规范化 JSON 决定，先算再写进 `persona.tavern.cardHash`
 * （`personaCardForHash` 会剥掉它，因此不影响 hash 本身）。
 */
export function buildPersonaPack(persona: Persona, opts: PersonaPackBuildOptions = {}): PersonaPackBuild {
  const source = opts.publicOnly ? stripPrivateConstraints(persona) : persona;
  const card: Persona = { ...source };
  if (card.tavern) card.tavern = { ...card.tavern, cardHash: "" };
  const cardHash = computePersonaCardHash(card);
  if (card.tavern) card.tavern = { ...card.tavern, cardHash };

  const parsed = parsePersona(card);
  if (!parsed.ok) return { ok: false, code: parsed.code, detail: parsed.detail };
  const out = parsed.persona;

  const manifest: PersonaPackManifest = {
    version: LOVE_PERSONA_PACK_VERSION,
    id: out.id,
    revision: out.revision,
    cardHash,
    source: opts.source ?? out.source,
  };
  const license = opts.license ?? out.license;
  if (license) manifest.license = license;

  const entries: Record<string, Uint8Array> = {
    [LOVE_PERSONA_PACK_MEMBERS.persona]: strToU8(JSON.stringify(out)),
  };
  if (opts.worldbook !== undefined) entries[LOVE_PERSONA_PACK_MEMBERS.worldbook] = strToU8(JSON.stringify(opts.worldbook));
  if (opts.style !== undefined) entries[LOVE_PERSONA_PACK_MEMBERS.style] = strToU8(JSON.stringify(opts.style));

  const assets = opts.assets ?? {};
  const refs: Record<string, PersonaPackAssetRef> = {};
  for (const [group, prefix] of [
    ["portraits", LOVE_PERSONA_PACK_MEMBERS.portraits],
    ["refs", LOVE_PERSONA_PACK_MEMBERS.refs],
  ] as const) {
    const groupAssets = assets[group];
    if (!groupAssets) continue;
    for (const [id, value] of Object.entries(groupAssets)) {
      const safe = sanitizeAssetId(id);
      if (!safe) return { ok: false, code: LOVE_PERSONA_ERROR.badShape, detail: `bad asset id: ${id}` };
      const { bytes, mime } = decodeAsset(value);
      if (bytes.length > LOVE_PERSONA_ASSET_MAX_BYTES) return { ok: false, code: LOVE_PERSONA_ERROR.assetTooLarge, detail: id };
      const path = `${prefix}${safe}`;
      entries[path] = bytes;
      refs[path] = { path, hash: sha256Hex(bytes), size: bytes.length, mime };
    }
  }
  if (Object.keys(refs).length) manifest.assets = refs;

  entries[LOVE_PERSONA_PACK_MEMBERS.manifest] = strToU8(JSON.stringify(manifest));

  let bytes: Uint8Array;
  try {
    bytes = zipSync(entries);
  } catch {
    return { ok: false, code: LOVE_PERSONA_ERROR.packUnreadable };
  }
  if (bytes.length > LOVE_PERSONA_PACK_MAX_BYTES) return { ok: false, code: LOVE_PERSONA_ERROR.packTooLarge };
  return { ok: true, bytes, manifest };
}

function parseJsonMember(files: Record<string, Uint8Array>, name: string): { ok: true; value: unknown } | { ok: false } {
  const file = files[name];
  if (!file) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(strFromU8(file)) };
  } catch {
    return { ok: false };
  }
}

const PACK_MANIFEST_SOURCE: readonly PersonaSource[] = ["builtin", "tavern-import", "studio-generated", "love-created"];

function isAssetRef(value: unknown): value is PersonaPackAssetRef {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as PersonaPackAssetRef).path === "string" &&
    typeof (value as PersonaPackAssetRef).hash === "string" &&
    typeof (value as PersonaPackAssetRef).size === "number"
  );
}

/** 读 `.scpersona`：校验 schema、版本、cardHash 与资产哈希；未知字段靠 loose Persona 保留。 */
export function readPersonaPack(bytes: Uint8Array): PersonaPackRead {
  if (!isPersonaPackBytes(bytes)) return { ok: false, code: LOVE_PERSONA_ERROR.packUnreadable, detail: "not a zip" };
  if (bytes.length > LOVE_PERSONA_PACK_MAX_BYTES) return { ok: false, code: LOVE_PERSONA_ERROR.packTooLarge };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.originalSize <= LOVE_PERSONA_PACK_MAX_BYTES });
  } catch {
    return { ok: false, code: LOVE_PERSONA_ERROR.packUnreadable };
  }

  const manifestRaw = parseJsonMember(files, LOVE_PERSONA_PACK_MEMBERS.manifest);
  if (!manifestRaw.ok) {
    return { ok: false, code: LOVE_PERSONA_ERROR.packMissing, detail: LOVE_PERSONA_PACK_MEMBERS.manifest };
  }
  const manifest = manifestRaw.value as Partial<PersonaPackManifest>;
  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof manifest.version !== "number" ||
    typeof manifest.id !== "string" ||
    typeof manifest.revision !== "number" ||
    typeof manifest.cardHash !== "string" ||
    !PACK_MANIFEST_SOURCE.includes(manifest.source as PersonaSource)
  ) {
    return { ok: false, code: LOVE_PERSONA_ERROR.packManifest };
  }
  if (manifest.version !== LOVE_PERSONA_PACK_VERSION) {
    // 未来版本单独报 bad-version：和「打包坏了」不是一回事（§5 版本兼容）。
    return { ok: false, code: LOVE_PERSONA_ERROR.badVersion, detail: `pack v${manifest.version}` };
  }

  const personaRaw = parseJsonMember(files, LOVE_PERSONA_PACK_MEMBERS.persona);
  if (!personaRaw.ok) return { ok: false, code: LOVE_PERSONA_ERROR.packMissing, detail: LOVE_PERSONA_PACK_MEMBERS.persona };
  const parsedPersona = parsePersona(personaRaw.value);
  if (!parsedPersona.ok) return { ok: false, code: parsedPersona.code, detail: parsedPersona.detail };
  const persona = parsedPersona.persona;

  if (computePersonaCardHash(persona) !== manifest.cardHash) {
    return { ok: false, code: LOVE_PERSONA_ERROR.packHash, detail: "card hash" };
  }

  const assets: PersonaPackAssets = {};
  for (const ref of Object.values(manifest.assets ?? {})) {
    if (!isAssetRef(ref)) return { ok: false, code: LOVE_PERSONA_ERROR.packManifest, detail: "asset ref" };
    const data = files[ref.path];
    if (!data) return { ok: false, code: LOVE_PERSONA_ERROR.packMissing, detail: ref.path };
    if (sha256Hex(data) !== ref.hash || data.length !== ref.size) {
      return { ok: false, code: LOVE_PERSONA_ERROR.packHash, detail: ref.path };
    }
    if (ref.path.startsWith(LOVE_PERSONA_PACK_MEMBERS.portraits)) {
      assets.portraits ??= {};
      assets.portraits[ref.path.slice(LOVE_PERSONA_PACK_MEMBERS.portraits.length)] =
        `data:${ref.mime ?? "application/octet-stream"};base64,${bytesToBase64(data)}`;
    } else if (ref.path.startsWith(LOVE_PERSONA_PACK_MEMBERS.refs)) {
      assets.refs ??= {};
      assets.refs[ref.path.slice(LOVE_PERSONA_PACK_MEMBERS.refs.length)] =
        `data:${ref.mime ?? "application/octet-stream"};base64,${bytesToBase64(data)}`;
    }
  }

  const pack: PersonaPack = { manifest: manifest as PersonaPackManifest, persona };
  const worldbook = parseJsonMember(files, LOVE_PERSONA_PACK_MEMBERS.worldbook);
  if (worldbook.ok) pack.worldbook = worldbook.value;
  const style = parseJsonMember(files, LOVE_PERSONA_PACK_MEMBERS.style);
  if (style.ok) pack.style = style.value;
  if (assets.portraits || assets.refs) pack.assets = assets;
  return { ok: true, pack };
}