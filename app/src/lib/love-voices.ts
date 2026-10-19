import type { SpeakerVoice } from "./speech";

/**
 * Stable casting for the romantic corpus. `SpeakerVoice` only selects one of
 * four timbres per language, so this is casting by identity/pronoun — not a
 * unique voice per character. Base entries are keyed by character id; repeated
 * ids whose scenes are different people get a `scenarioId:characterId` override.
 *
 * Corpus check (2026-10-20): 64 romantic scenarios, 54 unique NPC ids. `riley`
 * and `avery` are read through their Chinese pronouns in the scenario text;
 * every entry below is explicit on purpose — no name/hash inference at runtime.
 */
export const LOVE_VOICES_BASE: Record<string, SpeakerVoice> = {
  // --- dates, partners and friends (female) ---
  elena: { feminine: true, age: "adult" }, // content review: no pronoun in corpus; first-date framing, cast female
  riley: { feminine: true, age: "adult" }, // partner; "她的父母" in love-meet-parents
  maya: { feminine: true, age: "adult" }, // cafe regular
  kai: { feminine: true, age: "adult" }, // hidden: "她最近刚和前任复合"
  dani: { feminine: true, age: "adult" }, // ex; "她会说自己没有别的意思"
  nora: { feminine: true, age: "adult" }, // partner; "她会更慌"
  mina: { feminine: true, age: "adult" }, // long-distance partner (female pronouns)
  tara: { feminine: true, age: "adult" }, // content review: spec lists Tara as female; corpus line is pronoun-free
  lina: { feminine: true, age: "adult" }, // partner; "她家"
  aria: { feminine: true, age: "adult" }, // activity contact; "她会认真接"
  tess: { feminine: true, age: "adult" }, // base = LD partner; hobby-event overrides to young
  mae: { feminine: true, age: "adult" }, // first-date follow-up; "她会认真接"
  rio: { feminine: true, age: "adult" }, // three-act series; one voice across all acts
  yara: { feminine: true, age: "adult" }, // "她才可能松口"
  zoe: { feminine: true, age: "adult" }, // "她会认真接住"
  iris: { feminine: true, age: "adult" }, // "她的壳更硬"
  eve: { feminine: true, age: "adult" }, // three-act series; one voice across all acts
  nia: { feminine: true, age: "adult" }, // "她会罕见地停下来说真话"
  dana: { feminine: true, age: "adult" }, // "她脸上会露出真实的受伤"
  juna: { feminine: true, age: "adult" }, // "她偶尔会接一句"
  zoey: { feminine: true, age: "adult" }, // "她会更失望"
  ivy: { feminine: true, age: "adult" }, // "她会无语到笑出来"
  bianca: { feminine: true, age: "adult" }, // "她会慢慢降温"
  sana: { feminine: true, age: "adult" }, // long-distance partner (female pronouns)
  june: { feminine: true, age: "adult" }, // long-distance partner (female pronouns)
  vera: { feminine: true, age: "adult" }, // "她会觉得你根本没听"

  // --- dates, partners and friends (male) ---
  jamie: { feminine: false, age: "adult" }, // "他" in love-trust-repair; age not stated
  sam: { feminine: false, age: "adult" }, // base only; both scenes override (two different Sam)
  ning: { feminine: false, age: "adult" }, // hidden: "他最怕的是约好的时间你没出现"
  an: { feminine: false, age: "adult" }, // "不愿被你替他决定下个周末"
  leo: { feminine: false, age: "adult" }, // "他会认真下来"
  alex: { feminine: false, age: "adult" }, // "他会慢慢接受"
  jordan: { feminine: false, age: "adult" }, // long-distance partner (male pronouns)
  noah: { feminine: false, age: "adult" }, // "他会惊讶并愿意调整"
  seth: { feminine: false, age: "adult" }, // "他的父母"
  marcus: { feminine: false, age: "adult" }, // content review: no pronoun in corpus; gym regular, cast male
  eli: { feminine: false, age: "adult" }, // male across all three scenes
  finn: { feminine: false, age: "adult" }, // "他会动心"
  andre: { feminine: false, age: "adult" }, // "他会真正愣住"
  rowan: { feminine: false, age: "adult" }, // "他会先受伤"
  darin: { feminine: false, age: "adult" }, // "他越来劲"
  dylan: { feminine: false, age: "adult" }, // "他会焦躁"
  chris: { feminine: false, age: "adult" }, // "他会真正停下来面对"
  miro: { feminine: false, age: "adult" }, // "他会松弛下来"
  daryl: { feminine: false, age: "adult" }, // "他会愣一下"
  marco: { feminine: false, age: "adult" }, // "他会立刻升级"
  vic: { feminine: false, age: "adult" }, // "他会愣一下"
  drew: { feminine: false, age: "adult" }, // "他会愣住"
  avery: { feminine: false, age: "adult" }, // "他会步步后退"
  ravi: { feminine: false, age: "adult" }, // long-distance partner (male pronouns)

  // --- family elders ---
  "mrs-wu": { feminine: true, age: "mature" }, // Riley's mother
  "auntie-wang": { feminine: true, age: "mature" }, // 二姨; older relative
  "aunt-zhou": { feminine: true, age: "mature" }, // Wren's 姑妈
  "dad-chen": { feminine: false, age: "mature" }, // your father
};

/** Scene-level overrides for ids that point at different people in different scenes. */
export const LOVE_VOICES_SCENE: Record<string, SpeakerVoice> = {
  "love-approach-hobby-event:tess": { feminine: true, age: "young" }, // young stranger at a photo walk
  "love-ld-social-media-rumor:tess": { feminine: true, age: "adult" }, // adult long-distance partner
  "partner-alone-evening:sam": { feminine: true, age: "adult" }, // Sam the partner; content review: corpus is pronoun-free, cast female to keep the two Sams apart
  "love-receive-confession:sam": { feminine: false, age: "young" }, // Sam the friend who confesses
};

export function loveVoiceKey(scenarioId: string, characterId: string): string {
  return `${scenarioId}:${characterId}`;
}

/** Scene override wins over the shared base; unknown/custom casts stay undefined. */
export function resolveLoveVoice(scenarioId: string, characterId: string): SpeakerVoice | undefined {
  return LOVE_VOICES_SCENE[loveVoiceKey(scenarioId, characterId)] ?? LOVE_VOICES_BASE[characterId];
}
