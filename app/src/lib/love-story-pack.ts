import { z } from "zod";
import { canonicalJson, sha256Hex } from "./love-persona";
import type { StoryRecord } from "./love-archive";

/**
 * 故事包（spec-love-bridge §3、§5）：Studio → 半教练 / 半教练 → Studio 的显式交接载体。
 *
 * 单文件 JSON，字段名对齐 spec §3 的 StoryPack。与 `.scpersona` 不同，故事包是纯文本 JSON
 * （`story.json + persona.json` 合一），不压缩、不加密，便于冲突检测（`storyPackHash`）与
 * 人工审阅。
 *
 * 剧透边界（spec §2.4、§5.2）：`hidden` / `secret` / `success` / `failure` /
 * `endingPredicate` / `routeState` / `finalDecision` 不得出现在 story 与 character 里，
 * 构建与解析都统一剥掉并记 warning。`persona` 原样保留（结构交给 love-persona 校验）。
 *
 * quote 纪律（spec §6.1「自由输入才存逐字 quote」）：只有带 `quoteSource: "free-text"`
 * 标记的故事记录才保留 `keyChoices[].quote`；否则丢弃 quote 并记 warning（解析侧）。
 * `buildStoryPack` 在导出时若看到 quote 就补上该标记，保证往返不丢逐字原话。
 */

export const LOVE_STORY_PACK_VERSION = 1 as const;
/** manifest 里写的完整版本号：跨系统识别用，与顶层的 `v` 数字并存。 */
export const LOVE_STORY_PACK_MANIFEST_VERSION = "socialcoach.love-story.v1" as const;
/** 整份故事包的序列化字节上限。 */
export const LOVE_STORY_PACK_MAX_BYTES = 8 * 1024 * 1024;

const PRIVATE_FIELDS = new Set([
  "hidden",
  "secret",
  "success",
  "failure",
  "endingPredicate",
  "routeState",
  "finalDecision",
]);

export interface StoryPackManifest {
  version?: "socialcoach.love-story.v1";
  id: string;
  origin: "studio" | "love";
  createdAt: number;
  /** 作者 / 模型 / 用户。 */
  source: string;
  license?: string;
  characterPackId?: string;
}

export interface StoryPack {
  v: 1;
  manifest: StoryPackManifest;
  story: StoryRecord;
  /** 玩家 persona 快照；结构交给 love-persona 校验，这里只保留。 */
  persona?: unknown;
  /** 可选角色卡公开字段快照。 */
  character?: unknown;
  /** 可选 CG / 立绘引用（引用名 → data URL / 资源 id）。 */
  assets?: Record<string, string>;
}

export interface StoryPackBuildInput {
  story: StoryRecord;
  origin: "studio" | "love";
  source: string;
  license?: string;
  persona?: unknown;
  character?: unknown;
  assets?: Record<string, string>;
  characterPackId?: string;
}
/** 解析失败时把被第十个字段挤掉的关键信息列成可读错误。 */
export type StoryPackParse =
  | { ok: true; pack: StoryPack; warnings: string[] }
  | { ok: false; errors: string[] };

function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

/** 用户可见文本：双语都非空（spec §5「title/summary 是 {zh,en} 非空」）。 */
const locText = z.object({ zh: z.string().min(1).max(20_000), en: z.string().min(1).max(20_000) });

/**
 * `z.looseObject`（不是 `z.object`）：pack 是交接件，未知键必须原样穿过 parse→serialize 往返，
 * 否则 Studio 扩展字段会在半教练侧静默蒸发。manifest / story / keyChoice 都是 loose。
 */
const packManifestSchema = z.looseObject({
  version: z.optional(z.literal(LOVE_STORY_PACK_MANIFEST_VERSION)),
  id: z.string().min(1).max(200),
  origin: z.enum(["studio", "love"]),
  createdAt: z.number(),
  source: z.string().min(1).max(400),
  license: z.string().max(400).optional(),
  characterPackId: z.string().max(200).optional(),
});

const keyChoiceSchema = z.looseObject({
  at: z.number(),
  choice: locText,
  consequence: z.optional(locText),
  quote: z.optional(locText),
});

