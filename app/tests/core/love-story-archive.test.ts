/** G03/G05：设置页导出与恢复前下载共用同一个信封；导出→擦除→写回后 story/carry/series 都能再读回来。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseArchive } from '../../src/lib/archive';
import { buildBackupPayload, decodeBackup, downloadArchive } from '../../src/lib/backup';
import { LOVE_CARRY_KEY, readLoveCarries } from '../../src/lib/love-carry-store';
import { readLoveSeriesProgress } from '../../src/lib/love-series-progress';
import { LOVE_STORY_KEY, readLoveStoryStore } from '../../src/lib/love-story';

const settingsSource = readFileSync(new URL('../../src/app/settings/page.tsx', import.meta.url), 'utf8');
const recoverySource = readFileSync(new URL('../../src/components/StorageRecovery.tsx', import.meta.url), 'utf8');
const backupSource = readFileSync(new URL('../../src/lib/backup.ts', import.meta.url), 'utf8');

const slots = new Map<string, string>();
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
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

const CARRY_KEY = LOVE_CARRY_KEY;
const STORY_KEY = LOVE_STORY_KEY;
const seriesKey = (id: string) => `socialcoach.love-play.series.${id}`;
const SERIES = 'love-arc-rio-clarify';

const carry = {
  id: 'c1',
  text: '周三晚上打给你',
  lang: 'zh',
  cls: 'call',
  npcId: 'rio',
  npcName: { zh: 'Rio', en: 'Rio' },
  scenarioId: 'love-approach-soft-decline-reinvite',
  seriesId: SERIES,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
  askCount: 2,
  lastAskedAt: 1_700_000_000_002,
  state: 'pending',
};
const progress = { v: 2, completed: ['scene-a', 'scene-b'], lastScene: 'scene-b', outcome: { 'scene-a': 'success', 'scene-b': 'partial' }, lastAct: 2 };
const storySave = {
  v: 1,
  scenarioId: 'love-approach-soft-decline-reinvite',
  seriesId: SERIES,
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

/** 与 useApp 的持久化快照同形：store 自己的 hydrated / saveIssue 等字段不属于档案，parseArchive 会 strip。 */
const appState = {
  profile: { name: '林', bio: '', goals: ['communication'], contexts: ['romantic'], lang: 'zh', createdAt: 1 },
  onboardingLang: 'zh',
  proficiency: { communication: 2.5 },
  loveProficiency: { approach: 3 },
  sessions: [],
  customScenarios: [],
  bookmarks: ['case-1'],
  practiceDays: ['2026-10-01'],
  todaySessionId: null,
  todayDate: null,
  settings: { tts: false, theme: 'dark', voiceEngine: 'system', loveCarry: false },
  patternInsight: {
    result: { found: true, pattern: '先澄清再答应', why: '两次都先问清范围', evidence: [], nextStep: '继续澄清' },
    from: ['s1'],
    at: 1,
  },
  hydrated: true,
  storageIssue: null,
  saveIssue: null,
};

test('both export paths share one envelope builder and carry every parsed archive field', async () => {
  slots.clear();
  const payload = buildBackupPayload(parseArchive(appState));
  assert.deepEqual(Object.keys(payload).sort(), ['dinner3d', 'loveCards', 'lovePlay', 'state', 'version']);
  assert.equal(payload.version, 0);
  const decoded = await decodeBackup(JSON.stringify(payload));
  assert.deepEqual(decoded.archive.settings, appState.settings, 'settings must survive export → decode');
  assert.deepEqual(decoded.archive.loveProficiency, { approach: 3 }, 'love progress must survive export → decode');
  assert.deepEqual(decoded.archive.proficiency, { communication: 2.5 });
  assert.equal(decoded.archive.onboardingLang, 'zh');
  assert.equal(decoded.archive.patternInsight?.result.pattern, '先澄清再答应');
  assert.deepEqual(decoded.archive.bookmarks, ['case-1']);
  assert.deepEqual(decoded.archive.practiceDays, ['2026-10-01']);
});

test('the settings page and the pre-restore download call the same builder', () => {
  assert.match(settingsSource, /buildBackupPayload\(\s*parseArchive\(useApp\.getState\(\)\)\s*\)/);
  assert.ok(!settingsSource.includes('lovePlayBackup'), 'the page no longer assembles the love envelope by hand');
  assert.match(backupSource, /downloadArchive\(archive:Archive\)\{[\s\S]{0,300}buildBackupPayload\(archive\)/);
});

test('both erase entry points verify the love wipe instead of trusting a silent clear', () => {
  for (const [name, source] of [['settings', settingsSource], ['recovery', recoverySource]] as const) {
    assert.ok(source.includes('clearLovePlaySlots()'), `${name} clears the love slots`);
    assert.match(source, /const before\s*=\s*countLovePlaySlots\(\)/, `${name} scans before clearing`);
    assert.match(source, /countLovePlaySlots\(\)\s*!==\s*0/, `${name} scans after clearing`);
    assert.ok(source.includes('设备数据未能清除'), `${name} says the wipe failed instead of claiming success`);
    assert.ok(!source.includes('localStorage.clear('), `${name} must not nuke keys outside the love prefix`);
  }
});

test('downloadArchive writes exactly the payload buildBackupPayload returns', async () => {
  slots.clear();
  slots.set(CARRY_KEY, JSON.stringify([carry]));
  slots.set(STORY_KEY, JSON.stringify(story));
  slots.set(seriesKey(SERIES), JSON.stringify(progress));
  const archive = parseArchive({ sessions: [] });
  const expected = JSON.stringify(buildBackupPayload(archive), null, 2);
  let captured: Blob | undefined;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => { captured = blob; return 'blob:test'; },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ href: '', download: '', click() {} }) },
  });
  downloadArchive(archive);
  assert.ok(captured);
  assert.equal(await captured.text(), expected);
});

test('export, wipe and write-back restore story, carry and series through their own readers', async () => {
  slots.clear();
  slots.set(CARRY_KEY, JSON.stringify([carry]));
  slots.set(STORY_KEY, JSON.stringify(story));
  slots.set(seriesKey(SERIES), JSON.stringify(progress));
  const decoded = await decodeBackup(JSON.stringify(buildBackupPayload(parseArchive({ sessions: [] }))));
  assert.equal(decoded.lovePlayIssue, undefined);
  assert.equal(decoded.lovePlayOriginal, undefined);
  assert.deepEqual(Object.keys(decoded.lovePlay!).sort(), [CARRY_KEY, STORY_KEY, seriesKey(SERIES)].sort());

  slots.clear();
  for (const [key, json] of Object.entries(decoded.lovePlay!)) slots.set(key, json);

  assert.deepEqual(readLoveCarries(), [carry]);
  assert.deepEqual(readLoveSeriesProgress(SERIES), progress);
  const read = readLoveStoryStore();
  assert.equal(read.status, 'ok');
  if (read.status === 'ok') assert.deepEqual(read.store, story);
});
