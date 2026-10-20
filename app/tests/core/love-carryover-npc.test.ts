/**
 * G06 离线回归：承接句的 NPC 层——同线同 NPC 已答过（kept / open）的承诺用 CARRY_LINES
 * 的 kept / open 格在下一幕开场回头提。解析顺序（场景内 → NPC 层 → 系列/幕级）、
 * 撞名安全（seriesId + speakerOf 的说话人 id，跨线不认领）、纯读不花提问额度。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Lang } from '../../src/data/taxonomy';
import { CARRY_LINES, CARRY_LINES_UNCLASSIFIED, CARRY_QUOTE_MARKER } from '../../src/data/corpus/love-carry-lines';
import { LOVE_SERIES, loveSeriesById } from '../../src/data/corpus/love-series';
import {
  LOVE_CARRYOVER,
  LOVE_CARRYOVER_SCENE,
  markLoveCarryoverShown,
  peekLoveCarryoverForScene,
  pickLoveNpcCarryover,
} from '../../src/lib/love-carryover';
import { answerLoveCarry, readLoveCarries, saveLoveCarry, type LoveCarryDraft } from '../../src/lib/love-carry-store';
import { readLoveSeriesProgress, writeLoveSeriesProgress } from '../../src/lib/love-series-progress';
import { defaultLearnerId, speakerOf } from '../../src/lib/session-utils';

const RIO = 'love-arc-rio-clarify';
const EVE = 'love-arc-eve-after-no';
const QUOTE = '周三晚上打给你';

/** 设备端 slot 的最小替身：NPC 层只读 localStorage，这里不引入任何 DOM。 */
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

const CARRY_KEY = 'socialcoach.love-play.carry';
const seriesKey = (id: string) => `socialcoach.love-play.series.${id}`;
const reset = () => {
  slots.delete(CARRY_KEY);
  slots.delete(seriesKey(RIO));
  slots.delete(seriesKey(EVE));
};

const actsOf = (id: string) => loveSeriesById(id)!.scenarios.map((s) => s.id);
/** 开场匹配用的说话人 id 就是 speakerOf 的这一个，不做任何别的身份推断。 */
const speakerOfAct = (seriesId: string, scenarioId: string) => {
  const scenario = loveSeriesById(seriesId)!.scenarios.find((s) => s.id === scenarioId)!;
  return speakerOf(scenario, defaultLearnerId(scenario)).id;
};

const carryLineOf = (lang: Lang, cls: LoveCarryDraft['cls'] = 'call', resolution: 'kept' | 'open' = 'kept') =>
  (cls ? CARRY_LINES[cls][resolution] : CARRY_LINES_UNCLASSIFIED[resolution]).text[lang].replaceAll(CARRY_QUOTE_MARKER, () => QUOTE);

const saveCarry = (over: Partial<LoveCarryDraft> = {}) => {
  const res = saveLoveCarry({
    text: QUOTE,
    lang: 'zh',
    cls: 'call',
    npcId: 'rio',
    npcName: { zh: 'Rio', en: 'Rio' },
    scenarioId: actsOf(RIO)[0],
    seriesId: RIO,
    ...over,
  });
  assert.equal(res.ok, true);
  return (res as { ok: true; carry: { id: string } }).carry;
};

/** 直接控制 updatedAt / 状态的条目（避开 Date.now 毫秒碰撞），只用于「取哪一条」的断言。 */
const putRaw = (list: unknown[]) => slots.set(CARRY_KEY, JSON.stringify(list));
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  text: QUOTE,
  lang: 'zh',
  cls: 'call',
  npcId: 'rio',
  npcName: { zh: 'Rio', en: 'Rio' },
  scenarioId: actsOf(RIO)[0],
  seriesId: RIO,
  createdAt: 1,
  updatedAt: 1,
  askCount: 0,
  state: 'kept',
  ...over,
});

test('an answered promise is quoted at the next act opening through the NPC layer', () => {
  reset();
  const eveActs = actsOf(EVE);
  assert.ok(eveActs.length >= 2, 'the fixture needs at least two acts');
  const npc = speakerOfAct(EVE, eveActs[1]);
  const carry = saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(carry.id, 'kept');
  const opened = peekLoveCarryoverForScene(EVE, eveActs[1], 'zh');
  assert.equal(opened.text, carryLineOf('zh'), 'the kept cell of CARRY_LINES comes back with the quote verbatim');
  assert.ok(opened.text!.includes(QUOTE), 'the learner’s own words stay inside the line');
  assert.equal(opened.carryId, carry.id, 'the peek names the promise it quotes');
  assert.equal(opened.actIndex, 1);
  assert.equal(peekLoveCarryoverForScene(EVE, eveActs[1], 'en').text, carryLineOf('en'), 'the template follows the interface language');
  reset();
});

