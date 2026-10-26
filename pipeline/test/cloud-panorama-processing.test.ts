import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { buildScenePrompt } from "../src/art-direction/prompt.js";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { createPanoramaProcessingHandler } from "../src/cloud/panorama-processing-handler.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { sha256 } from "../src/panorama/hash.js";
import { buildPanoramaPrompt } from "../src/panorama/prompt.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";

test("cloud panorama processing reuses one raw image and writes immutable 2:1 output", async () => {
  const direction = artDirectionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/demo-art-direction.v1.json", import.meta.url), "utf8",
  )) as unknown);
  const editionId = direction.editionId;
  const root = `editions/${editionId}`;
  const sourceBytes = await sharp({ create: {
    width: 16,
    height: 10,
    channels: 3,
    background: { r: 80, g: 120, b: 160 },
  } }).png().toBuffer();
  const records = new Map<string, Uint8Array>();
  const artifacts: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({ key, bytes, contentType }) {
      const existing = records.get(key);
      if (existing && !Buffer.from(existing).equals(Buffer.from(bytes))) {
        throw new Error(`Artifact changed: ${key}`);
      }
      records.set(key, bytes);
      return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  const sourceKey = `${root}/panorama/source-original`;
  records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  records.set(sourceKey, sourceBytes);
  records.set(`${root}/panorama/source-image.json`, Buffer.from(JSON.stringify({
    schemaVersion: "1.0.0",
    artifactType: "raw-panorama-source",
    editionId,
    model: "test-image-model",
    provider: "google-genai",
    inputs: {
      selectedEditionSha256: "a".repeat(64),
      artDirectionSha256: artifactSha256(direction),
      reviewSha256: "b".repeat(64),
      promptSha256: sha256(buildPanoramaPrompt(buildScenePrompt(direction))),
    },
    image: {
      key: sourceKey,
      mimeType: "image/png",
      byteLength: sourceBytes.length,
      sha256: sha256(sourceBytes),
    },
    elapsedMs: 10,
    usage: null,
  })));
  let calls = 0;
  const claims = new Set<string>();
  const handler = createPanoramaProcessingHandler({
    artifacts,
    poleRepair: { model: "test-image-model",
      claims: { async claimOnce(key) { if (claims.has(key)) return false; claims.add(key); return true; } },
      generator: { async generate(prompt, reference) {
        calls++;
        assert.match(prompt, /masked zenith and nadir/);
        assert.equal(reference?.mimeType, "image/png");
        assert.ok(reference!.bytes.length > 0);
        return { bytes: await sharp({ create: { width: 160, height: 90, channels: 3, background: "#5078a0" } }).png().toBuffer(), mimeType: "image/png", elapsedMs: 1, usage: null };
      } },
    },
    processingConfig: {
      sourceWidth: 16,
      sourceHeight: 10,
      deliveryWidth: 32,
      deliveryHeight: 16,
      seamFeatherWidth: 2,
    },
  });
  await assert.rejects(handler({ editionId }), /confirmPaidGeneration/);
  assert.equal(calls, 0);
  const first = await handler({ editionId, confirmPaidGeneration: true });
  assert.equal(first.status, "created");
  assert.deepEqual(await sharp(Buffer.from(records.get(first.deliveryKey)!)).metadata().then(
    ({ width, height }) => ({ width, height }),
  ), { width: 32, height: 16 });
  const manifest = JSON.parse(Buffer.from(records.get(first.key)!).toString());
  assert.ok(manifest.transforms.poleRepair);
  assert.ok(records.has(`${root}/panorama/${manifest.files.poleRepairInput}`));
  assert.equal((await handler({ editionId, confirmPaidGeneration: true })).status, "reused");
  assert.equal(calls, 1);
  // A downstream interruption can resume from the paid repair receipt.
  records.delete(first.key);
  assert.equal((await handler({ editionId, confirmPaidGeneration: true })).status, "created");
  assert.equal(calls, 1);
});
