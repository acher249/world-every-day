import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createCloudWorldHandler } from "../src/cloud/world-generation-handler.js";
import { sha256 } from "../src/panorama/hash.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";

function memoryStore() {
  const records = new Map<string, Uint8Array>();
  const artifacts: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({ key, bytes, contentType }) {
      const existing = records.get(key);
      if (existing && !Buffer.from(existing).equals(Buffer.from(bytes))) {
        throw new Error(`Immutable artifact changed: ${key}`);
      }
      records.set(key, bytes);
      return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  return { artifacts, records };
}

function worldFixture() {
  const editionId = "selection-2026-10-15-0900";
  const root = `editions/${editionId}`;
  const source = Buffer.from("panorama-test-bytes");
  const sourceHash = sha256(source);
  const artHash = "a".repeat(64);
  const { artifacts, records } = memoryStore();
  const panorama = {
    schemaVersion: 1,
    artifactType: "panorama-manifest",
    editionId,
    createdAt: "2026-10-15T17:00:00.000Z",
    stage: "panorama-generation",
    inputs: { artDirectionSha256: artHash },
    provider: "google-genai",
    model: "test-image-model",
    request: { prompt: "Test", promptSha256: "b".repeat(64), aspectRatio: "16:9", imageSize: "4K", thinkingLevel: "minimal" },
    response: { mimeType: "image/png", elapsedMs: 10, usage: null, originalSha256: "c".repeat(64) },
    transforms: {
      centeredEquirectangularCrop: { top: 1, width: 32, height: 16 },
      longitudeRepair: { method: "feather", width: 2 },
      deliveryResize: { width: 64, height: 32, kernel: "lanczos3", nativeDetail: false },
    },
    metrics: { longitudeSeam: { wrapMeanAbsoluteDifference: 0, leftFeatherBoundaryDifference: 0, rightFeatherBoundaryDifference: 0 } },
    outputs: { delivery8kSha256: sourceHash },
    files: {
      original: "source-original.png",
      normalizedSource: "source.png",
      nativeEquirectangular: "native.png",
      seamRepairedEquirectangular: "seam.png",
      delivery8k: "delivery.png",
    },
  };
  records.set(`${root}/panorama/manifest.json`, Buffer.from(JSON.stringify(panorama)));
  records.set(`${root}/panorama/delivery.png`, source);
  return { editionId, root, source, sourceHash, artHash, artifacts, records };
}

test("cloud world generation requires image approval, submits once, polls, and reuses the durable asset", async () => {
  const { editionId, root, source, sourceHash, artHash, artifacts, records } = worldFixture();
  const claims = new Set<string>();
  let submits = 0;
  let polls = 0;
  const worldBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  const handler = createCloudWorldHandler({
    artifacts,
    claims: { async claimOnce(key) { if (claims.has(key)) return false; claims.add(key); return true; } },
    generator: {
      adapterVersion: "test-v1",
      provider: "world-labs",
      async submit(request, path) {
        submits += 1;
        assert.equal(request.sourceImage.sha256, sourceHash);
        assert.deepEqual(await readFile(path), source);
        return { operationId: "operation-1" };
      },
      async getOperation() {
        polls += 1;
        if (polls === 1) return { done: false } as const;
        return { done: true, response: { assetReference: "https://example.com/world.spz", format: "spz" as const, mediaType: "application/octet-stream", model: "marble-1.1" } };
      },
      async downloadAsset() { return { bytes: worldBytes, format: "spz" as const, mediaType: "application/octet-stream" }; },
    },
    model: "marble-1.1",
  });
  const start = { editionId, mode: "start", confirmPaidWorld: true };
  await assert.rejects(handler(start), /image-approval.json/);
  assert.equal(submits, 0);
  records.set(`${root}/review/image-approval.json`, Buffer.from(JSON.stringify({
    schemaVersion: "1.0.0",
    artifactType: "image-review",
    editionId,
    approvedAt: "2026-10-15T18:00:00.000Z",
    approvedBy: "test-operator",
    decision: "approved-for-world-generation",
    inputs: { artDirectionSha256: artHash, panoramaSha256: sourceHash },
  })));
  assert.equal((await handler(start)).status, "running");
  assert.equal((await handler(start)).status, "running");
  assert.equal(submits, 1);
  const poll = { editionId, mode: "poll", confirmPaidWorld: true };
  assert.equal((await handler(poll)).status, "running");
  assert.equal((await handler(poll)).status, "completed");
  assert.equal((await handler(poll)).status, "completed");
  assert.equal(submits, 1);
  assert.equal(polls, 2);
  assert.deepEqual(records.get(`${root}/world/assets/world.spz`), worldBytes);
});

test("an uncertain world submission cannot silently submit a second paid world", async () => {
  const { artifacts } = memoryStore();
  const handler = createCloudWorldHandler({
    artifacts,
    claims: { async claimOnce() { return false; } },
    generator: {
      adapterVersion: "test-v1",
      provider: "world-labs",
      async submit() { throw new Error("must not submit"); },
      async getOperation() { return { done: false }; },
      async downloadAsset() { throw new Error("must not download"); },
    },
    model: "marble-1.1",
  });
  await assert.rejects(handler({ editionId: "test-edition", mode: "start" }), /confirmPaidWorld/);
});

function retryFixture(error = { code: "500", message: "An error has happened, please retry it.", retryable: true }) {
  const fixture = worldFixture();
  const { editionId, root, sourceHash, artHash, artifacts, records } = fixture;
  records.set(`${root}/review/image-approval.json`, Buffer.from(JSON.stringify({
    schemaVersion: "1.0.0", artifactType: "image-review", editionId,
    approvedAt: "2026-10-15T18:00:00.000Z", approvedBy: "test-operator",
    decision: "approved-for-world-generation", inputs: { artDirectionSha256: artHash, panoramaSha256: sourceHash },
  })));
  let time = Date.parse("2026-10-15T18:00:00.000Z");
  let success = false;
  let uncertain = false;
  const keys: string[] = [];
  const claims = new Set<string>();
  const handler = createCloudWorldHandler({
    artifacts, model: "marble-1.1", now: () => new Date(time),
    claims: { async claimOnce(key) { if (claims.has(key)) return false; claims.add(key); return true; } },
    generator: {
      provider: "world-labs", adapterVersion: "test-v1",
      async submit(_request, _path, key) { keys.push(key); if (uncertain) throw new Error("connection lost"); return { operationId: `operation-${keys.length}` }; },
      async getOperation() {
        return success ? { done: true, response: { assetReference: "https://example.com/a.spz", format: "spz", mediaType: "application/octet-stream", model: "marble-1.1" } } : { done: true, error };
      },
      async downloadAsset() { return { bytes: Buffer.from("world"), format: "spz", mediaType: "application/octet-stream" }; },
    },
  });
  return { ...fixture, keys, handler, advance: (ms: number) => { time += ms; }, succeed: () => { success = true; }, disconnect: () => { uncertain = true; },
    start: { editionId, mode: "start", confirmPaidWorld: true }, poll: { editionId, mode: "poll", confirmPaidWorld: true, pollCount: 7 } };
}

test("confirmed transient failure retries after backoff, preserves prior records and completes once", async () => {
  const f = retryFixture();
  await f.handler(f.start);
  assert.equal((await f.handler(f.poll)).status, "running");
  const original = f.records.get(`${f.root}/world/operation-failed.json`);
  await f.handler(f.poll);
  assert.equal(f.keys.length, 1);
  f.advance(60_000);
  const retry = await f.handler(f.poll);
  assert.equal(retry.pollCount, 7);
  assert.equal(f.keys.length, 2);
  assert.notEqual(f.keys[0], f.keys[1]);
  await f.handler(f.start);
  assert.equal(f.keys.length, 2);
  f.succeed();
  assert.equal((await f.handler(f.poll)).status, "completed");
  assert.equal((await f.handler(f.start)).status, "completed");
  assert.deepEqual(f.records.get(`${f.root}/world/operation-failed.json`), original);
});

test("retries stop after four submissions and retain each terminal failure", async () => {
  const f = retryFixture();
  await f.handler(f.start);
  await f.handler(f.poll);
  f.advance(60_000); await f.handler(f.poll); await f.handler(f.poll);
  f.advance(60_000); await f.handler(f.poll);
  assert.equal(f.keys.length, 2);
  f.advance(60_000); await f.handler(f.poll);
  assert.equal((await f.handler(f.poll)).status, "running");
  f.advance(120_000); await f.handler(f.poll);
  assert.equal(f.keys.length, 3);
  f.advance(60_000); await f.handler(f.poll);
  assert.equal((await f.handler(f.poll)).status, "failed");
  f.advance(600_000);
  assert.equal((await f.handler(f.start)).status, "failed");
  assert.equal(f.keys.length, 4);
  assert.ok(f.records.has(`${f.root}/world/attempts/4/operation-failed.json`));
});

test("authorization and unknown failures never trigger new generation", async () => {
  for (const code of ["401", "403", "INVALID_ARGUMENT", "UNKNOWN"]) {
    const f = retryFixture({ code, message: "failure", retryable: false });
    await f.handler(f.start);
    assert.equal((await f.handler(f.poll)).status, "failed");
    f.advance(600_000);
    assert.equal((await f.handler(f.start)).status, "failed");
    assert.equal(f.keys.length, 1);
  }
});

test("a retry submission with an uncertain response is never repeated", async () => {
  const f = retryFixture();
  await f.handler(f.start); await f.handler(f.poll); f.advance(60_000); f.disconnect();
  await assert.rejects(f.handler(f.poll), /connection lost/);
  await assert.rejects(f.handler(f.poll), /submission attempt already exists/);
  assert.equal(f.keys.length, 2);
});

test("historical generic retry-request failures can recover without changing their records", async () => {
  const f = retryFixture({ code: "WORLD_LABS_GENERATION_FAILED", message: "An error has happened, please retry it.", retryable: false });
  await f.handler(f.start); await f.handler(f.poll); f.advance(60_000);
  await f.handler(f.poll);
  assert.equal(f.keys.length, 2);
});
