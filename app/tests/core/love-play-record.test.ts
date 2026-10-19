/** 离线回归：恋爱收尾写设备端 LovePlayRecord，不生成空壳练习 Session（G11/G14/G21）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCENARIOS } from "../../src/data/corpus";
import { LOVE_STORY_KEY, readLoveStoryStore } from "../../src/lib/love-story";
import { buildSession, isResumableSession } from "../../src/lib/session-utils";
import { lovePlayRecordFor, todayKey, useApp, type LovePlayCompletion } from "../../src/store/useApp";

const seriesScene = SCENARIOS.find((s) => s.context === "romantic" && s.series && s.loveTopic);
const soloScene = SCENARIOS.find((s) => s.context === "romantic" && !s.series && !s.custom && s.loveTopic);
assert.ok(seriesScene && soloScene, "the corpus still has both series and standalone romance scenes");

const slots = new Map<string, string>();
let quota = false;
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (quota) throw new DOMException("quota", "QuotaExceededError");
      slots.set(key, value);
    },
    removeItem: (key: string) => {
      slots.delete(key);
    },
  },
  configurable: true,
});

const reset = () => {
  slots.clear();
  quota = false;
  useApp.setState({ sessions: [], loveProficiency: {}, practiceDays: [] });
};

const record = (input: LovePlayCompletion) => useApp.getState().completeLovePlay(input);

const records = () => {
  const read = readLoveStoryStore();
  assert.equal(read.status, "ok");
  return read.status === "ok" ? read.store.records : [];
};

test("a record id is scenario plus start time, so a second click cannot add a second one", () => {
  const at = 1_760_000_000_000;
  const one = lovePlayRecordFor({ scenario: seriesScene!, outcome: "success", startedAt: at, endedAt: at + 90_000, lang: "zh", endingId: "rio-stay" });
  assert.equal(one.id, `${seriesScene!.id}@${at}`);
  assert.equal(one.scenarioId, seriesScene!.id);
  assert.equal(one.seriesId, seriesScene!.series!.id);
  assert.equal(one.outcome, "success");
  assert.equal(one.endingId, "rio-stay");
  assert.equal(one.startedAt, at);
  assert.equal(one.endedAt, at + 90_000);
  assert.equal(one.lang, "zh");
  assert.equal(lovePlayRecordFor({ scenario: soloScene!, outcome: "failure", startedAt: at, lang: "en" }).seriesId, null);
});

test("finishing a love story writes one device record and no practice session", () => {
  reset();
  const at = 1_760_000_100_000;
  const ok = record({ scenario: seriesScene!, outcome: "success", startedAt: at, endedAt: at + 180_000, lang: "zh", endingId: "ending-x" });
  assert.equal(ok, true);

  const state = useApp.getState();
  assert.equal(state.sessions.length, 0);
  assert.equal(state.sessions.some((s) => s.origin === "love-play"), false);

  const [saved] = records();
  assert.equal(saved.id, `${seriesScene!.id}@${at}`);
  assert.equal(saved.scenarioId, seriesScene!.id);
  assert.equal(saved.seriesId, seriesScene!.series!.id);
  assert.equal(saved.outcome, "success");
  assert.equal(saved.endingId, "ending-x");
  assert.equal(saved.startedAt, at);
  assert.equal(saved.endedAt, at + 180_000);
  assert.equal(saved.lang, "zh");

  // 既有口径保留：成功 +0.3，1–5 夹紧；今天记入练习日历。
  assert.equal(state.loveProficiency[seriesScene!.loveTopic!], 2.8);
  assert.deepEqual(state.practiceDays, [todayKey()]);
});

test("recording the same run twice keeps one record and one gain", () => {
  reset();
  const input: LovePlayCompletion = { scenario: seriesScene!, outcome: "partial", startedAt: 1_760_000_200_000, lang: "zh" };
  assert.equal(record(input), true);
  assert.equal(record(input), true);
  assert.equal(records().length, 1);

  const state = useApp.getState();
  assert.equal(state.loveProficiency[seriesScene!.loveTopic!], 2.65);
  assert.equal(state.practiceDays.length, 1);
});

test("a full device still moves the story forward but reports the failed write", () => {
  reset();
  quota = true;
  const input: LovePlayCompletion = { scenario: seriesScene!, outcome: "failure", startedAt: 1_760_000_300_000, endedAt: 1_760_000_360_000, lang: "zh" };
  assert.equal(record(input), false);
  assert.equal(readLoveStoryStore().status, "empty");

  const state = useApp.getState();
  assert.equal(state.loveProficiency[seriesScene!.loveTopic!], 2.55);
  assert.deepEqual(state.practiceDays, [todayKey()]);

  // 空间恢复后重试：这次落盘成功，但增益不因重试再记一次。
  quota = false;
  assert.equal(record(input), true);
  assert.equal(records().length, 1);
  assert.equal(useApp.getState().loveProficiency[seriesScene!.loveTopic!], 2.55);
});

test("a corrupt story slot is never overwritten by a record write", () => {
  reset();
  slots.set(LOVE_STORY_KEY, "{not json");
  assert.equal(record({ scenario: soloScene!, outcome: "success", startedAt: 1_760_000_400_000, lang: "zh" }), false);
  assert.equal(slots.get(LOVE_STORY_KEY), "{not json");
  // 落盘失败不阻断剧情：内存里的增益与日历照常更新。
  assert.equal(useApp.getState().loveProficiency[soloScene!.loveTopic!], 2.8);
});

test("the home resume card ignores romance shells but keeps real practice", () => {
  const practice = buildSession(SCENARIOS[0], "scheduled", "zh");
  assert.equal(isResumableSession({ ...practice, status: "active" }), true);
  assert.equal(isResumableSession({ ...practice, status: "ended" }), true);
  assert.equal(isResumableSession({ ...practice, status: "assessed" }), false);
  assert.equal(isResumableSession({ ...practice, status: "briefing" }), false);

  const shell = buildSession(seriesScene!, "love-play", "zh");
  assert.equal(isResumableSession({ ...shell, status: "ended" }), false);
  assert.equal(isResumableSession({ ...shell, status: "active" }), false);
});
