/**
 * P4 跟进卡的离线回归：节流表（单条 + 全局）、变体选择、作答不写分数、
 * 「台词库闭合」这条停止判据，以及采集侧/注入侧两道门的静态断言。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Lang } from '../../src/data/taxonomy';
import { CASES, SCENARIOS, THEORIES } from '../../src/data/corpus';
import {
  CARRY_LINES,
  CARRY_LINES_UNCLASSIFIED,
  CARRY_QUOTE_MARKER,
  type CarryLine,
  type CarryPromiseClass,
  type CarryResolution,
} from '../../src/data/corpus/love-carry-lines';
import {
  LOVE_CARRY_ASK,
  answerLoveCarry,
  dueLoveCarry,
  loveCarryAskable,
  loveCarryAskLine,
  loveCarryCardLine,
  loveCarryGlobalBlock,
  loveCarryLine,
  markLoveCarryAsked,
  readLoveCarries,
  retireExhaustedLoveCarries,
  type LoveCarry,
} from '../../src/lib/love-carry-store';

const KEY = 'socialcoach.love-play.carry';
const slots = new Map<string, string>();
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => { slots.set(key, value); },
    removeItem: (key: string) => { slots.delete(key); },
  },
  configurable: true,
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 本地时间构造时间戳：免打扰与「自然日」按学习者手表上的今天，测试不能绑 UTC。 */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const DAY1 = at(15, 12);
const DAY2 = at(16, 12);
const DAY3 = at(17, 12);

const QUOTE = '周三晚上八点打给你';
const NAME = { zh: 'Sana', en: 'Sana' };

const entry = (over: Partial<LoveCarry> = {}): LoveCarry => ({
  id: 'c1',
  text: QUOTE,
  lang: 'zh',
  cls: 'call',
  npcId: 'sana',
  npcName: NAME,
  scenarioId: 'love-ld-milestone-remote',
  seriesId: 'love-arc-long-distance',
  createdAt: DAY1,
  updatedAt: DAY1,
  askCount: 0,
  state: 'pending',
  ...over,
});

const reset = () => slots.delete(KEY);
const putRaw = (list: LoveCarry[]) => slots.set(KEY, JSON.stringify(list));
const stored = (): LoveCarry[] => JSON.parse(slots.get(KEY) ?? '[]');

// ---------- 节流表 ----------

test('the throttle table is the tightened one, not AIcove’s published values', () => {
  assert.deepEqual(
    { ...LOVE_CARRY_ASK },
    { perCarryMax: 3, perCarryGapMin: 24 * 60, perDayMax: 2, globalGapMin: 4 * 60, quietFromHour: 22, quietToHour: 8 },
    '每个数都要能指向 review §6 或 2026 主动消息指引；把它们放宽回 3/天 + 120 分钟是一次产品决策，不是重构',
  );
});

test('a fresh carry is not askable the day it was written, and is one day later', () => {
  const fresh = entry({ createdAt: DAY1 });
  assert.equal(loveCarryAskable(fresh, DAY1 + HOUR), false, 'an hour after writing it there is nothing yet to have done');
  assert.equal(loveCarryAskable(fresh, DAY1 + LOVE_CARRY_ASK.perCarryGapMin * MINUTE), true, 'the 24h anchor for the first ask is the recording itself');
  const asked = entry({ createdAt: DAY1, lastAskedAt: DAY2, askCount: 1 });
  assert.equal(loveCarryAskable(asked, DAY2 + 2 * HOUR), false, 'same line, two hours later: still too soon');
  assert.equal(loveCarryAskable(asked, DAY2 + LOVE_CARRY_ASK.perCarryGapMin * MINUTE), true);
});

test('terminal states and the three-ask lifetime cap take a carry out of rotation', () => {
  for (const state of ['kept', 'dropped'] as const) {
    assert.equal(loveCarryAskable(entry({ state }), DAY3), false, `${state} is an answer, not a pending question`);
  }
  assert.equal(loveCarryAskable(entry({ state: 'open' }), DAY3), true, '“not yet” is asked about again, later');
  assert.equal(loveCarryAskable(entry({ askCount: LOVE_CARRY_ASK.perCarryMax - 1 }), DAY3), true);
  assert.equal(loveCarryAskable(entry({ askCount: LOVE_CARRY_ASK.perCarryMax }), DAY3), false, 'three asks lifetime, full stop');
});

