/** P2 文风靠拢与用词提示（spec-love-human-voice §4.3/§4.4）：画像 / 靠拢块 / 用词提取。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeStyle,
  extractTerms,
  lexiconBlock,
  styleMirrorBlock,
  type LexiconTerm,
  type StyleProfile,
} from "../../src/lib/style-adaptation";

const ZERO: StyleProfile = {
  samples: 0,
  avgChars: 0,
  shortRatio: 0,
  questionRatio: 0,
  ellipsisRatio: 0,
  emojiRatio: 0,
  particles: [],
  latinRatio: 0,
  lowercaseStartRatio: 0,
};

/* ------------------------------------------------------------------ *
 * analyzeStyle：画像
 * ------------------------------------------------------------------ */

test("three short zh lines: samples=3, small avgChars, high shortRatio", () => {
  const p = analyzeStyle(["今天好累啊", "你呢", "早点睡吧"], "zh");
  assert.equal(p.samples, 3);
  assert.equal(p.avgChars, Math.round((5 + 2 + 4) / 3), "avgChars rounds to the nearest integer");
  assert.equal(p.shortRatio, 1, "all three lines are ≤8 chars");
  assert.equal(p.questionRatio, 0);
  assert.equal(p.ellipsisRatio, 0);
  assert.equal(p.emojiRatio, 0);
  assert.deepEqual(p.particles, ["啊", "吧", "呢"], "fixed order, only the ones that actually appear");
  assert.equal(p.latinRatio, 0);
  assert.equal(p.lowercaseStartRatio, 0, "zh never reports lowercaseStartRatio");
});

test("empty or whitespace-only input: all-zero profile, no NaN", () => {
  for (const lang of ["zh", "en"] as const) {
    assert.deepEqual(analyzeStyle([], lang), ZERO);
    assert.deepEqual(analyzeStyle(["", "  ", "\t"], lang), ZERO, "blank lines are filtered out");
    for (const [k, v] of Object.entries(analyzeStyle(["  "], lang))) {
      if (typeof v === "number") assert.ok(!Number.isNaN(v), `${k} is not NaN`);
    }
  }
});

test("zh particles, emoji and latin-mix ratios", () => {
  const p = analyzeStyle(["哈哈😄", "去吧", "嗯嗯"], "zh");
  assert.deepEqual(p.particles, ["吧"], "啊/吧/呢/嘛/诶/呀/哦/啦 fixed order, only 吧 appears");
  assert.equal(p.emojiRatio, 0.33, "1 of 3 lines has an emoji");
  assert.equal(p.latinRatio, 0);
  assert.equal(p.questionRatio, 0);

  const mixed = analyzeStyle(["这家店叫 Blue Bottle", "普通咖啡", "普通咖啡"], "zh");
  assert.equal(mixed.latinRatio, 0.33, "zh: 1 of 3 lines contains latin letters");

  const q = analyzeStyle(["吃饭了吗？", "去哪…", "行吧"], "zh");
  assert.equal(q.questionRatio, 0.33);
  assert.equal(q.ellipsisRatio, 0.33, "… counts as an ellipsis");

  const q2 = analyzeStyle(["吃饭了吗？", "然后呢...", "哦"], "zh");
  assert.equal(q2.questionRatio, 0.33, "? / ？ both count");
  assert.equal(q2.ellipsisRatio, 0.33, "three dots count as an ellipsis");
});

test("en lowercaseStartRatio skips quotes/parens and ignores letterless lines", () => {
  const p = analyzeStyle(["hey you", "What's up", "(no worries)", "I'm fine"], "en");
  assert.equal(p.lowercaseStartRatio, 0.5, "hey + (no → lowercase; What + I'm → uppercase");
  assert.equal(p.shortRatio, 1, "all ≤4 words");
  assert.equal(p.latinRatio, 0, "en never reports latinRatio");
  assert.deepEqual(p.particles, [], "en has no particles");

  const quoted = analyzeStyle(['"hi there"', "Bye", "…"], "en");
  assert.equal(quoted.lowercaseStartRatio, 0.5, 'the "…" line has no letter and is excluded from the denominator');

  const noLetters = analyzeStyle(["123", "ABC", "abc"], "en");
  assert.equal(noLetters.lowercaseStartRatio, 0.5, "the letterless line is not in the denominator");
});

/* ------------------------------------------------------------------ *
 * styleMirrorBlock：靠拢提示词块
 * ------------------------------------------------------------------ */

