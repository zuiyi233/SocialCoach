#!/usr/bin/env node
/**
 * 剧本模式场景背景 / CG 批量生成脚本（F3 素材，spec-love-scripted-art §4）。
 *
 * 读 public/love-scenes/manifest.json 的顶层 prompts（key = 资产文件名），
 * 对每个 key 调一次 OpenAI 兼容的 images/generations 接口，把图写到
 * public/love-scenes/{key}.png。
 *
 * 入库的是同名 .webp（PNG 不入库，整目录约 12 MB）。转法（Pillow，质量 82 / method 6）：
 *   python -c "from PIL import Image; import glob; \
 *     [Image.open(p).save(p[:-4] + '.webp', 'WEBP', quality=82, method=6) for p in glob.glob('public/love-scenes/*.png')]"
 * 转完逐张目检，再删 PNG。
 *
 * 用法：
 *   LOVE_SCENE_IMAGE_BASE=https://your-gateway.example/v1 \
 *   LOVE_SCENE_IMAGE_KEY=... \
 *   node scripts/generate-love-scenes.mjs [--force]
 *
 * 环境变量（密钥只从环境变量读，代码里不写默认值、不打印完整 key）：
 *   LOVE_SCENE_IMAGE_BASE  OpenAI 兼容 base URL（必填，如上面的示例）
 *   LOVE_SCENE_IMAGE_KEY   API key（必填）
 *   LOVE_SCENE_IMAGE_MODEL 模型名（默认 agnes-image-2.5-flash）
 *
 * 参数：
 *   --force  已存在的 {key}.png 也重新生成；默认跳过已存在文件
 *   --help   打印本说明并退出
 *
 * 行为：
 *   - 单张失败只打印 key + HTTP 状态码 + 响应体前 300 字，继续下一张；
 *   - 全部跑完打印 成功/失败 汇总；有失败时 exit 1。
 *   - Node 18+ 原生 fetch，无第三方依赖。
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "public", "love-scenes", "manifest.json");
const IMAGE_SIZE = "1280x720";

const args = process.argv.slice(2);
const force = args.includes("--force");
const wantsHelp = args.includes("--help") || args.includes("-h");

function usage() {
  return [
    "用法: LOVE_SCENE_IMAGE_BASE=... LOVE_SCENE_IMAGE_KEY=... node scripts/generate-love-scenes.mjs [--force]",
    "",
    "读 public/love-scenes/manifest.json 的 prompts，逐张生成图片，写到",
    "public/love-scenes/{key}.png（先 PNG，主控再转 WebP）。",
    "",
    "环境变量（密钥只从环境变量读，不写默认值）：",
    "  LOVE_SCENE_IMAGE_BASE    OpenAI 兼容 images/generations 的 base URL（必填，如 https://your-gateway.example/v1）",
    "  LOVE_SCENE_IMAGE_KEY     API key（必填）",
    "  LOVE_SCENE_IMAGE_MODEL   模型名（默认 agnes-image-2.5-flash）",
    "",
    "参数：",
    "  --force   已存在的 {key}.png 也重新生成（默认跳过）",
  ].join("\n");
}

/** 拉一张图：兼容 b64_json 与 url 两种返回；url 路径校验 content-type 是 image/*。 */
async function generateOne({ base, key, model, prompt }) {
  const endpoint = `${base.replace(/\/+$/, "")}/images/generations`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        size: IMAGE_SIZE,
        n: 1,
        response_format: "b64_json",
      }),
    });
  } catch (err) {
    throw new Error(`请求失败（非 HTTP）：${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json().catch(() => null);
  if (!json || !Array.isArray(json.data) || json.data.length === 0) {
    throw new Error(`响应里没有 data 数组: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const item = json.data[0];
  if (item && typeof item.b64_json === "string" && item.b64_json.length > 0) {
    return Buffer.from(item.b64_json, "base64");
  }
  if (item && typeof item.url === "string" && item.url) {
    return downloadImage(item.url);
  }
  throw new Error(`无法识别返回格式: ${JSON.stringify(item ?? {}).slice(0, 300)}`);
}

/** url 返回路径：拉取并校验 content-type 是 image/*。 */
async function downloadImage(url) {
  if (!/^https?:\/\//.test(url)) throw new Error(`图片 url 非法: ${url.slice(0, 120)}`);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`拉取图片 HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) {
    throw new Error(`content-type 不是 image/*: ${type || "(无 content-type)"}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("图片内容为空");
  return buf;
}

async function main() {
  if (wantsHelp) {
    console.log(usage());
    return;
  }
  const base = process.env.LOVE_SCENE_IMAGE_BASE;
  const apiKey = process.env.LOVE_SCENE_IMAGE_KEY;
  if (!base || !apiKey) {
    console.error(usage());
    console.error("");
    console.error(`缺少环境变量：${!base ? "LOVE_SCENE_IMAGE_BASE" : ""} ${!apiKey ? "LOVE_SCENE_IMAGE_KEY" : ""}`.trim());
    process.exit(1);
  }
  const model = process.env.LOVE_SCENE_IMAGE_MODEL || "agnes-image-2.5-flash";

  let raw;
  try {
    raw = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (err) {
    console.error(`无法读取 ${MANIFEST_PATH}: ${err.message}`);
    process.exit(1);
  }
  const prompts = raw && typeof raw === "object" ? raw.prompts : null;
  if (!prompts || typeof prompts !== "object" || Array.isArray(prompts)) {
    console.error("manifest 里没有顶层 prompts 对象");
    process.exit(1);
  }

  const entries = Object.entries(prompts).filter(([, prompt]) => typeof prompt === "string" && prompt.trim().length > 0);
  console.log(`共 ${entries.length} 张待处理（base=${base}，model=${model}）`);

  let ok = 0;
  let fail = 0;
  for (const [name, prompt] of entries) {
    const outPath = join(ROOT, "public", "love-scenes", `${name}.png`);
    if (!force) {
      try {
        await access(outPath);
        console.log(`[skip] ${name}: 已存在`);
        ok++;
        continue;
      } catch {
        /* 不存在，继续生成 */
      }
    }
    try {
      const buf = await generateOne({ base, key: apiKey, model, prompt });
      await writeFile(outPath, buf);
      console.log(`[ok] ${name}: 写入 ${outPath}（${buf.length} bytes）`);
      ok++;
    } catch (err) {
      fail++;
      console.error(`[fail] ${name}: ${err.message}`);
    }
  }

  console.log(`完成：成功 ${ok}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
