#!/usr/bin/env node
/**
 * gen-love-portraits.mjs —— 恋爱 Galgame 立绘批量生成管线
 *
 * 目标：为 `app/src/data/corpus/` 中 love 场景（love-scenarios-deep-*.ts 等）的
 * 每个非 learner 角色生成 4 个表情的透明背景半身立绘 PNG，
 * 输出到 `app/public/love-portraits/<roleId>-<emotion>.png`，并写出 manifest.json。
 *
 * 后端：本机 ComfyUI（http://127.0.0.1:8188），Qwen-Image 2.1：
 *   - 文生图：UNETLoader(qwen_image_2.1_int8_convrot) + CLIPLoader(pe_t2i) + VAELoader(qwen_image_2.1_vae_bf16)
 *     + TextEncodeQwenImage21 + EmptyLatentImage + KSampler + VAEDecode
 *   - 图生图（角色一致性）：以 neutral 立绘为参考图，TextEncodeQwenImage21 的
 *     images.image_1 参考输入（参考 latent 拼进 conditioning），编码器换 pe_i2i。
 *   - 透明背景：模型原生输出 RGBA，但背景近似不透明；用 easy imageRemBg(BEN2)
 *     抠图，SaveImage 输出透明 PNG。
 *
 * 用法：
 *   node scripts/gen-love-portraits.mjs                        # 全量（默认跳过已存在）
 *   node scripts/gen-love-portraits.mjs --roles=tess           # 只跑 tess
 *   node scripts/gen-love-portraits.mjs --roles=tess --emotions=neutral,smile
 *   node scripts/gen-love-portraits.mjs --force                # 覆盖已存在
 *   node scripts/gen-love-portraits.mjs --no-matte             # 跳过抠图（调试，保存近不透明 RGBA）
 *
 * 幂等：目标 PNG 已存在且非空则默认跳过；--force 强制重新生成。
 * 失败：单张失败打印原因并继续整批，manifest 只记录成功项。
 *
 * 依赖：Node >= 18（fetch 内置），无第三方包。
 * 只读 ComfyUI：不重启服务、不改配置、不装节点；模型文件由 ComfyUI 侧缓存。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

/* ------------------------------------------------------------------ */
/* 常量配置                                                             */
/* ------------------------------------------------------------------ */

const API_BASE = "http://127.0.0.1:8188";

const MODELS = {
  unet: "qwen_image_2.1_int8_convrot.safetensors",
  clipT2I: "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors",
  clipI2I: "qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors",
  vae: "qwen_image_2.1_vae_bf16.safetensors",
};

const SAMPLING = {
  width: 832,
  height: 1216, // 竖版 2:3 半身像
  steps: 30,
  cfg: 1.0, // Flow 模型（Flux 系）标准 cfg=1
  samplerName: "euler",
  scheduler: "simple",
  denoise: 1.0,
  refResolution: 1024, // 参考图送入文本编码器的统一分辨率
};

const MATTE_MODEL = "BEN2"; // easy imageRemBg 的 rem_mode；公开可下载

const NEGATIVE_PROMPT =
  "lowres, bad anatomy, extra fingers, extra limbs, distorted face, watermark, " +
  "text, signature, jpeg artifacts, blurry, cropped, out of frame";

const STYLE_SUFFIX =
  "anime visual-novel character portrait, upper body, clean lineart, soft cel shading, " +
  "transparent background, centered composition";

const EMOTIONS = {
  neutral: { en: "calm neutral expression, facing viewer", zh: "平静中性表情" },
  smile: { en: "warm gentle smile", zh: "温暖微笑" },
  tight: { en: "tight lips, tense expression, brows slightly furrowed", zh: "紧张抿嘴" },
  teary: { en: "teary eyes, glistening, wistful", zh: "含泪欲泣" },
};
const EMOTION_ORDER = ["neutral", "smile", "tight", "teary"];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = join(ROOT, "src", "data", "corpus");
const OUT_DIR = join(ROOT, "public", "love-portraits");
const MANIFEST_PATH = join(OUT_DIR, "manifest.json");
const MANIFEST_SOURCE =
  "Generated with Qwen-Image 2.1 via local ComfyUI; prompts recorded per character (traceable provenance).";

