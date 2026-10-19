/** G04: love slot change notifications, both across tabs (storage) and in the writing tab. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notifyLoveSlotsChanged, subscribeLoveSlots } from '../../src/lib/love-slot-events';

const events = new EventTarget();
Object.defineProperty(globalThis, 'window', { value: events, configurable: true });

test('a local write notifies subscribers with its key', () => {
  const seen: (string | null)[] = [];
  const off = subscribeLoveSlots((key) => seen.push(key));
  notifyLoveSlotsChanged('socialcoach.love-play.story');
  off();
  notifyLoveSlotsChanged('socialcoach.love-play.story');
  assert.deepEqual(seen, ['socialcoach.love-play.story']);
});

test('storage events for love slots are forwarded, other namespaces are ignored', () => {
  const seen: (string | null)[] = [];
  const off = subscribeLoveSlots((key) => seen.push(key));
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'socialcoach.love-play.carry' }));
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'socialcoach.v1' }));
  events.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
  off();
  assert.deepEqual(seen, ['socialcoach.love-play.carry', null]);
});

test('unsubscribing removes both listeners', () => {
  let count = 0;
  const off = subscribeLoveSlots(() => count++);
  off();
  notifyLoveSlotsChanged('socialcoach.love-play.story');
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'socialcoach.love-play.story' }));
  assert.equal(count, 0);
});
