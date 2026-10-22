/** 恋爱域「真人感」层：回合意图（spec-love-human-voice §4.2/§8）纯函数测试。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lang } from "../../src/data/taxonomy";
import {
  classifyLearnerTurn,
  chooseInitiative,
  initiativeDirective,
  type Initiative,
  type LearnerTurnKind,
} from "../../src/lib/turn-taking";

const zh: Lang = "zh";
const en: Lang = "en";
/** 具名常量避免 for-of 直接遍历数组字面量（TS 会误判循环变量自引用，TS7022）。 */
const LANGS: readonly Lang[] = [zh, en];

// —— 分类 ——

test("none：空串或只有标点/空白", () => {
  assert.equal(classifyLearnerTurn("", zh), "none");
  assert.equal(classifyLearnerTurn("   ", zh), "none");
  assert.equal(classifyLearnerTurn("\u200B\u200B\u200B", zh), "none");
  assert.equal(classifyLearnerTurn("。。。！？", zh), "none");
  assert.equal(classifyLearnerTurn("?!", en), "none");
  assert.equal(classifyLearnerTurn("…", zh), "none");
});

test("bare-ack：短应答词表（中英各一以上）", () => {
  assert.equal(classifyLearnerTurn("嗯", zh), "bare-ack");
  assert.equal(classifyLearnerTurn("嗯嗯", zh), "bare-ack");
  assert.equal(classifyLearnerTurn("好的", zh), "bare-ack");
  assert.equal(classifyLearnerTurn("知道了", zh), "bare-ack");
  assert.equal(classifyLearnerTurn("ok", en), "bare-ack");
  assert.equal(classifyLearnerTurn("Okay", en), "bare-ack");
  assert.equal(classifyLearnerTurn("yeah", en), "bare-ack");
  assert.equal(classifyLearnerTurn("got it", en), "bare-ack");
  assert.equal(classifyLearnerTurn("fine", en), "bare-ack");
  // 归一化不破坏命中：零宽字符与首尾空白
  assert.equal(classifyLearnerTurn("\u200B 嗯 \u200B", zh), "bare-ack");
  // 尾部句末/次级标点剥掉后仍算应答
  assert.equal(classifyLearnerTurn("嗯。", zh), "bare-ack");
  assert.equal(classifyLearnerTurn("好！", zh), "bare-ack");
  assert.equal(classifyLearnerTurn("ok.", en), "bare-ack");
});

test("bare-ack 反向：词表外的短句不算；语言决定词表", () => {
  assert.equal(classifyLearnerTurn("好的呀", zh), "statement");
  assert.equal(classifyLearnerTurn("嗯哼", zh), "statement");
  assert.equal(classifyLearnerTurn("okay then", en), "statement");
  assert.equal(classifyLearnerTurn("ok", zh), "statement");
  // 问号不剥：短应答带问号是问句，不是应答
  assert.equal(classifyLearnerTurn("好？", zh), "question");
  assert.equal(classifyLearnerTurn("sure?", en), "question");
});

test("question：问号或中文疑问词", () => {
  assert.equal(classifyLearnerTurn("你为什么这么说？", zh), "question");
  assert.equal(classifyLearnerTurn("你觉得呢", zh), "question");
  assert.equal(classifyLearnerTurn("然后呢", zh), "question");
  assert.equal(classifyLearnerTurn("你干嘛呢", zh), "question");
  assert.equal(classifyLearnerTurn("所以呢", zh), "question");
  assert.equal(classifyLearnerTurn("能不能帮我一下", zh), "question");
  assert.equal(classifyLearnerTurn("Are you free?", en), "question");
  assert.equal(classifyLearnerTurn("Why did you say that?", en), "question");
});

test("吧 不算问句标记", () => {
  assert.equal(classifyLearnerTurn("我们走吧", zh), "statement");
  assert.equal(classifyLearnerTurn("那就这样吧", zh), "statement");
  // 「好吧」本身在应答词表里，仍是 bare-ack
  assert.equal(classifyLearnerTurn("好吧", zh), "bare-ack");
});

test("invitation：邀请标记（中英）", () => {
  assert.equal(classifyLearnerTurn("周末要不要一起去看展", zh), "invitation");
  assert.equal(classifyLearnerTurn("今晚陪我吃饭", zh), "invitation");
  assert.equal(classifyLearnerTurn("let's go together tonight", en), "invitation");
  assert.equal(classifyLearnerTurn("Do you want to hang out this weekend", en), "invitation");
});

test("long-share：40 字叙述 / 25 词以上；其余 statement", () => {
  const zhLong =
    "今天天气很好，我去了公园散步，看见很多花，又去喝了咖啡，然后回家看了会书，晚上做了饭，洗完碗就睡了，整体过得挺充实的";
  assert.equal(classifyLearnerTurn(zhLong, zh), "long-share");
  const enLong =
    "I went to the park this morning and saw a lot of flowers, then I had a coffee, came home and read a book for a while, cooked dinner, washed the dishes, and went to sleep early";
  assert.equal(classifyLearnerTurn(enLong, en), "long-share");
  assert.equal(classifyLearnerTurn("我今天心情不错", zh), "statement");
  assert.equal(classifyLearnerTurn("I had a good day", en), "statement");
});

// —— 意图 ——

/** 默认 rng=0.99（必中 deflect），用于验证优先级与硬约束；抽样用例单独覆盖阈值。 */
const choose = (over: Partial<Parameters<typeof chooseInitiative>[0]> = {}) =>
  chooseInitiative({
    rng: () => 0.99,
    learnerTurn: "statement",
    lastNpcAskedQuestion: false,
    terminal: false,
    ended: false,
    turnIndex: 1,
    ...over,
  });