/* ------------------------------------------------------------------ */
/* 小工具                                                               */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([a-zA-Z0-9-]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

function splitList(v) {
  if (!v) return null;
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

function stableSeed(text) {
  return createHash("sha1").update(text).digest().readUInt32BE(0);
}

/* ------------------------------------------------------------------ */
/* corpus 角色解析：从 love 场景 TS 源文件正则提取 characters             */
/* （corpus 内部用无扩展名 import，Node strip-types 无法解析，故直接读源）  */
/* ------------------------------------------------------------------ */

/** 从 `L("zh", "en")` 调用点开始解析出两个字符串，返回 [zh, en, 结束下标]。 */
function parseLCall(text, start) {
  let i = start;
  while (i < text.length && text[i] !== "L") i++;
  if (text[i] !== "L") return null;
  i += 1;
  while (i < text.length && text[i] !== "(") i++;
  if (text[i] !== "(") return null;
  i += 1;

  const readString = () => {
    while (i < text.length && /\s|,/.test(text[i])) i++;
    if (text[i] !== '"') return null;
    i++;
    let out = "";
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\") { out += text[i + 1]; i += 2; continue; }
      if (ch === '"') { i++; return out; }
      out += ch;
      i++;
    }
    return null;
  };

  const zh = readString();
  if (zh === null) return null;
  while (i < text.length && /\s|,/.test(text[i])) i++;
  const en = readString();
  if (en === null) return null;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === ")") i++;
  return [zh, en, i];
}

/** 提取一个字段（如 name/role/personality）的 L() 双语文案。 */
function fieldL(objText, fieldName) {
  const idx = objText.search(new RegExp(`${fieldName}\\s*:`));
  if (idx < 0) return null;
  return parseLCall(objText, idx);
}

/** 解析单个角色对象文本为 {id,name:{zh,en},role:{zh,en},personality:{zh,en},hue,playable}。 */
function parseCharacterObject(text) {
  const idM = text.match(/id:\s*"([^"]+)"/);
  if (!idM) return null;
  const name = fieldL(text, "name");
  const role = fieldL(text, "role");
  const personality = fieldL(text, "personality");
  const hueM = text.match(/hue:\s*(\d+)/);
  const playable = /\bplayable:\s*true/.test(text);
  if (!name) return null;
  return {
    id: idM[1],
    name: { zh: name[0], en: name[1] },
    role: role ? { zh: role[0], en: role[1] } : { zh: "", en: "" },
    personality: personality ? { zh: personality[0], en: personality[1] } : { zh: "", en: "" },
    hue: hueM ? parseInt(hueM[1], 10) : 0,
    playable,
  };
}

/** 扫描一个 TS 文件里所有 characters 数组中的角色。 */
function parseCharactersFromFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  const chars = [];
  const blockRe = /characters:\s*\[([\s\S]*?)\n\s*\],/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const body = m[1];
    // 每个角色对象以 `{` 开头（characters 内部无嵌套花括号）
    const parts = body.split(/\{\s*\n/);
    for (const part of parts) {
      if (!part.trim()) continue;
      const c = parseCharacterObject("{\n" + part);
      if (c) chars.push(c);
    }
  }
  return chars;
}

