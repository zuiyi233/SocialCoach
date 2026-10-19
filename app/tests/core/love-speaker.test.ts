/** 离线回归：恋爱场景只有 speakerOf 一处配音口径（G02），全语料 + 畸形场景。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS, scenarioById } from '../../src/data/corpus';
import { defaultLearnerId, speakerOf } from '../../src/lib/session-utils';
import type { Scenario } from '../../src/data/corpus/types';

const romantic = SCENARIOS.filter((s) => s.context === 'romantic');

test('every romantic scene voices the opening speaker, or its first NPC when the opening is the learner', () => {
  assert.ok(romantic.length > 0, 'the corpus must contain romance scenes');
  for (const s of romantic) {
    const learnerId = defaultLearnerId(s);
    const speaker = speakerOf(s, learnerId);
    assert.ok(speaker, `${s.id}: speaker must exist`);
    assert.ok(speaker.id, `${s.id}: speaker id must be non-empty`);
    assert.ok(
      s.characters.some((c) => c.id === speaker.id),
      `${s.id}: speaker ${speaker.id} must be part of the cast`,
    );
    assert.notEqual(speaker.id, learnerId, `${s.id}: the learner never voices the NPC line`);
    if (s.opening.characterId !== learnerId) {
      assert.equal(speaker.id, s.opening.characterId, `${s.id}: the opening speaker is the one voiced`);
    }
  }
});

test('a malformed opening that points at the learner still falls back to the first NPC', () => {
  const base = scenarioById('love-approach-hobby-event')!;
  const learnerId = defaultLearnerId(base);
  const malformed: Scenario = { ...base, opening: { ...base.opening, characterId: learnerId } };
  const fallback = base.characters.find((c) => c.id !== learnerId)!;
  const captured: { speaker?: ReturnType<typeof speakerOf> } = {};
  assert.doesNotThrow(() => {
    captured.speaker = speakerOf(malformed, learnerId);
  }, 'speakerOf must not throw when the opening is the learner');
  assert.equal(captured.speaker!.id, fallback.id);
  assert.ok(malformed.characters.some((c) => c.id === captured.speaker!.id));
});
