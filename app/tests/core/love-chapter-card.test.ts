/** P3 呈现层：章节卡数据契约（spec-love-interactive-story §4.5）——全覆盖、双语、不剧透半张卡。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOVE_SERIES } from '../../src/data/corpus/love-series';
import { SCENARIOS } from '../../src/data/corpus';
import {
  LOVE_CHAPTER_CARDS,
  LOVE_TIMED_CHOICE_SCENES,
  loveChapterCardFor,
} from '../../src/lib/love-chapter-card';

/** 幕首卡的三行常量必须双语齐全：缺一边、空串都算缺。 */
const bilingual = (value: { zh: string; en: string }, label: string) => {
  assert.equal(typeof value.zh, 'string', `${label}.zh is a string`);
  assert.equal(typeof value.en, 'string', `${label}.en is a string`);
  assert.ok(value.zh.trim().length >= 2, `${label}.zh is written (${value.zh})`);
  assert.ok(value.en.trim().length >= 2, `${label}.en is written (${value.en})`);
};

test('every romantic series scene has a complete bilingual chapter card', () => {
  let count = 0;
  for (const series of LOVE_SERIES) {
    for (const scene of series.scenarios) {
      const data = LOVE_CHAPTER_CARDS[scene.id];
      assert.ok(data, `series scene ${scene.id} (${series.id}) is missing its chapter card`);
      bilingual(data.when, `${scene.id}.when`);
      bilingual(data.where, `${scene.id}.where`);
      bilingual(data.hook, `${scene.id}.hook`);
      count += 1;
    }
  }
  assert.ok(count >= 20, `expected the five love lines' scenes (got ${count})`);
  assert.equal(Object.keys(LOVE_CHAPTER_CARDS).length, count, 'no orphan card entries for scenes that do not exist');
});

test('non-series, non-romantic and unauthored scenes never get a card', () => {
  const free = SCENARIOS.find((s) => s.context === 'romantic' && !s.series);
  assert.ok(free, 'the corpus has standalone love scenes');
  assert.equal(loveChapterCardFor(free!), null, 'a scene without a series never shows a card');

  const family = SCENARIOS.find((s) => s.series?.id === 'family-care');
  assert.ok(family, 'the corpus has the family-care line');
  assert.equal(loveChapterCardFor(family!), null, 'non-romantic series never show a card');

  const fake = {
    ...free!,
    id: 'love-future-scene-without-card',
    series: { id: 'love-arc-rio-clarify', name: { zh: '暧昧到说清楚', en: 'From Ambiguous to Explicit' }, order: 7 },
  };
  assert.equal(loveChapterCardFor(fake), null, 'a series scene without authored card data gets no half card');
});

test('act numbers follow series order; continuous lines are acts, theme packs are scenes', () => {
  const rio = LOVE_SERIES.find((s) => s.id === 'love-arc-rio-clarify')!;
  assert.equal(rio.continuous, true, 'Rio is one cast throughout');
  rio.scenarios.forEach((scene, index) => {
    const card = loveChapterCardFor(scene);
    assert.ok(card);
    assert.equal(card!.act, index + 1, `${scene.id} is act ${index + 1}`);
    assert.equal(card!.continuous, true);
    assert.equal(card!.title, scene.title, 'the card title is the scenario title verbatim');
  });

  // Rio 第 6 幕由显式 order 锚定：语料标 6，卡片就报 6。
  const sixth = rio.scenarios.find((s) => s.id === 'love-rio-deadline-night')!;
  assert.equal(loveChapterCardFor(sixth)!.act, 6);

  const approach = LOVE_SERIES.find((s) => s.id === 'love-arc-approach')!;
  assert.equal(approach.continuous, false, 'approach line changes cast, so it is a theme pack');
  approach.scenarios.forEach((scene, index) => {
    const card = loveChapterCardFor(scene);
    assert.ok(card);
    assert.equal(card!.continuous, false, `${scene.id} is labelled a scene, not an act`);
    assert.equal(card!.act, index + 1, `unordered scenes fall back to in-line order (${scene.id})`);
  });
});

test('the timed choice is registered for the Rio climax act only', () => {
  assert.deepEqual([...LOVE_TIMED_CHOICE_SCENES], ['love-rio-deadline-night'], 'one climax scene, by id');
  const fifth = 'love-rio-family-settled';
  assert.ok(!LOVE_TIMED_CHOICE_SCENES.has(fifth), 'act 5 is not the climax');
});
