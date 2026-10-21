/** 用户卡契约（spec-love-user-cards §2.1/§2.3）：最小 PNG 往返、JSON 信封/扁平/未知 spec、拒绝分支、ScenarioSchema 合成。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOVE_CARD_MAX_BYTES,
  loveCardToJson,
  parseLoveCardJson,
  parseLoveCardPng,
  type LoveCard,
} from "../../src/lib/love-card";
import { scenarioFromCard } from "../../src/lib/love-card-scenario";
import { ScenarioSchema } from "../../src/lib/runtime-contracts";

// ---- 最小 PNG 构造器（CRC 留零即可：解析器不校验 CRC）----

const SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

function pngChunks(...chunks: Uint8Array[]): Uint8Array {
  const parts = [SIG, ...chunks];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ihdr(): Uint8Array {
  const data = new Uint8Array(13);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 1); // width
  dv.setUint32(4, 1); // height
  data[8] = 8; // bit depth
  data[9] = 0; // color type: grayscale
  return data;
}

function iend(): Uint8Array {
  return chunk("IEND", new Uint8Array(0));
}

function textChunk(keyword: string, text: string): Uint8Array {
  const kw = new TextEncoder().encode(keyword);
  const body = new TextEncoder().encode(text);
  const data = new Uint8Array(kw.length + 1 + body.length);
  data.set(kw, 0);
  data[kw.length] = 0;
  data.set(body, kw.length + 1);
  return chunk("tEXt", data);
}

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

function pngWithCard(cardJson: unknown, keyword: "chara" | "ccv3" = "chara"): Uint8Array {
  return pngChunks(ihdr(), textChunk(keyword, base64(JSON.stringify(cardJson))), iend());
}

// ---- 样例卡 ----

const sampleCardJson = () => ({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Rio",
    description: "慢热但认真。",
    personality: "认真、慢热，说话会先想一会儿。",
    scenario: "咖啡店里，你们第一次单独见面。",
    first_mes: "你来了。坐吧，这家店我常来。",
    mes_example: "<START>\n{{char}}: 你最近怎么样？",
    alternate_greetings: ["（她朝你点点头）", "（她在窗边等你）"],
    tags: ["slow-burn", "coffee"],
    character_book: {
      entries: [
        { keys: ["咖啡", "coffee"], content: "她只喝美式。", enabled: true, insertion_order: 100 },
        { keys: ["狗"], content: "她对狗毛过敏。", enabled: false, insertion_order: 200 },
      ],
    },
    license: "CC-BY-4.0",
    creator: "someone", // 未知字段应被丢弃
    extensions: { whatever: { x: 1 } }, // 未知字段应被丢弃
  },
});

// id / importedAt / updatedAt / source 是导入时新生成的本地元数据（id、时间戳与「来自哪条
// 通道」），不参与内容往返比较；其余逐字一致。
const contentFields = (c: LoveCard) => ({
  name: c.name,
  description: c.description,
  personality: c.personality,
  scenario: c.scenario,
  firstMes: c.firstMes,
  mesExample: c.mesExample,
  alternateGreetings: c.alternateGreetings,
  tags: c.tags,
  characterBook: c.characterBook,
  spec: c.spec,
  license: c.license,
});

// ---- 解析 ----

test("a minimal chara PNG parses, drops unknown fields and keeps only enabled world-book entries", () => {
  const parsed = parseLoveCardPng(pngWithCard(sampleCardJson()));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.card.name, "Rio");
  assert.equal(parsed.card.firstMes, "你来了。坐吧，这家店我常来。");
  assert.equal(parsed.card.source, "tavern-png");
  assert.equal(parsed.card.spec, "chara_card_v2");
  assert.ok(!("creator" in parsed.card));
  assert.ok(!("extensions" in parsed.card));
  assert.deepEqual(parsed.card.tags, ["slow-burn", "coffee"]);
  assert.deepEqual(parsed.card.characterBook, {
    entries: [{ keys: ["咖啡", "coffee"], content: "她只喝美式。", enabled: true, insertionOrder: 100 }],
  }, "disabled entries are dropped, insertion_order maps to insertionOrder");
  assert.equal(parsed.card.license, "CC-BY-4.0");
});

test("a ccv3 keyword names the v3 spec even without an embedded spec field", () => {
  const cardJson = { data: { name: "Nia", description: "话很少。", first_mes: "嗯。" } };
  const parsed = parseLoveCardPng(pngWithCard(cardJson, "ccv3"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.card.spec, "chara_card_v3");
  assert.equal(parsed.card.source, "tavern-png");
});

test("JSON import accepts envelopes, flat objects and unknown specs; rejects unusable shapes", () => {
  const enveloped = parseLoveCardJson(JSON.stringify(sampleCardJson()));
  assert.equal(enveloped.ok, true);
  if (!enveloped.ok) return;
  assert.equal(enveloped.card.spec, "chara_card_v2");
  assert.equal(enveloped.card.source, "tavern-json");
  assert.equal(enveloped.card.firstMes, "你来了。坐吧，这家店我常来。");

  // 扁平 { name, description, … }：无 spec 字段 → unknown
  const flat = parseLoveCardJson(JSON.stringify({ name: "Rio", description: "慢热", first_mes: "你好" }));
  assert.equal(flat.ok, true);
  if (!flat.ok) return;
  assert.equal(flat.card.spec, "unknown");
  assert.equal(flat.card.name, "Rio");

  // spec 认不出但 data 可取 → unknown
  const weirdSpec = parseLoveCardJson(JSON.stringify({ spec: "chara_card_future", data: { name: "X", description: "d" } }));
  assert.equal(weirdSpec.ok, true);
  if (!weirdSpec.ok) return;
  assert.equal(weirdSpec.card.spec, "unknown");
  assert.equal(weirdSpec.card.name, "X");

  // spec 认不出且 data/扁平字段都取不到 → bad-format
  assert.deepEqual(parseLoveCardJson(JSON.stringify({ spec: "chara_card_future" })), {
    ok: false,
    code: "bad-format",
    message: "认不出这是一张可用的角色卡：请选择 Tavern 卡文件（PNG）或角色卡 JSON。",
  });
  assert.equal(parseLoveCardJson(JSON.stringify({ data: {} })).ok, false);
  assert.equal(parseLoveCardJson(JSON.stringify({ data: "not-an-object" })).ok, false);
  assert.equal(parseLoveCardJson("42").ok, false, "a JSON number is not a card");
  assert.equal(parseLoveCardJson("{not json").ok, false, "broken JSON is bad-json");
});

test("missing name, or both description and first_mes empty, reject with missing-field", () => {
  const noName = parseLoveCardJson(JSON.stringify({ data: { description: "x", first_mes: "y" } }));
  assert.deepEqual(noName, {
    ok: false,
    code: "missing-field",
    message: "卡片缺少名字（name）。",
  });
  const emptyName = parseLoveCardJson(JSON.stringify({ data: { name: "   ", description: "x" } }));
  assert.equal(emptyName.ok, false);
  if (!emptyName.ok) assert.equal(emptyName.code, "missing-field");

  const noBody = parseLoveCardJson(JSON.stringify({ data: { name: "Rio", description: " ", first_mes: "" } }));
  assert.deepEqual(noBody, {
    ok: false,
    code: "missing-field",
    message: "描述与开场白（first_mes）不能同时为空。",
  });

  // 英文消息按 lang=en 选
  const en = parseLoveCardJson(JSON.stringify({ data: { description: "x" } }), "en");
  assert.deepEqual(en, { ok: false, code: "missing-field", message: "The card is missing its name." });
});

test("parseLoveCardPng rejects non-PNG bytes, PNGs without a card payload, and over-limit chunks", () => {
  assert.equal(parseLoveCardPng(new TextEncoder().encode("this is not a png")).ok, false);
  const noCard = pngChunks(ihdr(), iend());
  const withoutCard = parseLoveCardPng(noCard);
  assert.deepEqual(withoutCard, {
    ok: false,
    code: "bad-format",
    message: "认不出这是一张可用的角色卡：请选择 Tavern 卡文件（PNG）或角色卡 JSON。",
  });
  assert.equal(parseLoveCardPng(new Uint8Array(0)).ok, false, "empty buffer is bad-format");

  // 声明长度超 8 MiB 的块：不真分配 8 MiB，单看声明就拒绝。
  const over = new Uint8Array(12);
  new DataView(over.buffer).setUint32(0, LOVE_CARD_MAX_BYTES + 1);
  "tEXt".split("").forEach((char, i) => {
    over[4 + i] = char.charCodeAt(0);
  });
  const overLimit = parseLoveCardPng(pngChunks(ihdr(), over));
  assert.deepEqual(overLimit, { ok: false, code: "too-large", message: "文件超过 8 MiB 上限，没有读取。" });
});

test("a corrupt chara payload is bad-json (bad base64 or non-JSON text)", () => {
  const badBase64 = pngChunks(ihdr(), textChunk("chara", "!!!not-base64!!!"), iend());
  assert.equal(parseLoveCardPng(badBase64).ok, false);
  const nonJson = pngChunks(ihdr(), textChunk("chara", base64("not json")), iend());
  const parsed = parseLoveCardPng(nonJson);
  assert.deepEqual(parsed, { ok: false, code: "bad-json", message: "卡片内容读不出来：JSON 损坏，或 PNG 里的卡片数据解不开。" });
});

test("a PNG card round-trips through loveCardToJson and parseLoveCardJson with equal fields", () => {
  const parsed = parseLoveCardPng(pngWithCard(sampleCardJson()));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const exported = loveCardToJson(parsed.card);
  const again = parseLoveCardJson(exported);
  assert.equal(again.ok, true);
  if (!again.ok) return;

  // id / timestamps / source 是导入时新生成的本地元数据，不参与导出；其余逐字一致。
  assert.deepEqual(contentFields(again.card), contentFields(parsed.card));
  assert.notEqual(again.card.id, parsed.card.id);
  assert.equal(again.card.source, "tavern-json");
  assert.deepEqual(again.card.characterBook, parsed.card.characterBook, "world book survives the PNG→JSON round trip");
});

// ---- Scenario 合成 ----

const manualCard = (over: Partial<LoveCard> = {}): LoveCard => ({
  id: "card-test-npc",
  name: "Nia",
  description: "语速很慢，但每句话都认真。",
  personality: "认真、慢热。",
  scenario: "",
  firstMes: "",
  mesExample: "",
  alternateGreetings: [],
  tags: ["slow", "cafe"],
  source: "manual",
  spec: "unknown",
  importedAt: 1,
  updatedAt: 1,
  ...over,
});

test("scenarioFromCard synthesizes a shell accepted by the real ScenarioSchema", () => {
  const scenario = scenarioFromCard(manualCard());
  assert.ok(ScenarioSchema.safeParse(scenario).success, "the shell must pass ScenarioSchema");
  assert.equal(scenario.id, "card:card-test-npc");
  assert.equal(scenario.title.zh, "Nia");
  assert.equal(scenario.custom, true);
  assert.equal(scenario.source, "user-card");
  assert.equal(scenario.context, "romantic");
  assert.equal(scenario.opening.characterId, "npc");
  assert.equal(scenario.maxTurns, 12, "default maxTurns is 12 per the spec");
  assert.equal(scenario.characters.length, 2);
  const you = scenario.characters.find((c) => c.id === "you");
  const npc = scenario.characters.find((c) => c.id === "npc");
  assert.equal(you?.playable, true);
  assert.equal(npc?.playable, false);
  assert.equal(npc?.name.zh, "Nia");

  // 空 scenario/firstMes 时 background / opening 回退到 description
  assert.equal(scenario.background.zh, "语速很慢，但每句话都认真。");
  assert.equal(scenario.opening.text.zh, "语速很慢，但每句话都认真。");
  // hook 取描述首句
  assert.equal(scenario.hook.zh, "语速很慢，但每句话都认真。");
  assert.ok(scenario.success.zh.trim() && scenario.failure.zh.trim());
});

test("scenarioFromCard honours maxTurns and learnerName options", () => {
  const scenario = scenarioFromCard(manualCard(), { maxTurns: 8, learnerName: "Ada" });
  assert.equal(scenario.maxTurns, 8);
  assert.equal(scenario.characters.find((c) => c.id === "you")?.name.zh, "Ada");
  assert.ok(ScenarioSchema.safeParse(scenario).success);

  const clamped = scenarioFromCard(manualCard(), { maxTurns: 999 });
  assert.equal(clamped.maxTurns, 200, "maxTurns is clamped into the schema's 1–200 range");
});