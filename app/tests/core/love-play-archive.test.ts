/** 恋爱玩法设备端 slot 的导出/校验回归：它们不进 persist archive，导出是唯一能把它们带走的通道。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LovePlaySchema, LoveMemoryStoreSchema, parseArchive, parseLovePlaySlot } from '../../src/lib/archive';
import { clearLovePlaySlots, LOVE_CARRY_KEY, LOVE_PLAY_PREFIX } from '../../src/lib/love-carry-store';
import { LOVE_MEMORY_KEY } from '../../src/lib/love-memory';
import { LOVE_STORY_KEY } from '../../src/lib/love-story';
import { decodeBackup, lovePlayBackup } from '../../src/lib/backup';
import { buildSession } from '../../src/lib/session-utils';
import { SCENARIOS } from '../../src/data/corpus';

const CARRY_KEY = LOVE_CARRY_KEY;
const STORY_KEY = LOVE_STORY_KEY;
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
/** 按 `love-story.ts` 的 `LoveStoryStore` 字面写：整份 store 只有一个 slot，形状与恢复口径同源。 */
const storySave = {
  v: 1,
  scenarioId: 'love-approach-soft-decline-reinvite',
  seriesId: 'love-arc-rio-clarify',
  lang: 'zh',
  status: 'playing',
  history: [{ id: 'm-npc-1', role: 'npc', characterId: 'rio', text: '你终于来了。', lang: 'zh', ts: 1 }],
  currentLineId: 'm-npc-1',
  options: [
    { zh: '我来了。', en: 'I am here.' },
    { zh: '路上堵车。', en: 'Traffic was bad.' },
  ],
  emotion: 'neutral',
  stance: 50,
  carryover: false,
  learnerLines: [],
  outcome: null,
  recorded: false,
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};
const story = { v: 3, revision: 2, saves: { [storySave.scenarioId]: storySave }, slots: {}, records: [], routes: {}, relationships: {}, updatedAt: 1_700_000_000_002 };
/** 阅读层两个 slot：形状与 story 完全不同，但同在前缀下，必须跟备份一起走。 */
const read = { v: 1, seen: { 'love-approach-soft-decline-reinvite:1a2b3c:8': 1_700_000_000_003 }, updatedAt: 1_700_000_000_003 };
const reader = { v: 1, textSize: 'lg', speed: 'fast', auto: true, skipRead: true, reduceMotion: false };
const READ_KEY = `${LOVE_PLAY_PREFIX}read`;
const READER_KEY = `${LOVE_PLAY_PREFIX}reader`;
/** 陪伴层记忆 slot：按 `love-memory.ts` 的 LoveMemoryStore 字面写，与恢复口径同源。 */
const memoryEntry = {
  id: 'm1',
  kind: 'promise',
  text: '周三晚上打给你',
  sourceText: '周三晚上打给你',
  sourceMessageIds: ['carry:c1'],
  seriesId: 'love-arc-rio-clarify',
  characterKey: 'rio',
  createdAt: 1_700_000_000_010,
  updatedAt: 1_700_000_000_011,
  locked: false,
};
const memory = { v: 1, revision: 1, entries: { 'love-arc-rio-clarify:rio': [memoryEntry] }, updatedAt: 1_700_000_000_012 };
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

test('the story slot is exported and restored verbatim beside carry and series', async () => {
  slots.clear();
  slots.set(CARRY_KEY, JSON.stringify([carry]));
  slots.set(seriesKey('love-arc-rio-clarify'), JSON.stringify(progress));
  slots.set(STORY_KEY, JSON.stringify(story));
  const snapshot = lovePlayBackup();
  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot).sort(), [CARRY_KEY, STORY_KEY, seriesKey('love-arc-rio-clarify')].sort());
  const decoded = await decodeLove(snapshot);
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.equal(decoded.lovePlayOriginal, undefined);
  assert.deepEqual(JSON.parse(decoded.lovePlay![STORY_KEY]), story);
  assert.deepEqual(JSON.parse(decoded.lovePlay![CARRY_KEY]), [carry]);
  assert.deepEqual(JSON.parse(decoded.lovePlay![seriesKey('love-arc-rio-clarify')]), progress);
});

