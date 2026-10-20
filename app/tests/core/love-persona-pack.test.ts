/** `.scpersona` 打包格式的离线回归：build↔read 往返、cardHash 确定性、公/私导出、版本与哈希校验。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  LOVE_PERSONA_ERROR,
  computePersonaCardHash,
  localizedFromSingle,
  type Persona,
} from "../../src/lib/love-persona";
import {
  LOVE_PERSONA_PACK_MEMBERS,
  LOVE_PERSONA_PACK_VERSION,
  buildPersonaPack,
  isPersonaPackBytes,
  readPersonaPack,
  stripPrivateConstraints,
} from "../../src/lib/love-persona-pack";

const fixtureBytes = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/love-persona/${name}`, import.meta.url)));

const base = (over: Partial<Persona> = {}): Persona => ({
  v: 1,
  id: "pack-1",
  revision: 1,
  kind: "npc",
  name: localizedFromSingle("Rio"),
  source: "love-created",
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

test("the committed fixture pack round-trips persona, worldbook, style and assets", () => {
  const bytes = fixtureBytes("with-unknown.scpersona");
  assert.equal(isPersonaPackBytes(bytes), true);
  const res = readPersonaPack(bytes);
  assert.ok(res.ok);
  const { pack } = res;
  assert.equal(pack.manifest.version, LOVE_PERSONA_PACK_VERSION);
  assert.equal(pack.manifest.id, "persona-unknown-1");
  assert.equal(pack.manifest.source, "tavern-import");
  assert.equal(pack.manifest.license, "CC-BY-4.0");
  assert.equal(pack.manifest.cardHash, computePersonaCardHash(pack.persona), "manifest hash matches the card");
  // unknown fields survive the pack
  assert.deepEqual((pack.persona as unknown as Record<string, unknown>).x_custom, { note: "keep me", n: 7 });
  assert.deepEqual((pack.persona as unknown as Record<string, unknown>).personality_extra, ["a", "b"]);
  assert.deepEqual(pack.persona.greetings?.map((g) => g.zh), ["……你也来看这场展？"]);
  assert.equal(pack.persona.storyConstraints?.secret?.zh, "她其实是你妹妹的朋友。");
  // optional members come back separately from persona.json
  assert.deepEqual(pack.worldbook, [{ keys: ["展"], content: "她在这家画廊做过志愿。" }]);
  assert.deepEqual(pack.style, { blocks: ["第一人称、短句"], temperature: 0.8 });
  assert.deepEqual(Object.keys(pack.assets?.portraits ?? {}), ["smile"]);
  assert.ok(pack.assets!.portraits!.smile.startsWith("data:image/png;base64,"));
});

test("a build→read round trip keeps the card and the hash deterministic", () => {
  const persona = base({ bio: localizedFromSingle("慢热") });
  const first = buildPersonaPack(persona);
  const second = buildPersonaPack({ ...persona });
  assert.ok(first.ok && second.ok);
  assert.equal(first.manifest.cardHash, second.manifest.cardHash, "same card, same hash");
  assert.equal(first.manifest.cardHash, computePersonaCardHash(persona));
  const read = readPersonaPack(first.bytes);
  assert.ok(read.ok);
  assert.equal(read.pack.persona.bio?.zh, "慢热");
  assert.equal(read.pack.manifest.cardHash, first.manifest.cardHash);
  assert.equal(read.pack.worldbook, undefined);
  assert.equal(read.pack.style, undefined);
  assert.equal(read.pack.assets, undefined);
});

test("publicOnly strips storyConstraints.secret; a full export keeps it", () => {
  const persona = base({
    storyConstraints: { goal: localizedFromSingle("g"), redLine: localizedFromSingle("r"), secret: localizedFromSingle("s") },
  });
  const pub = buildPersonaPack(persona, { publicOnly: true });
  assert.ok(pub.ok);
  const pubRead = readPersonaPack(pub.bytes);
  assert.ok(pubRead.ok);
  assert.equal(pubRead.pack.persona.storyConstraints?.secret, undefined, "secret never reaches the public pack");
  assert.equal(pubRead.pack.persona.storyConstraints?.goal?.zh, "g", "goal is not private");
  assert.equal(stripPrivateConstraints(persona).storyConstraints?.redLine?.zh, "r");

  const full = buildPersonaPack(persona);
  assert.ok(full.ok);
  const fullRead = readPersonaPack(full.bytes);
  assert.ok(fullRead.ok);
  assert.equal(fullRead.pack.persona.storyConstraints?.secret?.zh, "s", "the private export keeps the secret");
});

test("a future pack version is rejected with the shared bad-version code", () => {
  const res = readPersonaPack(fixtureBytes("future.scpersona"));
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, LOVE_PERSONA_ERROR.badVersion);
});

test("a non-zip byte string is not a pack", () => {
  assert.deepEqual(readPersonaPack(new Uint8Array([1, 2, 3, 4])), {
    ok: false,
    code: LOVE_PERSONA_ERROR.packUnreadable,
    detail: "not a zip",
  });
});

test("a pack missing persona.json is reported, not half-read", () => {
  const manifest = { version: 1, id: "x", revision: 1, cardHash: "0".repeat(64), source: "love-created" };
  const bytes = zipSync({ [LOVE_PERSONA_PACK_MEMBERS.manifest]: strToU8(JSON.stringify(manifest)) });
  const res = readPersonaPack(bytes);
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, LOVE_PERSONA_ERROR.packMissing);
});

test("a tampered asset fails its hash check", () => {
  const built = buildPersonaPack(base(), { assets: { portraits: { smile: "data:image/png;base64,AAAA" } } });
  assert.ok(built.ok);
  const files = unzipSync(built.bytes);
  const key = Object.keys(files).find((k) => k.startsWith(LOVE_PERSONA_PACK_MEMBERS.portraits));
  assert.ok(key, "the pack carries one portrait");
  const tampered: Record<string, Uint8Array> = { ...files };
  const copy = new Uint8Array(tampered[key]);
  copy[0] = copy[0] ^ 0xff;
  tampered[key] = copy;
  const res = readPersonaPack(zipSync(tampered));
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, LOVE_PERSONA_ERROR.packHash);
});

test("a manifest cardHash that does not match the card is refused", () => {
  const persona = base();
  const personaJson = strToU8(JSON.stringify(persona));
  const manifest = { version: 1, id: persona.id, revision: persona.revision, cardHash: "0".repeat(64), source: persona.source };
  const bytes = zipSync({
    [LOVE_PERSONA_PACK_MEMBERS.manifest]: strToU8(JSON.stringify(manifest)),
    [LOVE_PERSONA_PACK_MEMBERS.persona]: personaJson,
  });
  const res = readPersonaPack(bytes);
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, LOVE_PERSONA_ERROR.packHash);
});

test("a bad persona inside the pack surfaces the persona error code", () => {
  const persona = base();
  const broken = strToU8(JSON.stringify({ ...persona, v: 2 }));
  const manifest = { version: 1, id: persona.id, revision: persona.revision, cardHash: computePersonaCardHash(persona), source: persona.source };
  const bytes = zipSync({
    [LOVE_PERSONA_PACK_MEMBERS.manifest]: strToU8(JSON.stringify(manifest)),
    [LOVE_PERSONA_PACK_MEMBERS.persona]: broken,
  });
  const res = readPersonaPack(bytes);
  assert.equal(res.ok, false);
  assert.equal((res as { code: string }).code, LOVE_PERSONA_ERROR.badVersion);
});

test("an asset id with a path separator is refused at build time", () => {
  const built = buildPersonaPack(base(), { assets: { refs: { "../evil": "data:image/png;base64,AAAA" } } });
  assert.equal(built.ok, false);
  assert.equal((built as { code: string }).code, LOVE_PERSONA_ERROR.badShape);
});