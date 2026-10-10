#!/usr/bin/env node
/**
 * gen-love-portraits.mjs —— 恋爱 Galgame 立绘批量生成管线
 *
 * 目标：为 `app/src/data/corpus/` 中 love 场景（love-scenarios-deep-*.ts 等）的
 * 每个非 learner 角色生成 4 个表情的透明背景半身立绘 PNG，
 * 输出到 `app/public/love-portraits/<roleId>-<emotion>.png`，并写出 manifest.json。
 *
 * 后端：本机 ComfyUI（http://127.0.0.1:8188），Qwen-Image 2.1 Turbo（官方 8 步）：
 *   UNETLoader(qwen_image_2.1_turbo_bf16) + CLIPLoader(qwen3vl_8b_int8_convrot, type=qwen_image)
 *   + VAELoader(qwen_image_2.1_vae_bf16) + TextEncodeQwenImage21
 *   + KSamplerSelect(euler) + ManualSigmas(官方 8 步) + SamplerCustom(cfg=1) + VAEDecode → SaveImage
 *   - 文生图（neutral）：latent 用 EmptyLatentImage(宽×高) 指定竖版画幅。
 *   - 图生图（其余表情，角色一致性）：neutral 立绘作 images.image_1 参考，同时把
 *     TextEncodeQwenImage21 的第 3 个输出 latent（按首张参考图尺寸）接进采样器。
 *   - 透明背景：模型原生输出 RGBA，无需抠图。qwen_image_2.1_vae 是 Wan2.2 布局的
 *     4 通道 RGBA VAE（comfy/sd.py:840，decoder 输出 4 通道），alpha 由模型自己生成。
 *
 * 用法：
 *   node scripts/gen-love-portraits.mjs                        # 全量（默认跳过已存在）
 *   node scripts/gen-love-portraits.mjs --roles=tess           # 只跑 tess
 *   node scripts/gen-love-portraits.mjs --roles=tess --emotions=neutral,smile
 *   node scripts/gen-love-portraits.mjs --force                # 覆盖已存在
 *   node scripts/gen-love-portraits.mjs --pack-only            # 不重出图，只把原图重新打包成交付尺寸
 *
 * 幂等：交付 PNG 已存在且非空则默认跳过；--force 强制重新生成。
 * 产物：832×1248 原图写 `.portrait-masters/`（gitignore，重出/参考图用），
 *      512×768 交付图写 `public/love-portraits/`（入库）。
 * 失败：单张失败打印原因并继续整批，manifest 只记录成功项。
 *
 * 依赖：Node >= 18（fetch 内置），无第三方包。
 * 只读 ComfyUI：不重启服务、不改配置、不装节点；模型文件由 ComfyUI 侧缓存。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { inflateSync, deflateSync } from "node:zlib";

/* ------------------------------------------------------------------ */
/* 常量配置                                                             */
/* ------------------------------------------------------------------ */

const API_BASE = "http://127.0.0.1:8188";

const MODELS = {
  unet: "qwen_image_2.1_turbo_bf16.safetensors",
  clip: "qwen3vl_8b_int8_convrot.safetensors",
  vae: "qwen_image_2.1_vae_bf16.safetensors",
};

const SAMPLING = {
  width: 832,
  height: 1248, // 竖版 2:3 半身像；与编辑路径下 TextEncodeQwenImage21 由参考图算出的
                // 画幅一致（按 32 取整），否则 neutral 与其余 3 个表情尺寸不一致。
  cfg: 1.0, // Turbo 蒸馏 flow 模型：cfg 固定 1，负向提示不参与采样
  samplerName: "euler",
  // 官方 8 步 sigma 表（末尾保留 0）。不要用 steps/scheduler——Turbo 权重只在这条
  // 噪声轨迹上训练过，30 步 + simple scheduler 会出噪点。
  sigmas: "1, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0",
  refResolution: 1024, // 参考图送入编码器的统一分辨率（同时决定编辑路径 latent 画幅）
};

// 交付尺寸：UI 里 AvatarStand 默认 216 CSS px 宽，512 已覆盖到 2.3×DPR；832×1248 原图
// 只用于重出与参考图，215MB 不入库（见 .gitignore 的 .portrait-masters/）。
const WEB = { width: 512, height: 768 };