test('a v1 story store is migrated to v3 with an empty slot table and empty relationships', async () => {
  slots.clear();
  const v1 = { v: 1, revision: 4, saves: story.saves, records: [], routes: {}, updatedAt: 1_700_000_000_004 };
  slots.set(STORY_KEY, JSON.stringify(v1));
  const decoded = await decodeLove(lovePlayBackup());
  assert.equal(decoded.lovePlayIssue, undefined);
  const restored = JSON.parse(decoded.lovePlay![STORY_KEY]);
  assert.equal(restored.v, 3);
  assert.deepEqual(restored.slots, {});
  assert.deepEqual(restored.relationships, {});
  assert.deepEqual(restored.saves, story.saves);
});

test('read index and reader settings travel under their own keys', async () => {
  slots.clear();
  slots.set(READ_KEY, JSON.stringify(read));
  slots.set(READER_KEY, JSON.stringify(reader));
  const snapshot = lovePlayBackup();
  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot).sort(), [READ_KEY, READER_KEY].sort());
  const decoded = await decodeLove(snapshot);
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.deepEqual(JSON.parse(decoded.lovePlay![READ_KEY]), read);
  assert.deepEqual(JSON.parse(decoded.lovePlay![READER_KEY]), reader);
});

test('read and reader slots cannot be swapped with one another', () => {
  assert.equal(parseLovePlaySlot(READ_KEY, read).success, true);
  assert.equal(parseLovePlaySlot(READER_KEY, reader).success, true);
  assert.equal(parseLovePlaySlot(READ_KEY, reader).success, false);
  assert.equal(parseLovePlaySlot(READER_KEY, read).success, false);
  assert.equal(parseLovePlaySlot(READ_KEY, story).success, false);
  assert.equal(parseLovePlaySlot(READER_KEY, { ...reader, textSize: 'huge' }).success, false);
});


test('the whole-table schema accepts carry, story, series, read, reader and memory side by side', () => {
  const result = LovePlaySchema.safeParse({
    [CARRY_KEY]: [carry],
    [STORY_KEY]: story,
    [seriesKey('love-arc-rio-clarify')]: progress,
    [READ_KEY]: read,
    [READER_KEY]: reader,
    [LOVE_MEMORY_KEY]: memory,
  });
  assert.equal(result.success, true);
  const saved = result.data as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(saved).sort(),
    [CARRY_KEY, STORY_KEY, seriesKey('love-arc-rio-clarify'), READ_KEY, READER_KEY, LOVE_MEMORY_KEY].sort(),
  );
});

test('each love slot is parsed by the shape its key names', () => {
  assert.equal(parseLovePlaySlot(CARRY_KEY, [carry]).success, true);
  assert.equal(parseLovePlaySlot(STORY_KEY, story).success, true);
  assert.equal(parseLovePlaySlot(seriesKey('love-arc-rio-clarify'), progress).success, true);
  assert.equal(parseLovePlaySlot(STORY_KEY, { unreadable: '{' }).success, true, 'raw bytes stay recoverable');
  assert.equal(parseLovePlaySlot('socialcoach.love-play.unknown', progress).success, false);
  assert.equal(parseLovePlaySlot(STORY_KEY, progress).success, false);
  assert.equal(parseLovePlaySlot(STORY_KEY, [carry]).success, false);
  assert.equal(parseLovePlaySlot(CARRY_KEY, story).success, false);
  assert.equal(parseLovePlaySlot(seriesKey('love-arc-rio-clarify'), story).success, false);
  assert.equal(parseLovePlaySlot(seriesKey('love-arc-rio-clarify'), [carry]).success, false);
});

test('a damaged story slot is quarantined without blocking carry or series', async () => {
  const damaged = { ...story, saves: { 'not-the-scenario': storySave } };
  const decoded = await decodeLove({ [CARRY_KEY]: [carry], [seriesKey('love-arc-rio-clarify')]: progress, [STORY_KEY]: damaged });
  assert.equal(decoded.lovePlayIssue, 'invalid');
  assert.equal(decoded.lovePlay![STORY_KEY], undefined, 'the broken story is not written back');
  assert.deepEqual(JSON.parse(decoded.lovePlay![CARRY_KEY]), [carry], 'one bad slot does not cost the healthy ones');
  assert.deepEqual(JSON.parse(decoded.lovePlay![seriesKey('love-arc-rio-clarify')]), progress);
  assert.ok(decoded.lovePlayOriginal!.includes(STORY_KEY), 'the refused bytes still reach the download');
});

