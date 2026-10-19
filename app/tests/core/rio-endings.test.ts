/** Rio 两结局回归：spec §4.3 八组用例、§4.4 路径 A–D，以及全部刹车条件。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyRioState,
  resolveRioEnding,
  type RioBoundary,
  type RioConflict,
  type RioConflictTopic,
  type RioEndingId,
  type RioEvidence,
  type RioFinalDecision,
  type RioFlags,
  type RioRelationshipState,
} from '../../src/lib/love-relationship-state';

const ev = (id = 'q'): RioEvidence => ({ kind: 'quote', quoteId: id });

const REQUIRED_TOPICS: RioConflictTopic[] = [
  'secondment',
  'wedding-timeline',
  'decision-ownership',
  'exclusivity',
  'pace',
];

function closedConflict(topic: RioConflictTopic, over: Partial<RioConflict> = {}): RioConflict {
  return {
    id: `c-${topic}`,
    topic,
    shape: 'pace-dated',
    status: 'resolved',
    openedAtAct: 6,
    lastTouchedAtAct: 6,
    hasMutualNextStep: true,
    evidence: ev(`open-${topic}`),
    resolution: ev(`close-${topic}`),
    ...over,
  };
}

function decision(over: Partial<RioFinalDecision> = {}): RioFinalDecision {
  return {
    kind: 'continue',
    agreedBy: 'both',
    atAct: 6,
    evidence: ev('learner-final'),
    acceptance: ev('rio-accept'),
    hasDatedNextStep: true,
    revisit: null,
    reason: null,
    ...over,
  };
}

/** 标准 E1 底座：第 6 幕双方继续、五个 topic 全关、婚期已撤回。 */
function baseState(): RioRelationshipState {
  return {
    ...emptyRioState(),
    lastAct: 6,
    lastOutcome: 'success',
    flags: {
      ...emptyRioState().flags,
      secondmentPreference: 'stay',
      secondmentDecision: 'defer-with-date',
      familyDecisionAnnounced: true,
      decisionReclaimed: true,
      exclusivity: 'agreed',
      pace: 'dated',
      weddingTimeline: 'withdrawn',
      finalDecisionMade: true,
    },
    conflicts: REQUIRED_TOPICS.map((topic) => closedConflict(topic)),
    finalDecision: decision(),
    updatedAt: 1,
  };
}

function stateWith(
  opts: {
    flags?: Partial<RioFlags>;
    decision?: Partial<RioFinalDecision> | null;
    conflicts?: RioConflict[];
    boundaries?: RioBoundary[];
  } = {},
): RioRelationshipState {
  const state = baseState();
  if (opts.decision === null) state.finalDecision = null;
  else if (opts.decision) state.finalDecision = { ...decision(), ...opts.decision };
  if (opts.flags) state.flags = { ...state.flags, ...opts.flags };
  if (opts.conflicts) state.conflicts = opts.conflicts;
  if (opts.boundaries) state.boundaries = opts.boundaries;
  return state;
}

function pauseState(over: Partial<RioFinalDecision> = {}, flags: Partial<RioFlags> = {}): RioRelationshipState {
  return stateWith({
    decision: {
      kind: 'pause',
      hasDatedNextStep: true,
      revisit: 'after-secondment-answer',
      reason: 'secondment',
      ...over,
    },
    flags: { secondmentDecision: 'accept', weddingTimeline: 'shelved', ...flags },
  });
}

function endState(over: Partial<RioFinalDecision> = {}, flags: Partial<RioFlags> = {}): RioRelationshipState {
  return stateWith({
    decision: {
      kind: 'end',
      hasDatedNextStep: false,
      revisit: null,
      reason: 'pace',
      ...over,
    },
    flags: { exclusivity: 'declined', pace: 'open-ended', secondmentDecision: 'decline', weddingTimeline: 'unset', ...flags },
  });
}

test('§4.3 case 1: continue + both + dated + closed topics is E1', () => {
  assert.equal(resolveRioEnding(baseState()), 'said-it-plain');
});

