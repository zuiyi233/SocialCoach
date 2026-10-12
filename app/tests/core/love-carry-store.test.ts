/** P2 承接存储的离线回归：候选来源、原话逐字、上限只挤终态、损坏读空、按线+人匹配。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARRY_LINES, CARRY_LINES_UNCLASSIFIED, CARRY_QUOTE_MARKER } from '../../src/data/corpus/love-carry-lines';
import {
  LOVE_CARRY_CAP,
  loveCarryAskLine,
  loveCarryCandidates,
  loveCarryLine,
  markLoveCarryAsked,
  pendingLoveCarryForOpening,
  readLoveCarries,
  saveLoveCarry,
  type LoveCarry,
  type LoveCarryDraft,
} from '../../src/lib/love-carry-store';

const KEY = 'socialcoach.love-play.carry';
const slots = new Map<string, string>();
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
const stubStorage = () =>
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => slots.get(key) ?? null,
      setItem: (key: string, value: string) => { slots.set(key, value); },
      removeItem: (key: string) => { slots.delete(key); },
    },
    configurable: true,
  });
stubStorage();

const draft = (over: Partial<LoveCarryDraft> = {}): LoveCarryDraft => ({
  text: '周三晚上打给你',
  lang: 'zh',
  cls: 'call',
  npcId: 'rio',
  npcName: { zh: 'Rio', en: 'Rio' },
  scenarioId: 'love-approach-soft-decline-reinvite',
  seriesId: 'love-arc-rio-clarify',
  ...over,
});

const entry = (over: Partial<LoveCarry>): LoveCarry => ({
  id: 'c1',
  text: '周三晚上打给你',
  lang: 'zh',
  cls: 'call',
  npcId: 'rio',
  npcName: { zh: 'Rio', en: 'Rio' },
  scenarioId: 'love-approach-soft-decline-reinvite',
  seriesId: 'love-arc-rio-clarify',
  createdAt: 1,
  updatedAt: 1,
  askCount: 0,
  state: 'pending',
  ...over,
});

const reset = () => slots.delete(KEY);
const putRaw = (value: unknown) => slots.set(KEY, JSON.stringify(value));
const stored = (): LoveCarry[] => JSON.parse(slots.get(KEY) ?? '[]');
/** 断言写入成功并取出那条，省掉每个用例里的解包噪音。 */
const saved = (over: Partial<LoveCarryDraft> = {}): LoveCarry => {
  const res = saveLoveCarry(draft(over));
  assert.equal(res.ok, true);
  return (res as { ok: true; carry: LoveCarry }).carry;
};

test('only free-typed sentences become candidates — a tapped option never does', () => {
  const turns = [
    { via: 'pick' as const, text: '我下周找个时间给你打电话' },
    { via: 'type' as const, text: '周三晚上打给你' },
    { via: 'pick' as const, text: '那先这样吧' },
    { via: 'type' as const, text: '   ' },
    { via: 'type' as const, text: '周三晚上打给你' },
  ];
  assert.deepEqual(loveCarryCandidates(turns), ['周三晚上打给你'], 'typed only, trimmed, deduped, in scene order');
  assert.ok(!loveCarryCandidates(turns).includes('我下周找个时间给你打电话'), 'option text must never reach the candidate list');
  assert.deepEqual(loveCarryCandidates([{ via: 'pick', text: 'a' }, { via: 'pick', text: 'b' }]), [], 'an all-options scene offers nothing');
});

