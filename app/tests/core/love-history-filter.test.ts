/** 离线回归：恋爱剧情存的是 story save，不是练习历史（G23）。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS } from '../../src/data/corpus';
import { buildSession, historyFor } from '../../src/lib/session-utils';
import type { Session } from '../../src/lib/types';

const scenario = SCENARIOS.find((s) => s.context === 'romantic')!;

function stored(origin: Session['origin'], id: string, at: number, status: Session['status']): Session {
  return { ...buildSession(scenario, origin, 'zh'), id, startedAt: at, status };
}

test('a finished love-play session never displaces practice history', () => {
  const love = stored('love-play', 'love-story-1', 2_000, 'ended');
  const practice = stored('scheduled', 'practice-1', 1_000, 'assessed');
  const history = historyFor([love, practice], 'zh');
  assert.deepEqual(history.map((h) => h.sessionId), [practice.id]);
});

test('romance-only devices have an empty practice history', () => {
  const love = stored('love-play', 'love-story-1', 2_000, 'ended');
  assert.deepEqual(historyFor([love], 'zh'), []);
});
