/** P1/P2 承接的离线回归：前幕规则、continuous 门槛、6 句台词的双语完整性与剧透防护，以及 P2 的原话引用优先级。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Lang } from '../../src/data/taxonomy';
import { LOVE_SERIES, loveSeriesById } from '../../src/data/corpus/love-series';
import { CARRY_LINES, CARRY_LINES_UNCLASSIFIED, CARRY_QUOTE_MARKER } from '../../src/data/corpus/love-carry-lines';
import { LOVE_CARRYOVER, loveCarryoverForScene, pickLoveCarryover } from '../../src/lib/love-carryover';
import { writeLoveSeriesProgress } from '../../src/lib/love-series-progress';
import { dueLoveCarry, readLoveCarries, saveLoveCarry, type LoveCarryDraft } from '../../src/lib/love-carry-store';
import { defaultLearnerId, speakerOf } from '../../src/lib/session-utils';

const RIO = 'love-arc-rio-clarify';
const EVE = 'love-arc-eve-after-no';
const OUTCOMES = ['success', 'partial', 'failure'] as const;

/** 设备端进度的最小替身：承接只读 localStorage，这里不引入任何 DOM。 */
const entries = new Map<string, string>();
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  },
  configurable: true,
});

const actIds = (seriesId: string) => loveSeriesById(seriesId)!.scenarios.map((s) => s.id);
const clear = (seriesId: string) => entries.delete(`socialcoach.love-play.series.${seriesId}`);

test('only the immediately-preceding act carries over, never an earlier completed one', () => {
  clear(RIO);
  const [first, second, third] = actIds(RIO);
  assert.equal(loveCarryoverForScene(RIO, second, 'zh').text, null, 'with no recorded outcome the next act opens clean');
  writeLoveSeriesProgress(RIO, first, 'success');
  // 第 1 幕已完成、第 2 幕没打点：第 3 幕不能承接第 1 幕，否则链条断成散点存档。
  assert.equal(loveCarryoverForScene(RIO, third, 'zh').text, null, 'a gap in the middle must not bridge over it');
  writeLoveSeriesProgress(RIO, second, 'partial');
  const carry = loveCarryoverForScene(RIO, third, 'zh');
  assert.equal(carry.outcome, 'partial', 'the predecessor outcome is what the sentence is keyed on');
  assert.ok(carry.text);
  assert.equal(carry.actIndex, 2);
});

test('the opening act of a line carries nothing and an unknown line resolves to nothing', () => {
  clear(RIO);
  const [first, second] = actIds(RIO);
  writeLoveSeriesProgress(RIO, second, 'success');
  assert.deepEqual(loveCarryoverForScene(RIO, first, 'zh'), { text: null, outcome: null, actIndex: 0 });
  assert.equal(loveCarryoverForScene('love-arc-not-a-line', second, 'zh').text, null);
  assert.equal(loveCarryoverForScene(RIO, 'not-a-scene', 'zh').text, null);
});

test('a line whose cast changes between acts gets no carryover, because the speaker would be lying', () => {
  // 换人的线（含后加的异地方向）里让 NPC 声称记得上一幕，是对「谁在说话」的假话。
  const scattered = LOVE_SERIES.find((s) => !s.continuous && s.scenarios.length > 1);
  assert.ok(scattered, 'the corpus is expected to keep at least one non-continuous romantic line');
  clear(scattered.id);
  const ids = scattered.scenarios.map((s) => s.id);
  writeLoveSeriesProgress(scattered.id, ids[0], 'success');
  assert.equal(loveCarryoverForScene(scattered.id, ids[1], 'zh').text, null);
  assert.equal(loveCarryoverForScene(scattered.id, ids[1], 'en').text, null);
});

test('all six authored sentences exist in both languages and are single spoken lines', () => {
  for (const seriesId of [RIO, EVE]) {
    for (const outcome of OUTCOMES) {
      const line = LOVE_CARRYOVER[seriesId][outcome];
      for (const lang of ['zh', 'en'] as Lang[]) {
        const text = pickLoveCarryover(outcome, seriesId, lang);
        assert.equal(text, line[lang], 'pickLoveCarryover returns the table value verbatim');
        assert.ok(text.trim().length > 0, `${seriesId}/${outcome}/${lang} is blank`);
        assert.ok(!/\n/.test(text), 'a carryover is one spoken sentence, not a paragraph');
        assert.ok(text.split(/[。！？.!?]/).filter((x) => x.trim()).length <= 2, 'keep it to two short clauses');
      }
    }
    // 两条线的人物、处境与压力都不同，句子不允许互相复读。
    for (const outcome of OUTCOMES) {
      for (const lang of ['zh', 'en'] as Lang[]) {
        assert.notEqual(LOVE_CARRYOVER[RIO][outcome][lang], LOVE_CARRYOVER[EVE][outcome][lang]);
      }
    }
  }
  assert.equal(Object.keys(LOVE_CARRYOVER).length, 2, 'the experiment stays scoped to the two continuous lines');
});