test('§4.3 case 2: pause after secondment answer is E2', () => {
  assert.equal(resolveRioEnding(pauseState()), 'clean-parting');
});

test('§4.3 case 3: clean end for pace difference is E2', () => {
  assert.equal(resolveRioEnding(endState()), 'clean-parting');
});

test('§4.3 case 4: set-by-family wedding blocks both endings', () => {
  const state = stateWith({ flags: { weddingTimeline: 'set-by-family', decisionReclaimed: false } });
  assert.equal(resolveRioEnding(state), null);
});

test('§4.3 case 5: one-sided decision is not an ending', () => {
  assert.equal(resolveRioEnding(stateWith({ decision: { agreedBy: 'one-sided' } })), null);
});

test('§4.3 case 6: unrepaired harm blocks until repaired, then E2', () => {
  const harmed = pauseState({}, { unrepairedHarm: ['used-half-promise-as-weapon'] });
  assert.equal(resolveRioEnding(harmed), null);

  const repaired: RioRelationshipState = { ...harmed, flags: { ...harmed.flags, unrepairedHarm: [] } };
  assert.equal(resolveRioEnding(repaired), 'clean-parting');

  const harmedContinue = stateWith({ flags: { unrepairedHarm: ['pressed-after-soft-no'] } });
  assert.equal(resolveRioEnding(harmedContinue), null);
  const repairedContinue: RioRelationshipState = {
    ...harmedContinue,
    flags: { ...harmedContinue.flags, unrepairedHarm: [] },
  };
  assert.equal(resolveRioEnding(repairedContinue), 'said-it-plain');
});

test('§4.3 case 7: no final decision at maxTurns is not a named ending', () => {
  assert.equal(resolveRioEnding(stateWith({ decision: null })), null);
  assert.equal(resolveRioEnding(stateWith({ flags: { finalDecisionMade: false } })), null);
});

test('§4.3 case 8: an act-1 soft-no failure repaired later still reaches E1', () => {
  const repairedBoundary: RioBoundary = {
    id: 'b-pace',
    topic: 'pace',
    by: 'rio',
    atAct: 1,
    status: 'repaired',
    evidence: ev('rio-soft-no'),
    acceptedBy: ['learner', 'rio'],
    repair: ev('learner-retract'),
  };
  const earlyConflict = closedConflict('availability', { openedAtAct: 1, lastTouchedAtAct: 2 });
  const state = stateWith({
    boundaries: [repairedBoundary],
    conflicts: [...baseState().conflicts, earlyConflict],
    flags: { secondmentPreference: 'stay' },
  });
  assert.equal(resolveRioEnding(state), 'said-it-plain');
});

test('§4.4 path A: all-success continue line reaches E1', () => {
  const state = stateWith({
    flags: { secondmentPreference: 'stay', exclusivity: 'agreed', pace: 'dated' },
    conflicts: [...baseState().conflicts, closedConflict('availability', { openedAtAct: 1 })],
  });
  assert.equal(resolveRioEnding(state), 'said-it-plain');
});

test('§4.4 path B: partial line with acceptance + pause reaches E2', () => {
  const state = pauseState({}, { familyHalfPromiseDisclosed: false, secondmentPreference: 'go' });
  assert.equal(resolveRioEnding(state), 'clean-parting');
});

test('§4.4 path C: five acts of success can still end cleanly as E2', () => {
  const state = endState({}, { secondmentPreference: 'stay' });
  assert.equal(resolveRioEnding(state), 'clean-parting');
});

