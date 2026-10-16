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

test("cloud world generation requires image approval, submits once, polls, and reuses the durable asset", async () => {
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
