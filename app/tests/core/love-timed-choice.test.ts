/** P3 呈现层：限时选择状态机（spec §4.5 / 拍板 Q6）——开关双闸、起表口径、超时只报一次、默认关。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  idleLoveTimedChoice,
  loveSilenceEvent,
  loveTimedChoiceEnabled,
  loveTimedChoiceEndsAt,
  loveTimedChoiceLapsed,
  loveTimedChoiceRemainingMs,
  reduceLoveTimedChoice,
  LOVE_TIMED_CHOICE_MS,
  LOVE_TIMED_CHOICE_SECONDS,
} from '../../src/lib/love-timed-choice';
import { DEFAULT_LOVE_READER, readLoveReaderSettings, writeLoveReaderSettings } from '../../src/lib/love-reader-settings';

const CLIMAX = 'love-rio-deadline-night';
const OTHER = 'love-rio-family-settled';

test('the switch is a double gate: off in settings or outside the climax means never', () => {
  assert.equal(loveTimedChoiceEnabled({ timedChoice: false }, CLIMAX), false, 'off in settings = never, even in the climax');
  assert.equal(loveTimedChoiceEnabled({ timedChoice: true }, OTHER), false, 'on in settings = only the registered climax scene');
  assert.equal(loveTimedChoiceEnabled({ timedChoice: true }, CLIMAX), true);
  assert.equal(loveTimedChoiceEnabled({ timedChoice: true }, 'not-a-love-scene'), false);
});

test('the reader setting defaults to off and survives a round-trip', () => {
  assert.equal(DEFAULT_LOVE_READER.timedChoice, false, 'the product default is off (Q6)');
  assert.equal(DEFAULT_LOVE_READER.v, 1, 'no version bump: old stored settings keep reading');
});

test('stored reader settings keep timedChoice off unless it was explicitly on', () => {
  const slots = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => slots.get(key) ?? null,
      setItem: (key: string, value: string) => {
        slots.set(key, value);
      },
      removeItem: (key: string) => {
        slots.delete(key);
      },
    },
  });
  const KEY = 'socialcoach.love-play.reader';

  // 旧档：没有这个字段 → 关。
  slots.set(KEY, JSON.stringify({ v: 1, textSize: 'md', speed: 'normal', auto: false, skipRead: false, reduceMotion: false }));
  assert.equal(readLoveReaderSettings().timedChoice, false, 'a v1 save without the field reads as off');

  // 垃圾值一律当关：识别不出的值绝不猜成开。
  for (const bad of ['yes', 1, null]) {
    slots.set(KEY, JSON.stringify({ v: 1, timedChoice: bad }));
    assert.equal(readLoveReaderSettings().timedChoice, false, `${String(bad)} is not on`);
  }

  // 打开 → 写 → 读回仍是开；其余设置不受影响。
  const next = { ...readLoveReaderSettings(), timedChoice: true };
  assert.equal(writeLoveReaderSettings(next), true);
  const back = readLoveReaderSettings();
  assert.equal(back.timedChoice, true);
  assert.equal(back.textSize, 'md');
  assert.equal(back.auto, false);

  // 坏 JSON → 默认（关）。
  slots.set(KEY, '{broken');
  assert.deepEqual(readLoveReaderSettings(), DEFAULT_LOVE_READER);
  slots.delete(KEY);
});

test('timing starts at now and lapses only at the deadline', () => {
  assert.equal(LOVE_TIMED_CHOICE_SECONDS, 12);
  assert.equal(LOVE_TIMED_CHOICE_MS, 12_000);
  assert.equal(loveTimedChoiceEndsAt(1_000), 13_000, 'the clock starts when armed (typing + TTS both done)');
  assert.equal(loveTimedChoiceRemainingMs(13_000, 10_000), 3_000);
  assert.equal(loveTimedChoiceRemainingMs(13_000, 99_000), 0, 'remaining never goes negative');
  assert.equal(loveTimedChoiceLapsed(13_000, 12_999), false);
  assert.equal(loveTimedChoiceLapsed(13_000, 13_000), true, 'the deadline itself lapses');
});

test('the reducer arms once per line, cancels cleanly and lapses exactly once', () => {
  // 起表。
  const armed = reduceLoveTimedChoice(idleLoveTimedChoice(), { type: 'arm', key: 'line-1', now: 1_000 });
  assert.equal(armed.lapsed, false);
  assert.deepEqual(armed.state, { phase: 'counting', key: 'line-1', endsAt: 13_000 });

  // 同一句重复 arm（重渲染）不重置：已流逝的时间不被吃掉。
  const rearm = reduceLoveTimedChoice(armed.state, { type: 'arm', key: 'line-1', now: 5_000 });
  assert.deepEqual(rearm.state, armed.state, 're-arming the same line keeps the original deadline');
  assert.equal(rearm.lapsed, false);

  // 换台词重新起表：旧计时不会污染新台词。
  const nextLine = reduceLoveTimedChoice(armed.state, { type: 'arm', key: 'line-2', now: 5_000 });
  assert.deepEqual(nextLine.state, { phase: 'counting', key: 'line-2', endsAt: 17_000 });

  // 未到点不 lapse。
  const early = reduceLoveTimedChoice(armed.state, { type: 'tick', now: 12_999 });
  assert.equal(early.lapsed, false);
  assert.deepEqual(early.state, armed.state);

  // 到点只报一次：第二次 tick 不再回报（沉默分支只走一次）。
  const lapsed = reduceLoveTimedChoice(armed.state, { type: 'tick', now: 13_000 });
  assert.equal(lapsed.lapsed, true);
  assert.equal(lapsed.state.phase, 'lapsed');
  const again = reduceLoveTimedChoice(lapsed.state, { type: 'tick', now: 20_000 });
  assert.equal(again.lapsed, false, 'a lapsed state never reports twice');
  assert.equal(again.state.phase, 'lapsed');

  // cancel 回 idle；idle 上的 cancel 原样返回。
  const cancelled = reduceLoveTimedChoice(armed.state, { type: 'cancel' });
  assert.deepEqual(cancelled.state, idleLoveTimedChoice());
  assert.deepEqual(reduceLoveTimedChoice(idleLoveTimedChoice(), { type: 'cancel' }).state, idleLoveTimedChoice());

  // idle 上的 tick 什么都不做。
  const idleTick = reduceLoveTimedChoice(idleLoveTimedChoice(), { type: 'tick', now: 99_000 });
  assert.equal(idleTick.lapsed, false);
  assert.deepEqual(idleTick.state, idleLoveTimedChoice());
});

test('the silence event is a local aside, never a learner line', () => {
  const event = loveSilenceEvent({ seconds: 12, text: '（你没有开口。12 秒的沉默过去了。）', now: 5_000 });
  assert.equal(event.role, 'event', 'role=event: the model reads it as something that happened, not as anyone’s words');
  assert.equal(event.kind, 'silence');
  assert.equal(event.seconds, 12);
  assert.equal(event.text, '（你没有开口。12 秒的沉默过去了。）', 'the narration is stored verbatim');
  assert.equal(event.ts, 5_000);
  assert.ok(event.id.length > 0, 'it has a stable id for the transcript');
  assert.equal((event as { characterId?: string }).characterId, undefined, 'no speaker: it belongs to nobody');
});