/** 汇总 love 场景全部角色（去重，跳过 learner）。 */
function loadLoveCharacters() {
  const files = readdirSync(CORPUS_DIR)
    .filter((f) => /^love-scenarios.*\.ts$/.test(f))
    .map((f) => join(CORPUS_DIR, f));
  const byId = new Map();
  for (const f of files) {
    for (const c of parseCharactersFromFile(f)) {
      if (c.id === "you" || c.playable) continue; // 跳过 learner 与 playable
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

/* ------------------------------------------------------------------ */
/* prompt 构建                                                          */
/* ------------------------------------------------------------------ */

/** 角色基础描述（英文，traceable）。 */
function characterBase(c) {
  const bits = [c.name.en, c.role.en ? `(${c.role.en})` : ""];
  if (c.personality.en) bits.push(c.personality.en);
  return bits.filter(Boolean).join(", ");
}

/** 拼出某一表情的完整正向 prompt。refImage 为 null 表示文生图（neutral）。 */
function buildPrompt(c, emotion, refImage) {
  const expr = EMOTIONS[emotion].en;
  if (refImage) {
    return `Same character as the reference image (${characterBase(c)}). ${expr}. ${STYLE_SUFFIX}`;
  }
  return `Portrait of ${characterBase(c)}. ${expr}. ${STYLE_SUFFIX}`;
}

/* ------------------------------------------------------------------ */
/* ComfyUI API：上传 / 提交 / 轮询 / 下载                                */
/* ------------------------------------------------------------------ */

async function comfyJson(path, options = {}) {
  const resp = await fetch(`${API_BASE}${path}`, options);
  return resp.json();
}

/** 上传参考图到 ComfyUI input 目录，返回 LoadImage 可用的文件名。 */
async function uploadImage(filePath, uploadName) {
  const form = new FormData();
  form.append("image", new Blob([readFileSync(filePath)], { type: "image/png" }), uploadName);
  form.append("type", "input");
  form.append("overwrite", "true");
  const j = await comfyJson("/upload/image", { method: "POST", body: form });
  if (j.error) throw new Error(`upload failed: ${JSON.stringify(j.error)}`);
  return uploadName;
}

/** 提交工作流并轮询，返回 { images, error }。 */
async function runWorkflow(promptGraph, { label, timeoutMs = 300000 } = {}) {
  const j = await comfyJson("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: promptGraph, client_id: "love-portraits" }),
  });
  if (!j.prompt_id) {
    const detail = JSON.stringify(j.node_errors || j.error || j).slice(0, 600);
    throw new Error(`[${label}] 提交被拒: ${detail}`);
  }
  const pid = j.prompt_id;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const h = await comfyJson(`/history/${pid}`);
    const rec = h[pid];
    if (!rec) continue;
    if (rec.status?.status_str === "error") {
      const errMsg = rec.status.messages
        .filter((m) => m[0] === "execution_error")
        .map((m) => m[1].exception_message || JSON.stringify(m[1]))
        .join(" | ");
      throw new Error(`[${label}] 执行失败: ${errMsg || "unknown execution error"}`);
    }
    if (rec.outputs && Object.keys(rec.outputs).length > 0) {
      const images = Object.values(rec.outputs).flatMap((o) => o.images || []);
      if (images.length > 0) return images;
    }
  }
  throw new Error(`[${label}] 超时（${Math.round(timeoutMs / 1000)}s）`);
}

/** 下载输出图片字节。 */
async function downloadImage(img) {
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || "",
    type: img.type || "output",
  });
  const resp = await fetch(`${API_BASE}/view?${q}`);
  if (!resp.ok) throw new Error(`下载失败 ${resp.status} for ${img.filename}`);
  return Buffer.from(await resp.arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* 工作流构建                                                           */
/* ------------------------------------------------------------------ */

/**
 * Qwen-Image 2.1 生成工作流（生成 + 抠图一体）。
 * refImage：LoadImage 可用的参考图文件名（null = 文生图）。
 * 节点顺序：1 UNETLoader / 2 CLIPLoader / 3 VAELoader / 4 TextEncodeQwenImage21
 *          / 5 EmptyLatentImage / 6 KSampler / 7 VAEDecode / 8 easy imageRemBg / 9 SaveImage
 */
function buildGenerationWorkflow({ character, emotion, prompt, seed, refImage, useMatte }) {
  const clip = refImage ? MODELS.clipI2I : MODELS.clipT2I;
  const g = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: MODELS.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: clip, type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: MODELS.vae } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: SAMPLING.width, height: SAMPLING.height, batch_size: 1 } },
    "6": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["4", 0], negative: ["4", 1], latent_image: ["5", 0],
        seed, steps: SAMPLING.steps, cfg: SAMPLING.cfg,
        sampler_name: SAMPLING.samplerName, scheduler: SAMPLING.scheduler, denoise: SAMPLING.denoise,
      },
    },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: `love-gen/${character.id}-${emotion}` } },
  };

  const te = { clip: ["2", 0], prompt, negative_prompt: NEGATIVE_PROMPT, resolution: SAMPLING.refResolution };
  if (refImage) {
    g["10"] = { class_type: "LoadImage", inputs: { image: refImage } };
    te.images = { image_1: ["10", 0] };
    te.vae = ["3", 0];
  }
  g["4"] = { class_type: "TextEncodeQwenImage21", inputs: te };

  if (useMatte) {
    // 抠图节点：把 VAEDecode 的 RGBA（背景近似不透明）切成透明背景
    g["8"] = {
      class_type: "easy imageRemBg",
      inputs: { images: ["7", 0], rem_mode: MATTE_MODEL, image_output: "Hide", save_prefix: "love-matte" },
    };
    g["9"].inputs.images = ["8", 0];
  } else {
    g["9"].inputs.images = ["7", 0];
  }
  return g;
}

/** 生成工作流：VAEDecode 直接接 SaveImage（不抠图，调试用）。 */
function buildRawWorkflow(opts) {
  return buildGenerationWorkflow({ ...opts, useMatte: false });
}

/* ------------------------------------------------------------------ */
/* manifest                                                            */
/* ------------------------------------------------------------------ */

function ensureManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    writeFileSync(MANIFEST_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      model: "qwen_image_2.1",
      characters: {},
      source: MANIFEST_SOURCE,
    }, null, 2), "utf8");
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function writeManifest(manifest) {
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
}

