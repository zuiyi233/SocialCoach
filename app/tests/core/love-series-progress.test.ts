/** G10：系列进度 v2 的离线回归 —— v1 迁移、v2 落盘、lastAct 取最大、坏档读空、未知结局过滤。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLoveSeriesProgress, writeLoveSeriesProgress } from '../../src/lib/love-series-progress';

const RIO = 'love-arc-rio-clarify';
const KEY = `socialcoach.love-play.series.${RIO}`;
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

const EMPTY = { v: 2, completed: [], lastScene: '', outcome: {} } as const;
const reset = () => slots.delete(KEY);
const putRaw = (value: unknown) => slots.set(KEY, JSON.stringify(value));
const stored = (): Record<string, unknown> => JSON.parse(slots.get(KEY) ?? '{}');

test('a v1 record (no version field) is read as v2 in memory without rewriting the slot', () => {
  reset();
  putRaw({ completed: ['scene-a'], lastScene: 'scene-a', outcome: { 'scene-a': 'success' } });
  const before = slots.get(KEY);
  assert.deepEqual(readLoveSeriesProgress(RIO), {
    v: 2,
    completed: ['scene-a'],
    lastScene: 'scene-a',
    outcome: { 'scene-a': 'success' },
  }, 'v1 fields survive verbatim; only the version tag is added');
  assert.equal(slots.get(KEY), before, 'reading is a lazy migration: it must not rewrite the device slot');
  reset();
});

test('an explicit v1 also migrates, and an empty device reads as an empty v2 record', () => {
  reset();
  assert.deepEqual(readLoveSeriesProgress(RIO), EMPTY);
  putRaw({ v: 1, completed: ['scene-a'], lastScene: 'scene-a', outcome: {} });
  assert.deepEqual(readLoveSeriesProgress(RIO), { v: 2, completed: ['scene-a'], lastScene: 'scene-a', outcome: {} });
  reset();
});

test('writing persists v2 and merges with whatever the v1 slot already held', () => {
  reset();
  putRaw({ completed: ['scene-a'], lastScene: 'scene-a', outcome: { 'scene-a': 'partial' } });
  const next = writeLoveSeriesProgress(RIO, 'scene-b', 'success', 2);
  assert.deepEqual(next, {
    v: 2,
    completed: ['scene-a', 'scene-b'],
    lastScene: 'scene-b',
    outcome: { 'scene-a': 'partial', 'scene-b': 'success' },
    lastAct: 2,
  });
  assert.deepEqual(stored(), next, 'the device slot is now v2, not a v1 shape with extra fields');
  reset();
});

test('lastAct is the largest completed act: replaying an earlier act never moves it back', () => {
  reset();
  writeLoveSeriesProgress(RIO, 'scene-b', 'success', 2);
  writeLoveSeriesProgress(RIO, 'scene-a', 'success', 1);
  assert.equal(readLoveSeriesProgress(RIO).lastAct, 2, 'an earlier replay keeps the furthest act');
  writeLoveSeriesProgress(RIO, 'scene-d', 'partial', 4);
  assert.equal(readLoveSeriesProgress(RIO).lastAct, 4);
  writeLoveSeriesProgress(RIO, 'scene-e', 'failure');
  assert.equal(readLoveSeriesProgress(RIO).lastAct, 4, 'a caller that does not know the act keeps the old value');
  reset();
});

test('an act number of 0 or a non-positive value is “unknown”, not act zero', () => {
  reset();
  writeLoveSeriesProgress(RIO, 'scene-a', 'success', 0);
  assert.equal(readLoveSeriesProgress(RIO).lastAct, undefined, '0-based indices must not be stored as an act');
  writeLoveSeriesProgress(RIO, 'scene-b', 'success', -3);
  assert.equal(readLoveSeriesProgress(RIO).lastAct, undefined);
  writeLoveSeriesProgress(RIO, 'scene-c', 'success', 2.9);
  assert.equal(readLoveSeriesProgress(RIO).lastAct, 2, 'fractional input is truncated, not rounded up');
  reset();
});

test('a corrupt slot or bad fields read as empty instead of throwing', () => {
  reset();
  slots.set(KEY, '{"completed": [');
  assert.deepEqual(readLoveSeriesProgress(RIO), EMPTY, 'bad JSON');
  putRaw(null);
  assert.deepEqual(readLoveSeriesProgress(RIO), EMPTY, 'null is not a record');
  putRaw([1, 2, 3]);
  assert.deepEqual(readLoveSeriesProgress(RIO), EMPTY, 'an array is not a record');
  putRaw({ v: 3, completed: ['scene-a'], lastScene: 'scene-a', outcome: {} });
  assert.deepEqual(readLoveSeriesProgress(RIO), EMPTY, 'an unknown future version is not guessed at');
  putRaw({ v: 2, completed: 'scene-a', lastScene: 7, outcome: [], lastAct: -1 });
  assert.deepEqual(readLoveSeriesProgress(RIO), EMPTY, 'wrong field types fall back to the empty shape');
  reset();
});

test('an unknown outcome value is filtered instead of trusted', () => {
  reset();
  putRaw({
    completed: ['scene-a', 'scene-b', 9],
    lastScene: 'scene-b',
    outcome: { 'scene-a': 'success', 'scene-b': 'great', '': 'failure', 'scene-c': 'partial' },
    lastAct: 2,
  });
  assert.deepEqual(readLoveSeriesProgress(RIO), {
    v: 2,
    completed: ['scene-a', 'scene-b'],
    lastScene: 'scene-b',
    outcome: { 'scene-a': 'success', 'scene-c': 'partial' },
    lastAct: 2,
  });
  reset();
});