/** pack 里的 story 比档案更宽：未知键保留，且只在解析后统一剥私有字段。 */
const packStorySchema = z.looseObject({
  id: z.string().min(1).max(200),
  origin: z.enum(["studio", "love"]),
  title: locText,
  summary: locText,
  keyChoices: z.array(keyChoiceSchema).max(100),
  endingId: z.string().max(200).optional(),
  characterPackIds: z.array(z.string().min(1).max(200)).max(100),
  parentStoryId: z.string().max(200).optional(),
  branchId: z.string().max(200).optional(),
  branchOf: z.string().max(200).optional(),
  canonical: z.boolean(),
  packRef: z.string().max(400).optional(),
  createdAt: z.number(),
  quoteSource: z.optional(z.literal("free-text")),
});

const packSchema = z.looseObject({
  v: z.literal(LOVE_STORY_PACK_VERSION),
  manifest: packManifestSchema,
  story: packStorySchema,
  persona: z.unknown().optional(),
  character: z.unknown().optional(),
  assets: z.record(z.string().max(200), z.string().max(4 * 1024 * 1024)).optional(),
});

/**
 * 递归剥掉私有字段（`hidden` / `secret` / `success` / `failure` / `endingPredicate` /
 * `routeState` / `finalDecision`），其余内容原样保留。返回新对象，不修改入参。
 */
export function stripPrivateStoryFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripPrivateStoryFields(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PRIVATE_FIELDS.has(key)) continue;
      next[key] = stripPrivateStoryFields(child);
    }
    return next as unknown as T;
  }
  return value;
}

/** 与 `stripPrivateStoryFields` 同规则，但把被剥掉的位置写进 `warnings`（解析侧要告诉用户）。 */
function stripWithWarnings(value: unknown, path: string, out: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => stripWithWarnings(item, `${path}[${index}]`, out));
  }
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (PRIVATE_FIELDS.has(key)) {
        out.push(`private field removed: ${childPath}`);
        continue;
      }
      next[key] = stripWithWarnings(child, childPath, out);
    }
    return next;
  }
  return value;
}

/**
 * 构建一份故事包。自动剥私有字段（story / character），补 `quoteSource` 标记，
 * 并把 manifest 的版本串写上。`license` 只在调用方给时才写（没给就不写默认许可）。
 * 输入形状不合法或超 8 MB 上限时抛 `SyntaxError`（与 `parseArchive` 同口径）。
 */
export function buildStoryPack(input: StoryPackBuildInput): StoryPack {
  if (input.origin !== "studio" && input.origin !== "love") throw new SyntaxError("story pack origin must be studio or love");
  if (!input.source) throw new SyntaxError("story pack source is required");

  const parsed = packStorySchema.safeParse(input.story);
  if (!parsed.success) throw new SyntaxError("story pack story is invalid");
  const storyRaw = parsed.data as unknown as Record<string, unknown>;

  // 档案里能存 quote 的只有自由输入；导出时用 quoteSource 标记，让另一端知道这是逐字原话。
  const hasQuote = ((storyRaw.keyChoices as { quote?: unknown }[] | undefined) ?? []).some((k) => k.quote !== undefined);
  const story = hasQuote ? { ...storyRaw, quoteSource: "free-text" as const } : storyRaw;

  const characterPackIds = (storyRaw.characterPackIds as string[] | undefined) ?? [];
  const pack: StoryPack = {
    v: LOVE_STORY_PACK_VERSION,
    manifest: {
      version: LOVE_STORY_PACK_MANIFEST_VERSION,
      id: storyRaw.id as string,
      origin: input.origin,
      createdAt: storyRaw.createdAt as number,
      source: input.source,
      ...(input.license !== undefined ? { license: input.license || "CC-BY-4.0" } : {}),
      ...(input.characterPackId !== undefined
        ? { characterPackId: input.characterPackId }
        : characterPackIds.length === 1
          ? { characterPackId: characterPackIds[0] }
          : {}),
    },
    story: stripPrivateStoryFields(story) as unknown as StoryRecord,
  };
  if (input.persona !== undefined) pack.persona = input.persona;
  if (input.character !== undefined) pack.character = stripPrivateStoryFields(input.character);
  if (input.assets !== undefined) pack.assets = input.assets;

  if (byteLength(storyPackJson(pack)) > LOVE_STORY_PACK_MAX_BYTES) {
    throw new SyntaxError(`story pack exceeds ${LOVE_STORY_PACK_MAX_BYTES} bytes`);
  }
  return pack;
}