test('the do-not-disturb window asks nothing at 22:00 or 07:59 and opens at 08:00', () => {
  assert.equal(loveCarryGlobalBlock([], at(15, 22)), 'quiet');
  assert.equal(loveCarryGlobalBlock([], at(16, 7, 59)), 'quiet');
  assert.equal(loveCarryGlobalBlock([], at(16, 8)), null);
  assert.equal(loveCarryGlobalBlock([], at(15, 21, 59)), null);
});

test('globally: two surfaced asks a day and four hours apart, no more', () => {
  const a = entry({ id: 'a', lastAskedAt: at(16, 9) });
  const b = entry({ id: 'b', lastAskedAt: at(16, 10) });
  assert.equal(loveCarryGlobalBlock([a, b], at(16, 18)), 'per-day');
  assert.equal(loveCarryGlobalBlock([a], at(16, 18)), null, 'one ask today leaves room for the second');
  assert.equal(loveCarryGlobalBlock([a], at(16, 12, 30)), 'spacing', 'three hours is under the four-hour floor');
  // 昨天 23:00 问过：到今早 08:00 既出了免打扰窗口，也过了 240 分钟。
  assert.equal(loveCarryGlobalBlock([entry({ lastAskedAt: at(15, 23) })], at(16, 8)), null);
});

test('a throttled ask is deferred, not dropped', () => {
  reset();
  // 今天已经浮现过两次（a、b），从没被问过的 c 只能等——等的时候它一个字节都不该被改。
  const a = entry({ id: 'a', createdAt: at(11, 12), lastAskedAt: at(16, 9), askCount: 1 });
  const b = entry({ id: 'b', createdAt: at(12, 12), lastAskedAt: at(16, 10), askCount: 1 });
  const c = entry({ id: 'c', createdAt: at(10, 12) });
  putRaw([a, b, c]);
  const snapshot = stored();
  assert.equal(dueLoveCarry(at(16, 18)), null, 'two surfaced asks already: the day is spent');
  assert.deepEqual(stored(), snapshot, 'the blocked read wrote no byte — not even a timestamp');
  const due = dueLoveCarry(at(17, 12));
  assert.equal(due?.id, 'c', 'the next day the deferred line comes back on its own');
  assert.equal(due?.state, 'pending', 'state is only ever changed by the learner pressing a button');
  reset();
});

test('several askable carries surface the one that has waited longest', () => {
  const list = [
    entry({ id: 'newest', createdAt: DAY2 }),
    entry({ id: 'oldest', createdAt: DAY1 }),
    entry({ id: 'middle', createdAt: DAY1 + HOUR }),
  ];
  assert.equal(dueLoveCarry(DAY3, list)?.id, 'oldest', 'otherwise the freshest line would always cut in');
});

// ---------- 台词：闭合与变体 ----------

const CLASSES: readonly CarryPromiseClass[] = ['call', 'visit', 'ritual'];
const RESOLUTIONS: readonly CarryResolution[] = ['ask', 'askAgain', 'kept', 'open'];

/** 库里每一条 `source` 都得指向真实存在的语料条目——出处写错等于没有出处。 */
const corpusIds = new Set([...SCENARIOS, ...THEORIES, ...CASES].map((x) => x.id));
const allCarryLines = (): { key: string; line: CarryLine }[] => {
  const out: { key: string; line: CarryLine }[] = [];
  for (const cls of CLASSES) {
    for (const resolution of RESOLUTIONS) out.push({ key: `${cls}.${resolution}`, line: CARRY_LINES[cls][resolution] });
  }
  for (const resolution of RESOLUTIONS) out.push({ key: `unclassified.${resolution}`, line: CARRY_LINES_UNCLASSIFIED[resolution] });
  return out;
};