/* ------------------------------------------------------------------ */
/* 主流程                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rolesFilter = splitList(args.roles);
  const emotionsFilter = splitList(args.emotions);
  const force = !!args.force;
  const useMatte = !args["no-matte"];
  const stepsOverride = args.steps ? parseInt(args.steps, 10) : null;
  if (stepsOverride) SAMPLING.steps = stepsOverride;

  const characters = loadLoveCharacters().filter((c) => !rolesFilter || rolesFilter.includes(c.id));
  const emotions = EMOTION_ORDER.filter((e) => !emotionsFilter || emotionsFilter.includes(e));
  if (characters.length === 0) {
    console.error("[portraits] 没有匹配的角色（--roles 检查拼写）。");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  ensureManifest();

  console.log(`[portraits] 角色 ${characters.map((c) => c.id).join(",")} × 表情 ${emotions.join(",")}`
    + `（${characters.length * emotions.length} 张；matte=${useMatte ? MATTE_MODEL : "off"}）`);

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const summary = { ok: 0, skipped: 0, failed: 0, elapsedMs: 0 };
  const t0 = Date.now();

  for (const c of characters) {
    const entry = manifest.characters[c.id] ?? (manifest.characters[c.id] = {});
    entry.name ??= c.name;
    entry.hue ??= c.hue;
    entry.emotions ??= {};
    entry.prompts ??= {};
    entry.seeds ??= {};
    entry.prompt ??= null;
    entry.seed ??= null;
    entry.referenceImage ??= null;

    for (const emotion of emotions) {
      const outPath = join(OUT_DIR, `${c.id}-${emotion}.png`);
      const relPath = `${c.id}-${emotion}.png`;
      const refImage = emotion === "neutral" ? null : `${c.id}-neutral.png`;
      const prompt = buildPrompt(c, emotion, refImage);
      const seed = stableSeed(`${c.id}:${emotion}`);

      if (!force && existsSync(outPath) && statSync(outPath).size > 0) {
        entry.emotions[emotion] = relPath;
        entry.prompts[emotion] = prompt;
        entry.seeds[emotion] = seed;
        console.log(`[portraits] ${c.id}/${emotion} 跳过（已存在）`);
        summary.skipped++;
        continue;
      }

      try {
        let images;
        if (useMatte) {
          images = await runWorkflow(buildGenerationWorkflow({ character: c, emotion, prompt, seed, refImage, useMatte }), { label: `${c.id}/${emotion}` });
        } else {
          images = await runWorkflow(buildRawWorkflow({ character: c, emotion, prompt, seed, refImage }), { label: `${c.id}/${emotion}` });
        }

        const bytes = await downloadImage(images[0]);
        if (bytes.length < 1000) throw new Error("输出文件过小，疑似空图");
        writeFileSync(outPath, bytes);

        // neutral 立绘上传作后续表情的参考图
        if (emotion === "neutral") {
          await uploadImage(outPath, `${c.id}-neutral.png`).catch((e) =>
            console.warn(`[portraits] ${c.id}/neutral 参考图上传失败（后续表情一致性可能受影响）: ${e.message.slice(0, 160)}`));
        }

        entry.emotions[emotion] = relPath;
        entry.prompts[emotion] = prompt;
        entry.seeds[emotion] = seed;
        entry.referenceImage = emotion === "neutral" ? null : `${c.id}-neutral.png`;
        summary.ok++;
        console.log(`[portraits] ${c.id}/${emotion} done (${Math.round(bytes.length / 1024)}KB${useMatte ? "" : "，无抠图"})`);
      } catch (e) {
        summary.failed++;
        console.error(`[portraits] ${c.id}/${emotion} 失败: ${e.message.slice(0, 400)}`);
      }
    }

    // 角色级 prompt/seed = neutral 表情的（与其他表情的 prompts/seeds 分开记录）
    if (entry.emotions.neutral) {
      entry.prompt = entry.prompts.neutral ?? null;
      entry.seed = entry.seeds.neutral ?? null;
    }
  }

  writeManifest(manifest);
  summary.elapsedMs = Date.now() - t0;
  console.log(`[portraits] 完成: 成功 ${summary.ok}，跳过 ${summary.skipped}，失败 ${summary.failed}，耗时 ${Math.round(summary.elapsedMs / 1000)}s`);
  console.log(`[portraits] manifest: ${MANIFEST_PATH}`);
}

// 仅在直接执行本文件时运行主流程（import 时不触发，便于复用构建/解析函数）
const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    console.error("[portraits] 致命错误:", e);
    process.exit(1);
  });
}

export { loadLoveCharacters, buildPrompt, buildGenerationWorkflow, buildRawWorkflow, EMOTIONS, EMOTION_ORDER };