test('{{quote}} takes the learner’s words verbatim, at clause length and at sentence length', () => {
  const clause = entry({ text: '周三打给你' });
  const sentence = entry({
    text: '我这周排一下日历，周三晚上八点打给你，这次不挂断',
  });
  // 学习者自己打上句号是常态：模板不能在引号后面再补一个标点。
  const stopped = entry({ text: '我这周一定打给你。' });
  const stoppedEn = entry({ text: 'I will call you this week.', lang: 'en' });
  for (const carry of [clause, sentence, stopped, stoppedEn]) {
    const zh = loveCarryAskLine(carry, 'zh')!;
    const en = loveCarryAskLine(carry, 'en')!;
    assert.equal(zh, CARRY_LINES.call.ask.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => carry.text));
    assert.ok(zh.includes(carry.text), 'the whole sentence survives, uncut');
    assert.ok(!zh.includes(CARRY_QUOTE_MARKER));
    // 模板自己已经带了引号：原话不得被再包一层。
    assert.equal(zh.split('「').length - 1, CARRY_LINES.call.ask.text.zh.split('「').length - 1, 'no second layer of quotes');
    assert.equal(en.split('“').length - 1, CARRY_LINES.call.ask.text.en.split('“').length - 1);
    // 模板按界面语言取，原话永不翻译。
    assert.equal(en, CARRY_LINES.call.ask.text.en.replaceAll(CARRY_QUOTE_MARKER, () => carry.text));
    assert.ok(en.includes(carry.text), 'the learner’s Chinese words stay Chinese inside the English line');
    assert.notEqual(en, zh);
    assert.ok(!/」[。！？；]/.test(zh), `the zh template closes the quote with a terminator: ${zh}`);
    assert.ok(!/”[.!?;:]/.test(en), `the en template closes the quote with a terminator: ${en}`);
  }
});

test('a carry already quoted once is opened with the askAgain wording', () => {
  assert.equal(loveCarryAskLine(entry({}), 'zh'), loveCarryLine(entry({}), 'ask', 'zh'));
  const twice = entry({ askCount: 2 });
  assert.equal(loveCarryAskLine(twice, 'zh'), loveCarryLine(twice, 'askAgain', 'zh'));
  assert.notEqual(loveCarryAskLine(twice, 'zh'), loveCarryAskLine(entry({}), 'zh'), 'surfacing 2 must not repeat the surfacing-1 sentence');
});

test('a learner sentence containing replacement markers is inserted literally', () => {
  const carry = entry({ text: '我说过 $& 也要打给你' });
  assert.ok(loveCarryAskLine(carry, 'zh')!.includes('$&'), 'no template echo from $-patterns');
});

test('an unlabelled carry falls back to the unclassified line, and a bogus class reads as unlabelled', () => {
  const unlabelled = entry({ cls: null });
  assert.equal(
    loveCarryAskLine(unlabelled, 'zh'),
    CARRY_LINES_UNCLASSIFIED.ask.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => unlabelled.text),
  );
  putRaw([entry({ cls: 'sleeping-call' as LoveCarry['cls'] })]);
  assert.equal(readLoveCarries()[0].cls, null, 'an unknown class is not guessed — it degrades to “no label”');
  reset();
});

test('the cap prunes only terminal entries, oldest updatedAt first', () => {
  reset();
  const pendings = Array.from({ length: LOVE_CARRY_CAP - 2 }, (_, i) => entry({ id: `p${i}`, scenarioId: `scene-${i}`, updatedAt: 100 + i }));
  putRaw([...pendings, entry({ id: 'old-kept', scenarioId: 'scene-kept', state: 'kept', updatedAt: 1 }), entry({ id: 'new-dropped', scenarioId: 'scene-dropped', state: 'dropped', updatedAt: 50 })]);
  const res = saveLoveCarry(draft({ scenarioId: 'brand-new-scene' }));
  assert.equal(res.ok, true);
  const after = stored();
  assert.equal(after.length, LOVE_CARRY_CAP, 'stays at the cap');
  assert.ok(!after.some((c) => c.id === 'old-kept'), 'the oldest answered line makes room');
  assert.ok(after.some((c) => c.id === 'new-dropped'), 'the newer terminal line is not the one dropped');
  assert.equal(after.filter((c) => c.state === 'pending').length, pendings.length + 1, 'every pending survives the prune');
});