test('the line library is closed: 3 classes x 4 resolutions + 4 fallbacks = 16, all bilingual, all sourced', () => {
  for (const cls of CLASSES) {
    for (const resolution of RESOLUTIONS) {
      const line = CARRY_LINES[cls][resolution];
      assert.ok(line, `CARRY_LINES.${cls}.${resolution} is missing`);
      assert.ok(line.source.length > 0, 'a carry line without a corpus source is not allowed in');
      for (const lang of ['zh', 'en'] as Lang[]) {
        assert.ok(line.text[lang].trim().length > 0, `${cls}.${resolution}.${lang} is blank`);
        // 没有占位符 = 学习者的原话被静默吞掉，违反「任何反馈先引用用户原话」。
        assert.ok(line.text[lang].includes(CARRY_QUOTE_MARKER), `${cls}.${resolution}.${lang} drops the quote`);
        assert.ok(!/\n/.test(line.text[lang]), 'one spoken turn, not a paragraph');
      }
    }
    // 矩阵闭合：多一格少一格都算破，因为多出来的那一格只能靠现编（=P4 的停止信号）。
    assert.deepEqual(Object.keys(CARRY_LINES[cls]).sort(), [...RESOLUTIONS].sort(), `${cls} must carry exactly the four resolutions`);
  }
  for (const resolution of RESOLUTIONS) {
    const line = CARRY_LINES_UNCLASSIFIED[resolution];
    assert.ok(line.text.zh.includes(CARRY_QUOTE_MARKER) && line.text.en.includes(CARRY_QUOTE_MARKER));
    assert.ok(line.source.length > 0);
  }
  assert.deepEqual(Object.keys(CARRY_LINES_UNCLASSIFIED).sort(), [...RESOLUTIONS].sort());
  assert.equal(allCarryLines().length, 16, '3 x 4 + 4 = 16 and the matrix stays closed');
});