test('§4.4 path D: act-1 failure repaired, then continue reaches E1', () => {
  const crossedThenRepaired: RioBoundary = {
    id: 'b-contact',
    topic: 'contact',
    by: 'learner',
    atAct: 1,
    status: 'repaired',
    evidence: ev('learner-repeated-dates'),
    acceptedBy: ['learner', 'rio'],
    repair: ev('learner-apology'),
  };
  const state = stateWith({
    boundaries: [crossedThenRepaired],
    conflicts: [
      ...baseState().conflicts,
      closedConflict('availability', { openedAtAct: 1, shape: 'soft-no-unverified' }),
    ],
    flags: { secondmentPreference: 'stay' },
  });
  assert.equal(resolveRioEnding(state), 'said-it-plain');
});

test('all brakes return null, never a third ending', () => {
  const noAcceptance = decision();
  delete noAcceptance.acceptance;
  const missingAcceptance = stateWith();
  missingAcceptance.finalDecision = noAcceptance;

  const crossed: RioBoundary = {
    id: 'b-crossed',
    topic: 'secondment',
    by: 'learner',
    atAct: 4,
    status: 'crossed',
    evidence: ev('learner-pressed'),
    acceptedBy: [],
  };

  const openPace = stateWith({
    conflicts: baseState().conflicts.map((row) =>
      row.topic === 'pace' ? { ...row, status: 'open', resolution: undefined } : row,
    ),
  });

  const cases: Array<[string, RioRelationshipState]> = [
    ['finalDecision null', stateWith({ decision: null })],
    ['finalDecisionMade false', stateWith({ flags: { finalDecisionMade: false } })],
    ['agreedBy one-sided', stateWith({ decision: { agreedBy: 'one-sided' } })],
    ['both without acceptance', missingAcceptance],
    ['unrepaired harm', stateWith({ flags: { unrepairedHarm: ['pressed-secondment'] } })],
    ['crossed boundary', stateWith({ boundaries: [crossed] })],
    ['wedding set-by-family', stateWith({ flags: { weddingTimeline: 'set-by-family' } })],
    [
      'family announced but not reclaimed',
      stateWith({ flags: { familyDecisionAnnounced: true, decisionReclaimed: false } }),
    ],
    ['secondment undecided', stateWith({ flags: { secondmentDecision: 'undecided' } })],
    ['no conflicts at all', stateWith({ conflicts: [] })],
    ['an open pace conflict', openPace],
    ['E1 with exclusivity undefined', stateWith({ flags: { exclusivity: 'undefined' } })],
    ['E1 with open-ended pace', stateWith({ flags: { pace: 'open-ended' } })],
    ['E1 continue without a dated next step', stateWith({ decision: { hasDatedNextStep: false } })],
    [
      'pause without a dated next step',
      stateWith({ decision: { kind: 'pause', reason: 'pace', revisit: 'two-weeks', hasDatedNextStep: false } }),
    ],
    [
      'pause without a revisit date',
      stateWith({ decision: { kind: 'pause', reason: 'pace', revisit: null } }),
    ],
    [
      'end with a dated next step',
      stateWith({ decision: { kind: 'end', reason: 'pace', hasDatedNextStep: true } }),
    ],
    ['decision without a reason', stateWith({ decision: { kind: 'end', hasDatedNextStep: false, reason: null } })],
  ];

  for (const topic of REQUIRED_TOPICS) {
    cases.push([
      `missing closed ${topic}`,
      stateWith({ conflicts: baseState().conflicts.filter((row) => row.topic !== topic) }),
    ]);
  }

  for (const [name, state] of cases) {
    assert.equal(resolveRioEnding(state), null, name);
  }
});

test('return type is exactly the two ending ids or null', () => {
  const results: Array<RioEndingId | null> = [
    resolveRioEnding(baseState()),
    resolveRioEnding(pauseState()),
    resolveRioEnding(endState()),
    resolveRioEnding(stateWith({ decision: null })),
    resolveRioEnding(stateWith({ flags: { unrepairedHarm: ['pressed-secondment'] } })),
  ];
  for (const result of results) {
    assert.ok(result === 'said-it-plain' || result === 'clean-parting' || result === null);
  }
  assert.deepEqual(results, ['said-it-plain', 'clean-parting', 'clean-parting', null, null]);
});