test('an open answer quotes the open cell, and a dropped promise is never quoted again', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[1]);
  const carry = saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(carry.id, 'open');
  assert.equal(peekLoveCarryoverForScene(EVE, eveActs[1], 'zh').text, carryLineOf('zh', 'call', 'open'));
  answerLoveCarry(carry.id, 'dropped');
  assert.equal(peekLoveCarryoverForScene(EVE, eveActs[1], 'zh').text, null, '「不再问了」之后 NPC 不再回头提');
  reset();
});

test('resolution order: the scene hand-off table outranks the NPC layer', () => {
  reset();
  const rioActs = actsOf(RIO);
  const carry = saveCarry({ scenarioId: rioActs[0], npcId: speakerOfAct(RIO, rioActs[1]) });
  answerLoveCarry(carry.id, 'kept');
  writeLoveSeriesProgress(RIO, rioActs[0], 'success');
  const opened = peekLoveCarryoverForScene(RIO, rioActs[1], 'zh');
  assert.equal(opened.text, LOVE_CARRYOVER_SCENE[`${RIO}:${rioActs[0]}`].success.zh, '场景内专属句优先于 NPC 层');
  assert.equal(opened.carryId, null, 'the outcome-table quote names no carry');
  reset();
});

test('resolution order: the NPC layer outranks the series fallback', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[1]);
  const carry = saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(carry.id, 'kept');
  writeLoveSeriesProgress(EVE, eveActs[0], 'failure');
  const opened = peekLoveCarryoverForScene(EVE, eveActs[1], 'zh');
  assert.equal(opened.text, carryLineOf('zh'));
  assert.notEqual(opened.text, LOVE_CARRYOVER[EVE].failure.zh, 'NPC 层在通用结局句之前');
  assert.equal(opened.outcome, 'failure', 'the outcome still rides along for the eyebrow label');
  reset();
});

test('the NPC layer fires even when the previous act has no recorded outcome', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[1]);
  const carry = saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(carry.id, 'kept');
  assert.equal(readLoveSeriesProgress(EVE).outcome[eveActs[0]] ?? null, null);
  assert.ok(peekLoveCarryoverForScene(EVE, eveActs[1], 'zh').text, 'no outcome does not silence the promise callback');
  reset();
});

test('a pending promise still outranks the NPC layer', () => {
  reset();
  const eveActs = actsOf(EVE);
  assert.ok(eveActs.length >= 3, 'the fixture needs three acts to park two carries apart');
  const npc = speakerOfAct(EVE, eveActs[1]);
  saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: npc, npcName: { zh: npc, en: npc }, text: '周五下班来找你' });
  const answered = saveCarry({ seriesId: EVE, scenarioId: eveActs[2], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(answered.id, 'kept');
  const opened = peekLoveCarryoverForScene(EVE, eveActs[1], 'zh');
  assert.ok(opened.text!.includes('周五下班来找你'), 'the un-answered promise is what the opening quotes');
  assert.notEqual(opened.carryId, answered.id, 'the kept carry stays behind the pending one');
  reset();
});

test('tess-style id collisions stay inside their own line: seriesId + speaker matching, no identity guessing', () => {
  reset();
  const rioActs = actsOf(RIO);
  const eveActs = actsOf(EVE);
  const rioNpc = speakerOfAct(RIO, rioActs[1]);
  const inRio = saveCarry({ seriesId: RIO, scenarioId: rioActs[0], npcId: rioNpc, npcName: { zh: rioNpc, en: rioNpc }, text: '这条属于 RIO 线' });
  answerLoveCarry(inRio.id, 'kept');
  // 同一个 npcId 挂到另一条线上（tess 撞名的形状）：跨线绝不认领。
  const inEve = saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: rioNpc, npcName: { zh: rioNpc, en: rioNpc }, text: '这条属于 EVE 线' });
  answerLoveCarry(inEve.id, 'kept');
  assert.equal(peekLoveCarryoverForScene(RIO, rioActs[2], 'zh').carryId, inRio.id, 'RIO 只引用自己线里的那句');
  assert.ok(!peekLoveCarryoverForScene(RIO, rioActs[2], 'zh').text!.includes('这条属于 EVE 线'));
  // EVE 线的说话人不是这个人：同 id 也不能替别的角色开口。
  assert.equal(peekLoveCarryoverForScene(EVE, eveActs[1], 'zh').text, null);
  reset();
});

