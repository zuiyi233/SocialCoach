import { z } from "zod";
import rawManifest from "../../public/love-scenes/manifest.json";

/**
 * 剧本模式场景视觉 manifest（spec-love-scripted-art §2.2）。
 *
 * 资产与授权纪律（与 `love-ambient` 同纪律）：每条场景必须**同时**登记
 * `source` 与 `license`，并且有 `background`，缺一即视为该场景无效——
 * 无效条目在解析时被丢弃，`loveSceneFor` 对它们返回 null。任何坏数据都
 * 静默降级到「没有背景图」= 沿用现有渐变，绝不抛到界面。
 *
 * manifest 用静态 import 进 bundle：Next 构建期就能发现 JSON 语法错误；
 * 运行时再经 zod 校验，坏数据回退空清单。加载器不依赖 window/fetch，
 * 服务端渲染也安全。
 */

/** 背景层：cover 裁切 + object-position 焦点（spec §2.1）。 */
export interface LoveSceneBackground {
  /** 相对 public 的路径，如 "/love-scenes/rio-01.webp"。 */
  src: string;
  /** 焦点百分比 0–100（object-position 的 x），缺省 50。 */
  focusX?: number;
  /** 焦点百分比 0–100（object-position 的 y），缺省 50。 */
  focusY?: number;
}

export type LoveSceneCgAt = "reveal" | "ending" | "beat";

/** CG：背景层之上的整幅插图，只在 reveal / ending / 作者指定 beat 出现。 */
export interface LoveSceneCg {
  src: string;
  at: LoveSceneCgAt;
  caption?: { zh: string; en: string };
}

/** 一个场景（key = scenarioId）的视觉条目。 */
export interface LoveSceneVisual {
  scenarioId: string;
  /** 背景图；解析时缺 background 的条目被丢弃（loveSceneFor 返回 null）。 */
  background?: LoveSceneBackground;
  cg?: LoveSceneCg[];
  /** 生成模型 / 作者 / 授权来源——没有出处的图不进 manifest。 */
  source: string;
  license: string;
}

export interface LoveSceneManifest {
  v: 1;
  scenes: Record<string, LoveSceneVisual>;
  /** 生成脚本用的英文 prompt，key = 资产文件名（加载器忽略）。 */
  prompts?: Record<string, string>;
}

const captionSchema = z.object({
  zh: z.string().min(1).max(120),
  en: z.string().min(1).max(120),
});

const backgroundSchema = z.object({
  src: z.string().min(1).max(300),
  focusX: z.number().min(0).max(100).optional(),
  focusY: z.number().min(0).max(100).optional(),
});

const cgSchema = z.object({
  src: z.string().min(1).max(300),
  at: z.enum(["reveal", "ending", "beat"]),
  caption: captionSchema.optional(),
});

const sceneSchema = z.object({
  scenarioId: z.string().min(1).max(120),
  background: backgroundSchema,
  cg: z.array(cgSchema).optional(),
  source: z.string().min(1).max(500),
  license: z.string().min(1).max(300),
});

const EMPTY: LoveSceneManifest = { v: 1, scenes: {} };

/**
 * 解析并校验整份 manifest。坏数据静默回退：
 * - 顶层形状不对（v 不是 1 / scenes 不是对象）→ 空清单；
 * - 单条场景缺 background 或 source/license、形状不对 → 该条丢弃，其余保留。
 * 不抛异常。
 */
export function parseLoveSceneManifest(raw: unknown): LoveSceneManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY;
  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== 1) return EMPTY;
  if (!candidate.scenes || typeof candidate.scenes !== "object" || Array.isArray(candidate.scenes)) {
    return EMPTY;
  }

  const scenes: Record<string, LoveSceneVisual> = {};
  for (const [key, value] of Object.entries(candidate.scenes as Record<string, unknown>)) {
    if (!key) continue;
    const parsed = sceneSchema.safeParse(value);
    if (!parsed.success) continue;
    scenes[key] = parsed.data;
  }

  const manifest: LoveSceneManifest = { v: 1, scenes };
  // prompts 仅供生成脚本可读（加载器忽略）；同样逐条过滤，坏值不拖垮其余。
  if (candidate.prompts && typeof candidate.prompts === "object" && !Array.isArray(candidate.prompts)) {
    const prompts: Record<string, string> = {};
    for (const [promptKey, promptValue] of Object.entries(candidate.prompts as Record<string, unknown>)) {
      if (typeof promptValue === "string" && promptValue.length > 0) prompts[promptKey] = promptValue;
    }
    if (Object.keys(prompts).length > 0) manifest.prompts = prompts;
  }
  return manifest;
}

let cached: LoveSceneManifest | null = null;

/** 读取 manifest（模块级缓存，只解析一次）；坏数据返回空清单。 */
export function readLoveScenes(): LoveSceneManifest {
  if (!cached) cached = parseLoveSceneManifest(rawManifest);
  return cached;
}

/**
 * 按 scenarioId 查场景视觉；查不到、或条目缺 background / source / license
 * （正常情况这类条目已被解析丢弃）→ null。series 级回退由调用方（E2）负责。
 */
export function loveSceneFor(scenarioId: string): LoveSceneVisual | null {
  const scene = readLoveScenes().scenes[scenarioId];
  if (!scene || !scene.background || !scene.source || !scene.license) return null;
  return scene;
}

/** 只返回匹配 `at` 的那张 CG 的 src；无 CG 或没有匹配节点 → null。 */
export function loveCgFor(scenarioId: string, at: LoveSceneCgAt): string | null {
  const scene = loveSceneFor(scenarioId);
  if (!scene?.cg) return null;
  return scene.cg.find((cg) => cg.at === at)?.src ?? null;
}