test('every carry line cites a corpus id that actually exists', () => {
  for (const { key, line } of allCarryLines()) {
    const ids = [...line.source.matchAll(/#([a-z0-9-]+)/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, `${key} cites no corpus id`);
    for (const id of ids) {
      assert.ok(corpusIds.has(id), `${key} cites “${id}”, which is not in the corpus`);
    }
    assert.ok(line.source.includes('app/src/data/corpus/'), `${key} source must name the file it came from`);
  }
});

test('library text is quote-clean: no ASCII double quote, no straight apostrophe', () => {
  for (const { key, line } of allCarryLines()) {
    for (const lang of ['zh', 'en'] as Lang[]) {
      assert.ok(!line.text[lang].includes('"'), `${key}.${lang} carries a raw ASCII double quote`);
      assert.ok(!line.text[lang].includes("'"), `${key}.${lang} carries a straight apostrophe instead of ’`);
    }
  }
});

/** 学习者的原话不可控：可能是从句，也可能自带句号。两种形状都要能渲染成合法句子。 */
const QUOTE_SHAPES = ['周三打给你', '我这周一定打给你。'];
const QUOTE_SHAPES_EN = ['call me Wednesday', 'I will call you this week.'];

test('a rendered carry line never stacks punctuation, whichever shape the quote is', () => {
  for (const { key, line } of allCarryLines()) {
    for (const quote of QUOTE_SHAPES) {
      const out = line.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => quote);
      // 「…」后面只能跟逗号或破折号：自带句号的原话会渲染成 `。」。`。
      assert.ok(!/」[。！？；]/.test(out), `${key} closes the quote with a terminator: ${out}`);
      assert.ok(!out.includes('。」。'), `${key} doubles the full stop`);
    }
    for (const quote of QUOTE_SHAPES_EN) {
      const out = line.text.en.replaceAll(CARRY_QUOTE_MARKER, () => quote);
      assert.ok(!/”[.!?;:]/.test(out), `${key} closes the English quote with a terminator: ${out}`);
      assert.ok(!out.includes('..'), `${key} stacks two periods`);
    }
  }
});

/** `ask` 不许对「问过没问过」作任何断言——节流表允许同一条承诺被问满 3 次。 */
const ASK_HISTORY_CLAIMS = ['没催', '没问过', '一直留着', '没拿出来', '不曾问', 'never pressed', 'never asked', 'without waving', 'haven’t asked', 'kept it without'];
const REPEATED_CLAIMS = ['又', '再', '不止一次', '头一回', '第二', 'again', 'more than once', 'first time'];

test('the first-ask lines say nothing about whether they have asked before', () => {
  for (const cls of [...CLASSES, 'unclassified'] as const) {
    const line = cls === 'unclassified' ? CARRY_LINES_UNCLASSIFIED.ask : CARRY_LINES[cls].ask;
    for (const lang of ['zh', 'en'] as Lang[]) {
      const lower = line.text[lang].toLowerCase();
      for (const forbidden of ASK_HISTORY_CLAIMS) {
        assert.ok(!lower.includes(forbidden), `${cls}.ask.${lang} claims “${forbidden}” — falsifiable by askCount on surfacing 2`);
      }
    }
  }
});

test('the re-ask lines own that this is being raised again', () => {
  for (const cls of [...CLASSES, 'unclassified'] as const) {
    const line = cls === 'unclassified' ? CARRY_LINES_UNCLASSIFIED.askAgain : CARRY_LINES[cls].askAgain;
    const hit = (lang: Lang, list: string[]) => list.some((w) => line.text[lang].toLowerCase().includes(w));
    assert.ok(hit('zh', REPEATED_CLAIMS), `${cls}.askAgain.zh does not acknowledge the repeat`);
    assert.ok(hit('en', REPEATED_CLAIMS), `${cls}.askAgain.en does not acknowledge the repeat`);
    // 反过来也不许说谎：askAgain 不能宣称「头一回」。
    for (const lang of ['zh', 'en'] as Lang[]) {
      assert.ok(!/这不是我头一回|这就是头一回|this is the first time/.test(line.text[lang]), `${cls}.askAgain.${lang} claims a first`);
    }
  }
});

test('no kept line ends by asking the learner for a new commitment', () => {
  for (const cls of [...CLASSES, 'unclassified'] as const) {
    const line = cls === 'unclassified' ? CARRY_LINES_UNCLASSIFIED.kept : CARRY_LINES[cls].kept;
    for (const lang of ['zh', 'en'] as Lang[]) {
      const rendered = line.text[lang].replaceAll(CARRY_QUOTE_MARKER, () => (lang === 'zh' ? QUOTE_SHAPES[0] : QUOTE_SHAPES_EN[0]));
      // 收尾必须是陈述句：问句在这里只能变成「再答应一件」「再约一次」那样的作业。
      assert.ok(!/[？?]$/.test(rendered.trim()), `${cls}.kept.${lang} ends on a question: ${rendered}`);
      for (const homework of ['下一个', '下一次', '再约', '排在哪天', 'what day', 'the next']) {
        assert.ok(!rendered.includes(homework), `${cls}.kept.${lang} assigns homework (“${homework}”)`);
      }
    }
  }
});

test('the 16 lines do not repeat themselves: no two share a rendered body', () => {
  const seen = new Map<string, string>();
  for (const { key, line } of allCarryLines()) {
    for (const lang of ['zh', 'en'] as Lang[]) {
      const body = line.text[lang];
      const prev = seen.get(body);
      assert.ok(!prev, `${key} reuses the exact sentence already written at ${prev}`);
      seen.set(body, key);
    }
  }
});


test('the card asks with the ask line until the learner says “not yet”, then with the open line', () => {
  const pending = entry({ state: 'pending', cls: 'visit' });
  assert.equal(loveCarryCardLine(pending, 'zh'), CARRY_LINES.visit.ask.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => QUOTE));
  const open = entry({ state: 'open', cls: 'visit' });
  assert.equal(loveCarryCardLine(open, 'zh'), CARRY_LINES.visit.open.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => QUOTE));
  const unlabelled = entry({ cls: null });
  assert.equal(loveCarryCardLine(unlabelled, 'en'), CARRY_LINES_UNCLASSIFIED.ask.text.en.replaceAll(CARRY_QUOTE_MARKER, () => QUOTE));
  // 答过的「还没」优先于计数：它背后有学习者自己按过一次的东西。
  const answered = entry({ state: 'open', cls: 'visit', askCount: 2 });
  assert.equal(loveCarryCardLine(answered, 'zh'), loveCarryLine(answered, 'open', 'zh'));
});

test('the second surfacing of the same promise switches to the askAgain line', () => {
  // 同一条承诺最多问 3 次；第 2、3 次再用 `ask` 就是把「我没催过你」说成假话。
  const quoted = entry({ state: 'pending', cls: 'ritual', askCount: 2, lastAskedAt: DAY2 });
  assert.equal(loveCarryCardLine(quoted, 'zh'), loveCarryLine(quoted, 'askAgain', 'zh'));
  assert.notEqual(loveCarryCardLine(quoted, 'zh'), loveCarryLine(quoted, 'ask', 'zh'));
  assert.notEqual(loveCarryCardLine(quoted, 'zh'), loveCarryLine(quoted, 'open', 'zh'), 'open 那句断言「还没做」，而学习者从没这么说过——替他作答就是编造他的回答');
  // 幕内开场走同一条规则（同一个 askCount，不各记一份）。
  assert.equal(loveCarryAskLine(entry({ cls: 'call' }), 'zh'), loveCarryLine(entry({ cls: 'call' }), 'ask', 'zh'));
  const twice = entry({ cls: 'call', askCount: 1 });
  assert.equal(loveCarryAskLine(twice, 'zh'), loveCarryLine(twice, 'askAgain', 'zh'));
  const third = entry({ cls: null, askCount: 2 });
  assert.equal(loveCarryAskLine(third, 'en'), CARRY_LINES_UNCLASSIFIED.askAgain.text.en.replaceAll(CARRY_QUOTE_MARKER, () => QUOTE));
});

