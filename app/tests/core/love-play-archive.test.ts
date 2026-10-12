/** 恋爱玩法设备端 slot 的导出/校验回归：它们不进 persist archive，导出是唯一能把它们带走的通道。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArchive } from '../../src/lib/archive';
import { clearLovePlaySlots, LOVE_CARRY_KEY, LOVE_PLAY_PREFIX } from '../../src/lib/love-carry-store';
import { decodeBackup, lovePlayBackup } from '../../src/lib/backup';
import { buildSession } from '../../src/lib/session-utils';
import { SCENARIOS } from '../../src/data/corpus';

const CARRY_KEY = LOVE_CARRY_KEY;
const seriesKey = (id: string) => `socialcoach.love-play.series.${id}`;
const slots = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() { return slots.size; },
    key: (index: number) => [...slots.keys()][index] ?? null,
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => { slots.set(key, value); },
    removeItem: (key: string) => { slots.delete(key); },
  },
});

/** 逐字按 `love-carry-store.ts` 的 LoveCarry 与 `love-series-progress.ts` 的 LoveSeriesProgress 写，
 *  但不 import 那两个文件：导出契约只认它们文档化的形状，读取口径一改就该由那两个模块自己的测试报出来。 */
const carry = {
  id: 'c1',
  text: '周三晚上打给你',
  lang: 'zh',
  cls: 'call',
  npcId: 'rio',
  npcName: { zh: 'Rio', en: 'Rio' },
  scenarioId: 'love-approach-soft-decline-reinvite',
  seriesId: 'love-arc-rio-clarify',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
  askCount: 2,
  lastAskedAt: 1_700_000_000_002,
  state: 'pending',
};
const progress = { completed: ['scene-a', 'scene-b'], lastScene: 'scene-b', outcome: { 'scene-a': 'success', 'scene-b': 'partial' } };
const wrap = (lovePlay: unknown) => JSON.stringify({ state: { sessions: [] }, version: 0, lovePlay });
const decodeLove = async (lovePlay: unknown) => decodeBackup(wrap(lovePlay));

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

test('export collects love-play slots by prefix and decode hands them back verbatim', async () => {
  slots.clear();
  slots.set(CARRY_KEY, JSON.stringify([carry]));
  slots.set(seriesKey('love-arc-rio-clarify'), JSON.stringify(progress));
  slots.set('socialcoach.llm.v1', '{"key":"sk-must-not-export"}');
  slots.set('socialcoach.v1', '{"sessions":[]}');
  const snapshot = lovePlayBackup();
  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot).sort(), [CARRY_KEY, seriesKey('love-arc-rio-clarify')].sort());
  assert.ok(!JSON.stringify(snapshot).includes('sk-must-not-export'), 'model keys never travel with the backup');
  const decoded = await decodeLove(snapshot);
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.equal(decoded.lovePlayOriginal, undefined);
  assert.deepEqual(Object.keys(decoded.lovePlay!).sort(), [CARRY_KEY, seriesKey('love-arc-rio-clarify')].sort());
  assert.deepEqual(JSON.parse(decoded.lovePlay![CARRY_KEY]), [carry]);
  assert.deepEqual(JSON.parse(decoded.lovePlay![seriesKey('love-arc-rio-clarify')]), progress);
});

test('the write-back the restore button performs puts the same slots on a wiped device', async () => {
  slots.clear();
  slots.set(CARRY_KEY, JSON.stringify([carry]));
  slots.set(seriesKey('love-arc-rio-clarify'), JSON.stringify(progress));
  const before = new Map(slots);
  const decoded = await decodeLove(lovePlayBackup());
  slots.clear();
  for (const [key, json] of Object.entries(decoded.lovePlay!)) slots.set(key, json);
  assert.deepEqual([...slots.keys()].sort(), [...before.keys()].sort());
  for (const [key, json] of before) assert.deepEqual(JSON.parse(slots.get(key)!), JSON.parse(json), key);
});

test('decoding only prepares the slots; the device is untouched until the restore button', async () => {
  slots.clear();
  slots.set(CARRY_KEY, JSON.stringify([carry]));
  slots.set(seriesKey('love-arc-rio-clarify'), JSON.stringify(progress));
  const untouched = new Map(slots);
  const decoded = await decodeLove(lovePlayBackup());
  assert.deepEqual([...slots.entries()], [...untouched.entries()], 'decoding must not write — only the restore button decides, and merge mode never shows it');
  assert.ok(Object.keys(decoded.lovePlay!).length === 2);
});

