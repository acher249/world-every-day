import assert from "node:assert/strict";
import { test } from "node:test";
import { createCloudInteractionBakingHandler } from "../src/cloud/interaction-baking-handler.js";
import { sha256 } from "../src/panorama/hash.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";

test("cloud interaction baking binds landmarks to the immutable SPZ and reuses the result", async () => {
  const editionId = "test-edition";
  const root = `editions/${editionId}`;
  const worldBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  const worldHash = sha256(worldBytes);
  const imageHash = "a".repeat(64);
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
  records.set(`${root}/landmarks/landmark-detections.json`, Buffer.from(JSON.stringify({
    schemaVersion: "1.0.0",
    artifactType: "landmark-detections",
    editionId,
    createdAt: "2026-10-15T17:00:00.000Z",
    sourceImage: { sha256: imageHash, width: 64, height: 32, projection: "equirectangular" },
    provider: { id: "mock", model: "mock" },
    landmarks: [
      {
        storyId: "story-one",
        label: "Test landmark",
        boundingBox: { xMin: 0.1, yMin: 0.4, xMax: 0.2, yMax: 0.5 },
        target: { x: 0.15, y: 0.45 },
        confidence: 0.9,
        visibility: "clear",
      },
      {
        storyId: "story-two",
        label: "Absent landmark",
        boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
        target: { x: 0, y: 0 },
        confidence: 0,
        visibility: "not-found",
      },
    ],
    contextMarkers: [
      { id: "story-one-echo", storyId: "story-one", label: "Path", explanation: "Visible path.", boundingBox: { xMin: 0.3, yMin: 0.4, xMax: 0.4, yMax: 0.5 }, target: { x: 0.35, y: 0.45 }, confidence: 0.9 },
      { id: "story-two-echo", storyId: "story-two", label: "Marker", explanation: "Secondary feature.", boundingBox: { xMin: 0.5, yMin: 0.4, xMax: 0.6, yMax: 0.5 }, target: { x: 0.55, y: 0.45 }, confidence: 0.9 },
    ],
  })));
  records.set(`${root}/world/generated-world.json`, Buffer.from(JSON.stringify({
    schemaVersion: "1.0.0",
    artifactType: "generated-world",
    editionId,
    createdAt: "2026-10-15T17:00:00.000Z",
    provider: "world-labs",
    adapterVersion: "test-v1",
    providerOperationId: "operation-1",
    model: "marble-1.1",
    input: { sourceImageSha256: imageHash, requestSha256: "b".repeat(64) },
    asset: {
      storageKey: `${root}/world/assets/world.spz`,
      format: "spz",
      mediaType: "application/octet-stream",
      byteLength: worldBytes.length,
      sha256: worldHash,
    },
  })));
  records.set(`${root}/world/assets/world.spz`, worldBytes);
  let calls = 0;
  const handler = createCloudInteractionBakingHandler({
    artifacts,
    baker: {
      method: "spherical-raycast",
      algorithmVersion: "surface-grid-v2",
      async bake({ landmarks, sourceSplatSha256 }) {
        calls += 1;
        assert.equal(sourceSplatSha256, worldHash);
        assert.deepEqual(landmarks.landmarks.map(({ storyId }) => storyId), ["story-one"]);
        assert.deepEqual(landmarks.contextMarkers.map(({ id }) => id), ["story-one-echo"]);
        return [
          ...landmarks.landmarks.map((landmark) => ({
            id: landmark.storyId,
            imageTarget: landmark.target,
            worldPosition: { x: 1, y: 2, z: 3 },
          })),
          ...landmarks.contextMarkers.map((marker) => ({
            id: marker.id,
            imageTarget: marker.target,
            worldPosition: { x: 2, y: 3, z: 4 },
          })),
        ];
      },
    },
  });
  assert.equal((await handler({ editionId })).status, "created");
  assert.equal((await handler({ editionId })).status, "reused");
  assert.equal(calls, 1);
  assert.ok(records.has(`${root}/interactions/interaction-manifest.json`));
  const manifest = JSON.parse(Buffer.from(records.get(`${root}/interactions/interaction-manifest.json`)!).toString("utf8"));
  assert.deepEqual(manifest.anchors.map((anchor: { id: string }) => anchor.id), ["story-one", "story-one-echo"]);
  const key = `${root}/interactions/interaction-manifest.json`;
  const stale = JSON.parse(Buffer.from(records.get(key)!).toString("utf8"));
  delete stale.algorithmVersion;
  records.set(key, Buffer.from(JSON.stringify(stale)));
  await assert.rejects(handler({ editionId }), /older baking algorithm/);
  assert.equal(calls, 1, "stale immutable artifacts must require explicit repair");
});
