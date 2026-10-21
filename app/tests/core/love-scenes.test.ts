/** F3 场景视觉 manifest：加载 / 校验 / 降级（spec-love-scripted-art §2.2）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseLoveSceneManifest,
  loveSceneFor,
  loveCgFor,
  readLoveScenes,
  type LoveSceneVisual,
} from "../../src/lib/love-scenes";

const scene = (over: Partial<LoveSceneVisual> = {}): LoveSceneVisual => ({
  scenarioId: "s-1",
  background: { src: "/love-scenes/s-1.webp", focusX: 50, focusY: 45 },
  source: "Agnes image 2.5 flash / SocialCoach",
  license: "CC-BY-4.0",
  ...over,
});

/** 静态 import 的 manifest 在测试里能直接读到：readLoveScenes 解析内置 JSON。 */
test("the built-in manifest covers all six Rio acts with source/license/background", () => {
  const manifest = readLoveScenes();
  assert.equal(manifest.v, 1, "v 字段应为 1");

  const rioActIds = [
    "love-approach-received-interest",
    "love-define-rio-pace-talk",
    "love-family-decision-pressure",
    "love-rio-secondment-deadline",
    "love-rio-family-settled",
    "love-rio-deadline-night",
  ];
  for (const id of rioActIds) {
    const visual = loveSceneFor(id);
    assert.ok(visual, `Rio 六幕 ${id} 应有视觉条目`);
    assert.ok(visual.background?.src.startsWith("/love-scenes/"), `${id} 的 background.src 应以 /love-scenes/ 开头`);
    assert.ok(visual.background?.focusX !== undefined && visual.background?.focusY !== undefined, `${id} 应有焦点`);
    assert.ok(visual.source.length > 0, `${id} 必须有 source`);
    assert.ok(visual.license.length > 0, `${id} 必须有 license`);
  }
});

test("loveSceneFor returns background, focus, source and license from a parsed manifest", () => {
  const parsed = parseLoveSceneManifest({
    v: 1,
    scenes: {
      rainbow: scene({
        scenarioId: "rainbow",
        background: { src: "/love-scenes/r.webp", focusX: 62, focusY: 44 },
        cg: [{ src: "/love-scenes/r-cg.webp", at: "beat", caption: { zh: "标题", en: "Title" } }],
      }),
    },
  });
  const visual = parsed.scenes.rainbow;
  assert.equal(visual.background?.src, "/love-scenes/r.webp");
  assert.equal(visual.background?.focusX, 62);
  assert.equal(visual.background?.focusY, 44);
  assert.equal(visual.source, "Agnes image 2.5 flash / SocialCoach");
  assert.equal(visual.license, "CC-BY-4.0");
  assert.equal(visual.cg?.[0].src, "/love-scenes/r-cg.webp");
  assert.equal(visual.cg?.[0].at, "beat");
});

test("a scene missing source or license or background is dropped (loveSceneFor returns null)", () => {
  const parsed = parseLoveSceneManifest({
    v: 1,
    scenes: {
      ok: scene(),
      noSource: scene({ scenarioId: "noSource", source: "" }),
      noLicense: scene({ scenarioId: "noLicense", license: "" }),
      noBackground: scene({ scenarioId: "noBackground", background: undefined }),
      badShape: { scenarioId: "badShape", background: "not-an-object", source: "x", license: "y" },
    },
  });
  assert.ok(parsed.scenes["ok"] !== undefined, "合法条目保留");
  assert.equal(parsed.scenes["noSource"], undefined, "缺 source 的条目丢弃");
  assert.equal(parsed.scenes["noLicense"], undefined, "缺 license 的条目丢弃");
  assert.equal(parsed.scenes["noBackground"], undefined, "缺 background 的条目丢弃");
  assert.equal(parsed.scenes["badShape"], undefined, "background 形状不对的条目丢弃");
});

test("loveSceneFor returns null for an unknown scenarioId", () => {
  assert.equal(loveSceneFor("love-arc-rio-clarify-nope"), null);
  assert.equal(loveSceneFor("no-such-scenario"), null);
  assert.equal(loveSceneFor(""), null);
});

test("loveCgFor only returns the CG whose `at` matches; no CG → null", () => {
  // 第 1 幕 reveal 有 CG。
  assert.equal(loveCgFor("love-approach-received-interest", "reveal"), "/love-scenes/rio-01-cg.webp");
  // 第 6 幕 ending 有 CG；同幕其余 at 不匹配。
  assert.equal(loveCgFor("love-rio-deadline-night", "ending"), "/love-scenes/rio-06-cg.webp");
  assert.equal(loveCgFor("love-rio-deadline-night", "reveal"), null);
  assert.equal(loveCgFor("love-rio-deadline-night", "beat"), null);
  // 其余幕没有 CG。
  assert.equal(loveCgFor("love-rio-secondment-deadline", "reveal"), null);
  assert.equal(loveCgFor("love-rio-family-settled", "ending"), null);
  // 未知场景 / 无该场景。
  assert.equal(loveCgFor("no-such-scenario", "ending"), null);
});

test("bad manifests degrade to an empty manifest without throwing", () => {
  for (const bad of [
    null,
    undefined,
    42,
    "nope",
    [],
    [1, 2],
    { v: 2, scenes: {} },
    { scenes: {} },
    { v: 1 },
    { v: 1, scenes: 42 },
    { v: 1, scenes: [] },
    { v: 1, scenes: { x: { background: { src: "/x.webp" } } } },
    { v: 1, scenes: { x: { source: "s", license: "l" } } },
  ]) {
    assert.deepEqual(parseLoveSceneManifest(bad), { v: 1, scenes: {} }, `bad input ${JSON.stringify(bad)}`);
  }
});

test("garbage inside an otherwise fine manifest does not throw and keeps good scenes", () => {
  const parsed = parseLoveSceneManifest({
    v: 1,
    scenes: {
      good: scene(),
      junk: { scenarioId: "junk", background: { src: "/junk.webp" }, source: "s" }, // 缺 license
      nan: { scenarioId: "nan", background: { src: "/nan.webp", focusX: NaN }, source: "s", license: "l" },
      cg: scene({ scenarioId: "cg", cg: [{ src: "/bad.webp", at: "soon" as "beat" }] }),
    },
    prompts: { good: "prompt", junk: 7 },
  });
  assert.ok(parsed.scenes["good"] !== undefined, "合法条目保留");
  assert.equal(parsed.scenes["junk"], undefined);
  assert.equal(parsed.scenes["nan"], undefined, "focusX 不是 0–100 数字的条目丢弃");
  assert.equal(parsed.scenes["cg"], undefined, "cg.at 非法的条目丢弃");
  assert.deepEqual(parsed.prompts, { good: "prompt" }, "prompts 逐条校验，坏值丢弃");
});
