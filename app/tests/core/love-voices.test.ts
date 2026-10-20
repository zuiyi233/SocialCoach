/** Offline regression: per-character love casting and `speak()` speaker passthrough. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SCENARIOS, type Scenario } from "../../src/data/corpus";
import { LOVE_VOICES_BASE, loveVoiceKey, resolveLoveVoice } from "../../src/lib/love-voices";

const romantic = SCENARIOS.filter((s) => s.context === "romantic");
const npcIds = (s: Scenario) => s.characters.filter((c) => c.id !== "you").map((c) => c.id);

test("the base table covers exactly the 54 unique romantic NPC ids", () => {
  assert.equal(romantic.length, 66, "corpus drift: the romantic line is 66 scenes");
  const ids = new Set(romantic.flatMap(npcIds));
  assert.equal(ids.size, 54, "corpus drift: the romantic line has 54 unique NPC ids");
  assert.deepEqual(Object.keys(LOVE_VOICES_BASE).sort(), [...ids].sort(), "every id has a base voice, and nothing extra");
});

test("every one of the 66 scene slots resolves to a voice", () => {
  let slots = 0;
  for (const s of romantic) {
    for (const characterId of npcIds(s)) {
      slots++;
      const voice = resolveLoveVoice(s.id, characterId);
      assert.ok(voice, `${loveVoiceKey(s.id, characterId)} has no voice`);
      assert.equal(typeof voice.feminine, "boolean");
      assert.ok(["young", "adult", "mature"].includes(voice.age), `${loveVoiceKey(s.id, characterId)} has no known age`);
    }
  }
  assert.equal(slots, 66, "66 cast positions, not 54: repeated ids still resolve per scene");
});

test("scene overrides win over the shared base; unknown casts stay undefined", () => {
  assert.equal(loveVoiceKey("some-scene", "some-id"), "some-scene:some-id");
  assert.deepEqual(resolveLoveVoice("love-approach-hobby-event", "tess"), { feminine: true, age: "young" });
  assert.deepEqual(resolveLoveVoice("some-other-scene", "tess"), LOVE_VOICES_BASE.tess, "the base id still resolves when a scene has no override");
  assert.equal(resolveLoveVoice("some-scene", "not-a-character"), undefined, "no name/hash/default fallback");
});

test("the two Tess characters are cast as different people", () => {
  const hobby = resolveLoveVoice("love-approach-hobby-event", "tess");
  const rumor = resolveLoveVoice("love-ld-social-media-rumor", "tess");
  assert.ok(hobby && rumor);
  assert.notDeepEqual(hobby, rumor, "young stranger vs adult long-distance partner");
  assert.deepEqual(hobby, { feminine: true, age: "young" });
  assert.deepEqual(rumor, { feminine: true, age: "adult" });
});

test("the two Sam characters are not forced into one voice", () => {
  const partner = resolveLoveVoice("partner-alone-evening", "sam");
  const friend = resolveLoveVoice("love-receive-confession", "sam");
  assert.ok(partner && friend);
  assert.notDeepEqual(partner, friend, "the partner and the confessing friend are different people");
});

test("Rio and Eve keep one voice across their series", () => {
  // Rio 六幕都已落语料（第 5–6 幕按产品决定豁免试玩闸门）。Eve 仍是三幕。
  const actCounts: Record<string, number> = { rio: 6, eve: 3 };
  for (const characterId of ["rio", "eve"]) {
    const scenes = romantic.filter((s) => npcIds(s).includes(characterId));
    assert.equal(scenes.length, actCounts[characterId], `${characterId} act count`);
    for (const scene of scenes) {
      assert.deepEqual(resolveLoveVoice(scene.id, characterId), { feminine: true, age: "adult" }, `${loveVoiceKey(scene.id, characterId)} drifts from the series voice`);
    }
  }
});

test("the eight long-distance leads keep their corpus pronouns", () => {
  const scenes = romantic.filter((s) => s.series?.id === "love-arc-long-distance");
  assert.equal(scenes.length, 8, "the long-distance line is eight scenes");
  const sceneById = new Map(scenes.map((s) => [npcIds(s)[0], s.id]));
  assert.equal(sceneById.size, 8, "eight different NPCs, not one repeated lead");

  for (const characterId of ["sana", "mina", "june", "tess", "tara"]) {
    const sceneId = sceneById.get(characterId);
    assert.ok(sceneId, `${characterId} is missing from the long-distance line`);
    assert.equal(resolveLoveVoice(sceneId, characterId)?.feminine, true, `${characterId} is feminine in the corpus`);
  }
  for (const characterId of ["jordan", "ravi", "eli"]) {
    const sceneId = sceneById.get(characterId);
    assert.ok(sceneId, `${characterId} is missing from the long-distance line`);
    assert.equal(resolveLoveVoice(sceneId, characterId)?.feminine, false, `${characterId} is masculine in the corpus`);
  }
});

// Read the module, not a mock: the queue is module-level state and importing it
// would drag in `useApp` / audio. The call shape is the contract that matters.
const speechSource = readFileSync(new URL("../../src/lib/speech.ts", import.meta.url), "utf8");

test("speak() carries the speaker through the queue into playNpcLine", () => {
  assert.ok(/export function speak\(text: string, lang: Lang, speaker\?: SpeakerVoice\)/.test(speechSource), "speak exposes the optional speaker");
  assert.ok(/let queue: \{ text: string; lang: Lang; speaker\?: SpeakerVoice \}\[\] = \[\];/.test(speechSource), "the queue stores the speaker per line");
  assert.ok(speechSource.includes("queue.push({ text, lang, speaker })"), "speak pushes the speaker with the line");
  assert.ok(speechSource.includes("playNpcLine(line.text, line.lang, line.speaker)"), "next() forwards the queued speaker");
});