// 产物体检阈值：由本机 113 张坏图（edgeEnergy 8-35）与正常立绘（约 3）标定。
const QUALITY = {
  maxEdgeEnergy: 6,      // 超过即判噪点
  minClearFrac: 0.05,    // 至少 5% 全透明，否则背景没抠出来
  minOpaqueFrac: 0.20,   // 至少 20% 不透明，否则没有主体
  maxMidFrac: 0.10,      // 半透明（32-200）占比；正常只有轮廓边约 0.5-1.7%，起雾的整幅蒙版会到 30%+
  maxAttempts: 5,        // 不合格换种子重试次数（编辑路径会整段锁死白底，3 次不够）
};

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
const MASTERS_DIR = join(ROOT, ".portrait-masters"); // 832×1248 原图，gitignore
const MANIFEST_PATH = join(OUT_DIR, "manifest.json");
const MANIFEST_SOURCE =
  "Generated with Qwen-Image 2.1 Turbo (official 8-step sigmas, cfg=1) via local ComfyUI; " +
  "transparent background is native RGBA from the 2.1 VAE (no cutout). Prompts and seeds recorded per character.";

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

/**
 * 从角色自身文案的英文代词推断性别呈现。
 * 语料没有 appearance / gender 字段，所以只用文案里已有的证据，不臆造；
 * 证据冲突或缺失一律返回 null（prompt 不写性别，交给模型）。
 */
function genderFromText(c) {
  const t = `${c.personality.en} ${c.role.en}`;
  const f = (t.match(/\b(she|her|hers)\b/gi) || []).length;
  const m = (t.match(/\b(he|him|his)\b/gi) || []).length;
  if (f && !m) return "female";
  if (m && !f) return "male";
  return null;
}

/** 角色基础描述（英文，traceable）。 */
function characterBase(c) {
  const bits = [c.name.en, c.role.en ? `(${c.role.en})` : ""];
  if (c.personality.en) bits.push(c.personality.en);
  return bits.filter(Boolean).join(", ");
}

/** 拼出某一表情的完整正向 prompt。refImage 为 null 表示文生图（neutral）。 */
function buildPrompt(c, emotion, refImage) {
  const expr = EMOTIONS[emotion].en;
  const g = genderFromText(c);
  const who = g === "female" ? "a woman" : g === "male" ? "a man" : "a person";
  if (refImage) {
    return `Same character as the reference image (${who}, ${characterBase(c)}). ${expr}. ${STYLE_SUFFIX}`;
  }
  return `Portrait of ${who}, ${characterBase(c)}. ${expr}. ${STYLE_SUFFIX}`;
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
/* 产物体检（无需人眼，拦噪点和抠图失败）                                 */
/* ------------------------------------------------------------------ */

/** 解 8bit 非隔行 PNG 为像素缓冲；只支持本管线会遇到的真彩/灰度类型。 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IHDR") {
      ihdr = {
        w: buf.readUInt32BE(off + 8), h: buf.readUInt32BE(off + 12),
        depth: buf[off + 16], ct: buf[off + 17], interlace: buf[off + 20],
      };
    } else if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const { w, h, depth, ct, interlace } = ihdr || {};
  if (depth !== 8 || interlace !== 0) throw new Error(`不支持的 PNG（depth=${depth} interlace=${interlace}）`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error(`不支持的 colorType=${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let rec;
      switch (ft) {
        case 0: rec = v; break;
        case 1: rec = a + v; break;
        case 2: rec = b + v; break;
        case 3: rec = ((a + b) >> 1) + v; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          rec = (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) + v;
          break;
        }
        default: rec = v;
      }
      out[y * stride + x] = rec & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

/**
 * 统计 alpha 分布与相邻像素梯度。
 * edgeEnergy 是噪点判据：正常立绘有大片平涂区，相邻像素差约 3；
 * 噪点图在任意方向都剧烈跳变（本机 113 张坏图实测 8-35）。
 */
function inspectPortrait(bytes) {
  const { w, h, ch, data } = decodePng(bytes);
  const px = (x, y, k) => data[(y * w + x) * ch + k];
  const alpha = (x, y) => (ch === 4 ? px(x, y, 3) : 255);
  const total = w * h;
  let clear = 0, opaque = 0, mid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha(x, y);
      if (a < 32) clear++; else if (a > 200) opaque++; else mid++;
    }
  }
  let diffSum = 0, diffN = 0;
  for (let y = 1; y < h - 1; y += 3) {
    for (let x = 1; x < w - 1; x += 3) {
      if (alpha(x, y) < 200) continue;
      diffSum += (Math.abs(px(x, y, 0) - px(x + 1, y, 0)) + Math.abs(px(x, y, 1) - px(x + 1, y, 1))
        + Math.abs(px(x, y, 2) - px(x + 1, y, 2)) + Math.abs(px(x, y, 0) - px(x, y + 1, 0))
        + Math.abs(px(x, y, 1) - px(x, y + 1, 1)) + Math.abs(px(x, y, 2) - px(x, y + 1, 2))) / 6;
      diffN++;
    }
  }
  return {
    w, h,
    clearFrac: clear / total,
    opaqueFrac: opaque / total,
    midFrac: mid / total,
    edgeEnergy: diffN ? diffSum / diffN : Infinity,
  };
}

