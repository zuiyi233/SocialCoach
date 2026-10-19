/**
 * G22 / G06 / G09 的离线回归：
 * Rio 三处「前一幕 → 本幕」专属承接优先于 6 句通用兜底、未命中回退；
 * peek 纯读不花提问额度，mark 之后 askCount 才 +1，重开同一幕不重复记账。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Lang } from '../../src/data/taxonomy';
import { CARRY_LINES, CARRY_QUOTE_MARKER } from '../../src/data/corpus/love-carry-lines';
import { loveSeriesById } from '../../src/data/corpus/love-series';
import {
  LOVE_CARRYOVER,
  LOVE_CARRYOVER_SCENE,
  markLoveCarryoverShown,
  peekLoveCarryoverForScene,
  pickLoveCarryover,
} from '../../src/lib/love-carryover';
import { readLoveCarries, saveLoveCarry } from '../../src/lib/love-carry-store';
import { writeLoveSeriesProgress } from '../../src/lib/love-series-progress';

const RIO = 'love-arc-rio-clarify';
const OUTCOMES = ['success', 'partial', 'failure'] as const;
const LANGS: readonly Lang[] = ['zh', 'en'];
const ACT1 = 'love-approach-soft-decline-reinvite';
const ACT2 = 'love-define-rio-pace-talk';
const ACT3 = 'love-family-expectation-clash';
const SCENE_PREFIX = `${RIO}:`;

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

const CARRY_KEY = 'socialcoach.love-play.carry';
const seriesKey = (id: string) => `socialcoach.love-play.series.${id}`;
const reset = () => {
  slots.delete(CARRY_KEY);
  slots.delete(seriesKey(RIO));
};

const QUOTE = '周三晚上打给你';
const saveCarry = () => {
  const res = saveLoveCarry({
    text: QUOTE,
    lang: 'zh',
    cls: 'call',
    npcId: 'rio',
    npcName: { zh: 'Rio', en: 'Rio' },
    scenarioId: ACT1,
    seriesId: RIO,
  });
  assert.equal(res.ok, true);
};
const carrySlot = () => readLoveCarries()[0];
const askOf = (lang: Lang, resolution: 'ask' | 'askAgain' = 'ask') =>
  CARRY_LINES.call[resolution].text[lang].replaceAll(CARRY_QUOTE_MARKER, () => QUOTE);

test('the Rio route carries one dedicated sentence per previous act, three outcomes, both languages', () => {
  assert.deepEqual(
    Object.keys(LOVE_CARRYOVER_SCENE).sort(),
    [`${SCENE_PREFIX}${ACT1}`, `${SCENE_PREFIX}${ACT2}`, `${SCENE_PREFIX}${ACT3}`].sort(),
    'only the three authored Rio hand-offs exist — the generic table stays the fallback for everything else',
  );
  for (const [key, byOutcome] of Object.entries(LOVE_CARRYOVER_SCENE)) {
    assert.deepEqual(Object.keys(byOutcome).sort(), [...OUTCOMES].sort(), `${key} must cover exactly the three outcomes`);
    for (const outcome of OUTCOMES) {
      for (const lang of LANGS) {
        const text = byOutcome[outcome][lang];
        assert.ok(text.trim().length > 0, `${key}/${outcome}/${lang} is blank`);
        assert.ok(!/\n/.test(text), `${key}/${outcome}/${lang} is one spoken turn, not a paragraph`);
        assert.notEqual(text, LOVE_CARRYOVER[RIO][outcome][lang], `${key}/${outcome}/${lang} just repeats the generic line`);
      }
    }
  }
});

test('the dedicated line wins for its own previous act, and each previous act gets a different sentence', () => {
  for (const outcome of OUTCOMES) {
    for (const lang of LANGS) {
      const picked = [ACT1, ACT2, ACT3].map((prev) => pickLoveCarryover(outcome, RIO, lang, prev));
      assert.deepEqual(
        picked,
        [LOVE_CARRYOVER_SCENE[`${SCENE_PREFIX}${ACT1}`][outcome][lang],
          LOVE_CARRYOVER_SCENE[`${SCENE_PREFIX}${ACT2}`][outcome][lang],
          LOVE_CARRYOVER_SCENE[`${SCENE_PREFIX}${ACT3}`][outcome][lang]],
        `${outcome}/${lang}: the previous act decides the sentence`,
      );
      assert.equal(new Set(picked).size, 3, `${outcome}/${lang}: six acts must not all hear the same line`);
      for (const text of picked) {
        assert.notEqual(text, LOVE_CARRYOVER[RIO][outcome][lang], `${outcome}/${lang}: a dedicated line must not be the generic one`);
      }
    }
  }
});

test('a previous act without an override falls back to the six generic sentences', () => {
  for (const outcome of OUTCOMES) {
    for (const lang of LANGS) {
      assert.equal(pickLoveCarryover(outcome, RIO, lang, 'some-other-scene'), LOVE_CARRYOVER[RIO][outcome][lang]);
      assert.equal(pickLoveCarryover(outcome, RIO, lang), LOVE_CARRYOVER[RIO][outcome][lang], 'no previous act = generic table');
    }
  }
});

test('peek is a pure read: no ask is spent until the line is actually marked as shown', () => {
  reset();
  saveCarry();
  writeLoveSeriesProgress(RIO, ACT1, 'success');

  const first = peekLoveCarryoverForScene(RIO, ACT2, 'zh');
  assert.equal(first.text, askOf('zh'), 'the promise still outranks the outcome table');
  assert.equal(first.carryId, carrySlot().id, 'the peek names the carry it quotes');
  assert.equal(carrySlot().askCount, 0, 'peeking — including reopening or recalling the act — spends nothing');
  assert.equal(carrySlot().lastAskedAt, undefined, 'and writes no timestamp');

  // 同一幕被打开/回想多次也还是零成本。
  peekLoveCarryoverForScene(RIO, ACT2, 'zh');
  peekLoveCarryoverForScene(RIO, ACT2, 'en');
  assert.equal(carrySlot().askCount, 0);

  markLoveCarryoverShown(first.carryId!);
  assert.equal(carrySlot().askCount, 1, 'the explicit mark after the line shows counts exactly once');
  markLoveCarryoverShown(first.carryId!);
  assert.equal(carrySlot().askCount, 1, 'marking again the same sitting is idempotent (the store owns the daily gate)');

  const reopened = peekLoveCarryoverForScene(RIO, ACT2, 'zh');
  assert.equal(reopened.text, askOf('zh', 'askAgain'), 'the reopened act quotes the promise in the second-ask wording');
  assert.equal(reopened.carryId, first.carryId, 'same carry, not a new one');
  reset();
});

test('with no learner promise behind it, the same peek returns the dedicated outcome sentence', () => {
  reset();
  writeLoveSeriesProgress(RIO, ACT1, 'success');
  const peeked = peekLoveCarryoverForScene(RIO, ACT2, 'zh');
  assert.equal(peeked.text, LOVE_CARRYOVER_SCENE[`${SCENE_PREFIX}${ACT1}`].success.zh);
  assert.equal(peeked.carryId, null, 'nothing to mark when the line comes from the outcome table');
  reset();
});

test('the fourth act is keyed by the third act without needing yesterday’s disclosure', () => {
  reset();
  writeLoveSeriesProgress(RIO, ACT3, 'failure');
  // 第 4 幕语料由另一代理并行创建；这里只验「线 + 前一幕」的键与台词，不依赖语料是否已落地。
  const line = pickLoveCarryover('failure', RIO, 'zh', ACT3);
  assert.equal(line, LOVE_CARRYOVER_SCENE[`${SCENE_PREFIX}${ACT3}`].failure.zh);
  assert.ok(!line?.includes('外派'), 'a carry may name the email in front of them, never yesterday’s hidden offer');
  assert.ok(line?.includes('邮件'), 'it hands into this act’s actual object: the email on the table');
  reset();
});

test('no dedicated line names a date the player never said, or leaks Rio’s hidden facts', () => {
  const forbidden = ['两周', '十天', '国庆', '外派', '项目下周'];
  const tokens = (text: string, lang: Lang) =>
    lang === 'zh' ? [...text] : text.toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9']+/).filter(Boolean);
  const longestRun = (a: string[], b: string[]): number => {
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
  };
  const hidden = loveSeriesById(RIO)!.scenarios.flatMap((s) =>
    s.characters.flatMap((c) => (c.hidden ? [c.hidden.zh, c.hidden.en] : [])),
  );
  for (const [key, byOutcome] of Object.entries(LOVE_CARRYOVER_SCENE)) {
    for (const outcome of OUTCOMES) {
      for (const lang of LANGS) {
        const text = byOutcome[outcome][lang];
        for (const word of forbidden) assert.ok(!text.includes(word), `${key}/${outcome}/${lang} invents “${word}”`);
        for (const fact of hidden) {
          const probe = fact.length > 40 ? fact.slice(0, 40) : fact;
          assert.ok(!text.includes(probe), `${key}/${outcome}/${lang} quotes a hidden fact`);
          assert.ok(
            longestRun(tokens(text, lang), tokens(fact, lang)) < (lang === 'zh' ? 6 : 3),
            `${key}/${outcome}/${lang} shares a long stretch with a hidden fact`,
          );
        }
      }
    }
  }
});
