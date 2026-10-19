/** G02: a love-play scene with no NPC cannot be voiced — the server must reject it, not let the learner speak as both sides. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS } from '../../src/data/corpus';
import { TaskInputSchemas } from '../../src/lib/task-input';

const scenario = SCENARIOS.find((s) => s.context === 'romantic' && s.characters.some((c) => c.playable));
assert.ok(scenario, 'a romantic scenario with a playable learner exists');
const learner = scenario.characters.find((c) => c.playable)!;

const input = (over: Record<string, unknown> = {}) => ({
  scenario,
  learnerCharacterId: learner.id,
  language: 'zh',
  messages: [],
  ...over,
});

test('a normal romantic scene passes the love-play input gate', () => {
  const parsed = TaskInputSchemas['love-play'].safeParse(input());
  assert.equal(parsed.success, true);
});

test('a scene whose only character is the learner is rejected', () => {
  const learnerOnly = { ...scenario, characters: scenario.characters.filter((c) => c.playable) };
  const parsed = TaskInputSchemas['love-play'].safeParse(input({ scenario: learnerOnly }));
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((i) => i.message === 'A non-learner NPC is required'));
  }
});

test('an unplayable learner is still rejected', () => {
  const npc = scenario.characters.find((c) => !c.playable);
  assert.ok(npc);
  const parsed = TaskInputSchemas['love-play'].safeParse(input({ learnerCharacterId: npc.id }));
  assert.equal(parsed.success, false);
});