/** 体检规则；返回不通过原因数组（空数组 = 合格）。 */
function portraitRejectReasons(m, { width, height }) {
  const r = [];
  if (m.w !== width || m.h !== height) r.push(`尺寸 ${m.w}x${m.h} != ${width}x${height}`);
  if (m.edgeEnergy > QUALITY.maxEdgeEnergy) r.push(`edgeEnergy ${m.edgeEnergy.toFixed(2)} > ${QUALITY.maxEdgeEnergy}（疑似噪点）`);
  if (m.clearFrac < QUALITY.minClearFrac) r.push(`透明像素 ${(m.clearFrac * 100).toFixed(1)}% < ${(QUALITY.minClearFrac * 100).toFixed(0)}%（背景没透明）`);
  if (m.opaqueFrac < QUALITY.minOpaqueFrac) r.push(`不透明像素 ${(m.opaqueFrac * 100).toFixed(1)}% < ${(QUALITY.minOpaqueFrac * 100).toFixed(0)}%（没有主体）`);
  // 半透明带只该出现在轮廓边缘（正常约 0.5%）；整幅起雾时 alpha 既不全透也不全不透，
  // 上面三条都查不出来，必须单独卡这一条。
  if (m.midFrac > QUALITY.maxMidFrac) r.push(`半透明像素 ${(m.midFrac * 100).toFixed(1)}% > ${(QUALITY.maxMidFrac * 100).toFixed(0)}%（画面起雾/蒙版不干净）`);
  return r;
}

/* ------------------------------------------------------------------ */
/* 打包：原图不入库，交付 512×768 web 版                                 */
/* ------------------------------------------------------------------ */