test('a story slot whose bytes could not be parsed is preserved as unreadable', async () => {
  const decoded = await decodeLove({ [STORY_KEY]: { unreadable: '{"v":1' }, [CARRY_KEY]: [carry] });
  assert.equal(decoded.lovePlayIssue, 'unreadable');
  assert.equal(decoded.lovePlay![STORY_KEY], undefined, 'raw bytes are not written back as data');
  assert.deepEqual(JSON.parse(decoded.lovePlay![CARRY_KEY]), [carry]);
  assert.deepEqual(JSON.parse(decoded.lovePlayOriginal!), { [STORY_KEY]: { unreadable: '{"v":1' }, [CARRY_KEY]: [carry] });
});

test('a healthy story slot survives the per-slot fallback triggered by another slot', async () => {
  const decoded = await decodeLove({ [CARRY_KEY]: [{ ...carry, state: 'guilt' }], [STORY_KEY]: story });
  assert.equal(decoded.lovePlayIssue, 'invalid');
  assert.deepEqual(JSON.parse(decoded.lovePlay![STORY_KEY]), story);
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

test('v2 series progress keeps v and lastAct through restore', async () => {
  const v2 = { v: 2, completed: ['scene-a'], lastScene: 'scene-a', outcome: { 'scene-a': 'success' }, lastAct: 3 };
  const decoded = await decodeLove({ [seriesKey('love-arc-rio-clarify')]: v2 });
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.deepEqual(JSON.parse(decoded.lovePlay![seriesKey('love-arc-rio-clarify')]), v2, 'Zod must not strip the v2 fields');
  const outOfRange = await decodeLove({ [seriesKey('love-arc-rio-clarify')]: { ...v2, lastAct: 7 } });
  assert.equal(outOfRange.lovePlayIssue, 'invalid');
});

test('a carry with characterKey survives while old carries without it still restore', async () => {
  const keyed = { ...carry, characterKey: 'love-approach-soft-decline-reinvite:rio' };
  const decoded = await decodeLove({ [CARRY_KEY]: [keyed] });
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.deepEqual(JSON.parse(decoded.lovePlay![CARRY_KEY]), [keyed]);
  const legacy = await decodeLove({ [CARRY_KEY]: [carry] });
  assert.equal(legacy.lovePlayIssue, undefined);
  assert.deepEqual(JSON.parse(legacy.lovePlay![CARRY_KEY]), [carry]);
});

test('a shape that does not match its key is refused', async () => {
  const cases: [string, unknown][] = [
    [seriesKey('love-arc-rio-clarify'), [carry]],
    [CARRY_KEY, progress],
    [STORY_KEY, [carry]],
    [STORY_KEY, progress],
    [CARRY_KEY, story],
    [seriesKey('love-arc-rio-clarify'), story],
    ['socialcoach.love-play.unknown', progress],
  ];
  for (const [key, value] of cases) {
    const decoded = await decodeLove({ [key]: value });
    assert.equal(decoded.lovePlayIssue, 'invalid', key);
    assert.equal(decoded.lovePlay, undefined, key);
  }
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
  localStorage.setItem(STORY_KEY, JSON.stringify(story));
  localStorage.setItem(LOVE_MEMORY_KEY, JSON.stringify(memory));
  localStorage.setItem('socialcoach.dinner', 'keep-me');
  assert.ok(lovePlayBackup(), 'the slots are exportable before the wipe');
  // 同一个 slot Map 被本文件多个用例共用，所以这里只按「擦除前应有多少」来断言，不写死条数。
  const before = [...slots.keys()].filter((k) => k.startsWith(LOVE_PLAY_PREFIX)).length;

  const removed = clearLovePlaySlots();

  assert.ok(before >= 4);
  assert.equal(removed, before);
  assert.equal(localStorage.getItem(CARRY_KEY), null);
  assert.equal(localStorage.getItem(seriesKey('love-arc-eve-after-no')), null);
  assert.equal(localStorage.getItem(STORY_KEY), null, 'the story slot sits under the same prefix and must go with it');
  assert.equal(localStorage.getItem(LOVE_MEMORY_KEY), null, 'the memory slot is under the same prefix too (G16)');
  assert.equal(localStorage.getItem('socialcoach.dinner'), 'keep-me', 'the wipe may not reach outside its own prefix');
  assert.equal(lovePlayBackup(), null);
});

test('the memory slot is exported and restored verbatim beside the other love slots', async () => {
  slots.clear();
  slots.set(CARRY_KEY, JSON.stringify([carry]));
  slots.set(STORY_KEY, JSON.stringify(story));
  slots.set(LOVE_MEMORY_KEY, JSON.stringify(memory));
  const snapshot = lovePlayBackup();
  assert.ok(snapshot);
  assert.deepEqual(Object.keys(snapshot).sort(), [CARRY_KEY, STORY_KEY, LOVE_MEMORY_KEY].sort());
  const decoded = await decodeLove(snapshot);
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.deepEqual(JSON.parse(decoded.lovePlay![LOVE_MEMORY_KEY]), memory, 'memory entries travel byte for byte');
  assert.deepEqual(JSON.parse(decoded.lovePlay![CARRY_KEY]), [carry]);
});

test('a memory slot that fails validation is quarantined without blocking the others', async () => {
  const broken = { ...memory, entries: { 's:r': [{ ...memoryEntry, locked: 'yes' }] } };
  const decoded = await decodeLove({ [LOVE_MEMORY_KEY]: broken, [CARRY_KEY]: [carry] });
  assert.equal(decoded.lovePlayIssue, 'invalid');
  assert.equal(decoded.lovePlay![LOVE_MEMORY_KEY], undefined, 'the broken memory slot is not written back');
  assert.deepEqual(JSON.parse(decoded.lovePlay![CARRY_KEY]), [carry]);
  assert.ok(decoded.lovePlayOriginal!.includes(LOVE_MEMORY_KEY));
});

test('memory caps and enums are checked like every other slot', () => {
  assert.equal(parseLovePlaySlot(LOVE_MEMORY_KEY, memory).success, true);
  assert.equal(LoveMemoryStoreSchema.safeParse(memory).success, true);
  assert.equal(parseLovePlaySlot(STORY_KEY, memory).success, false, 'memory bytes under the story key are refused');
  assert.equal(parseLovePlaySlot(CARRY_KEY, memory).success, false);
  assert.equal(parseLovePlaySlot(LOVE_MEMORY_KEY, story).success, false);
  assert.equal(parseLovePlaySlot(LOVE_MEMORY_KEY, { ...memory, v: 2 }).success, false, 'unknown version is refused, not migrated');
  assert.equal(
    parseLovePlaySlot(LOVE_MEMORY_KEY, { ...memory, entries: { 's:r': [{ ...memoryEntry, kind: 'mood' }] } }).success,
    false,
    'an unknown memory kind is refused',
  );
  assert.equal(
    parseLovePlaySlot(LOVE_MEMORY_KEY, {
      ...memory,
      entries: { 's:r': Array.from({ length: 41 }, (_, i) => ({ ...memoryEntry, id: `m${i}` })) },
    }).success,
    false,
    'a scope over the store cap is refused',
  );
  assert.equal(
    parseLovePlaySlot(LOVE_MEMORY_KEY, { ...memory, entries: { 's:r': [{ ...memoryEntry, text: '长'.repeat(501) }] } }).success,
    false,
    'a memory longer than the store cap is refused',
  );
  assert.equal(
    parseLovePlaySlot(LOVE_MEMORY_KEY, { ...memory, entries: { 's:r': [{ ...memoryEntry, sourceMessageIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }] } }).success,
    false,
    'more evidence pointers than the store can write are refused',
  );
});

test('restoring memory slots cannot smuggle a scored field into the device', async () => {
  const polluted = { ...memory, entries: { 'love-arc-rio-clarify:rio': [{ ...memoryEntry, proficiency: 5, stars: 3 }] } };
  const decoded = await decodeLove({ [LOVE_MEMORY_KEY]: polluted });
  assert.equal(decoded.lovePlayIssue, undefined);
  const json = decoded.lovePlay![LOVE_MEMORY_KEY];
  for (const forbidden of ['proficiency', 'loveProficiency', 'stars', 'practiceDays']) {
    assert.ok(!json.includes(forbidden), `${forbidden} never reaches the memory slot`);
  }
  assert.deepEqual(JSON.parse(json), memory, 'zod strips the pollution and the rest travels verbatim');
});