test('a full slot of pending lines refuses the write instead of eating one of them', () => {
  reset();
  const pendings = Array.from({ length: LOVE_CARRY_CAP }, (_, i) => entry({ id: `p${i}`, scenarioId: `scene-${i}`, updatedAt: 100 + i }));
  putRaw(pendings);
  const res = saveLoveCarry(draft({ scenarioId: 'brand-new-scene' }));
  assert.deepEqual(res, { ok: false, reason: 'full' });
  assert.deepEqual(stored().map((c) => c.id), pendings.map((c) => c.id), 'nothing was overwritten or dropped');
});

test('a legacy slot already over the cap compacts when it can and refuses when it cannot', () => {
  reset();
  const pendings = Array.from({ length: LOVE_CARRY_CAP - 1 }, (_, i) => entry({ id: `p${i}`, scenarioId: `scene-${i}`, updatedAt: 100 + i }));
  putRaw([...pendings, entry({ id: 'k1', scenarioId: 'scene-k1', state: 'kept', updatedAt: 1 }), entry({ id: 'k2', scenarioId: 'scene-k2', state: 'dropped', updatedAt: 2 })]);
  assert.equal(saveLoveCarry(draft({ scenarioId: 'brand-new-scene' })).ok, true, 'two answered lines make room for one more');
  const after = stored();
  assert.equal(after.length, LOVE_CARRY_CAP, 'the oversized slot is pressed back to the cap');
  assert.ok(after.some((c) => c.scenarioId === 'brand-new-scene'));
  assert.equal(after.filter((c) => c.state === 'pending').length, LOVE_CARRY_CAP, 'every pending line survived');

  // 22 条里只有 2 条终态：压不回 20，那就整条拒绝，而不是白删两条还超限。
  reset();
  putRaw([...Array.from({ length: LOVE_CARRY_CAP }, (_, i) => entry({ id: `p${i}`, scenarioId: `scene-${i}`, updatedAt: 100 + i })), entry({ id: 'k1', scenarioId: 'scene-k1', state: 'kept', updatedAt: 1 }), entry({ id: 'k2', scenarioId: 'scene-k2', state: 'dropped', updatedAt: 2 })]);
  assert.deepEqual(saveLoveCarry(draft({ scenarioId: 'brand-new-scene' })), { ok: false, reason: 'full' });
  assert.equal(stored().length, LOVE_CARRY_CAP + 2, 'a refused write leaves the slot untouched');

  // 改写本场自己那句不增长，所以照写，顺手把 slot 压回上限。
  const before = stored().filter((c) => c.state === 'pending').length;
  const rewritten = saved({ scenarioId: 'scene-0', text: '周五晚上八点，我打给你' });
  const compacted = stored();
  assert.equal(compacted.length, LOVE_CARRY_CAP, 'the replace still writes, trimming only answered lines');
  assert.equal(compacted.find((c) => c.scenarioId === 'scene-0')?.text, rewritten.text, 'the learner’s new wording wins');
  assert.equal(compacted.filter((c) => c.state === 'pending').length, before, 'no pending line was lost to the compaction');
  reset();
});

test('replaying one scene rewrites its own pending carry instead of piling up duplicates', () => {
  reset();
  const first = saved();
  markLoveCarryAsked(first.id);
  const second = saved({ text: '周五晚上八点，我打给你' });
  const list = stored();
  assert.equal(list.length, 1, 'one scene leaves one carry');
  assert.equal(list[0].text, '周五晚上八点，我打给你', 'the newer own words replace the older');
  assert.equal(second.id, first.id, 'same entry, not a fresh one');
  assert.equal(list[0].askCount, 1, 'the ask history belongs to the scene, not to the old wording');
  assert.equal(list[0].state, 'pending');
  reset();
});