test('an incomplete lookup never throws and never invents a sentence', () => {
  assert.equal(pickLoveCarryover(null, RIO, 'zh'), null, 'no recorded outcome means no carryover');
  assert.equal(pickLoveCarryover('success', undefined, 'zh'), null);
  assert.equal(pickLoveCarryover('success', 'love-arc-unknown', 'en'), null);
});

/** 与 scripts/check-landing-ssr.ts:117-136 同一口径的剧透串收集：隐藏动机不许出现在承接句里。 */
function spoilersOf(seriesId: string, lang: Lang): string[] {
  const out: string[] = [];
  for (const scenario of loveSeriesById(seriesId)!.scenarios) {
    for (const c of scenario.characters) {
      if (!c.hidden) continue;
      out.push(c.hidden[lang]);
    }
  }
  return out;
}

/** 最长公共片段（zh 按字、en 按词），用来把「抄了隐藏设定里的一句话」和「共用一个虚词」分开。 */
function longestRun(a: string[], b: string[]): number {
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let diagonal = 0;
    for (let j = 0; j < b.length; j += 1) {
      const saved = prev[j + 1];
      prev[j + 1] = x === b[j] && x.length ? diagonal + 1 : 0;
      diagonal = saved;
      best = Math.max(best, prev[j + 1]);
    }
  }
  return best;
}

const tokens = (text: string, lang: Lang) =>
  lang === 'zh' ? [...text] : text.toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9']+/).filter(Boolean);

test('no carryover sentence leaks a fragment of either arc’s hidden motivation', () => {
  for (const seriesId of [RIO, EVE]) {
    for (const outcome of OUTCOMES) {
      for (const lang of ['zh', 'en'] as Lang[]) {
        const sentence = pickLoveCarryover(outcome, seriesId, lang)!;
        for (const hidden of spoilersOf(seriesId, lang)) {
          // 逐字复用 check-landing-ssr 的探针：长句取前 40 字。
          const probe = hidden.length > 40 ? hidden.slice(0, 40) : hidden;
          assert.ok(!sentence.includes(probe), `${seriesId}/${outcome} quotes hidden text`);
          const run = longestRun(tokens(sentence, lang), tokens(hidden, lang));
          assert.ok(run < (lang === 'zh' ? 6 : 3), `${seriesId}/${outcome}/${lang} shares a ${run}-token stretch of hidden text`);
        }
      }
    }
  }
});

/**
 * 台词库不是只属于两条同人线：跟进卡会把同一句问在异地 8 个人头上，幕内开场也会。
 * 所以 16 句同样不许碰到这三个系列里任何角色的 `hidden`——口径与上面那条探针一致。
 */
test('no carry library line leaks a hidden motivation of the arcs it can be spoken in', () => {
  const library = [
    ...Object.values(CARRY_LINES).flatMap((byResolution) => Object.values(byResolution)),
    ...Object.values(CARRY_LINES_UNCLASSIFIED),
  ];
  assert.equal(library.length, 16, 'the matrix stays closed at 16 — a 17th cell means someone improvised');
  for (const seriesId of [RIO, EVE, 'love-arc-long-distance']) {
    for (const lang of ['zh', 'en'] as Lang[]) {
      for (const hidden of spoilersOf(seriesId, lang)) {
        for (const line of library) {
          const sentence = line.text[lang];
          const probe = hidden.length > 40 ? hidden.slice(0, 40) : hidden;
          assert.ok(!sentence.includes(probe), `${seriesId}: a carry line quotes hidden text verbatim`);
          const run = longestRun(tokens(sentence, lang), tokens(hidden, lang));
          assert.ok(run < (lang === 'zh' ? 6 : 3), `${seriesId}/${lang}: a carry line shares a ${run}-token stretch of hidden text — ${sentence}`);
        }
      }
    }
  }
});

// ---------- P2：结构化的承接对象（love-carry-store）参与开场 ----------

const CARRY_KEY = 'socialcoach.love-play.carry';
const clearCarries = () => entries.delete(CARRY_KEY);
const QUOTE = '周三晚上打给你';