test('an empty device exports no lovePlay part and decodes as a backup without one', async () => {
  slots.clear();
  assert.equal(lovePlayBackup(), null);
  const decoded = await decodeLove(null);
  assert.equal(decoded.lovePlay, undefined);
  assert.equal(decoded.lovePlayIssue, undefined);
});

test('a corrupt carry entry is rejected instead of trusted', async () => {
  const bad = { ...carry, state: 'guilt' };
  const decoded = await decodeLove({ [CARRY_KEY]: [bad], [seriesKey('love-arc-rio-clarify')]: progress });
  assert.equal(decoded.lovePlayIssue, 'invalid');
  assert.equal(decoded.lovePlay![CARRY_KEY], undefined, 'the damaged carry slot is not written back');
  assert.deepEqual(JSON.parse(decoded.lovePlay![seriesKey('love-arc-rio-clarify')]), progress, 'a bad slot does not cost the rest');
  assert.deepEqual(JSON.parse(decoded.lovePlayOriginal!), { [CARRY_KEY]: [bad], [seriesKey('love-arc-rio-clarify')]: progress });
});

test('enum, stamp and id fields are checked one by one', async () => {
  const carryRejects = [
    { ...carry, lang: 'ja' },
    { ...carry, cls: 'gift' },
    { ...carry, createdAt: '1700000000000' },
    { ...carry, updatedAt: null },
    { ...carry, askCount: -1 },
    { ...carry, lastAskedAt: 1 / 0 },
    { ...carry, npcName: { zh: 'Rio' } },
    { ...carry, seriesId: 42 },
    { ...carry, id: '' },
  ];
  const progressRejects = [
    { ...progress, completed: ['scene-a', 7] },
    { ...progress, lastScene: null },
    { ...progress, outcome: { 'scene-a': 'mostly' } },
  ];
  for (const value of carryRejects) {
    const decoded = await decodeLove({ [CARRY_KEY]: [value] });
    assert.equal(decoded.lovePlayIssue, 'invalid', JSON.stringify(value));
    assert.equal(decoded.lovePlay, undefined, JSON.stringify(value));
  }
  for (const value of progressRejects) {
    const decoded = await decodeLove({ [seriesKey('love-arc-rio-clarify')]: value });
    assert.equal(decoded.lovePlayIssue, 'invalid', JSON.stringify(value));
    assert.equal(decoded.lovePlay, undefined, JSON.stringify(value));
  }
});

test('an unreadable slot is preserved as { unreadable } and reported', async () => {
  slots.clear();
  const raw = '[{"id":"c1","text":"周三晚上打给';
  slots.set(CARRY_KEY, raw);
  slots.set(seriesKey('love-arc-rio-clarify'), JSON.stringify(progress));
  const snapshot = lovePlayBackup()!;
  assert.deepEqual(snapshot[CARRY_KEY], { unreadable: raw });
  const decoded = await decodeLove(snapshot);
  assert.equal(decoded.lovePlayIssue, 'unreadable');
  assert.equal(decoded.lovePlay![CARRY_KEY], undefined, 'bytes the app cannot parse are not written back');
  assert.ok(decoded.lovePlay![seriesKey('love-arc-rio-clarify')], 'the healthy line still restores');
  assert.deepEqual(JSON.parse(decoded.lovePlayOriginal!), { [CARRY_KEY]: { unreadable: raw }, [seriesKey('love-arc-rio-clarify')]: progress });
});

test('an oversized promise sentence is refused', async () => {
  const decoded = await decodeLove({ [CARRY_KEY]: [{ ...carry, text: '我'.repeat(501) }] });
  assert.equal(decoded.lovePlayIssue, 'invalid');
  assert.equal(decoded.lovePlay, undefined);
  assert.ok(decoded.lovePlayOriginal!.includes('我'.repeat(501)), 'the refused bytes still reach the download');
});

test('a shape that does not match its key is refused', async () => {
  const swapped = await decodeLove({ [seriesKey('love-arc-rio-clarify')]: [carry] });
  assert.equal(swapped.lovePlayIssue, 'invalid');
  assert.equal(swapped.lovePlay, undefined);
  const arraySlot = await decodeLove({ [CARRY_KEY]: progress });
  assert.equal(arraySlot.lovePlayIssue, 'invalid');
});

test('a foreign key inside lovePlay is never written back to another namespace', async () => {
  const decoded = await decodeLove({ 'socialcoach.llm.v1': { key: 'sk-steal' }, [CARRY_KEY]: [carry] });
  assert.equal(decoded.lovePlayIssue, 'invalid');
  assert.deepEqual(Object.keys(decoded.lovePlay!), [CARRY_KEY]);
});

