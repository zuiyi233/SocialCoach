/** P3 呈现层：BGM manifest 与播放器降级路径（spec §4.5）——无素材静默待机，绝不报错。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLoveAmbientPlayer,
  loadLoveAmbientManifest,
  loveAmbientTrackForTone,
  parseLoveAmbientManifest,
  stepAmbientVolume,
  LOVE_AMBIENT_DUCKED_VOLUME,
  LOVE_AMBIENT_VOLUME,
  type LoveAmbientAudio,
  type LoveAmbientTrack,
} from '../../src/lib/love-ambient';

const track = (over: Partial<LoveAmbientTrack> = {}): LoveAmbientTrack => ({
  id: 'rio-loop',
  tone: 'rose',
  src: 'love-ambient/rio-loop.mp3',
  title: { zh: '深夜餐桌', en: 'Late Table' },
  license: 'CC BY 4.0',
  source: 'example-archive.org/track/1',
  ...over,
});

test('the manifest parses per entry: bad rows are dropped, good rows survive', () => {
  assert.deepEqual(parseLoveAmbientManifest([]), [], 'an empty manifest is valid: no licensed assets yet');
  assert.deepEqual(parseLoveAmbientManifest(null), [], 'not an array → nothing');
  assert.deepEqual(parseLoveAmbientManifest('nope'), [], 'a string is not a manifest');
  assert.deepEqual(parseLoveAmbientManifest([undefined, 3, {}]), [], 'garbage rows contribute nothing');

  const parsed = parseLoveAmbientManifest([
    track(),
    track({ id: 'missing-license', license: '' }),
    track({ id: 'missing-source', source: '' }),
    track({ id: 'bad-tone', tone: 'crimson' as LoveAmbientTrack['tone'] }),
    track({ id: 'bad-title', title: { zh: '只有中文' } as unknown as LoveAmbientTrack['title'] }),
  ]);
  assert.deepEqual(parsed.map((t) => t.id), ['rio-loop'], 'a track without license or source never ships');
});

test('duplicate ids or sources collapse to one entry', () => {
  const parsed = parseLoveAmbientManifest([track(), track(), track({ id: 'other', src: 'love-ambient/other.mp3' })]);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((t) => t.id), ['rio-loop', 'other']);
});

test('the loader degrades silently: 404, network errors and bad JSON all read as no assets', async () => {
  const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  assert.deepEqual(await loadLoveAmbientManifest((async () => ok([])) as unknown as typeof fetch), []);
  assert.deepEqual(await loadLoveAmbientManifest((async () => ok([track()])) as unknown as typeof fetch).then((r) => r), [track()]);
  assert.deepEqual(
    await loadLoveAmbientManifest((async () => ok('not found', 404)) as unknown as typeof fetch),
    [],
    'a missing manifest is the empty case, not an error',
  );
  assert.deepEqual(await loadLoveAmbientManifest((async () => ok({ nope: true })) as unknown as typeof fetch), [], 'a shapeless manifest is no assets');
  assert.deepEqual(
    await loadLoveAmbientManifest((async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch),
    [],
    'a network failure is silent',
  );
});

test('tracks are picked by scene tone; an empty manifest has no track', () => {
  assert.equal(loveAmbientTrackForTone([], 'rose'), null, 'no assets → no track');
  assert.equal(loveAmbientTrackForTone([track()], 'teal'), null, 'an unpaired tone stays silent');
  assert.equal(loveAmbientTrackForTone([track()], 'rose')?.id, 'rio-loop');
  assert.equal(loveAmbientTrackForTone([track(), track({ id: 'second', src: 'b.mp3' })], 'rose')?.id, 'rio-loop', 'first match wins');
});

test('the volume fade converges without overshooting', () => {
  assert.equal(stepAmbientVolume(0.05, 0.05), 0.05, 'at target, stay');
  assert.equal(stepAmbientVolume(0.16, 0.16), 0.16);
  const up = stepAmbientVolume(0, LOVE_AMBIENT_VOLUME);
  assert.ok(up > 0 && up < LOVE_AMBIENT_VOLUME, `a step moves toward the target, not past it (${up})`);
  const down = stepAmbientVolume(LOVE_AMBIENT_VOLUME, LOVE_AMBIENT_DUCKED_VOLUME);
  assert.ok(down < LOVE_AMBIENT_VOLUME && down > LOVE_AMBIENT_DUCKED_VOLUME);
  let v = 0;
  for (let i = 0; i < 200; i++) v = stepAmbientVolume(v, LOVE_AMBIENT_VOLUME);
  assert.equal(v, LOVE_AMBIENT_VOLUME, 'the fade converges exactly');
});

interface FakeAudio extends LoveAmbientAudio {
  calls: string[];
}

const fakeFactory = (log: FakeAudio[]) => (src: string): LoveAmbientAudio => {
  const audio: FakeAudio = {
    src,
    loop: false,
    volume: 1,
    calls: [],
    play() {
      audio.calls.push('play');
      return undefined;
    },
    pause() {
      audio.calls.push('pause');
    },
  };
  log.push(audio);
  return audio;
};

test('with no assets the player stays idle and never touches audio', () => {
  const made: FakeAudio[] = [];
  const player = createLoveAmbientPlayer({ audioFactory: fakeFactory(made) });
  player.setManifest([]);
  player.setTone('rose');
  player.unlock();
  player.tick();
  player.setDucked(true);
  player.beatMute();
  assert.deepEqual(player.debugState(), { trackId: null, playing: false, volume: 0, target: 0 });
  assert.equal(made.length, 0, 'no audio element is created without a track');
  assert.doesNotThrow(() => player.dispose());
});

test('a matching track starts on the chosen tone, loops, and fades up to the quiet base volume', async () => {
  const made: FakeAudio[] = [];
  const player = createLoveAmbientPlayer({ audioFactory: fakeFactory(made) });
  player.setManifest([track()]);
  player.setTone('rose');
  await Promise.resolve();
  assert.equal(made.length, 1, 'one audio element for the matched track');
  assert.equal(made[0]!.src, 'love-ambient/rio-loop.mp3');
  assert.equal(made[0]!.loop, true, 'ambient loops');
  assert.equal(made[0]!.calls.includes('play'), true);
  assert.equal(player.debugState().playing, true);
  assert.equal(player.debugState().volume, 0, 'it fades in from silence');
  for (let i = 0; i < 50; i++) player.tick();
  assert.equal(player.debugState().volume, LOVE_AMBIENT_VOLUME, 'base volume is low, never over the lines');
  player.dispose();
  assert.ok(made[0]!.calls.includes('pause'));
});

test('TTS ducking presses the volume down and back', () => {
  const made: FakeAudio[] = [];
  const player = createLoveAmbientPlayer({ audioFactory: fakeFactory(made) });
  player.setManifest([track()]);
  player.setTone('rose');
  for (let i = 0; i < 50; i++) player.tick();
  assert.equal(player.debugState().volume, LOVE_AMBIENT_VOLUME);

  player.setDucked(true);
  for (let i = 0; i < 50; i++) player.tick();
  assert.equal(player.debugState().volume, LOVE_AMBIENT_DUCKED_VOLUME, 'ducked while the line is read');

  player.setDucked(false);
  for (let i = 0; i < 50; i++) player.tick();
  assert.equal(player.debugState().volume, LOVE_AMBIENT_VOLUME, 'released after the line');
  player.dispose();
});

test('beat mute dips to zero for one beat and restores itself', () => {
  const made: FakeAudio[] = [];
  let nowMs = 1_000;
  const player = createLoveAmbientPlayer({ audioFactory: fakeFactory(made), now: () => nowMs });
  player.setManifest([track()]);
  player.setTone('rose');
  for (let i = 0; i < 50; i++) player.tick();
  assert.equal(player.debugState().volume, LOVE_AMBIENT_VOLUME);

  player.beatMute();
  for (let i = 0; i < 20; i++) player.tick();
  assert.equal(player.debugState().volume, 0, 'one beat of silence');

  nowMs += 700 + 1;
  for (let i = 0; i < 50; i++) player.tick();
  assert.equal(player.debugState().volume, LOVE_AMBIENT_VOLUME, 'it restores after the beat');
  player.dispose();
});

test('a rejected play (autoplay policy) leaves the player silent, not crashed', async () => {
  const calls: string[] = [];
  const player = createLoveAmbientPlayer({
    audioFactory: () => {
      calls.push('created');
      return {
        src: 'x',
        loop: false,
        volume: 1,
        play: () => Promise.reject(new Error('NotAllowedError')),
        pause() {
          calls.push('paused');
        },
      };
    },
  });
  player.setManifest([track()]);
  player.setTone('rose');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(player.debugState(), { trackId: 'rio-loop', playing: false, volume: 0, target: 0 });
  // 手势解锁后可以再试。
  player.unlock();
  await Promise.resolve();
  await Promise.resolve();
  assert.doesNotThrow(() => player.dispose());
});

test('switching to a tone without a track stops cleanly instead of playing the wrong scene', () => {
  const made: FakeAudio[] = [];
  const player = createLoveAmbientPlayer({ audioFactory: fakeFactory(made) });
  player.setManifest([track()]);
  player.setTone('rose');
  assert.equal(player.debugState().playing, true);
  player.setTone('teal');
  assert.equal(player.debugState().playing, false, 'no teal track → stop');
  assert.ok(made[0]!.calls.includes('pause'));
  assert.equal(player.debugState().trackId, null, 'the old track is released, not kept half-alive');
  player.dispose();
});
