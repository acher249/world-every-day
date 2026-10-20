import assert from "node:assert/strict";
import test from "node:test";
import { editionInputForScheduledTime } from "../src/cloud/scheduled-edition-input.js";

test("daily scheduler uses the scheduled Pacific date and a bounded 24-hour window", () => {
  assert.deepEqual(editionInputForScheduledTime({ scheduledTime: "2026-10-19T14:30:00Z" }), {
    editionId: "daily-2026-10-19",
    windowStart: "2026-10-18T14:30:00.000Z",
    windowEnd: "2026-10-19T14:30:00.000Z",
    confirmPaidAnalysis: true,
    confirmLiveArticleFetch: true,
    confirmPaidArticleAnalysis: true,
    confirmPaidArtDirection: true,
    confirmUnattendedRun: true,
    confirmPaidPanorama: true,
    confirmPaidWorld: true,
    confirmPaidLandmarks: true,
    confirmPublish: true,
  });
});

test("daily scheduler follows Pacific date after the daylight-saving change", () => {
  assert.equal(
    editionInputForScheduledTime({ scheduledTime: "2026-11-02T15:30:00Z" }).editionId,
    "daily-2026-11-02",
  );
});

test("daily scheduler rejects missing or malformed context", () => {
  assert.throws(() => editionInputForScheduledTime({}), /scheduledTime/);
  assert.throws(() => editionInputForScheduledTime({ scheduledTime: "tomorrow" }), /scheduledTime/);
});
