/** 离线回归：恋爱域「真人感」层 human-voice 的纯函数（spec-love-human-voice §4.1 / §4.5 / §4.6）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  driftDirective,
  enforceLine,
  maybeImperfection,
  pickDrift,
  pickReplyShape,
  replyShapeDirective,
  replyShapeLimit,
  stripSpokenMarkdown,
  type ReplyShape,
} from "../../src/lib/human-voice";
import type { LearnerTurnKind } from "../../src/lib/turn-taking";

/** 固定 rng：逐个吐出给定值（用完后重复最后一个）。 */
function seqRng(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const fixed = (v: number) => () => v;

const SHAPES: ReplyShape[] = ["clause", "short", "two-beat", "trail-off", "flat"];

test("stripSpokenMarkdown 剥离 markdown 语法", () => {
  assert.equal(stripSpokenMarkdown("- 你好"), "你好");
  assert.equal(stripSpokenMarkdown("**嗯**"), "嗯");
  assert.equal(stripSpokenMarkdown("## 标题"), "标题");
  assert.equal(stripSpokenMarkdown("```ts\nconst x = 1\n```"), "");
  assert.equal(stripSpokenMarkdown("```"), "");
  assert.equal(stripSpokenMarkdown("> 引用"), "引用");
  assert.equal(stripSpokenMarkdown("1. 第一"), "第一");
  assert.equal(stripSpokenMarkdown("[点这里](https://x)"), "点这里");
  assert.equal(stripSpokenMarkdown("---"), "");
  assert.equal(stripSpokenMarkdown("用 `code` 表示"), "用表示");
});

test("stripSpokenMarkdown 保留口语符号与下划线", () => {
  assert.equal(stripSpokenMarkdown("他说「嗯」……"), "他说「嗯」……");
  assert.equal(stripSpokenMarkdown("嗯？好。"), "嗯？好。");
  assert.equal(stripSpokenMarkdown("use snake_case here"), "use snake_case here");
});

test("stripSpokenMarkdown 折叠换行与归一空白", () => {
  assert.equal(stripSpokenMarkdown("你 好 ， 我 在"), "你好，我在");
  assert.equal(stripSpokenMarkdown("第一行\n第二行"), "第一行第二行");
  assert.equal(stripSpokenMarkdown("第一行\nnext line"), "第一行 next line");
  assert.equal(stripSpokenMarkdown("hello , world !"), "hello, world!");
  assert.equal(stripSpokenMarkdown("hello,world"), "hello, world");
});

test("stripSpokenMarkdown 幂等", () => {
  const cases = [
    "- 你好",
    "**嗯**",
    "## 标题",
    "> 引用",
    "1. 第一",
    "[点这里](https://x)",
    "---",
    "```\ncode\n```",
    "你 好 ， 我 在",
    "他说「嗯」……",
    "use snake_case here",
    "hello , world !",
  ];
  for (const c of cases) {
    const once = stripSpokenMarkdown(c);
    assert.equal(stripSpokenMarkdown(once), once, c);
  }
});

test("enforceLine 未超上限只剥离不截断", () => {
  assert.equal(enforceLine("**你好**", "zh", "short"), "你好");
  assert.equal(enforceLine("hello, world", "en", "short"), "hello, world");
});

test("enforceLine 五种形态的超长中文都截到句末标点", () => {
  for (const shape of SHAPES) {
    const input = "字".repeat(118) + "。长出来的尾巴";
    const out = enforceLine(input, "zh", shape);
    assert.equal(out, "字".repeat(118) + "。", shape);
    assert.ok(out.endsWith("。"), shape);
  }
});

test("enforceLine 无句末标点时截到次级标点并补省略号", () => {
  const input = "字".repeat(60) + "，" + "字".repeat(100);
  const out = enforceLine(input, "zh", "two-beat");
  assert.equal(out, "字".repeat(60) + "，……");
  assert.equal(out.length, 63);
});

test("enforceLine 找不到任何标点则原样返回", () => {
  const input = "字".repeat(200);
  assert.equal(enforceLine(input, "zh", "flat"), input);
});

test("enforceLine 英文按句末标点截断、不切词", () => {
  const words49 = Array.from({ length: 49 }, () => "word").join(" ");
  const input = words49 + " end. " + Array.from({ length: 50 }, () => "more").join(" ");
  const out = enforceLine(input, "en", "short");
  assert.equal(out, words49 + " end.");
  assert.ok(!out.endsWith("more"));
});

test("enforceLine 英文无句末标点时补省略号", () => {
  const a59 = Array.from({ length: 59 }, () => "a").join(" ");
  const input = a59 + " cut, " + Array.from({ length: 40 }, () => "b").join(" ");
  const out = enforceLine(input, "en", "short");
  assert.equal(out, a59 + " cut,…");
});

test("enforceLine 幂等", () => {
  const cases = [
    "字".repeat(118) + "。尾巴",
    "字".repeat(60) + "，" + "字".repeat(100),
    "字".repeat(200),
    Array.from({ length: 49 }, () => "word").join(" ") + " end. " + Array.from({ length: 50 }, () => "more").join(" "),
  ];
  for (const c of cases) {
    const onceZh = enforceLine(c, "zh", "flat");
    assert.equal(enforceLine(onceZh, "zh", "flat"), onceZh, c);
    const onceEn = enforceLine(c, "en", "flat");
    assert.equal(enforceLine(onceEn, "en", "flat"), onceEn, c);
  }
});

test("pickReplyShape 收束回合恒为 flat", () => {
  const base = {
    rng: fixed(0.01),
    lang: "zh" as const,
    learnerTurn: "question" as const,
    initiative: "answer" as const,
    terminal: false,
    ended: false,
    turnIndex: 0,
  };
  assert.equal(pickReplyShape({ ...base, terminal: true }), "flat");
  assert.equal(pickReplyShape({ ...base, ended: true }), "flat");
  assert.equal(pickReplyShape({ ...base, terminal: true, ended: true }), "flat");
});

test("pickReplyShape 固定 rng 可预测且边界准确", () => {
  const mk = (rng: () => number, learnerTurn: LearnerTurnKind = "statement") =>
    pickReplyShape({ rng, lang: "zh", learnerTurn, initiative: "answer", terminal: false, ended: false, turnIndex: 3 });
  // statement：short 0.35 / flat 0.25 / two-beat 0.2 / clause 0.12 / trail-off 0.08。
  assert.equal(mk(fixed(0.2)), "short");
  assert.equal(mk(fixed(0.35)), "flat");
  assert.equal(mk(fixed(0.5)), "flat");
  assert.equal(mk(fixed(0.6)), "two-beat");
  assert.equal(mk(fixed(0.7)), "two-beat");
  assert.equal(mk(fixed(0.8)), "clause");
  assert.equal(mk(fixed(0.9)), "clause");
  assert.equal(mk(fixed(0.92)), "trail-off");
  assert.equal(mk(fixed(0.99)), "trail-off");
  // bare-ack：clause 0.5 / trail-off 0.3 / short 0.2。
  assert.equal(mk(fixed(0.2), "bare-ack"), "clause");
  assert.equal(mk(fixed(0.5), "bare-ack"), "trail-off");
  assert.equal(mk(fixed(0.6), "bare-ack"), "trail-off");
  assert.equal(mk(fixed(0.8), "bare-ack"), "short");
  assert.equal(mk(fixed(0.9), "bare-ack"), "short");
  // question：short 0.5 / flat 0.3 / two-beat 0.2。
  assert.equal(mk(fixed(0.2), "question"), "short");
  assert.equal(mk(fixed(0.5), "question"), "flat");
  assert.equal(mk(fixed(0.6), "question"), "flat");
  assert.equal(mk(fixed(0.8), "question"), "two-beat");
  assert.equal(mk(fixed(0.9), "question"), "two-beat");
});

test("pickReplyShape hold-back 恒 clause、close 恒 trail-off", () => {
  const mk = (initiative: "hold-back" | "close", rng: () => number) =>
    pickReplyShape({ rng, lang: "zh", learnerTurn: "statement", initiative, terminal: false, ended: false, turnIndex: 1 });
  assert.equal(mk("hold-back", fixed(0.99)), "clause");
  assert.equal(mk("close", fixed(0.99)), "trail-off");
});

test("replyShapeLimit 表值准确", () => {
  assert.deepEqual(replyShapeLimit("clause", "zh"), { maxChars: 14 });
  assert.deepEqual(replyShapeLimit("clause", "en"), { maxChars: 10 });
  assert.deepEqual(replyShapeLimit("trail-off", "zh"), { maxChars: 24 });
  assert.deepEqual(replyShapeLimit("trail-off", "en"), { maxChars: 14 });
  assert.deepEqual(replyShapeLimit("short", "zh"), { maxChars: 30 });
  assert.deepEqual(replyShapeLimit("short", "en"), { maxChars: 18 });
  assert.deepEqual(replyShapeLimit("flat", "zh"), { maxChars: 45 });
  assert.deepEqual(replyShapeLimit("flat", "en"), { maxChars: 28 });
  assert.deepEqual(replyShapeLimit("two-beat", "zh"), { maxChars: 60 });
  assert.deepEqual(replyShapeLimit("two-beat", "en"), { maxChars: 35 });
});

test("replyShapeDirective 双语非空且含形态名与上限", () => {
  for (const shape of SHAPES) {
    for (const lang of ["zh", "en"] as const) {
      const d = replyShapeDirective(shape, lang);
      assert.ok(d.length > 0, `${shape}/${lang}`);
      assert.ok(d.includes("THIS TURN'S SHAPE"), `${shape}/${lang}`);
      assert.ok(d.includes(shape), `${shape}/${lang}`);
      assert.ok(d.includes(String(replyShapeLimit(shape, lang).maxChars)), `${shape}/${lang}`);
    }
  }
});

test("maybeImperfection 默认关闭、locked 强制关闭且不抽 rng", () => {
  const never = () => {
    throw new Error("rng 不应被调用");
  };
  assert.deepEqual(maybeImperfection({ text: "你好", lang: "zh", rng: never, enabled: false, locked: false }), {
    text: "你好",
    corrected: false,
  });
  assert.deepEqual(maybeImperfection({ text: "你好", lang: "zh", rng: never, enabled: true, locked: true }), {
    text: "你好",
    corrected: false,
  });
  assert.deepEqual(maybeImperfection({ text: "hello", lang: "en", rng: never, enabled: false, locked: false }), {
    text: "hello",
    corrected: false,
  });
});

test("maybeImperfection 中文三档概率各只改一处", () => {
  // 0.002 < 0.003：重复抽中的字符「吗」。
  assert.deepEqual(maybeImperfection({ text: "你好吗", lang: "zh", rng: seqRng(0.002, 0.9, 0.9), enabled: true, locked: false }), {
    text: "你好吗吗",
    corrected: true,
  });
  // 0.01 < 0.03：同音替换（抽中 他→她）。
  assert.deepEqual(maybeImperfection({ text: "他来了", lang: "zh", rng: seqRng(0.9, 0.01, 0.9), enabled: true, locked: false }), {
    text: "她来了",
    corrected: true,
  });
  // 0.001 < 0.002：删除抽中的字符「好」。
  assert.deepEqual(maybeImperfection({ text: "你好啊", lang: "zh", rng: seqRng(0.9, 0.9, 0.001), enabled: true, locked: false }), {
    text: "你啊",
    corrected: true,
  });
  // 三档都未触发。
  assert.deepEqual(maybeImperfection({ text: "你好", lang: "zh", rng: seqRng(0.9, 0.9, 0.9), enabled: true, locked: false }), {
    text: "你好",
    corrected: false,
  });
});

test("maybeImperfection 英文只做轻微拼写错误", () => {
  // 0.002 < 0.003 触发；抽中的 fox 不在表里，回退替换 the。
  assert.deepEqual(maybeImperfection({ text: "the quick fox", lang: "en", rng: fixed(0.002), enabled: true, locked: false }), {
    text: "teh quick fox",
    corrected: true,
  });
  assert.deepEqual(maybeImperfection({ text: "you are here", lang: "en", rng: fixed(0.002), enabled: true, locked: false }), {
    text: "yuo are here",
    corrected: true,
  });
  // 触发但表里没有可替换的词。
  assert.deepEqual(maybeImperfection({ text: "hello world", lang: "en", rng: fixed(0.002), enabled: true, locked: false }), {
    text: "hello world",
    corrected: false,
  });
  // 未触发。
  assert.deepEqual(maybeImperfection({ text: "fine", lang: "en", rng: fixed(0.9), enabled: true, locked: false }), {
    text: "fine",
    corrected: false,
  });
});

test("pickDrift 阈值 0.15", () => {
  assert.equal(pickDrift(fixed(0.149)), true);
  assert.equal(pickDrift(fixed(0.15)), false);
  assert.equal(pickDrift(fixed(0.999)), false);
});

test("driftDirective 双语非空且不许改立场", () => {
  for (const lang of ["zh", "en"] as const) {
    const d = driftDirective(lang);
    assert.ok(d.length > 0, lang);
    assert.ok(d.includes("redLine"), lang);
  }
});

test('数字、时间、URL、邮箱不被标点归一改写，且二次应用仍然幂等', () => {
  const cases = [
    ["我们约在 10:30 见", "我们约在 10:30 见"],
    ["版本 3.14 和 3.0 都在", "版本 3.14 和 3.0 都在"],
    ["看这个 https://example.com/a.b 就好", "看这个 https://example.com/a.b 就好"],
    ["发我邮箱 a.b@example.com", "发我邮箱 a.b@example.com"],
    ["1. 第一", "第一"],
    ["12,000 人和 1,234.56 元", "12,000 人和 1,234.56 元"],
  ] as const;
  for (const [input, expected] of cases) {
    const once = stripSpokenMarkdown(input);
    assert.equal(once, expected, `first pass: ${input}`);
    assert.equal(stripSpokenMarkdown(once), once, `idempotent: ${input}`);
  }
});

test('带空格的小数不会被有序列表规则吃掉', () => {
  assert.equal(stripSpokenMarkdown("3. 14 是圆周率"), "3. 14 是圆周率");
});