test('a carry is matched by line and speaker, never by which act it came from', () => {
  reset();
  saveLoveCarry(draft({ scenarioId: 'love-approach-soft-decline-reinvite' }));
  const hit = pendingLoveCarryForOpening('love-arc-rio-clarify', 'rio', 'love-family-expectation-clash');
  assert.ok(hit, 'any earlier act of the same line with the same speaker is quotable at a later act');
  assert.equal(pendingLoveCarryForOpening('love-arc-rio-clarify', 'rio', 'love-approach-soft-decline-reinvite'), null, 'a scene never quotes its own carry back at itself');
  assert.equal(pendingLoveCarryForOpening('love-arc-eve-after-no', 'rio', 'love-family-expectation-clash'), null, 'another line’s carry stays there');
  assert.equal(pendingLoveCarryForOpening('love-arc-rio-clarify', 'eve', 'love-family-expectation-clash'), null, 'another character never claims this promise');
  assert.equal(pendingLoveCarryForOpening('love-arc-rio-clarify', 'rio', 'love-family-expectation-clash')?.state, 'pending');
  putRaw([...readLoveCarries(), entry({ id: 'answered', scenarioId: 'other-scene', state: 'kept', updatedAt: 9e12 })]);
  assert.equal(pendingLoveCarryForOpening('love-arc-rio-clarify', 'rio', 'love-family-expectation-clash')?.id, hit?.id, 'an answered carry is not asked again');
  reset();
});

test('the newest carry of a line wins when several are pending', () => {
  reset();
  putRaw([entry({ id: 'older', scenarioId: 'scene-a', updatedAt: 5 }), entry({ id: 'newer', scenarioId: 'scene-b', updatedAt: 9 })]);
  assert.equal(pendingLoveCarryForOpening('love-arc-rio-clarify', 'rio', 'love-family-expectation-clash')?.id, 'newer');
});

test('a corrupt slot reads as empty and never throws', () => {
  slots.set(KEY, '{"text": "not an array"');
  assert.deepEqual(readLoveCarries(), []);
  for (const bad of [null, 7, {}, [null, 1, 'x'], [{}], [{ id: 'x' }]]) {
    putRaw(bad);
    assert.deepEqual(readLoveCarries(), [], `${JSON.stringify(bad)} is not a carry`);
  }
  // 认不出 state 就整条丢：猜一个态等于决定「还要不要问这个人」。
  putRaw([entry({ state: 'maybe' as LoveCarry['state'] })]);
  assert.deepEqual(readLoveCarries(), []);
  // 线 id 坏了不丢原话，只当它没编线——谁都不会来问它。
  putRaw([entry({ seriesId: 42 as unknown as string | null })]);
  assert.equal(readLoveCarries()[0].seriesId, null);
  reset();
});

test('a storage that refuses writes degrades silently', () => {
  reset();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    },
    configurable: true,
  });
  assert.deepEqual(readLoveCarries(), [], 'unreadable storage reads as empty');
  assert.equal(saveLoveCarry(draft()).ok, true, 'the scene keeps working; the carry just does not persist');
  assert.doesNotThrow(() => markLoveCarryAsked('c1'));
  stubStorage();
  reset();
});

test('asking spends the budget once per day, not once per render', () => {
  reset();
  const realNow = Date.now;
  try {
    const first = saved();
    const t0 = first.createdAt;
    Date.now = () => t0 + 1000;
    markLoveCarryAsked(first.id);
    markLoveCarryAsked(first.id);
    assert.equal(stored()[0].askCount, 1, 'reopening the same act twice in one sitting still spends one ask');
    assert.equal(stored()[0].lastAskedAt, t0 + 1000, 'the timestamp refreshes even when the count does not');
    Date.now = () => t0 + 25 * 60 * 60 * 1000;
    markLoveCarryAsked(first.id);
    assert.equal(stored()[0].askCount, 2, 'a day later it counts again');
  } finally {
    Date.now = realNow;
    reset();
  }
});
