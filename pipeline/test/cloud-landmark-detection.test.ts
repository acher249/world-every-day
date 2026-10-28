import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { createCloudLandmarkHandler } from "../src/cloud/landmark-detection-handler.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { sha256 } from "../src/panorama/hash.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";

test("cloud landmarks retry an incomplete story map once and reuse the valid immutable result", async () => {
  const direction = artDirectionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/demo-art-direction.v1.json", import.meta.url), "utf8",
  )) as unknown);
  const editionId = direction.editionId;
  const root = `editions/${editionId}`;
  const source = await sharp({ create: {
    width: 16, height: 8, channels: 3, background: { r: 80, g: 120, b: 160 },
  } }).png().toBuffer();
  const records = new Map<string, Uint8Array>();
  const artifacts: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({ key, bytes, contentType }) {
      const existing = records.get(key);
      if (existing && !Buffer.from(existing).equals(Buffer.from(bytes))) throw new Error("Artifact changed");
      records.set(key, bytes);
      return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  records.set(`${root}/panorama/delivery.png`, source);
  records.set(`${root}/panorama/manifest.json`, Buffer.from(JSON.stringify({
    schemaVersion: 1,
    artifactType: "panorama-manifest",
    editionId,
    createdAt: "2026-10-15T17:00:00.000Z",
    stage: "panorama-generation",
    inputs: { artDirectionSha256: artifactSha256(direction) },
    provider: "google-genai",
    model: "test-image-model",
    request: { prompt: "Test", promptSha256: "b".repeat(64), aspectRatio: "16:9", imageSize: "4K", thinkingLevel: "minimal" },
    response: { mimeType: "image/png", elapsedMs: 10, usage: null, originalSha256: "c".repeat(64) },
    transforms: {
      centeredEquirectangularCrop: { top: 1, width: 16, height: 8 },
      longitudeRepair: { method: "feather", width: 2 },
      deliveryResize: { width: 16, height: 8, kernel: "lanczos3", nativeDetail: false },
    },
    metrics: { longitudeSeam: { wrapMeanAbsoluteDifference: 0, leftFeatherBoundaryDifference: 0, rightFeatherBoundaryDifference: 0 } },
    outputs: { delivery8kSha256: sha256(source) },
    files: { original: "original.png", normalizedSource: "source.png", nativeEquirectangular: "native.png", seamRepairedEquirectangular: "seam.png", delivery8k: "delivery.png" },
  })));
  let calls = 0;
  const claims = new Set<string>();
  const handler = createCloudLandmarkHandler({
    artifacts,
    claims: { async claimOnce(key) { if (claims.has(key)) return false; claims.add(key); return true; } },
    detector: {
      id: "mock-detector",
      model: "mock-model",
      async detect(input) {
        calls += 1;
        if (calls === 2) assert.match(input.retryInstructions ?? "", /missing=/);
        const subjects = calls === 1 ? direction.subjects.slice(0, -2) : direction.subjects;
        return {
          landmarks: subjects.map((subject, index) => ({
            storyId: subject.storyId,
            label: subject.subject,
            confidence: 0.9,
            visibility: "clear" as const,
            boundingBox: { xMin: index / 20, yMin: 0.4, xMax: index / 20 + 0.02, yMax: 0.5 },
            target: { x: index / 20 + 0.01, y: 0.45 },
          })),
          contextMarkers: [],
        };
      },
    },
  });
  const input = { editionId, confirmPaidLandmarks: true };
  assert.equal((await handler(input)).status, "created");
  assert.equal((await handler(input)).status, "reused");
  assert.equal(calls, 2);
  assert.ok(claims.has(`${root}/landmarks/detection-attempt.json`));
  assert.ok(claims.has(`${root}/landmarks/detection-attempt-2.json`));
  assert.ok(records.has(`${root}/landmarks/analysis-image.jpg`));
  await assert.rejects(handler({ editionId }), /confirmPaidLandmarks/);
});
