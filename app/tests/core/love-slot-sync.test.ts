/** G04: carry / series / story 三条写路径的跨标签页（storage）与同标签页（CustomEvent）通知。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOVE_CARRY_KEY,
  clearLoveCarrySlot,
  readLoveCarries,
  saveLoveCarry,
  type LoveCarryDraft,
} from '../../src/lib/love-carry-store';
import {
  clearLoveSeriesProgressSlot,
  loveSeriesProgressKey,
  readLoveSeriesProgress,
  writeLoveSeriesProgress,
} from '../../src/lib/love-series-progress';
import {
  LOVE_STORY_KEY,
  clearLoveStorySlot,
  emptyLoveStoryStore,
  readLoveStoryStore,
  writeLoveStoryStore,
} from '../../src/lib/love-story';
import { subscribeLoveSlots } from '../../src/lib/love-slot-events';

const SERIES = 'love-arc-rio-clarify';
const SERIES_KEY = loveSeriesProgressKey(SERIES);
const slots = new Map<string, string>();
const bus = new EventTarget();
let quota = false;

Object.defineProperty(globalThis, 'window', { value: bus, configurable: true });
const stubStorage = () =>
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => slots.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (quota) throw new DOMException('quota', 'QuotaExceededError');
        slots.set(key, value);
      },
      removeItem: (key: string) => slots.delete(key),
    },
    configurable: true,
  });
stubStorage();

const draft: LoveCarryDraft = {
  text: '周三晚上打给你',
  lang: 'zh',
  cls: 'call',
  npcId: 'rio',
  npcName: { zh: 'Rio', en: 'Rio' },
  scenarioId: 'love-approach-soft-decline-reinvite',
  seriesId: SERIES,
};

const reset = () => {
  slots.clear();
  quota = false;
};

/** 订阅一次，把 key 记下来；调用方负责 off()。 */
const watch = () => {
  const seen: (string | null)[] = [];
  const off = subscribeLoveSlots((key) => seen.push(key));
  return { seen, off };
};

test('a successful carry write notifies once; a corrupt slot refuses without notifying', () => {
  reset();
  const { seen, off } = watch();
  try {
    assert.equal(saveLoveCarry(draft).ok, true);
    assert.deepEqual(seen, [LOVE_CARRY_KEY]);

    slots.set(LOVE_CARRY_KEY, '{"text": "not an array"');
    const before = slots.get(LOVE_CARRY_KEY);
    assert.deepEqual(saveLoveCarry(draft), { ok: false, reason: 'corrupt' });
    assert.equal(slots.get(LOVE_CARRY_KEY), before, 'the corrupt bytes are never overwritten');
    assert.deepEqual(seen, [LOVE_CARRY_KEY], 'a refused write never notifies');
  } finally {
    off();
    reset();
  }
});

test('a failed carry write due to storage throws does not notify either', () => {
  reset();
  const { seen, off } = watch();
  try {
    quota = true;
    assert.deepEqual(saveLoveCarry(draft), { ok: false, reason: 'unavailable' });
    assert.deepEqual(seen, []);
  } finally {
    off();
    reset();
  }
});

test('series writes notify with their own key, and a corrupt slot refuses silently', () => {
  reset();
  const { seen, off } = watch();
  try {
    const ok = writeLoveSeriesProgress(SERIES, 'scene-a', 'success', 1);
    assert.equal(ok.ok, true);
    assert.deepEqual(seen, [SERIES_KEY]);

    slots.set(SERIES_KEY, '{"completed": [');
    const before = slots.get(SERIES_KEY);
    const refused = writeLoveSeriesProgress(SERIES, 'scene-b', 'success', 2);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.issue, 'corrupt');
    assert.equal(slots.get(SERIES_KEY), before);
    assert.deepEqual(seen, [SERIES_KEY], 'the failed write did not announce a change');
  } finally {
    off();
    reset();
  }
});

test('story writes notify with the story key; a quota failure does not', () => {
  reset();
  const { seen, off } = watch();
  try {
    assert.equal(writeLoveStoryStore(emptyLoveStoryStore()).ok, true);
    assert.deepEqual(seen, [LOVE_STORY_KEY]);

    quota = true;
    const res = writeLoveStoryStore(emptyLoveStoryStore());
    assert.deepEqual(res, { ok: false, reason: 'quota' });
    assert.deepEqual(seen, [LOVE_STORY_KEY], 'nothing landed, so nothing is announced');
  } finally {
    off();
    reset();
  }
});

test('explicit clears notify with their slot key and leave every reader empty', () => {
  reset();
  const { seen, off } = watch();
  try {
    assert.equal(saveLoveCarry(draft).ok, true);
    assert.equal(writeLoveSeriesProgress(SERIES, 'scene-a', 'success', 1).ok, true);
    assert.equal(writeLoveStoryStore(emptyLoveStoryStore()).ok, true);
    seen.length = 0;

    clearLoveCarrySlot();
    clearLoveSeriesProgressSlot(SERIES);
    clearLoveStorySlot();

    assert.deepEqual(seen, [LOVE_CARRY_KEY, SERIES_KEY, LOVE_STORY_KEY]);
    assert.deepEqual(readLoveCarries(), []);
    assert.deepEqual(readLoveSeriesProgress(SERIES), { v: 2, completed: [], lastScene: '', outcome: {} });
    assert.deepEqual(readLoveStoryStore(), { status: 'empty' });
  } finally {
    off();
    reset();
  }
});