test('every cell the card can render really renders the learner’s words', () => {
  for (const cls of [...CLASSES, null]) {
    for (const resolution of RESOLUTIONS) {
      const line = loveCarryLine(entry({ cls }), resolution, 'zh');
      assert.ok(line, `${cls ?? 'unlabelled'}.${resolution} rendered nothing`);
      assert.ok(line.includes(QUOTE), `${cls ?? 'unlabelled'}.${resolution} lost the verbatim quote`);
      assert.ok(!line.includes(CARRY_QUOTE_MARKER));
    }
  }
});

// ---------- 作答：只写 state ----------

test('answering touches state and updatedAt and nothing else', () => {
  reset();
  const before = entry({ id: 'a', createdAt: 1, updatedAt: 1, askCount: 1, lastAskedAt: 2 });
  const other = entry({ id: 'b', scenarioId: 'other', createdAt: 1 });
  putRaw([before, other]);
  answerLoveCarry('a', 'kept');
  const [kept, untouched] = stored();
  assert.equal(kept.state, 'kept');
  assert.ok(kept.updatedAt > before.updatedAt, 'the answer moves updatedAt so the prune order stays honest');
  // 除 state / updatedAt 之外的每个字段都必须逐字还在——原话被改写就等于破「引用用户原话」。
  const withoutAnswerFields = (c: LoveCarry) => ({ ...c, state: null, updatedAt: null });
  assert.deepEqual(withoutAnswerFields(kept), withoutAnswerFields(before), 'text, quote, class, speaker and ask history all survive the answer');
  assert.deepEqual(untouched, other, 'another carry is never touched');
  reset();
});

test('“not yet” re-opens the line, and the third ask retires it', () => {
  reset();
  putRaw([entry({ id: 'a', createdAt: 1, askCount: 1 })]);
  answerLoveCarry('a', 'open');
  assert.equal(stored()[0].state, 'open', 'the line stays in rotation, with the open wording next time');
  putRaw([entry({ id: 'b', createdAt: 1, askCount: LOVE_CARRY_ASK.perCarryMax })]);
  answerLoveCarry('b', 'open');
  assert.equal(stored()[0].state, 'dropped', 'there is no fourth ask');
  putRaw([entry({ id: 'c', createdAt: 1, state: 'open', askCount: 2 })]);
  answerLoveCarry('c', 'dropped');
  assert.equal(stored()[0].state, 'dropped', '“stop asking” ends it — and it ends in silence, no line is printed');
  reset();
});

test('a carry asked three times and never answered is retired instead of squatting a slot forever', () => {
  reset();
  putRaw([entry({ id: 'zombie', createdAt: 1, askCount: LOVE_CARRY_ASK.perCarryMax })]);
  retireExhaustedLoveCarries();
  assert.equal(stored()[0].state, 'dropped');
  reset();
  putRaw([entry({ id: 'still-alive', createdAt: DAY1, askCount: 1 })]);
  retireExhaustedLoveCarries();
  assert.equal(stored()[0].state, 'pending', 'one that still has asks left is left alone');
  assert.equal(dueLoveCarry(DAY1 + HOUR, readLoveCarries()), null, '…and what holds it back here is the 24h gate');
  assert.equal(dueLoveCarry(DAY3, readLoveCarries())?.id, 'still-alive');
  reset();
});