test('a scene never quotes its own answered carry back at itself', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[1]);
  const own = saveCarry({ seriesId: EVE, scenarioId: eveActs[1], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(own.id, 'kept');
  assert.equal(peekLoveCarryoverForScene(EVE, eveActs[1], 'zh').text, null);
  reset();
});

test('the opening act has no past: no NPC layer there either', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[0]);
  const carry = saveCarry({ seriesId: EVE, scenarioId: eveActs[1], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(carry.id, 'kept');
  assert.deepEqual(peekLoveCarryoverForScene(EVE, eveActs[0], 'zh'), { text: null, outcome: null, actIndex: 0, carryId: null });
  reset();
});

test('a character-swapping line never gets an NPC-layer callback', () => {
  reset();
  const scattered = LOVE_SERIES.find((s) => !s.continuous && s.scenarios.length > 1);
  assert.ok(scattered, 'the corpus is expected to keep at least one non-continuous romantic line');
  const ids = scattered.scenarios.map((s) => s.id);
  const next = scattered.scenarios[1];
  const speaker = speakerOf(next, defaultLearnerId(next));
  const carry = saveCarry({ seriesId: scattered.id, scenarioId: ids[0], npcId: speaker.id, npcName: speaker.name });
  answerLoveCarry(carry.id, 'kept');
  assert.equal(peekLoveCarryoverForScene(scattered.id, ids[1], 'zh').text, null, '换人的线里声称记得上一句是对「谁在说话」的假话');
  assert.equal(peekLoveCarryoverForScene(scattered.id, ids[1], 'en').text, null);
  reset();
});

test('several answered carries of one line resolve to the most recently updated one', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[1]);
  putRaw([
    entry({ id: 'older', seriesId: EVE, npcId: npc, scenarioId: eveActs[0], updatedAt: 5, text: '较早那句' }),
    entry({ id: 'newer', seriesId: EVE, npcId: npc, scenarioId: eveActs[0], updatedAt: 9, text: '较新那句' }),
  ]);
  // 同场景同人共用一个 characterKey，这里用 putRaw 摆出两条只为断言排序。
  const picked = pickLoveNpcCarryover(EVE, npc, eveActs[1], 'zh');
  assert.equal(picked?.carryId, 'newer');
  assert.equal(picked?.text, CARRY_LINES.call.kept.text.zh.replaceAll(CARRY_QUOTE_MARKER, () => '较新那句'));
  reset();
});

test('peeking the NPC layer is a pure read; only the explicit mark touches the ledger', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[1]);
  const carry = saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: npc, npcName: { zh: npc, en: npc } });
  answerLoveCarry(carry.id, 'kept');
  const before = readLoveCarries().find((c) => c.id === carry.id);
  peekLoveCarryoverForScene(EVE, eveActs[1], 'zh');
  peekLoveCarryoverForScene(EVE, eveActs[1], 'en');
  assert.deepEqual(readLoveCarries().find((c) => c.id === carry.id), before, 'peek 不写 askCount / lastAskedAt');
  markLoveCarryoverShown(carry.id);
  const marked = readLoveCarries().find((c) => c.id === carry.id)!;
  assert.equal(marked.state, 'kept', 'the mark never answers on the learner’s behalf');
  assert.equal(marked.askCount, 1, 'the shown line counts exactly once');
  reset();
});

test('an unlabelled answered promise uses the unclassified cell', () => {
  reset();
  const eveActs = actsOf(EVE);
  const npc = speakerOfAct(EVE, eveActs[1]);
  const carry = saveCarry({ seriesId: EVE, scenarioId: eveActs[0], npcId: npc, npcName: { zh: npc, en: npc }, cls: null });
  answerLoveCarry(carry.id, 'kept');
  assert.equal(peekLoveCarryoverForScene(EVE, eveActs[1], 'zh').text, carryLineOf('zh', null));
  reset();
});
