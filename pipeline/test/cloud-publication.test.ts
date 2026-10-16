import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createCloudPublicationHandler } from "../src/cloud/publication-handler.js";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { selectedEditionSchema } from "../src/editorial/edition.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { sha256 } from "../src/panorama/hash.js";
import { currentEditionPointerSchema, unpublishedCurrentSchema } from "../src/publication/review.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";

test("an unpublished marker cannot be mistaken for a published edition", () => {
  const marker = { schemaVersion: "1.0.0", status: "unpublished" };
  assert.deepEqual(unpublishedCurrentSchema.parse(marker), marker);
  assert.equal(currentEditionPointerSchema.safeParse(marker).success, false);
});

function memoryStore() {
  const records = new Map<string, Uint8Array>();
  const store: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({ key, bytes, contentType }) {
      const previous = records.get(key);
      if (previous && !Buffer.from(previous).equals(Buffer.from(bytes))) throw new Error(`Artifact changed: ${key}`);
      records.set(key, bytes);
      return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  return { store, records };
}

test("publication stays private until an exact staged manifest is approved", async () => {
  const edition = selectedEditionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/selected-edition.example.v1.json", import.meta.url), "utf8",
  )) as unknown);
  const demoDirection = JSON.parse(await readFile(
    new URL("../fixtures/demo-art-direction.v1.json", import.meta.url), "utf8",
  )) as { subjects: Array<Record<string, unknown>>; [key: string]: unknown };
  const editionId = edition.editionId;
  const storyId = edition.stories[0].storyId;
  const direction = artDirectionSchema.parse({
    ...demoDirection,
    editionId,
    inputs: { selectedEditionSha256: artifactSha256(edition) },
    subjects: [{ ...demoDirection.subjects[0], storyId, role: "anchor" }],
  });
  const root = `editions/${editionId}`;
  const poster = Buffer.from("test-poster");
  const splat = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  const posterHash = sha256(poster);
  const splatHash = sha256(splat);
  const { store: artifacts, records } = memoryStore();
  const { store: publicAssets, records: publicRecords } = memoryStore();
  const put = (key: string, value: unknown) => records.set(key, Buffer.from(JSON.stringify(value)));
  put(`${root}/editorial/selected-edition.json`, edition);
  put(`${root}/art-direction/art-direction.json`, direction);
  put(`${root}/panorama/manifest.json`, {
    schemaVersion: 1, artifactType: "panorama-manifest", editionId,
    createdAt: "2026-10-15T17:00:00.000Z", stage: "panorama-generation",
    inputs: { artDirectionSha256: artifactSha256(direction) },
    provider: "google-genai", model: "test-model",
    request: { prompt: "Test", promptSha256: "b".repeat(64), aspectRatio: "16:9", imageSize: "4K", thinkingLevel: "minimal" },
    response: { mimeType: "image/png", elapsedMs: 10, usage: null, originalSha256: "c".repeat(64) },
    transforms: {
      centeredEquirectangularCrop: { top: 1, width: 16, height: 8 },
      longitudeRepair: { method: "feather", width: 2 },
      deliveryResize: { width: 16, height: 8, kernel: "lanczos3", nativeDetail: false },
    },
    metrics: { longitudeSeam: { wrapMeanAbsoluteDifference: 0, leftFeatherBoundaryDifference: 0, rightFeatherBoundaryDifference: 0 } },
    outputs: { delivery8kSha256: posterHash },
    files: { original: "original.png", normalizedSource: "source.png", nativeEquirectangular: "native.png", seamRepairedEquirectangular: "seam.png", delivery8k: "delivery.png" },
  });
  records.set(`${root}/panorama/delivery.png`, poster);
  put(`${root}/landmarks/landmark-detections.json`, {
    schemaVersion: "1.0.0", artifactType: "landmark-detections", editionId,
    createdAt: "2026-10-15T17:10:00.000Z",
    sourceImage: { sha256: posterHash, width: 16, height: 8, projection: "equirectangular" },
    provider: { id: "mock", model: "mock" },
    landmarks: [{ storyId, label: "Test", boundingBox: { xMin: 0.1, yMin: 0.4, xMax: 0.2, yMax: 0.5 }, target: { x: 0.15, y: 0.45 }, confidence: 0.9, visibility: "clear" }],
    contextMarkers: [],
  });
  put(`${root}/interactions/interaction-manifest.json`, {
    schemaVersion: "1.0.0", artifactType: "interaction-manifest", editionId,
    createdAt: "2026-10-15T17:20:00.000Z", method: "spherical-raycast",
    sourceImageSha256: posterHash, sourceSplatSha256: splatHash,
    anchors: [{ id: storyId, imageTarget: { x: 0.15, y: 0.45 }, worldPosition: { x: 1, y: 2, z: 3 } }],
  });
  put(`${root}/world/generated-world.json`, {
    schemaVersion: "1.0.0", artifactType: "generated-world", editionId,
    createdAt: "2026-10-15T17:15:00.000Z", provider: "world-labs", adapterVersion: "test-v1",
    providerOperationId: "operation-1", model: "marble-1.1",
    input: { sourceImageSha256: posterHash, requestSha256: "d".repeat(64) },
    asset: { storageKey: `${root}/world/assets/world.spz`, format: "spz", mediaType: "application/octet-stream", byteLength: splat.length, sha256: splatHash },
  });
  records.set(`${root}/world/assets/world.spz`, splat);
  const publishedPointers: unknown[] = [];
  const handler = createCloudPublicationHandler({
    artifacts,
    publicAssets,
    current: { async advance(pointer) { publishedPointers.push(pointer); } },
  });
  assert.equal((await handler({ editionId, mode: "stage" })).status, "created");
  assert.equal((await handler({ editionId, mode: "stage" })).status, "reused");
  assert.equal(publicRecords.size, 0);
  await assert.rejects(handler({ editionId, mode: "publish", confirmPublish: true }), /publication-approval.json/);
  assert.equal(publicRecords.size, 0);
  const staged = JSON.parse(Buffer.from(records.get(`${root}/publication/publication-manifest.json`)!).toString("utf8")) as unknown;
  put(`${root}/review/publication-approval.json`, {
    schemaVersion: "1.0.0", artifactType: "publication-review", editionId,
    approvedAt: "2026-10-15T18:00:00.000Z", approvedBy: "test-operator",
    decision: "approved-for-publication", inputs: { publicationSha256: artifactSha256(staged) },
  });
  assert.equal((await handler({ editionId, mode: "publish", confirmPublish: true })).status, "published");
  assert.equal(publicRecords.size, 3);
  assert.equal(publishedPointers.length, 1);
  const publicManifest = JSON.parse(Buffer.from(publicRecords.get(`generated/editions/${editionId}/publication.json`)!).toString("utf8")) as { edition: { status: string } };
  assert.equal(publicManifest.edition.status, "published");
});
