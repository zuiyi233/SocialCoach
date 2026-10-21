/** 故事包（spec-love-bridge §3/§5）的离线回归：round-trip、hash/文件名稳定、未知键保留、缺字段报错、大小上限与私有字段剥离。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOVE_STORY_PACK_MANIFEST_VERSION,
  LOVE_STORY_PACK_MAX_BYTES,
  LOVE_STORY_PACK_VERSION,
  buildStoryPack,
  parseStoryPack,
  storyPackFileName,
  storyPackHash,
  storyPackJson,
  stripPrivateStoryFields,
} from "../../src/lib/love-story-pack";
import { canonicalJson } from "../../src/lib/love-persona";
import type { StoryRecord } from "../../src/lib/love-archive";

const story = (over: Partial<StoryRecord> = {}): StoryRecord => ({
  id: "story-1",
  origin: "studio",
  title: { zh: "雨夜告白", en: "Confession in the Rain" },
  summary: { zh: "她在雨夜说出心意。", en: "She confesses on a rainy night." },
  keyChoices: [
    {
      at: 12,
      choice: { zh: "先问她想要什么", en: "Ask what she wants" },
      consequence: { zh: "她认真回答了", en: "She answered seriously" },
    },
  ],
  characterPackIds: ["rio"],
  canonical: true,
  createdAt: 1_700_000_000_000,
  ...over,
});

test("a legal pack round-trips and its hash and file name are stable", () => {
  const built = buildStoryPack({ story: story(), origin: "studio", source: "user", license: "CC-BY-4.0" });
  assert.equal(built.v, LOVE_STORY_PACK_VERSION);
  assert.equal(built.manifest.version, LOVE_STORY_PACK_MANIFEST_VERSION);
  assert.equal(built.manifest.id, "story-1");
  assert.equal(built.manifest.characterPackId, "rio");
  assert.equal(built.manifest.license, "CC-BY-4.0");
  assert.equal(built.story.keyChoices[0].choice.zh, "先问她想要什么");

  // 对象与 JSON 字符串都收。
  const parsed = parseStoryPack(JSON.stringify(built));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("parse failed");
  assert.equal(parsed.warnings.length, 0);
  assert.deepEqual(parsed.pack.story, built.story);
  assert.equal(parsed.pack.manifest.characterPackId, "rio");

  const parsedObject = parseStoryPack(built);
  assert.equal(parsedObject.ok, true);

  const again = buildStoryPack({ story: story(), origin: "studio", source: "user", license: "CC-BY-4.0" });
  assert.equal(storyPackHash(built), storyPackHash(again), "same story, same hash");
  assert.equal(storyPackFileName(built), storyPackFileName(again), "same story, same file name");
  assert.match(storyPackFileName(built), /^socialcoach-story-.+-[0-9a-f]{8}\.json$/);
  assert.equal(storyPackJson(built), canonicalJson(JSON.parse(storyPackJson(built))), "stable json is key-sorted");
});

test("unknown keys survive the pack round trip", () => {
  const withExtra = {
    ...story(),
    x_custom: { note: "keep me", n: 7 },
    keyChoices: [
      { at: 1, choice: { zh: "选A", en: "A" }, consequence: { zh: "后果", en: "C" }, x_meta: "choice-extra" },
    ],
  } as unknown as StoryRecord;
  const built = buildStoryPack({ story: withExtra, origin: "love", source: "model" });
  const parsed = parseStoryPack(built);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("parse failed");
  assert.deepEqual((parsed.pack.story as unknown as Record<string, unknown>).x_custom, { note: "keep me", n: 7 });
  assert.equal((parsed.pack.story.keyChoices[0] as unknown as Record<string, unknown>).x_meta, "choice-extra");
});

test("missing required fields and wrong versions are reported as errors", () => {
  const valid = { v: 1, manifest: { id: "x", origin: "studio", createdAt: 1, source: "user" }, story: story() };

  const emptyTitle = parseStoryPack({ ...valid, story: { ...story(), title: { zh: "", en: "x" } } });
  assert.equal(emptyTitle.ok, false);
  if (!emptyTitle.ok) assert.ok(emptyTitle.errors.some((e) => e.includes("title")), "empty title is refused");

  const emptySummary = parseStoryPack({ ...valid, story: { ...story(), summary: { zh: "x", en: "" } } });
  assert.equal(emptySummary.ok, false);

  const noStory = parseStoryPack({ v: 1, manifest: { id: "x", origin: "studio", createdAt: 1, source: "user" } });
  assert.equal(noStory.ok, false);
  if (!noStory.ok) assert.ok(noStory.errors.some((e) => e.includes("story")));

  const badVersion = parseStoryPack({ v: 2, manifest: { id: "x", origin: "studio", createdAt: 1, source: "user" }, story: story() });
  assert.equal(badVersion.ok, false);
  if (!badVersion.ok) assert.ok(badVersion.errors[0].includes("version"));

  const noManifest = parseStoryPack({ v: 1, story: story() });
  assert.equal(noManifest.ok, false);
  if (!noManifest.ok) assert.ok(noManifest.errors.some((e) => e.includes("manifest")));

  const badOrigin = parseStoryPack({ v: 1, manifest: { id: "x", origin: "other", createdAt: 1, source: "user" }, story: story() });
  assert.equal(badOrigin.ok, false);

  const notJson = parseStoryPack("{oops");
  assert.equal(notJson.ok, false);
});

test("an oversized pack is refused at build and parse time", () => {
  // persona/character 是不受形状约束的 unknown：用它把整包顶过 8 MB。
  const giant = { giant: "x".repeat(LOVE_STORY_PACK_MAX_BYTES) };
  const built = parseStoryPack({
    v: 1,
    manifest: { id: "x", origin: "studio", createdAt: 1, source: "user" },
    story: story(),
    persona: giant,
  });
  assert.equal(built.ok, false);
  if (!built.ok) assert.ok(built.errors.some((e) => e.includes("bytes")), "oversize is an error, not a silent truncation");

  assert.throws(
    () => buildStoryPack({ story: story(), origin: "studio", source: "user", persona: giant }),
    /exceeds .* bytes/u,
  );
});

test("private fields are stripped from story and character with warnings; persona passes through untouched", () => {
  const dirtyStory = {
    ...story(),
    hidden: "SECRET-HIDDEN",
    secret: { zh: "不能说的", en: "secret" },
    success: { zh: "成功条件", en: "success" },
    failure: "fail",
    endingPredicate: { zh: "结局条件", en: "predicate" },
    routeState: { act: 3, asked: true },
    finalDecision: "walk-away",
    keyChoices: [
      { at: 1, choice: { zh: "答应", en: "Agree" }, quote: { zh: "我答应你", en: "I promise" }, hidden: "choice-secret" },
    ],
  } as unknown as StoryRecord;

  // 构建侧自动剥私有字段：story 与 character 都进不去 pack。
  const built = buildStoryPack({
    story: dirtyStory,
    origin: "studio",
    source: "user",
    character: { name: "Rio", secret: "char-secret", hidden: "char-hidden" },
  });
  const builtJson = storyPackJson(built);
  for (const field of ["hidden", "secret", "success", "failure", "endingPredicate", "routeState", "finalDecision"]) {
    assert.ok(!builtJson.includes(`"${field}"`), `${field} never leaves the pack`);
  }

  // 解析侧（直接解析 Studio 原文包）同样剥掉并记 warning。
  const raw = {
    v: 1,
    manifest: { id: "x", origin: "studio", createdAt: 1, source: "user" },
    story: {
      ...story(),
      hidden: "SECRET-HIDDEN",
      routeState: { act: 3 },
      keyChoices: [{ at: 1, choice: { zh: "答应", en: "Agree" }, hidden: "choice-secret" }],
    },
    character: { name: "Rio", secret: "char-secret" },
  };
  const parsed = parseStoryPack(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("parse failed");
  assert.ok(parsed.warnings.some((w) => w.includes("hidden")), "warnings name the stripped story paths");
  assert.ok(parsed.warnings.some((w) => w.includes("routeState")), "routeState is reported");
  assert.ok(parsed.warnings.some((w) => w.includes("character.secret")), "character paths are reported too");
  const parsedJson = storyPackJson(parsed.pack);
  for (const field of ["hidden", "secret", "routeState"]) {
    assert.ok(!parsedJson.includes(`"${field}"`), `${field} is gone from the parsed pack`);
  }

  // persona 是玩家快照：原样保留，不在此剥（结构交给 love-persona 校验）。
  const withPersona = buildStoryPack({ story: story(), origin: "love", source: "user", persona: { name: "You", hidden: "mine" } });
  const parsedPersona = parseStoryPack(withPersona);
  assert.equal(parsedPersona.ok, true);
  if (!parsedPersona.ok) throw new Error("parse failed");
  assert.deepEqual(parsedPersona.pack.persona, { name: "You", hidden: "mine" });
});

test("quotes without the free-text marker are dropped at parse with a warning", () => {
  const withQuote = (extra: Record<string, unknown> = {}) => ({
    v: 1,
    manifest: { id: "x", origin: "studio", createdAt: 1, source: "user" },
    story: {
      ...story(),
      keyChoices: [{ at: 1, choice: { zh: "答应", en: "Agree" }, quote: { zh: "我答应你", en: "I promise" } }],
      ...extra,
    },
  });

  const unmarked = parseStoryPack(withQuote());
  assert.equal(unmarked.ok, true);
  if (!unmarked.ok) throw new Error("parse failed");
  assert.equal(unmarked.pack.story.keyChoices[0].quote, undefined, "an unmarked quote never enters the archive");
  assert.ok(unmarked.warnings.some((w) => w.includes("quote")), "dropping a quote is reported");

  const marked = parseStoryPack(withQuote({ quoteSource: "free-text" }));
  assert.equal(marked.ok, true);
  if (!marked.ok) throw new Error("parse failed");
  assert.deepEqual(marked.pack.story.keyChoices[0].quote, { zh: "我答应你", en: "I promise" });
  assert.equal(marked.warnings.length, 0, "no warning when the free-text marker is present");
});

test("parseStoryPack never mutates the object it was given", () => {
  const input = {
    v: 1,
    manifest: { id: "x", origin: "studio", createdAt: 1, source: "user" },
    story: {
      ...story(),
      keyChoices: [{ at: 1, choice: { zh: "答应", en: "Agree" }, quote: { zh: "我答应你", en: "I promise" } }],
    },
  };
  const before = JSON.stringify(input);
  const parsed = parseStoryPack(input);
  assert.equal(parsed.ok, true);
  assert.equal(JSON.stringify(input), before, "the caller's object is not rewritten");
});

test("stripPrivateStoryFields removes the forbidden keys at any depth and leaves the input untouched", () => {
  const input = {
    a: 1,
    hidden: "x",
    nested: { routeState: { y: 2 }, keep: "z", arr: [{ success: true, ok: 1 }] },
  };
  assert.deepEqual(stripPrivateStoryFields(input), { a: 1, nested: { keep: "z", arr: [{ ok: 1 }] } });
  assert.ok("hidden" in input && "routeState" in input.nested, "the input itself is not mutated");
});

test("license is written only when the caller provides one", () => {
  const noLicense = buildStoryPack({ story: story(), origin: "studio", source: "user" });
  assert.equal(noLicense.manifest.license, undefined);

  const emptyLicense = buildStoryPack({ story: story(), origin: "studio", source: "user", license: "" });
  assert.equal(emptyLicense.manifest.license, "CC-BY-4.0");

  const given = buildStoryPack({ story: story(), origin: "studio", source: "user", license: "MIT" });
  assert.equal(given.manifest.license, "MIT");
});

test("build rejects invalid inputs with a SyntaxError", () => {
  assert.throws(
    () => buildStoryPack({ story: { ...story(), title: { zh: "", en: "x" } }, origin: "studio", source: "user" }),
    SyntaxError,
  );
  assert.throws(() => buildStoryPack({ story: story(), origin: "other" as "studio", source: "user" }), SyntaxError);
  assert.throws(() => buildStoryPack({ story: story(), origin: "studio", source: "" }), SyntaxError);
});