test('the mount path end to end: surface once with the ask line, re-surface a day later with the open one', () => {
  reset();
  // 卡片调的 markLoveCarryAsked / answerLoveCarry 内部读 Date.now()，所以要按「今天来这一趟」把钟拨准。
  const realNow = Date.now;
  try {
    Date.now = () => DAY2;
    putRaw([entry({ id: 'a', createdAt: DAY1 })]);
    const first = dueLoveCarry(DAY2);
    assert.ok(first, 'a promise from yesterday is worth asking about today');
    assert.equal(loveCarryCardLine(first!, 'zh'), CARRY_LINES.call.ask.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => QUOTE));
    // 浮现 = 那一次提问；学习者按「还没」只把 state 推到 open，别的字段一个都不动。
    markLoveCarryAsked(first!.id);
    answerLoveCarry(first!.id, 'open');
    assert.equal(stored()[0].askCount, 1);
    assert.equal(stored()[0].state, 'open');
    assert.equal(dueLoveCarry(DAY2 + HOUR), null, 'one hour later it is still the same sitting');
    Date.now = () => DAY3;
    const second = dueLoveCarry(DAY3);
    assert.ok(second, 'a day later it comes back');
    assert.equal(loveCarryCardLine(second!, 'zh'), CARRY_LINES.call.open.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => QUOTE));
    assert.equal(stored()[0].state, 'open', 're-surfacing changes the wording, never the answer');
  } finally {
    Date.now = realNow;
    reset();
  }
});

test('a never-answered promise comes back the next day as the askAgain line, not a second “first time”', () => {
  reset();
  const realNow = Date.now;
  try {
    Date.now = () => DAY2;
    putRaw([entry({ id: 'a', createdAt: DAY1, cls: 'visit' })]);
    const first = dueLoveCarry(DAY2);
    assert.ok(first);
    // 卡片拿的是浮现前读到的那一份（askCount 还没 +1），所以第一次是 `ask`。
    assert.equal(loveCarryCardLine(first!, 'zh'), loveCarryLine(first!, 'ask', 'zh'));
    markLoveCarryAsked(first!.id);
    Date.now = () => DAY3;
    const again = dueLoveCarry(DAY3);
    assert.ok(again, ' unanswered is not the same as answered — it comes back');
    assert.equal(again!.askCount, 1, 'the stored count is what the second surfacing reads');
    assert.equal(loveCarryCardLine(again!, 'zh'), loveCarryLine(again!, 'askAgain', 'zh'), 'the second ask admits it is the second ask');
    assert.equal(stored()[0].state, 'pending', 'and it still never answers for the learner');
  } finally {
    Date.now = realNow;
    reset();
  }
});

test('the card renders nothing before hydration — storage is only read after mount', async () => {
  reset();
  putRaw([entry({ createdAt: 1 })]);
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { LoveCarryFollowUp } = await import('../../src/components/love/LoveCarryFollowUp');
  // 首屏（服务端 / 未 hydration）就输出承诺文本会直接造成 hydration 不一致。
  assert.equal(renderToStaticMarkup(createElement(LoveCarryFollowUp, { lang: 'zh' })), '', 'the card is empty until the device store is read');
  reset();
});

// ---------- 两道门：采集不按 continuous，注入按 continuous ----------

const playScene = readFileSync(new URL('../../src/components/love/PlayScene.tsx', import.meta.url), 'utf8');
const carryover = readFileSync(new URL('../../src/lib/love-carryover.ts', import.meta.url), 'utf8');
const followUp = readFileSync(new URL('../../src/components/love/LoveCarryFollowUp.tsx', import.meta.url), 'utf8');

test('the capture side has no `continuous` gate left on it; the injection side still does', () => {
  // 异地那条线 8 幕 8 个人，continuous 为 false：采集抄了这道门，功能就恰好排除了它的动机来源。
  assert.ok(!playScene.includes('.continuous'), 'PlayScene must offer capture to every love scene, cast-swapping lines included');
  assert.ok(carryover.includes('series.continuous'), 'the in-scene claim of remembering still requires one NPC throughout');
});

test('the follow-up card reaches the screen with no model call, no score and no chat box', () => {
  for (const forbidden of ['fetch(', '/api/', 'assess', 'addSession', 'completeLovePlay', 'proficiency', 'practiceDays', 'stars']) {
    assert.ok(!followUp.includes(forbidden), `the card must not touch ${forbidden} — answering is not a graded practice`);
  }
  for (const forbidden of ['<input', '<textarea', 'contentEditable']) {
    assert.ok(!followUp.includes(forbidden), 'this is a follow-up on one stated action, not a companion chat channel');
  }
});
