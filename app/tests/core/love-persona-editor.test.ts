/** 聚焦人设编辑器的纯逻辑离线回归：导入路由、冲突裁决、合并、导出预览、教练副本与基础 JSON 往返。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  localizedFromSingle,
  importBasicPersonaJson,
  type Persona,
} from "../../src/lib/love-persona";
import {
  coachCopyRows,
  isOriginalOnly,
  mergePersona,
  personaFileName,
  personaSaveBlocked,
  personaToBasicJson,
  resolveConflict,
  routePersonaFile,
  sameNameCollisions,
  summarizeExport,
} from "../../src/components/love/persona-editor-logic";
import { buildCoachProfilePatch } from "../../src/lib/love-persona-store";

const persona = (over: Partial<Persona> = {}): Persona => ({
  v: 1,
  id: "p1",
  revision: 1,
  kind: "npc",
  name: localizedFromSingle("Rio"),
  source: "love-created",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

test("import routing sends full Tavern artefacts to Studio and keeps packs / basic JSON local", () => {
  assert.deepEqual(routePersonaFile({ kind: "scpersona" }), { kind: "pack" });
  assert.deepEqual(routePersonaFile({ kind: "basic-json" }), { kind: "basic-json" });
  assert.deepEqual(routePersonaFile({ kind: "tavern-card", guide: "studio" }), { kind: "studio", carries: [] });
  assert.deepEqual(routePersonaFile({ kind: "world-book", guide: "studio" }, ["worldbook"]), { kind: "studio", carries: ["worldbook"] });
  assert.deepEqual(routePersonaFile({ kind: "preset", guide: "studio" }), { kind: "studio", carries: [] });
  assert.deepEqual(routePersonaFile({ kind: "unknown" }), { kind: "unknown" });
});

test("same-name collisions are detected by name but never keyed by it", () => {
  const incoming = persona({ id: "new", name: { zh: "tess", en: "Tess" } });
  const library = [
    persona({ id: "old-a", name: { zh: "tess", en: "Tess" } }),
    persona({ id: "other", name: localizedFromSingle("Rio") }),
    persona({ id: "new", name: { zh: "tess", en: "Tess" } }), // 同 id：不算「撞名」
  ];
  const collisions = sameNameCollisions(incoming, library);
  assert.deepEqual(collisions.map((p) => p.id), ["old-a"]);
  // 空名不撞名
  assert.deepEqual(sameNameCollisions(persona({ id: "x", name: localizedFromSingle("") }), library), []);
});

test("a same-id conflict offers real choices and never silently overwrites", () => {
  const current = persona({ id: "p1", revision: 3, bio: localizedFromSingle("old bio") });
  const incoming = persona({ id: "p1", revision: 1, bio: localizedFromSingle("new bio") });
  const ctx = { current, incoming, sameName: [] };

  assert.deepEqual(resolveConflict(ctx, "keep"), { ok: true, write: null }, "keep writes nothing");
  const replaced = resolveConflict(ctx, "replace");
  assert.ok(replaced.ok);
  assert.equal(replaced.write?.bio?.zh, "new bio");
  assert.equal(replaced.write?.id, "p1", "replace keeps the identity id");
  assert.equal(replaced.write?.createdAt, current.createdAt, "and keeps createdAt");

  const fresh = resolveConflict(ctx, "import-new", "p9");
  assert.ok(fresh.ok);
  assert.equal(fresh.write?.id, "p9", "import-new gets a fresh id so both survive");
  assert.deepEqual(resolveConflict(ctx, "import-new"), { ok: false, code: "needs-new-id" });
});

test("merge takes incoming non-empty fields and reports exactly which changed", () => {
  const current = persona({ id: "p1", bio: localizedFromSingle("old bio"), personality: localizedFromSingle("calm") });
  const incoming = persona({ id: "p1", bio: localizedFromSingle("new bio"), speechStyle: localizedFromSingle("blunt") });
  const { persona: merged, changes } = mergePersona(current, incoming);
  assert.equal(merged.bio?.zh, "new bio", "incoming wins where it has content");
  assert.equal(merged.personality?.zh, "calm", "current is kept where incoming is empty");
  assert.equal(merged.speechStyle?.zh, "blunt");
  const fields = changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ["bio", "name", "speechStyle"]);
  assert.ok(changes.every((c) => c.from === "incoming"));
});

test("the merge decision writes a merged persona, not a name match", () => {
  const current = persona({ id: "p1", bio: localizedFromSingle("old") });
  const incoming = persona({ id: "p1", personality: localizedFromSingle("warm") });
  const out = resolveConflict({ current, incoming, sameName: [] }, "merge");
  assert.ok(out.ok && out.write);
  assert.equal(out.write?.bio?.zh, "old");
  assert.equal(out.write?.personality?.zh, "warm");
});

test("export preview shows what will be included and what public export strips", () => {
  const p = persona({
    storyConstraints: { secret: localizedFromSingle("s"), goal: localizedFromSingle("g") },
    tavern: { raw: {}, cardHash: "h", worldbook: [{ content: "x" }], styleBlocks: ["a"] },
  });
  const full = summarizeExport(p, false, true, 2);
  assert.ok(full.fields.includes("name"));
  assert.ok(full.fields.includes("storyConstraints.secret"));
  assert.equal(full.worldbookEntries, 1);
  assert.equal(full.hasStyle, true);
  assert.equal(full.hasRefImage, true);
  assert.equal(full.portraitCount, 2);
  assert.equal(full.secretStripped, false);

  const publicOnly = summarizeExport(p, true, true, 2);
  assert.equal(publicOnly.secretStripped, true, "public export strips the secret");
});

test("basic JSON export maps only the core fields and round-trips through the importer", () => {
  const p = persona({
    kind: "npc",
    name: { zh: "里奥", en: "Rio" },
    bio: localizedFromSingle("acupuncturist"),
    personality: localizedFromSingle("reserved"),
    speechStyle: localizedFromSingle("short sentences"),
    greetings: [localizedFromSingle("hi"), localizedFromSingle("hey")],
  });
  const json = personaToBasicJson(p, "en");
  assert.deepEqual(Object.keys(json).sort(), ["alternate_greetings", "description", "first_mes", "mes_example", "name", "personality"]);
  assert.equal(json.name, "Rio");
  assert.equal(json.description, "acupuncturist");

  const imported = importBasicPersonaJson(json);
  assert.ok(imported.ok);
  if (!imported.ok) return;
  assert.equal(imported.persona.name.en, "Rio");
  assert.equal(imported.persona.bio?.en, "acupuncturist");
  assert.equal(imported.persona.personality?.en, "reserved");
  assert.equal(imported.persona.speechStyle?.en, "short sentences");
  assert.deepEqual(imported.persona.greetings?.map((g) => g.en), ["hi", "hey"]);
});

test("the coach copy preview lists only name / bio / lang, and an NPC copies nothing", () => {
  const player = persona({ kind: "player", language: "en", name: { zh: "你", en: "You" }, bio: localizedFromSingle("practicing boundaries") });
  assert.deepEqual(coachCopyRows(buildCoachProfilePatch(player)), [
    { field: "name", value: "You" },
    { field: "bio", value: "practicing boundaries" },
    { field: "lang", value: "en" },
  ]);
  assert.deepEqual(coachCopyRows(buildCoachProfilePatch(persona({ kind: "npc" }))), [], "an NPC has no coach-profile counterpart");
});

test("the editor blocks a nameless save and marks a single-language card as 原文", () => {
  assert.equal(personaSaveBlocked(persona({ name: localizedFromSingle("") })), true);
  assert.equal(personaSaveBlocked(persona({ name: localizedFromSingle("Rio") })), false);
  assert.equal(isOriginalOnly(localizedFromSingle("Rio")), true);
  assert.equal(isOriginalOnly({ zh: "里奥", en: "Rio" }), false);
  assert.equal(isOriginalOnly(localizedFromSingle("")), false, "an empty name is not 'original'");
});

test("export file names are safe slugs with the right extension", () => {
  assert.equal(personaFileName(persona({ name: localizedFromSingle("Rio Chen") }), "en", "scpersona"), "rio-chen.scpersona");
  assert.equal(personaFileName(persona({ name: localizedFromSingle("") , id: "p1" }), "en", "json"), "p1.json");
  assert.match(personaFileName(persona({ name: localizedFromSingle("里奥 博士") }), "zh", "scpersona"), /^[\p{L}\p{N}-]+\.scpersona$/u);
});