/** 面积平均重采样（预乘 alpha，避免边缘出现亮/暗描边）。 */
function resizeRGBA(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xs = sw / dw, ys = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * ys, y1 = Math.min(sh, y0 + ys);
    for (let x = 0; x < dw; x++) {
      const x0 = x * xs, x1 = Math.min(sw, x0 + xs);
      let ra = 0, ga = 0, ba = 0, aa = 0, wsum = 0;
      const iy0 = Math.floor(y0), iy1 = Math.ceil(y1), ix0 = Math.floor(x0), ix1 = Math.ceil(x1);
      for (let iy = iy0; iy < iy1; iy++) {
        const wy = Math.min(iy + 1, y1) - Math.max(iy, y0);
        if (wy <= 0) continue;
        for (let ix = ix0; ix < ix1; ix++) {
          const wx = Math.min(ix + 1, x1) - Math.max(ix, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const s = (iy * sw + ix) * 4;
          const a = src[s + 3];
          ra += src[s] * a * w; ga += src[s + 1] * a * w; ba += src[s + 2] * a * w;
          aa += a * w; wsum += w;
        }
      }
      const d = (y * dw + x) * 4;
      if (aa === 0) { out[d + 3] = 0; continue; }
      const aAvg = aa / wsum;
      out[d] = Math.round(ra / aa);
      out[d + 1] = Math.round(ga / aa);
      out[d + 2] = Math.round(ba / aa);
      out[d + 3] = Math.round(aAvg);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 逐行选最优 PNG filter（0-4，按绝对差和最小），比固定 filter 0 小 30-40%。 */
function filterRows(rgba, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = null, bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      const cand = Buffer.alloc(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = up ? up[i] : 0;
        const c = up && i >= bpp ? up[i - bpp] : 0;
        let pred;
        switch (f) {
          case 0: pred = 0; break;
          case 1: pred = a; break;
          case 2: pred = b; break;
          case 3: pred = (a + b) >> 1; break;
          default: {
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          }
        }
        const v = (row[i] - pred) & 0xff;
        cand[i] = v;
        score += v > 127 ? 256 - v : v; // 有符号绝对差
      }
      if (score < bestScore) { bestScore = score; best = { f, cand }; }
    }
    out[y * (1 + stride)] = best.f;
    best.cand.copy(out, y * (1 + stride) + 1);
  }
  return out;
}

/** 编 8bit RGBA PNG（colorType 6）。 */
function encodeRGBApng(rgba, w, h) {
  const rows = filterRows(rgba, w, h, 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bitDepth 8, colorType RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 把原图缩到 web 尺寸写盘，返回交付文件字节数。 */
function packWebVersion(masterPath, webPath) {
  const img = decodePng(readFileSync(masterPath));
  if (img.ch !== 4) throw new Error(`${masterPath} 不是 RGBA（ch=${img.ch}）`);
  const scaled = resizeRGBA(img.data, img.w, img.h, WEB.width, WEB.height);
  const bytes = encodeRGBApng(scaled, WEB.width, WEB.height);
  writeFileSync(webPath, bytes);
  return bytes.length;
}

/* ------------------------------------------------------------------ */
/* 工作流构建                                                           */
/* ------------------------------------------------------------------ */

/**
 * Qwen-Image 2.1 Turbo 生成工作流（原生透明背景，无抠图）。
 * refImage：LoadImage 可用的参考图文件名（null = 文生图）。
 * 节点：1 UNETLoader / 2 CLIPLoader / 3 VAELoader / 4 TextEncodeQwenImage21
 *      / 5 KSamplerSelect / 6 ManualSigmas / 7 SamplerCustom / 8 VAEDecode / 9 SaveImage
 *      / 10 EmptyLatentImage（文生图）或 LoadImage（图生图）
 */
function buildGenerationWorkflow({ character, emotion, prompt, seed, refImage }) {
  const g = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: MODELS.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: MODELS.vae } },
    "5": { class_type: "KSamplerSelect", inputs: { sampler_name: SAMPLING.samplerName } },
    "6": { class_type: "ManualSigmas", inputs: { sigmas: SAMPLING.sigmas } },
    "7": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["4", 0], negative: ["4", 1],
        sampler: ["5", 0], sigmas: ["6", 0], latent_image: ["4", 2],
        add_noise: true, noise_seed: seed, cfg: SAMPLING.cfg,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: `love-gen/${character.id}-${emotion}` } },
  };

  const te = { clip: ["2", 0], prompt, negative_prompt: NEGATIVE_PROMPT, resolution: SAMPLING.refResolution };
  if (refImage) {
    // 编辑路径：参考图同时进视觉编码器与 VAE 参考 latent；采样 latent 用节点按首张
    // 参考图尺寸给出的输出（["4", 2]），换画幅会偏移编辑结果。
    // Autogrow 输入在 API 格式下必须用点号键名；写成 images: { image_1: ... } 会被
    // 静默丢弃——不报错，只是参考图完全不生效（退化成文生图，latent 变回正方形）。
    g["10"] = { class_type: "LoadImage", inputs: { image: refImage } };
    te["images.image_1"] = ["10", 0];
    te.vae = ["3", 0];
  } else {
    // 文生图：节点自身的 latent 是正方形，竖版需要显式 EmptyLatentImage。
    g["10"] = { class_type: "EmptyLatentImage", inputs: { width: SAMPLING.width, height: SAMPLING.height, batch_size: 1 } };
    g["7"].inputs.latent_image = ["10", 0];
  }
  g["4"] = { class_type: "TextEncodeQwenImage21", inputs: te };
  return g;
}

/* ------------------------------------------------------------------ */
/* manifest                                                            */
/* ------------------------------------------------------------------ */

function ensureManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    writeFileSync(MANIFEST_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      model: "qwen_image_2.1_turbo",
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
  const packOnly = !!args["pack-only"];

  const characters = loadLoveCharacters().filter((c) => !rolesFilter || rolesFilter.includes(c.id));
  const emotions = EMOTION_ORDER.filter((e) => !emotionsFilter || emotionsFilter.includes(e));
  if (characters.length === 0) {
    console.error("[portraits] 没有匹配的角色（--roles 检查拼写）。");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(MASTERS_DIR, { recursive: true });
  ensureManifest();

  console.log(`[portraits] 角色 ${characters.map((c) => c.id).join(",")} × 表情 ${emotions.join(",")}`
    + `（${characters.length * emotions.length} 张；原生 RGBA，无抠图；交付 ${WEB.width}×${WEB.height}${packOnly ? "，仅重打包" : ""}）`);

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
      const masterPath = join(MASTERS_DIR, `${c.id}-${emotion}.png`);
      const relPath = `${c.id}-${emotion}.png`;
      const refImage = emotion === "neutral" ? null : `${c.id}-neutral.png`;
      const prompt = buildPrompt(c, emotion, refImage);
      const seed = stableSeed(`${c.id}:${emotion}`);

      if (packOnly) {
        if (!existsSync(masterPath)) {
          summary.failed++;
          console.warn(`[portraits] ${c.id}/${emotion} 没有原图（${masterPath}），跳过`);
          continue;
        }
        const webBytes = packWebVersion(masterPath, outPath);
        entry.emotions[emotion] = relPath;
        summary.ok++;
        console.log(`[portraits] ${c.id}/${emotion} 重打包 (${Math.round(webBytes / 1024)}KB)`);
        continue;
      }

      if (!force && existsSync(outPath) && statSync(outPath).size > 0) {
        entry.emotions[emotion] = relPath;
        entry.prompts[emotion] = prompt;
        entry.seeds[emotion] = seed;
        console.log(`[portraits] ${c.id}/${emotion} 跳过（已存在）`);
        summary.skipped++;
        continue;
      }

      try {
        let bytes = null, usedSeed = seed, metrics = null, reasons = [];
        for (let attempt = 0; attempt < QUALITY.maxAttempts; attempt++) {
          const s = seed + attempt * 7919; // 稳定种子会让同一缺陷无限复现，重试必须换种子
          const images = await runWorkflow(
            buildGenerationWorkflow({ character: c, emotion, prompt, seed: s, refImage }),
            { label: `${c.id}/${emotion}#${attempt + 1}` },
          );
          const b = await downloadImage(images[0]);
          if (b.length < 1000) throw new Error("输出文件过小，疑似空图");
          metrics = inspectPortrait(b);
          reasons = portraitRejectReasons(metrics, SAMPLING);
          bytes = b;
          usedSeed = s;
          if (reasons.length === 0) break;
          console.warn(`[portraits] ${c.id}/${emotion} 第 ${attempt + 1} 次不合格: ${reasons.join("；")} → 换种子重试`);
        }
        if (reasons.length > 0) throw new Error(`连续 ${QUALITY.maxAttempts} 次体检不合格: ${reasons.join("；")}`);

        writeFileSync(masterPath, bytes);
        const webBytes = packWebVersion(masterPath, outPath);

        // neutral 原图上传作后续表情的参考图（保留 alpha，编辑路径靠它传透明底）
        if (emotion === "neutral") {
          await uploadImage(masterPath, `${c.id}-neutral.png`).catch((e) =>
            console.warn(`[portraits] ${c.id}/neutral 参考图上传失败（后续表情一致性可能受影响）: ${e.message.slice(0, 160)}`));
        }

        entry.emotions[emotion] = relPath;
        entry.prompts[emotion] = prompt;
        entry.seeds[emotion] = usedSeed;
        entry.referenceImage = emotion === "neutral" ? null : `${c.id}-neutral.png`;
        summary.ok++;
        const reroll = usedSeed !== seed ? `，体检重出 seed→${usedSeed}` : "";
        console.log(`[portraits] ${c.id}/${emotion} done (交付 ${Math.round(webBytes / 1024)}KB / 原图 ${Math.round(bytes.length / 1024)}KB`
          + `，透明 ${(metrics.clearFrac * 100).toFixed(0)}%，edge ${metrics.edgeEnergy.toFixed(1)}${reroll})`);
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

export { loadLoveCharacters, buildPrompt, genderFromText, buildGenerationWorkflow, inspectPortrait, portraitRejectReasons, QUALITY, EMOTIONS, EMOTION_ORDER };
