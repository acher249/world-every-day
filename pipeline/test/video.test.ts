import assert from "node:assert/strict";
import { test } from "node:test";
import { batchInputs, cameraPose, jobId, jobSchema } from "../src/video/job.js";
import { ambientWav } from "../src/video/ambient.js";
import { validateProbe } from "../src/video/assemble-handler.js";
import { musicOptions, selectSoundtrack, soundtrackWav } from "../src/video/music-options.js";

test("thirty batches cover every frame exactly once without timeline resets", () => {
  const ref = { editionId: "example", jobId: "a".repeat(64) };
  const frames = batchInputs(ref).flatMap((batch) => Array.from({ length: 10 }, (_, offset) => batch.startFrame + offset));
  assert.deepEqual(frames, Array.from({ length: 300 }, (_, index) => index));
  const job = { seed: 1234, startYaw: 1 };
  for (let frame = 0; frame < 300; frame++) {
    const pose = cameraPose(job, frame);
    assert(Math.abs(pose.pitch) < Math.PI / 18);
    assert(pose.drift.y >= 0);
    assert(Math.hypot(...Object.values(pose.drift)) < 0.1);
    if (frame) assert(Math.abs(pose.yaw - cameraPose(job, frame - 1).yaw) < 0.01);
    assert.deepEqual(pose, cameraPose(job, frame));
  }
  assert.throws(() => cameraPose(job, 300));
});

test("video identity changes with world or publication, not object property order", () => {
  const job = jobSchema.parse({ version: "tour-v3", captureBuild: "d".repeat(64), soundtrack: "soft-orbit", editionId: "example", publicationKey: "publication.json", publicationSha256: "a".repeat(64),
    worldSha256: "b".repeat(64), worldKey: "world.spz", seed: 1, startYaw: 0, width: 1280, height: 720, fps: 30, frameCount: 300, batchSize: 10 });
  assert.notEqual(jobId(job), jobId({ ...job, worldSha256: "c".repeat(64) }));
  assert.notEqual(jobId(job), jobId({ ...job, publicationSha256: "c".repeat(64) }));
  assert.notEqual(jobId(job), jobId({ ...job, soundtrack: "night-bloom" }));
  assert.notEqual(jobId(job), jobId({ ...job, captureBuild: "e".repeat(64) }));
  assert.equal(jobId(job), jobId(jobSchema.parse(Object.fromEntries(Object.entries(job).reverse()))));
});

test("soundtracks vary across worlds but remain stable on retries", () => {
  const choices = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const edition = `edition-${i}`;
    const selected = selectSoundtrack(edition, "a".repeat(64));
    assert.equal(selected, selectSoundtrack(edition, "a".repeat(64)));
    choices.add(selected);
  }
  assert.deepEqual([...choices].sort(), musicOptions.map((option) => option.id).sort());
});

test("all approved soundtracks produce bounded ten-second stereo audio", () => {
  const outputs = new Set<string>();
  for (const option of musicOptions) {
    const wav = soundtrackWav(option.id);
    assert.equal(wav.length, 44 + 48000 * 10 * 4);
    assert.equal(wav.readUInt16LE(22), 2);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert(peak > 100 && peak < 32767);
    assert.equal(wav.readInt16LE(44), 0);
    assert(Math.abs(wav.readInt16LE(wav.length - 2)) < 3);
    outputs.add(wav.subarray(44 + 48000, 44 + 48100).toString("hex"));
  }
  assert.equal(outputs.size, 5);
});

test("ambient track is deterministic ten-second stereo PCM with fades and no clipping", () => {
  const wav = ambientWav(123);
  assert.equal(wav.length, 44 + 48000 * 10 * 4);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(22), 2);
  assert.deepEqual(wav, ambientWav(123));
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert(peak > 100 && peak < 16384);
  assert.equal(wav.readInt16LE(44), 0);
  assert(Math.abs(wav.readInt16LE(wav.length - 2)) < 3);
});

test("video validation rejects missing audio and incomplete or wrong-size encodes", () => {
  const probe = { streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1", nb_read_frames: "300" },
    { codec_type: "audio", codec_name: "aac" }], format: { duration: "10.000" } };
  validateProbe(probe, "h264", "aac");
  assert.throws(() => validateProbe({ ...probe, streams: probe.streams.slice(0, 1) }, "h264", "aac"));
  assert.throws(() => validateProbe({ ...probe, format: { duration: "NaN" } }, "h264", "aac"));
  assert.throws(() => validateProbe({ ...probe, streams: [{ ...probe.streams[0], nb_read_frames: "299" }, probe.streams[1]] }, "h264", "aac"));
});