test("mirror block: <3 samples → null; ≥3 → non-null with prohibitions", () => {
  assert.equal(styleMirrorBlock(analyzeStyle(["就一句", "再一句"], "zh"), "zh"), null, "too few samples, no portrait");
  assert.equal(styleMirrorBlock(analyzeStyle(["just one"], "en"), "en"), null);

  const zh = styleMirrorBlock(analyzeStyle(["今天好累啊", "你呢", "早点睡吧"], "zh"), "zh");
  assert.ok(zh, "3 samples are enough");
  assert.ok(zh.startsWith("LEARNER'S WRITING STYLE（只影响你说话的长短与语气，不改变人设、不改变立场）"));
  assert.ok(zh.includes("他的消息平均 4 字"), "describes average length");
  assert.ok(zh.includes("以短句为主"), "describes short-sentence share");
  assert.ok(zh.includes("常用「啊」「吧」"), "describes particles");
  assert.ok(zh.includes("几乎不用 emoji"));
  assert.ok(zh.includes("不要模仿错别字"), "forbids mimicking typos");
  assert.ok(zh.includes("不要评论他说话的方式"), "forbids commenting on how they talk");
  assert.ok(zh.includes("不要变成另一个人"));

  const en = styleMirrorBlock(analyzeStyle(["hey you", "how's it going", "see you soon"], "en"), "en");
  assert.ok(en);
  assert.ok(en.startsWith("LEARNER'S WRITING STYLE ("));
  assert.ok(en.includes("Their messages average 11 characters"));
  assert.ok(en.toLowerCase().includes("don't mimic typos"));
  assert.ok(en.toLowerCase().includes("don't comment on how they talk"));
});

test("long-form learner: only 'don't be more verbose', no convergence instruction", () => {
  const longLine = "唉，说来话长，" + "真的很复杂很复杂很复杂很复杂很复杂很复杂很复杂很复杂很复杂很复杂很复杂很复杂".repeat(3);
  assert.ok([...longLine].length > 60, "sanity: the line is really long");
  const lines = [longLine, longLine.slice(0, 40) + "……", longLine.slice(0, 30) + "吧。"];
  const p = analyzeStyle(lines, "zh");
  assert.ok(p.avgChars > 60, `avgChars ${p.avgChars} crosses the zh threshold`);

  const block = styleMirrorBlock(p, "zh");
  assert.ok(block);
  assert.ok(block.includes("不要比他更啰嗦"), "the only hint is: don't out-verbose them");
  assert.ok(!block.includes("靠拢"), "no convergence instruction");
  assert.ok(!block.includes("接近他"), "no 'match their length' instruction");
  assert.ok(block.includes("不要模仿错别字"), "prohibitions still present");

  const enLong = styleMirrorBlock(analyzeStyle(["word ".repeat(260).trim(), "same ".repeat(250).trim(), "again ".repeat(240).trim()], "en"), "en");
  assert.ok(enLong);
  assert.ok(enLong.toLowerCase().includes("don't be more long-winded"));
  assert.ok(!enLong.toLowerCase().includes("lean"), "no convergence instruction in en either");
});

/* ------------------------------------------------------------------ *
 * extractTerms：用词提取
 * ------------------------------------------------------------------ */

test("quoted terms are extracted with their first source line", () => {
  const first = "伞在门口，「下雨天」记得带";
  const terms = extractTerms([first, "「下雨天」是说过的话"], "zh");
  const hit = terms.find((t) => t.term === "下雨天");
  assert.ok(hit, "「下雨天」 is extracted");
  assert.equal(hit.count, 2, "one occurrence per line");
  assert.equal(hit.source, first, "source is the first original line");

  const curly = extractTerms(['她说“晚安”', '她说“晚安”'], "zh");
  assert.ok(curly.some((t) => t.term === "晚安"), "“…” quotes count too");
});

test("latin tokens: POV/OKR extracted, stopwords excluded, case-sensitive", () => {
  const terms = extractTerms(["POV: 我们聊到深夜", "OKR 是这周的", "POV 这个词很好"], "zh");
  const pov = terms.find((t) => t.term === "POV");
  assert.ok(pov && pov.count === 2);
  assert.ok(terms.some((t) => t.term === "OKR"));

  const en = extractTerms(["the cat and the dog", "the cat and the dog"], "en");
  assert.ok(!en.some((t) => t.term === "the"), "the is a stopword");
  assert.ok(!en.some((t) => t.term === "The"), "case-insensitive stopword match");
  assert.ok(en.some((t) => t.term === "cat"), "cat is kept");

  const caseSensitive = extractTerms(["POV and pov", "POV and pov"], "zh");
  assert.ok(caseSensitive.some((t) => t.term === "POV"));
  assert.ok(caseSensitive.some((t) => t.term === "pov"), "case-sensitive dedup keeps both");
});

