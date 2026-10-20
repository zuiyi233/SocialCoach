/** P3 呈现层：镜头语言纯函数（spec §4.5）——景别只在有动机时切换，站位确定性可复现。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isHeavyLoveEmotion,
  loveShotForMoment,
  loveShotForSpeaker,
  loveSideFor,
  LOVE_SHOT_SCALE,
  LOVE_SIDE_OFFSET_PX,
} from '../../src/lib/love-stage';

test('shots change only with a motive: opening far, reveal/ending near, heavy emotion near, else mid', () => {
  assert.equal(loveShotForMoment({ opening: true, reveal: false, ending: false, heavyEmotion: false }), 'far', 'the opening establishes in a wide shot');
  assert.equal(loveShotForMoment({ opening: false, reveal: true, ending: false, heavyEmotion: false }), 'near', 'the hidden reveal pushes in');
  assert.equal(loveShotForMoment({ opening: false, reveal: false, ending: true, heavyEmotion: false }), 'near', 'the ending pushes in');
  assert.equal(loveShotForMoment({ opening: false, reveal: false, ending: false, heavyEmotion: true }), 'near', 'teary pushes in');
  assert.equal(loveShotForMoment({ opening: false, reveal: false, ending: false, heavyEmotion: false }), 'mid', 'no motive stays mid');
  // 动机优先级：结局与揭示压过开场；开场压过普通情绪。
  assert.equal(loveShotForMoment({ opening: true, reveal: true, ending: false, heavyEmotion: false }), 'near');
  assert.equal(loveShotForMoment({ opening: true, reveal: false, ending: true, heavyEmotion: false }), 'near');
  assert.equal(isHeavyLoveEmotion('teary'), true);
  for (const emotion of ['neutral', 'smile', 'tight'] as const) {
    assert.equal(isHeavyLoveEmotion(emotion), false, `${emotion} must not push the camera in`);
  }
});

test('only the speaker follows the shot; scene partners stay mid', () => {
  const moment = { opening: false, reveal: true, ending: false, heavyEmotion: false };
  assert.equal(loveShotForSpeaker(moment, true), 'near');
  assert.equal(loveShotForSpeaker(moment, false), 'mid');
  assert.equal(loveShotForSpeaker({ opening: true, reveal: false, ending: false, heavyEmotion: false }, false), 'mid');
});

test('scale table is ordered far < mid < near and the side offset is small', () => {
  assert.ok(LOVE_SHOT_SCALE.far < LOVE_SHOT_SCALE.mid);
  assert.ok(LOVE_SHOT_SCALE.mid < LOVE_SHOT_SCALE.near);
  assert.equal(LOVE_SHOT_SCALE.mid, 1, 'mid is the existing base size');
  assert.ok(LOVE_SIDE_OFFSET_PX > 0 && LOVE_SIDE_OFFSET_PX < 80, 'a side step, not a jump');
});

test('sides are deterministic per scene+character and stable across calls', () => {
  const a = loveSideFor('love-rio-deadline-night', 'rio');
  assert.equal(a, loveSideFor('love-rio-deadline-night', 'rio'), 'same scene+character, same side');
  assert.equal(loveSideFor('love-rio-deadline-night', 'rio'), loveSideFor('love-rio-deadline-night', 'rio'), 'SSR and client compute the same value');
  // 覆盖两边：散列必须把不同输入分到 left/right 两侧，而不是全一边。
  const values = new Set(
    ['love-rio-deadline-night', 'love-ld-routine', 'love-approach-cafe', 'love-define-rio-pace-talk', 'love-trust-repair'].flatMap((scene) =>
      ['rio', 'mina', 'you', 'jamie'].map((who) => loveSideFor(scene, who)),
    ),
  );
  assert.ok(values.has('left') && values.has('right'), `both sides occur (got ${[...values].join(', ')})`);
});