/**
 * 解析一份故事包（接受对象或 JSON 字符串）。必填缺失 / 版本不符 / 超 8 MB → errors；
 * 未知键保留（round-trip 不丢）；私有字段与无标记 quote 被剥掉并在 warnings 里点名。
 */
export function parseStoryPack(raw: unknown): StoryPackParse {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ["story pack is not valid JSON"] };
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["story pack must be an object"] };
  }
  if ((value as { v?: unknown }).v !== LOVE_STORY_PACK_VERSION) {
    return { ok: false, errors: [`story pack version must be ${LOVE_STORY_PACK_VERSION}`] };
  }

  // quote 过滤必须在校验前：quote 不是必填，去掉后按同一套必填规则验。
  const warnings: string[] = [];
  const storyObj = (value as Record<string, unknown>).story;
  if (!storyObj || typeof storyObj !== "object" || Array.isArray(storyObj)) {
    return { ok: false, errors: ["story pack is missing a story object"] };
  }
  // 在副本上过滤，不改调用方传入的对象。
  const storyRaw = { ...(storyObj as Record<string, unknown>) };
  if (storyRaw.quoteSource !== "free-text") {
    const choices = Array.isArray(storyRaw.keyChoices) ? (storyRaw.keyChoices as Record<string, unknown>[]) : [];
    const nextChoices: Record<string, unknown>[] = [];
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      if (choice && typeof choice === "object" && "quote" in choice) {
        const copy = { ...choice };
        delete (copy as { quote?: unknown }).quote;
        nextChoices.push(copy);
        warnings.push(`story.keyChoices[${i}].quote dropped (not marked quoteSource:free-text)`);
      } else {
        nextChoices.push(choice);
      }
    }
    storyRaw.keyChoices = nextChoices;
    delete (storyRaw as { quoteSource?: unknown }).quoteSource;
  }
  // 过滤后的副本放进新对象：schema 校验与输出都基于它，不修改调用方传入的原始对象。
  const nextValue = { ...(value as Record<string, unknown>), story: storyRaw };

  const parsed = packSchema.safeParse(nextValue);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "."}: ${issue.message}`) };
  }

  // 顶层压平后整包铺开（未知键保留），story / character 单独剥私有字段。
  const data = parsed.data as unknown as Record<string, unknown>;
  const story = stripWithWarnings(data.story, "story", warnings) as unknown as StoryRecord;
  const character = data.character === undefined ? undefined : stripWithWarnings(data.character, "character", warnings);
  const pack: StoryPack = {
    ...(data as unknown as StoryPack),
    story,
    ...(character !== undefined ? { character } : {}),
  };

  if (byteLength(storyPackJson(pack)) > LOVE_STORY_PACK_MAX_BYTES) {
    return { ok: false, errors: [`story pack exceeds ${LOVE_STORY_PACK_MAX_BYTES} bytes`] };
  }
  return { ok: true, pack, warnings };
}

/** 稳定 JSON：递归键排序 + 丢弃 undefined，同一包在任何序列化顺序下得到同一段字节。 */
export function storyPackJson(pack: StoryPack): string {
  return canonicalJson(pack);
}

/** sha256（复用 love-persona 的 sha256Hex）：内容不变 → hash 不变，用于冲突检测。 */
export function storyPackHash(pack: StoryPack): string {
  return sha256Hex(new TextEncoder().encode(storyPackJson(pack)));
}

/** 导出文件名：`socialcoach-story-{slug}-{hash前8}.json`；slug 取标题，稳定且防撞名。 */
export function storyPackFileName(pack: StoryPack): string {
  const title = pack.story.title.zh || pack.story.title.en || pack.story.id;
  const base =
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "story";
  return `socialcoach-story-${base}-${storyPackHash(pack).slice(0, 8)}.json`;
}