test("repeated CJK fragments: ≥2 occurrences, stopwords and similar-fragment dedup", () => {
  const terms = extractTerms(["下雨天记得带伞", "下雨天也要注意"], "zh");
  const t = terms.find((x) => x.term === "下雨天");
  assert.ok(t && t.count === 2, "3-char fragment seen twice is extracted");
  assert.ok(!terms.some((x) => x.term === "下雨"), "equal-count substring 下雨 is dropped in favor of 下雨天");

  const unequal = extractTerms(["下雨天记得带伞", "下雨天也要注意", "下雨了"], "zh");
  assert.ok(unequal.some((x) => x.term === "下雨"), "different counts keep both 下雨 and 下雨天");
  assert.ok(unequal.some((x) => x.term === "下雨天"));

  const stop = extractTerms(["我们就是随便聊聊", "我们就是随便聊聊"], "zh");
  assert.ok(!stop.some((x) => x.term === "我们"), "我们 is a stopword");
  assert.ok(!stop.some((x) => x.term === "就是"), "就是 is a stopword");
});

test("quotes and latin come before CJK fragments; total capped at 8", () => {
  const nineQuotes = ["苹果", "香蕉", "橘子", "草莓", "西瓜", "葡萄", "芒果", "菠萝", "樱桃"].map(
    (f) => `「${f}」不错`,
  );
  const terms = extractTerms(nineQuotes, "zh");
  assert.equal(terms.length, 8, "cap is 8 even when more qualify");
  assert.deepEqual(terms.map((t) => t.term), ["苹果", "香蕉", "橘子", "草莓", "西瓜", "葡萄", "芒果", "菠萝"]);

  const mixed = extractTerms(["「约定」好的事", "「约定」好的事", "下雨天记得带伞", "下雨天也要注意", "OKR 是这周的", "OKR 是这周的"], "zh");
  const order = mixed.map((t) => t.term);
  assert.ok(order.indexOf("约定") < order.indexOf("OKR"), "quotes before latin");
  assert.ok(order.indexOf("OKR") < order.indexOf("下雨天"), "latin before CJK fragments");
  assert.ok(mixed.length <= 8);

  assert.deepEqual(extractTerms([], "zh"), []);
  assert.deepEqual(extractTerms(["", "  "], "en"), [], "blank lines contribute nothing");
});

test("source is truncated to 120 chars", () => {
  const long = "开头不重要，" + "中间真的很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长".repeat(2) + "「暗号」结尾";
  const terms = extractTerms([long, "「暗号」再来一次"], "zh");
  const hit = terms.find((t) => t.term === "暗号");
  assert.ok(hit);
  assert.equal(hit.source.length, 120, "source is the first line cut at 120 chars");
  assert.ok(hit.source.startsWith("开头不重要"), "source is still the original line");
});

/* ------------------------------------------------------------------ *
 * lexiconBlock：用词提示词块
 * ------------------------------------------------------------------ */

const TERMS: LexiconTerm[] = [
  { term: "下雨天", count: 2, source: "下雨天记得带伞" },
  { term: "POV", count: 2, source: "POV 我们聊到深夜" },
];

test("lexicon block: empty → null; non-empty carries the header, terms and rules", () => {
  assert.equal(lexiconBlock([], "zh"), null);
  assert.equal(lexiconBlock([], "en"), null);

  const zh = lexiconBlock(TERMS, "zh");
  assert.ok(zh);
  assert.ok(zh.startsWith("LEARNER'S OWN WORDS（学习者自己的用词；不是让你复读的清单）"));
  assert.ok(zh.includes("- 下雨天"));
  assert.ok(zh.includes("- POV"));
  assert.ok(zh.includes("最多 1 个"), "at most one term per turn");
  assert.ok(zh.includes("不要重复对方的话"));
  assert.ok(zh.includes("不要解释这个词"));
  assert.ok(zh.includes("不要因为这个改变立场"));

  const en = lexiconBlock(TERMS, "en");
  assert.ok(en);
  assert.ok(en.startsWith("LEARNER'S OWN WORDS ("));
  assert.ok(en.toLowerCase().includes("at most one"));
});

test("lexicon block caps the term list at 8", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ term: `词${i}`, count: 1, source: "s" }));
  const block = lexiconBlock(many, "zh");
  assert.ok(block);
  const rows = block.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((r) => r.slice(2)), many.slice(0, 8).map((t) => t.term));
});