/** 只留一条承诺：用例之间靠 clearCarries 隔离，读回时取第 0 条就够了。 */
const saveCarry = (over: Partial<LoveCarryDraft> = {}) =>
  saveLoveCarry({
    text: QUOTE,
    lang: 'zh',
    cls: 'call',
    npcId: 'rio',
    npcName: { zh: 'Rio', en: 'Rio' },
    scenarioId: actIds(RIO)[0],
    seriesId: RIO,
    ...over,
  });
const carrySlot = () => readLoveCarries()[0];
const askOf = (cls: LoveCarryDraft['cls'], lang: Lang, resolution: 'ask' | 'askAgain' = 'ask') => {
  const line = cls ? CARRY_LINES[cls][resolution] : CARRY_LINES_UNCLASSIFIED[resolution];
  return line.text[lang].replaceAll(CARRY_QUOTE_MARKER, () => QUOTE);
};

test('every ask template really contains the quote slot, in both languages', () => {
  const asks = [
    CARRY_LINES.call.ask, CARRY_LINES.visit.ask, CARRY_LINES.ritual.ask, CARRY_LINES_UNCLASSIFIED.ask,
    CARRY_LINES.call.askAgain, CARRY_LINES.visit.askAgain, CARRY_LINES.ritual.askAgain, CARRY_LINES_UNCLASSIFIED.askAgain,
  ];
  for (const line of asks) {
    for (const lang of ['zh', 'en'] as Lang[]) {
      // 模板漏掉占位符 = 学习者的话被静默吞掉，比措辞不好更糟。
      assert.ok(line.text[lang].includes(CARRY_QUOTE_MARKER), `${lang} ask template drops the quote`);
      assert.ok(!/\n/.test(line.text[lang]), 'a carry line is one spoken turn');
    }
    assert.ok(line.source.length > 0, 'a carry line without source is not allowed in');
  }
});

test('a pending carry from the same line and speaker outranks the outcome sentence', () => {
  clearCarries();
  clear(RIO);
  const [first, second] = actIds(RIO);
  saveCarry();
  writeLoveSeriesProgress(RIO, first, 'success');
  const opened = loveCarryoverForScene(RIO, second, 'zh');
  assert.equal(opened.text, askOf('call', 'zh'), 'the opening quotes the learner’s own words');
  assert.notEqual(opened.text, LOVE_CARRYOVER[RIO].success.zh, '…in place of P1’s hardcoded sentence');
  assert.equal(opened.outcome, 'success', 'the outcome still rides along, so the eyebrow label works on both paths');
  assert.equal(carrySlot().askCount, 1, 'quoting counts as asking');
  assert.equal(carrySlot().state, 'pending', 'the ask never answers on the learner’s behalf');
  assert.equal(typeof carrySlot().lastAskedAt, 'number');
  loveCarryoverForScene(RIO, second, 'zh');
  // 重开同一幕不再多花掉一次提问：一次自然日只算问过一回。不设这条的话，连打三幕或把一幕
  // 重开两次就能在同一次访问里把 3 次问满，承诺被静默 retire，跟进卡再也轮不到——而设置页
  // 向用户承诺的是「两次至少隔一天」。计数按天，引用照旧，NPC 不会忽然忘了刚问过的那句。
  assert.equal(carrySlot().askCount, 1, 'reopening the same act does not spend another ask');
  assert.equal(loveCarryoverForScene(RIO, second, 'zh').text, askOf('call', 'zh', 'askAgain'), 'the reopened act keeps quoting the promise, in the second-ask wording');
  assert.equal(loveCarryoverForScene(RIO, second, 'en').text, askOf('call', 'en', 'askAgain'), 'the opening switches on the same askCount the card uses, in the interface language');
  clearCarries();
});

test('the carry line follows the interface language while the quote stays single-language', () => {
  clearCarries();
  clear(RIO);
  saveCarry();
  const [, second] = actIds(RIO);
  const opened = loveCarryoverForScene(RIO, second, 'en').text!;
  assert.equal(opened, askOf('call', 'en'));
  assert.ok(opened.includes(QUOTE), 'the Chinese words are not translated into the English line');
  clearCarries();
});

test('a carry matches by line + speaker, not by which act it came from', () => {
  clearCarries();
  clear(RIO);
  const [first, , third] = actIds(RIO);
  saveCarry({ scenarioId: first });
  // 隔一幕也算：原话真的说过就不是编造；只有 P1 的查表句要求紧邻。
  assert.equal(loveCarryoverForScene(RIO, third, 'zh').text, askOf('call', 'zh'), 'act 3 quotes a carry left in act 1');
  clearCarries();
  saveCarry({ scenarioId: third });
  assert.equal(loveCarryoverForScene(RIO, third, 'zh').text, null, 'a scene never quotes its own carry back at itself');
  clearCarries();
});

