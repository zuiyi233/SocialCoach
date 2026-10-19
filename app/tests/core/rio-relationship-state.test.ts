/** Rio 关系账本的 schema / 迁移 / 对账回归：strip 未知字段、旧档只迁幕号、不凭空生成状态。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RIO_SERIES_ID,
  emptyRioState,
  isRioStateCurrent,
  migrateLegacyRioState,
  parseRioState,
  type RioBoundary,
  type RioConflict,
  type RioQuote,
  type RioRelationshipState,
} from '../../src/lib/love-relationship-state';

const SCENES = {
  1: 'love-approach-soft-decline-reinvite',
  2: 'love-define-rio-pace-talk',
  3: 'love-family-expectation-clash',
  4: 'love-rio-secondment-deadline',
  5: 'love-rio-family-settled',
  6: 'love-rio-deadline-night',
} as const;

const FORBIDDEN = ['score', 'affinity', 'proficiency', 'loveProficiency', 'stars', 'practiceDays', 'stance'];

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.add(key);
      collectKeys(inner, out);
    }
  }
  return out;
}

const quote = (id: string): RioQuote => ({ id, atAct: 2, speaker: 'learner', text: '周三晚上打给你', lang: 'zh', via: 'type' });

const boundary = (): RioBoundary => ({
  id: 'b1',
  topic: 'pace',
  by: 'learner',
  atAct: 2,
  status: 'agreed',
  evidence: { kind: 'option', optionId: 'o1', text: { zh: '两周后再谈', en: 'Talk again in two weeks' } },
  acceptedBy: ['learner', 'rio'],
});

const conflict = (): RioConflict => ({
  id: 'c1',
  topic: 'pace',
  shape: 'pace-dated',
  status: 'resolved',
  openedAtAct: 2,
  lastTouchedAtAct: 2,
  hasMutualNextStep: true,
  evidence: { kind: 'npc', quoteId: 'q-npc' },
  resolution: { kind: 'quote', quoteId: 'q-learn' },
});

function fullState(): RioRelationshipState {
  return {
    ...emptyRioState(),
    lastAct: 2,
    lastOutcome: 'partial',
    legacy: false,
    stale: false,
    unknown: ['paceAgreed'],
    promises: [
      {
        id: 'p1',
        kind: 'answer-with-date',
        by: 'learner',
        madeAtAct: 2,
        dueByAct: 3,
        status: 'open',
        evidence: { kind: 'quote', quoteId: 'q1' },
        carryId: 'carry-1',
      },
    ],
    boundaries: [boundary()],
    conflicts: [conflict()],
    rituals: [
      {
        id: 'r1',
        kind: 'weekly-talk',
        status: 'agreed',
        atAct: 2,
        evidence: { kind: 'npc', quoteId: 'q2' },
        acceptedBy: ['learner', 'rio'],
      },
    ],
    flags: { ...emptyRioState().flags, pace: 'dated', exclusivity: 'agreed', decisionReclaimed: true },
    finalDecision: {
      kind: 'continue',
      agreedBy: 'both',
      atAct: 6,
      evidence: { kind: 'quote', quoteId: 'q3' },
      acceptance: { kind: 'npc', quoteId: 'q4' },
      hasDatedNextStep: true,
      revisit: null,
      reason: null,
    },
    quotes: [quote('q1'), quote('q3')],
    updatedAt: 1_700_000_000_000,
  };
}

test('schema: empty state round-trips without losing shape', () => {
  const empty = emptyRioState();
  const parsed = parseRioState(empty);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.state, empty);
  assert.equal(parsed.state.seriesId, RIO_SERIES_ID);
});

test('schema: missing optional blocks fall back to safe defaults', () => {
  const parsed = parseRioState({ v: 1, seriesId: RIO_SERIES_ID });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const { state } = parsed;
  assert.equal(state.lastAct, 0);
  assert.equal(state.lastOutcome, null);
  assert.equal(state.legacy, false);
  assert.equal(state.stale, false);
  assert.deepEqual(state.unknown, []);
  assert.deepEqual(state.promises, []);
  assert.deepEqual(state.boundaries, []);
  assert.deepEqual(state.conflicts, []);
  assert.deepEqual(state.rituals, []);
  assert.deepEqual(state.flags, emptyRioState().flags);
  assert.equal(state.finalDecision, null);
  assert.deepEqual(state.quotes, []);
  assert.equal(state.updatedAt, 0);
});

test('schema: unknown fields are stripped at every level', () => {
  const full = fullState();
  const raw = {
    ...full,
    score: 99,
    affinity: 7,
    stance: 'open',
    loveProficiency: 3,
    flags: { ...full.flags, stars: 5, practiceDays: 12 },
    promises: [{ ...full.promises[0], score: 1 }],
    boundaries: [{ ...full.boundaries[0], affinity: 2 }],
    conflicts: [{ ...full.conflicts[0], practiceDays: 4 }],
    rituals: [{ ...full.rituals[0], stars: 6 }],
    finalDecision: { ...full.finalDecision, stance: 'closed' },
    quotes: [{ ...full.quotes[0], proficiency: 1 }],
  };
  const parsed = parseRioState(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const keys = collectKeys(parsed.state);
  for (const key of FORBIDDEN) assert.equal(keys.has(key), false, `leaked ${key}`);
  for (const key of ['score', 'affinity', 'loveProficiency']) assert.equal(keys.has(key), false);
  assert.deepEqual(parsed.state.promises[0], full.promises[0]);
  assert.deepEqual(parsed.state.flags, full.flags);
});

test('schema: serialized state never carries score-like fields', () => {
  const states: RioRelationshipState[] = [
    emptyRioState(),
    fullState(),
    migrateLegacyRioState({ completed: [SCENES[1], SCENES[2], SCENES[3]], lastScene: SCENES[3], outcome: { [SCENES[3]]: 'success' } }),
  ];
  for (const state of states) {
    const serialized = JSON.parse(JSON.stringify(state)) as unknown;
    const keys = collectKeys(serialized);
    for (const key of FORBIDDEN) assert.equal(keys.has(key), false, `serialized ${key}`);
  }
});

test('schema: bad enum values and timestamps fall back instead of throwing', () => {
  const parsed = parseRioState({
    ...fullState(),
    lastAct: 9,
    lastOutcome: 'amazing',
    updatedAt: 'yesterday',
    flags: { ...fullState().flags, weddingTimeline: 'decided-by-dad', pace: 'soon' },
    promises: [{ ...fullState().promises[0], status: 'done' }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.state.lastAct, 0);
  assert.equal(parsed.state.lastOutcome, null);
  assert.equal(parsed.state.updatedAt, 0);
  assert.equal(parsed.state.flags.weddingTimeline, 'unset');
  assert.equal(parsed.state.flags.pace, 'undefined');
  assert.equal(parsed.state.promises.length, 1);
  assert.equal(parsed.state.promises[0].status, 'open');
});

test('schema: broken records are dropped or reject the whole slot, never throw', () => {
  const missingEvidence = parseRioState({ ...emptyRioState(), promises: [{ id: 'p1' }] });
  assert.equal(missingEvidence.ok, true);
  if (missingEvidence.ok) assert.deepEqual(missingEvidence.state.promises, []);

  for (const raw of [
    null,
    undefined,
    [],
    'not json',
    {},
    { v: 2, seriesId: RIO_SERIES_ID },
    { v: 1, seriesId: 'other-series' },
  ]) {
    const parsed = parseRioState(raw);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.reason, 'shape');
  }

  // 字符串输入按 JSON 解析，避免调用方多写一层 try/catch。
  const asString = parseRioState(JSON.stringify(emptyRioState()));
  assert.equal(asString.ok, true);
});

test('migration: empty legacy progress yields act 0 with four unknowns', () => {
  const state = migrateLegacyRioState({ completed: [], lastScene: '', outcome: {} });
  assert.equal(state.lastAct, 0);
  assert.equal(state.lastOutcome, null);
  assert.equal(state.legacy, true);
  assert.equal(state.stale, false);
  assert.deepEqual(state.unknown, [
    'secondmentDisclosed',
    'familyHalfPromiseDisclosed',
    'paceAgreed',
    'decisionReclaimed',
  ]);
  assert.deepEqual(state.promises, []);
  assert.deepEqual(state.boundaries, []);
  assert.deepEqual(state.conflicts, []);
  assert.deepEqual(state.rituals, []);
  assert.equal(state.finalDecision, null);
  assert.deepEqual(state.flags, emptyRioState().flags);
});

test('migration: act 1 only carries the landed act and its outcome', () => {
  const state = migrateLegacyRioState({
    completed: [SCENES[1]],
    lastScene: SCENES[1],
    outcome: { [SCENES[1]]: 'success' },
  });
  assert.equal(state.lastAct, 1);
  assert.equal(state.lastOutcome, 'success');
  assert.equal(state.legacy, true);
  assert.deepEqual(state.unknown.length, 4);
  // 旧档的 success 不能凭空变成外派已披露、节奏已约定或冲突已解决。
  assert.equal(state.flags.secondmentDisclosed, false);
  assert.equal(state.flags.pace, 'undefined');
  assert.equal(state.flags.secondmentDecision, 'undecided');
  assert.equal(state.flags.finalDecisionMade, false);
  assert.deepEqual(state.conflicts, []);
  assert.deepEqual(state.promises, []);
  assert.deepEqual(state.boundaries, []);
});

test('migration: act 3 takes max completed act and lastScene outcome', () => {
  const state = migrateLegacyRioState({
    completed: [SCENES[3], SCENES[1], SCENES[2]],
    lastScene: SCENES[3],
    outcome: { [SCENES[1]]: 'success', [SCENES[2]]: 'success', [SCENES[3]]: 'partial' },
  });
  assert.equal(state.lastAct, 3);
  assert.equal(state.lastOutcome, 'partial');
  assert.equal(state.legacy, true);
  assert.deepEqual(state.unknown.length, 4);
  assert.equal(state.flags.familyHalfPromiseDisclosed, false);
});

test('migration: act 6 stays legacy and does not infer the final decision', () => {
  const state = migrateLegacyRioState({
    completed: [SCENES[1], SCENES[2], SCENES[3], SCENES[4], SCENES[5], SCENES[6]],
    lastScene: SCENES[6],
    outcome: { [SCENES[6]]: 'failure' },
  });
  assert.equal(state.lastAct, 6);
  assert.equal(state.lastOutcome, 'failure');
  assert.equal(state.legacy, true);
  assert.equal(state.flags.finalDecisionMade, false);
  assert.equal(state.finalDecision, null);
  assert.equal(state.flags.weddingTimeline, 'unset');
  assert.equal(state.flags.decisionReclaimed, false);
});

test('migration: invalid or junk input falls back to act 0 / outcome null', () => {
  const empty = migrateLegacyRioState({} as never);
  assert.equal(empty.lastAct, 0);
  assert.equal(empty.lastOutcome, null);
  assert.equal(empty.legacy, true);

  const junk = migrateLegacyRioState({
    completed: ['not-a-rio-scene', 42 as never],
    lastScene: 'not-a-rio-scene',
    outcome: { 'not-a-rio-scene': 'amazing' as never },
  });
  assert.equal(junk.lastAct, 0);
  assert.equal(junk.lastOutcome, null);
  assert.equal(junk.legacy, true);

  const brokenShape = migrateLegacyRioState({ completed: 'nope', lastScene: 7, outcome: null } as never);
  assert.equal(brokenShape.lastAct, 0);
  assert.equal(brokenShape.lastOutcome, null);
  assert.equal(brokenShape.legacy, true);
});

test('isRioStateCurrent: matches act and outcome against progress', () => {
  const state = migrateLegacyRioState({
    completed: [SCENES[1], SCENES[2], SCENES[3]],
    lastScene: SCENES[3],
    outcome: { [SCENES[3]]: 'partial' },
  });
  const progress = {
    completed: [SCENES[1], SCENES[2], SCENES[3]],
    outcome: { [SCENES[1]]: 'success' as const, [SCENES[2]]: 'success' as const, [SCENES[3]]: 'partial' as const },
  };
  assert.equal(isRioStateCurrent(state, progress), true);

  // 同一幕但 outcome 不一致：state 落后于最后一次写进度。
  assert.equal(
    isRioStateCurrent(state, { ...progress, outcome: { ...progress.outcome, [SCENES[3]]: 'success' } }),
    false,
  );

  // 进度还没到 state 的幕。
  assert.equal(isRioStateCurrent(state, { completed: [SCENES[1], SCENES[2]], outcome: progress.outcome }), false);

  // 进度已经越过 state 的幕（state 写失败后的经典 stale 场景）。
  const behind = migrateLegacyRioState({
    completed: [SCENES[1]],
    lastScene: SCENES[1],
    outcome: { [SCENES[1]]: 'success' },
  });
  assert.equal(
    isRioStateCurrent(behind, {
      completed: [SCENES[1], SCENES[2]],
      outcome: { [SCENES[1]]: 'success', [SCENES[2]]: 'success' },
    }),
    false,
  );

  // 空 state / 空进度一律 false。
  assert.equal(isRioStateCurrent(emptyRioState(), { completed: [], outcome: {} }), false);
  const noOutcome = migrateLegacyRioState({ completed: [SCENES[1]], lastScene: '', outcome: {} });
  assert.equal(isRioStateCurrent(noOutcome, { completed: [SCENES[1]], outcome: {} }), false);
});