test('restoring love slots cannot smuggle a scored field into the device', async () => {
  const pollutedCarry = { ...carry, proficiency: 5, loveProficiency: { charm: 5 }, stars: 3, practiceDays: ['2026-10-13'] };
  const pollutedProgress = { ...progress, proficiency: 5, stars: 3 };
  const decoded = await decodeLove({ [CARRY_KEY]: [pollutedCarry], [seriesKey('love-arc-rio-clarify')]: pollutedProgress });
  assert.equal(decoded.lovePlayIssue, undefined);
  const restoredCarry = decoded.lovePlay![CARRY_KEY];
  const restoredProgress = decoded.lovePlay![seriesKey('love-arc-rio-clarify')];
  for (const json of [restoredCarry, restoredProgress]) {
    for (const forbidden of ['proficiency', 'loveProficiency', 'stars', 'practiceDays']) {
      assert.ok(!json.includes(forbidden), `${forbidden} never reaches localStorage`);
    }
  }
  assert.deepEqual(JSON.parse(restoredCarry), [carry]);
  assert.deepEqual(JSON.parse(restoredProgress), progress);
  assert.deepEqual(decoded.archive.proficiency, {});
  assert.deepEqual(decoded.archive.loveProficiency, {});
  assert.deepEqual(decoded.archive.practiceDays, []);
});

test('a backup without a lovePlay part decodes exactly as it did before', async () => {
  const scenario = SCENARIOS.find((s) => s.id === 'love-approach-hobby-event')!;
  const session = buildSession(scenario, 'love-play', 'zh');
  const legacy = JSON.stringify({ state: { sessions: [session] }, version: 0 });
  const decoded = await decodeBackup(legacy);
  assert.equal(decoded.lovePlay, undefined);
  assert.equal(decoded.lovePlayOriginal, undefined);
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.equal(decoded.dinner, undefined);
  assert.equal(decoded.dinnerOriginal, undefined);
  assert.equal(decoded.dinnerIssue, undefined);
  assert.deepEqual(decoded.archive.sessions.map((s) => s.id), [session.id]);
  // 这些 slot 留在设备端，不进 persist archive：把它们塞进 store 会把版本迁移那条老路重新走一遍。
  const smuggled = parseArchive({ sessions: [session], lovePlay: { [CARRY_KEY]: [carry] } });
  assert.ok(!('lovePlay' in smuggled));
});

test('the carry key is defined once and always sits inside the prefix the exporter scans', () => {
  // 导出是按 LOVE_PLAY_PREFIX 扫 localStorage 的。键名一旦和那个前缀分叉，承接数据会
  // 「读得到、写得了、就是导不出」——这类丢失没有任何报错，只能在常量层面钉住。
  assert.ok(CARRY_KEY.startsWith(LOVE_PLAY_PREFIX), 'carry key must be under the scanned prefix');
  assert.ok(seriesKey('love-arc-rio-clarify').startsWith(LOVE_PLAY_PREFIX), 'series key must be under the scanned prefix');
  assert.notEqual(CARRY_KEY, seriesKey('love-arc-rio-clarify'));
});

test('erasing everything really erases the love slots, promises included', () => {
  // 这些 slot 不进 persist archive，store 的 reset() 覆盖不到；承诺存的是用户亲手打的一句话，
  // 所以「删除所有数据」漏掉这一半就等于：练过什么、答应过什么，删了还在设备上。
  localStorage.setItem(CARRY_KEY, JSON.stringify([{ ...carry, text: '我这周一定打给你' }]));
  localStorage.setItem(seriesKey('love-arc-eve-after-no'), JSON.stringify({ completed: ['love-reject-shared-circle'], lastScene: 'love-reject-shared-circle', outcome: {} }));
  localStorage.setItem('socialcoach.dinner', 'keep-me');
  assert.ok(lovePlayBackup(), 'the slots are exportable before the wipe');
  // 同一个 slot Map 被本文件多个用例共用，所以这里只按「擦除前应有多少」来断言，不写死条数。
  const before = [...slots.keys()].filter((k) => k.startsWith(LOVE_PLAY_PREFIX)).length;

  const removed = clearLovePlaySlots();

  assert.ok(before >= 2);
  assert.equal(removed, before);
  assert.equal(localStorage.getItem(CARRY_KEY), null);
  assert.equal(localStorage.getItem(seriesKey('love-arc-eve-after-no')), null);
  assert.equal(localStorage.getItem('socialcoach.dinner'), 'keep-me', 'the wipe may not reach outside its own prefix');
  assert.equal(lovePlayBackup(), null);
});
