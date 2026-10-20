/** 结局图鉴的纯投影：同场同结局合并、计数与最近时间、未登记命名结局不伪造标题。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLoveEndingGallery, loveGalleryLabel } from "../../src/lib/love-endings";
import type { LovePlayRecord } from "../../src/lib/love-story";

const record = (over: Partial<LovePlayRecord> = {}): LovePlayRecord => ({
  id: `r-${Math.random()}`,
  scenarioId: "scene-a",
  seriesId: "series-a",
  outcome: "success",
  endingId: null,
  startedAt: 1,
  endedAt: 100,
  lang: "zh",
  ...over,
});

test("replaying the same ending stays one gallery entry with a count", () => {
  const entries = buildLoveEndingGallery([
    record({ endedAt: 100 }),
    record({ endedAt: 300 }),
    record({ endedAt: 200 }),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].count, 3);
  assert.equal(entries[0].firstAt, 100);
  assert.equal(entries[0].lastAt, 300);
});

test("different outcomes and named endings are separate entries", () => {
  const entries = buildLoveEndingGallery([
    record({ outcome: "success" }),
    record({ outcome: "failure" }),
    record({ outcome: "partial" }),
    record({ outcome: "success", endingId: "rio-said-it-plain" }),
  ]);
  assert.equal(entries.length, 4);
  assert.deepEqual(new Set(entries.map((e) => e.key)).size, 4);
});

test("the newest ending comes first", () => {
  const entries = buildLoveEndingGallery([
    record({ scenarioId: "old", endedAt: 100 }),
    record({ scenarioId: "new", endedAt: 900 }),
    record({ scenarioId: "mid", endedAt: 500 }),
  ]);
  assert.deepEqual(entries.map((e) => e.scenarioId), ["new", "mid", "old"]);
});

test("an unregistered ending name is not invented", () => {
  const [entry] = buildLoveEndingGallery([record({ endingId: "not-registered-yet" })]);
  assert.equal(loveGalleryLabel(entry, "zh"), null);
  const [plain] = buildLoveEndingGallery([record()]);
  assert.equal(loveGalleryLabel(plain, "zh"), null, "outcome endings use the outcome copy, not a fake name");
});

test("an empty record list produces an empty gallery", () => {
  assert.deepEqual(buildLoveEndingGallery([]), []);
});