test("ended / terminal → close", () => {
  assert.equal(choose({ ended: true }), "close");
  assert.equal(choose({ ended: true, learnerTurn: "question" }), "close");
  assert.equal(choose({ terminal: true }), "close");
  assert.equal(choose({ terminal: true, ended: true, learnerTurn: "question" }), "close");
});

test("问句 → answer（rng 即使会抽到 deflect 也不生效）", () => {
  assert.equal(choose({ learnerTurn: "question" }), "answer");
  assert.equal(choose({ learnerTurn: "question", turnIndex: 0 }), "answer");
});

test("bare-ack + 上轮 NPC 提问 → hold-back", () => {
  assert.equal(choose({ learnerTurn: "bare-ack", lastNpcAskedQuestion: true }), "hold-back");
  // 上轮没提问时走抽样：rng=0.0 → answer
  assert.equal(choose({ learnerTurn: "bare-ack", lastNpcAskedQuestion: false, rng: () => 0.0 }), "answer");
});

test("invitation → answer", () => {
  assert.equal(choose({ learnerTurn: "invitation" }), "answer");
});

test("long-share → reflect", () => {
  assert.equal(choose({ learnerTurn: "long-share" }), "reflect");
});

test("固定 rng 时抽样可预测（阈值 0.45 / 0.75 / 0.95）", () => {
  assert.equal(choose({ rng: () => 0.0 }), "answer");
  assert.equal(choose({ rng: () => 0.44 }), "answer");
  assert.equal(choose({ rng: () => 0.45 }), "reflect");
  assert.equal(choose({ rng: () => 0.74 }), "reflect");
  assert.equal(choose({ rng: () => 0.75 }), "hold-back");
  assert.equal(choose({ rng: () => 0.94 }), "hold-back");
  assert.equal(choose({ rng: () => 0.95 }), "deflect");
  assert.equal(choose({ rng: () => 0.99 }), "deflect");
});

test("硬约束：deflect 不出现在问句 / 邀请 / 首回合 / 收束回合", () => {
  const deflectRng = () => 0.99;
  assert.equal(choose({ rng: deflectRng, learnerTurn: "question" }), "answer");
  assert.equal(choose({ rng: deflectRng, learnerTurn: "invitation" }), "answer");
  assert.equal(choose({ rng: deflectRng, turnIndex: 0 }), "answer");
  assert.equal(choose({ rng: deflectRng, ended: true }), "close");
  assert.equal(choose({ rng: deflectRng, terminal: true }), "close");
});

// —— 提示词块 ——

test("initiativeDirective：五种意图 × 中英，首行固定、规则 2–4 行", () => {
  const initiatives: Initiative[] = ["answer", "reflect", "hold-back", "close", "deflect"];
  for (const initiative of initiatives) {
    for (const lang of LANGS) {
      const block = initiativeDirective(initiative, lang);
      assert.ok(block.length > 0);
      assert.ok(block.startsWith(`THIS TURN'S INITIATIVE: ${initiative}\n`), `${initiative}/${lang} 首行`);
      const ruleLines = block.split("\n").length - 1;
      assert.ok(ruleLines >= 2 && ruleLines <= 4, `${initiative}/${lang} 规则行数 ${ruleLines}`);
    }
  }
});

test("中文块含中文规则关键词", () => {
  assert.match(initiativeDirective("answer", zh), /回答/);
  assert.match(initiativeDirective("reflect", zh), /接住/);
  assert.match(initiativeDirective("hold-back", zh), /你呢/);
  assert.match(initiativeDirective("close", zh), /收束/);
  assert.match(initiativeDirective("deflect", zh), /岔开/);
});

test("英文块语义对位（非机翻腔）", () => {
  assert.match(initiativeDirective("answer", en), /directly/);
  assert.match(initiativeDirective("reflect", en), /no advice/i);
  assert.match(initiativeDirective("hold-back", en), /what about you/i);
  assert.match(initiativeDirective("close", en), /wrap/i);
  assert.match(initiativeDirective("deflect", en), /veer/i);
});

// —— 纯度 ——

test("纯函数：同输入同输出，不依赖时间", () => {
  const texts = ["嗯", "你为什么这么说？", "今晚陪我", "ok", "Are you free?", "今天天气不错"];
  for (const text of texts) {
    for (const lang of LANGS) {
      assert.equal(classifyLearnerTurn(text, lang), classifyLearnerTurn(text, lang));
    }
  }
  const input = {
    rng: () => 0.5,
    learnerTurn: "statement" as LearnerTurnKind,
    lastNpcAskedQuestion: false,
    terminal: false,
    ended: false,
    turnIndex: 3,
  };
  assert.equal(chooseInitiative(input), chooseInitiative(input));
  assert.equal(initiativeDirective("hold-back", zh), initiativeDirective("hold-back", zh));
});

test('常见词不误判：哪怕 / 在一起 / 不怎么 / 哪里哪里 / 才怪呢', () => {
  assert.equal(classifyLearnerTurn("哪怕你不想去也没关系", zh), "statement");
  assert.equal(classifyLearnerTurn("我们在一起三年了", zh), "statement");
  assert.equal(classifyLearnerTurn("我不怎么喜欢下雨", zh), "statement");
  assert.equal(classifyLearnerTurn("哪里哪里", zh), "statement");
  assert.equal(classifyLearnerTurn("我才怪呢。", zh), "statement");
  // 真正的问句与邀请仍然命中
  assert.equal(classifyLearnerTurn("你哪里不舒服？", zh), "question");
  assert.equal(classifyLearnerTurn("周末要不要一起去看展", zh), "invitation");
  assert.equal(classifyLearnerTurn("一起吃饭吧", zh), "invitation");
});
