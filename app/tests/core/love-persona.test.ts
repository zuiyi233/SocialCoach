/** 共享 Persona schema 的离线回归：未知字段往返、单语不伪造、基础 JSON 只映射核心子集、Tavern 只引导。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LOVE_PERSONA_ERROR,
  LOVE_PERSONA_TEXT_MAX,
  PersonaSchema,
  canonicalJson,
  classifyPersonaFile,
  classifyPersonaJson,
  computePersonaCardHash,
  createEmptyPersona,
  importBasicPersonaJson,
  isSingleLanguage,
  localizedFromSingle,
  parsePersona,
  serializePersona,
  sha256Hex,
  type Persona,
} from "../../src/lib/love-persona";

const fixture = (name: string) => new URL(`../fixtures/love-persona/${name}`, import.meta.url);
const fixtureText = (name: string) => readFileSync(fixture(name), "utf8");
const fixtureBytes = (name: string) => new Uint8Array(readFileSync(fixture(name)));

const base = (over: Partial<Persona> = {}): Persona => ({
  v: 1,
  id: "p1",
  revision: 1,
  kind: "npc",
  name: localizedFromSingle("Rio"),
  source: "love-created",
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

function mustParse(value: unknown): Persona {
  const parsed = parsePersona(value);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.code}`);
  return parsed.persona;
}

function mustSerialize(persona: Persona): Record<string, unknown> {
  const out = serializePersona(persona);
  if (!out.ok) throw new Error(`serialize failed: ${out.code}`);
  return JSON.parse(out.json) as Record<string, unknown>;
}

test("sha256 matches the published test vectors", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.equal(sha256Hex(enc("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(enc("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(
    sha256Hex(enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("canonical JSON sorts keys so the card hash is order-independent", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]', "arrays keep order, objects sort");
  const reordered = { updatedAt: 2, createdAt: 1, source: "love-created", name: localizedFromSingle("Rio"), kind: "npc", revision: 1, id: "p1", v: 1 } as Persona;
  assert.equal(computePersonaCardHash(reordered), computePersonaCardHash(base()), "key order does not move the hash");
  assert.equal(computePersonaCardHash(base({ updatedAt: 9e12 })), computePersonaCardHash(base()), "timestamps are not card content");
  assert.notEqual(computePersonaCardHash(base({ name: localizedFromSingle("Eve") })), computePersonaCardHash(base()));
});

test("unknown fields survive a parse→serialize round trip, top-level and nested", () => {
  const raw = {
    ...base(),
    x_custom: { note: "keep me", n: 7 },
    personality_extra: ["a", "b"],
    appearance: { text: "tall", unknownAppearance: "x" },
    storyConstraints: { secret: localizedFromSingle("hidden"), notes: "extra" },
    tavern: {
      spec: "v1",
      raw: { description: "orig", extensions: { keep: true } },
      cardHash: "",
      worldbook: [{ keys: ["k"], content: "c", extraField: 1 }],
    },
  };
  const round = mustSerialize(mustParse(raw));
  assert.deepEqual(round.x_custom, { note: "keep me", n: 7 });
  assert.deepEqual(round.personality_extra, ["a", "b"]);
  assert.deepEqual((round.appearance as Record<string, unknown>).unknownAppearance, "x");
  assert.deepEqual((round.storyConstraints as Record<string, unknown>).notes, "extra");
  assert.deepEqual(((round.tavern as Record<string, unknown>).raw as Record<string, unknown>).extensions, { keep: true });
  assert.deepEqual((((round.tavern as Record<string, unknown>).worldbook as Record<string, unknown>[])[0]).extraField, 1);
});

test("a single-language card fills both zh and en and never fabricates a translation", () => {
  const name = localizedFromSingle("Mira");
  assert.deepEqual(name, { zh: "Mira", en: "Mira" });
  assert.equal(isSingleLanguage(name), true, "same string both sides reads as “original”");
  assert.equal(isSingleLanguage({ zh: "里奥", en: "Rio" }), false, "a real translation is not single-language");
});

test("basic JSON maps only the documented core subset", () => {
  const res = importBasicPersonaJson(JSON.parse(fixtureText("basic.json")), { id: "b1", now: 1 });
  assert.ok(res.ok, "the fixture is a basic JSON");
  const persona = res.persona;
  assert.equal(persona.id, "b1");
  assert.equal(persona.kind, "npc", "basic JSON is treated as a character by default");
  assert.deepEqual(persona.name, { zh: "阿元", en: "阿元" }, "no fabricated English");
  assert.equal(persona.bio?.zh, "便利店夜班店员，话不多。", "description → bio");
  assert.equal(persona.personality?.zh, "务实、嘴硬心软。");
  assert.equal(persona.speechStyle?.zh, "{{user}}: 你怎么还不下班？", "mes_example → speechStyle");
  assert.deepEqual(persona.greetings?.map((g) => g.zh), ["这么晚还不回去？", "又是你。", "要热牛奶吗？"]);
  assert.equal(persona.source, "tavern-import");
  assert.deepEqual(res.notices, [], "a clean basic JSON carries nothing extra");
  // scenario did NOT override bio, because description was present.
  assert.ok(!persona.bio?.zh.includes("凌晨两点"));
});

test("a basic JSON that also carries a world book / sprites / preset imports the core fields with a Studio notice", () => {
  const value = {
    name: "Nova",
    personality: "quiet",
    system_prompt: "You are Nova.",
    post_history_instructions: "stay in character",
    character_book: { entries: [{ keys: ["x"], content: "y" }] },
    extensions: { assets: {} },
    temperature: 0.7,
  };
  const res = importBasicPersonaJson(value, { now: 1 });
  assert.ok(res.ok);
  assert.equal(res.persona.name.zh, "Nova");
  assert.equal(res.persona.personality?.zh, "quiet");
  assert.deepEqual(res.notices, [{ code: "studio-for-full", carries: ["worldbook", "sprites", "preset"] }]);
  // Nothing beyond the subset is mapped: the system prompt is not a style block here.
  assert.equal((res.persona.tavern as { styleBlocks?: unknown }).styleBlocks, undefined);
  assert.equal((res.persona.tavern as { worldbook?: unknown }).worldbook, undefined);
});

test("a Tavern V2 card is classified with Studio guidance and never field-mapped", () => {
  const bytes = fixtureBytes("tavern-v2-card.json");
  assert.deepEqual(classifyPersonaFile({ name: "mira.json", bytes }), { kind: "tavern-card", guide: "studio" });
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  assert.equal(classifyPersonaJson(value), "tavern-card");
  const res = importBasicPersonaJson(value);
  assert.deepEqual(res, { ok: false, code: LOVE_PERSONA_ERROR.unsupported, guide: "studio" });
  assert.equal("persona" in res, false, "no half-parsed Persona leaks out of a full Tavern card");
});

test("file classification routes by magic bytes and extension only", () => {
  assert.deepEqual(classifyPersonaFile({ bytes: fixtureBytes("with-unknown.scpersona") }), { kind: "scpersona" });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.deepEqual(classifyPersonaFile({ name: "card.png", bytes: png }), { kind: "tavern-card", guide: "studio" });
  assert.deepEqual(classifyPersonaFile({ name: "x.scpersona" }), { kind: "scpersona" });
  assert.deepEqual(classifyPersonaFile({ name: "mystery.bin" }), { kind: "unknown" });
  assert.equal(classifyPersonaJson({ entries: { "0": { keys: ["a"], content: "b" } } }), "world-book");
  assert.equal(classifyPersonaJson({ prompts: [], prompt_order: [] }), "preset");
  assert.equal(classifyPersonaJson({ name: "x", description: "y" }), "basic-json");
});

test("parse rejects future versions, bad shapes and oversized text with distinct codes", () => {
  assert.equal(PersonaSchema.safeParse(base()).success, true);
  assert.deepEqual(parsePersona({ ...base(), v: 2 }), {
    ok: false,
    code: LOVE_PERSONA_ERROR.badVersion,
    detail: "v=2",
  });
  assert.equal((parsePersona(null) as { code: string }).code, LOVE_PERSONA_ERROR.badShape);
  assert.equal((parsePersona([]) as { code: string }).code, LOVE_PERSONA_ERROR.badShape);
  assert.equal((parsePersona({ ...base(), kind: "ghost" }) as { code: string }).code, LOVE_PERSONA_ERROR.badShape);
  assert.equal((parsePersona({ ...base(), id: "" }) as { code: string }).code, LOVE_PERSONA_ERROR.badShape);
  const long = "x".repeat(LOVE_PERSONA_TEXT_MAX + 1);
  assert.equal((parsePersona({ ...base(), bio: { zh: long, en: long } }) as { code: string }).code, LOVE_PERSONA_ERROR.textTooLong);
  assert.equal(parsePersona(base()).ok, true);
});

test("a blank persona of either kind is well-formed, versioned and uniquely identified", () => {
  const player = createEmptyPersona("player", { name: localizedFromSingle("You") });
  assert.equal(player.kind, "player");
  assert.equal(player.v, 1);
  assert.equal(player.revision, 1);
  assert.ok(player.id.length > 0);
  assert.equal(parsePersona(player).ok, true);
  const npc = createEmptyPersona("npc");
  assert.equal(npc.kind, "npc");
  assert.notEqual(npc.id, player.id, "ids are never derived from the display name");
});