test('a carry from another line or another character is never quoted', () => {
  clearCarries();
  clear(RIO);
  const [first, second] = actIds(RIO);
  writeLoveSeriesProgress(RIO, first, 'partial');
  // 语料里 tess 是两条线上两个角色的同一个 id（还共用立绘），线 id 这一层就是让这种撞 id 无害。
  saveCarry({ seriesId: EVE, scenarioId: actIds(EVE)[0] });
  assert.equal(loveCarryoverForScene(RIO, second, 'zh').text, LOVE_CARRYOVER[RIO].partial.zh, "another line's carry stays in that line");
  clearCarries();
  saveCarry({ npcId: 'eve' });
  assert.equal(loveCarryoverForScene(RIO, second, 'zh').text, LOVE_CARRYOVER[RIO].partial.zh, 'a different character never claims this promise');
  clearCarries();
});

test('an unlabelled carry falls to the unclassified ask line', () => {
  clearCarries();
  clear(RIO);
  saveCarry({ cls: null });
  const [, second] = actIds(RIO);
  assert.equal(loveCarryoverForScene(RIO, second, 'zh').text, askOf(null, 'zh'));
  clearCarries();
});

test('P1’s gates survive P2: the first act and a character-swapping line still quote nothing', () => {
  clearCarries();
  clear(RIO);
  const [first, second] = actIds(RIO);
  saveCarry({ scenarioId: second });
  assert.equal(loveCarryoverForScene(RIO, first, 'zh').text, null, 'the opening act has no past to carry');
  const scattered = LOVE_SERIES.find((s) => !s.continuous && s.scenarios.length > 1);
  assert.ok(scattered, 'the corpus is expected to keep at least one non-continuous romantic line');
  clear(scattered.id);
  const ids = scattered.scenarios.map((s) => s.id);
  const next = scattered.scenarios[1];
  saveCarry({ seriesId: scattered.id, npcId: speakerOf(next, defaultLearnerId(next)).id, scenarioId: ids[0] });
  assert.equal(loveCarryoverForScene(scattered.id, ids[1], 'zh').text, null, 'a line that swaps characters must not let an NPC claim a memory');
  assert.equal(loveCarryoverForScene(scattered.id, ids[1], 'en').text, null);
  clearCarries();
});

// ---------- 采集侧没有 continuous 这道门（P4 跟进卡按说话人归属） ----------

/** 两天后的正午：躲开免打扰窗口，也满足单条 24 小时那一门。 */
const muchLater = () => {
  const date = new Date(Date.now() + 48 * 60 * 60 * 1000);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
};

test('the long-distance line records promises even though its acts swap characters', () => {
  clearCarries();
  const ld = loveSeriesById('love-arc-long-distance')!;
  assert.equal(ld.continuous, false, '8 幕 8 个不同的人——这正是这条线的形状，也是评审 §1 的动机所在');
  const [first, second] = ld.scenarios;
  // 承诺记在「第二幕那个人」名下：注入那道门一旦被拆掉，下面那条断言会立刻红。
  const speaker = speakerOf(second, defaultLearnerId(second));
  writeLoveSeriesProgress(ld.id, first.id, 'success');
  const res = saveCarry({ seriesId: ld.id, scenarioId: first.id, npcId: speaker.id, npcName: speaker.name });
  assert.equal(res.ok, true, '采集不看 continuous：异地 8 场每一场都该能留下一句');
  assert.equal(loveCarryoverForScene(ld.id, second.id, 'zh').text, null, '注入仍然按 continuous 关门');
  assert.equal(loveCarryoverForScene(ld.id, second.id, 'en').text, null, '…两种语言都不开');
  const due = dueLoveCarry(muchLater());
  assert.equal(due?.npcId, speaker.id, '跟进卡按说话人归属，与这条线连不连续无关');
  assert.ok(due?.text, '学习者那句原话还在，等着被逐字问起');
  clearCarries();
  clear(ld.id);
});

test('a scene with no story line at all can still leave a promise behind', () => {
  clearCarries();
  const res = saveCarry({ seriesId: null, scenarioId: 'love-approach-cafe', npcId: 'maya', npcName: { zh: 'Maya', en: 'Maya' } });
  assert.equal(res.ok, true, '独立场景与自定义排练同样能记——它们只是没有下幕，不是没有下一个人');
  assert.equal(readLoveCarries()[0].seriesId, null);
  assert.equal(dueLoveCarry(muchLater())?.scenarioId, 'love-approach-cafe');
  clearCarries();
});
