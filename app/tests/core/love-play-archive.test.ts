import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArchive } from '../../src/lib/archive';
import { SCENARIOS } from '../../src/data/corpus';

test('a love-play session survives the local archive round trip', () => {
  const scenario = SCENARIOS.find((s) => s.id === 'love-approach-hobby-event');
  assert.ok(scenario, 'love scenario present');
  const session = {
    id: 'love-play-test-1',
    scenario,
    learnerCharacterId: 'you',
    messages: [],
    objectiveDone: scenario.objectives.map(() => false),
    status: 'ended',
    startedAt: Date.now(),
    reflections: [],
    origin: 'love-play',
  };
  // Regression: archive's origin enum must accept love-play, or the whole
  // archive fails to parse and the user's stored history is lost.
  const archive = parseArchive(JSON.parse(JSON.stringify({ sessions: [session] })));
  const kept = archive.sessions.find((s) => s.id === session.id);
  assert.ok(kept, 'love-play session kept after round trip');
  assert.equal(kept.origin, 'love-play');
});