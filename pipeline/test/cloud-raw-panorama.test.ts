import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { createRawPanoramaHandler } from "../src/cloud/raw-panorama-handler.js";
import { selectedEditionSchema } from "../src/editorial/edition.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { sha256 } from "../src/panorama/hash.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";
import { editionReviewSchema } from "../src/workflow/review.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as unknown;
}

async function inputs() {
  const edition = selectedEditionSchema.parse(await fixture("selected-edition.example.v1.json"));
  const direction = artDirectionSchema.parse({
    ...(await fixture("demo-art-direction.v1.json") as object),
    editionId: edition.editionId,
    inputs: { selectedEditionSha256: artifactSha256(edition) },
  });
  const review = editionReviewSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "edition-review",
    editionId: edition.editionId,
    approvedAt: "2026-10-15T16:00:00.000Z",
    approvedBy: "test-operator",
    inputs: {
      selectedEditionSha256: artifactSha256(edition),
      artDirectionSha256: artifactSha256(direction),
    },
    decision: "approved-for-generation",
  });
  return { edition, direction, review };
}

function memoryStore(): ArtifactStore & { records: Map<string, Uint8Array> } {
  const records = new Map<string, Uint8Array>();
  return {
    records,
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
}

test("raw image generation requires a matching approval and resumes without another paid call", async () => {
  const { edition, direction, review } = await inputs();
  const root = `editions/${edition.editionId}`;
  const artifacts = memoryStore();
  artifacts.records.set(`${root}/editorial/selected-edition.json`, Buffer.from(JSON.stringify(edition)));
  artifacts.records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  const claimed = new Set<string>();
  let calls = 0;
  const handler = createRawPanoramaHandler({
    artifacts,
    claims: { async claimOnce(key) { if (claimed.has(key)) return false; claimed.add(key); return true; } },
    generator: { async generate() { calls += 1; return { bytes: Buffer.from("test-image"), mimeType: "image/png", elapsedMs: 10, usage: null }; } },
    model: "test-image-model",
  });
  const event = { editionId: edition.editionId, confirmPaidGeneration: true };
  await assert.rejects(handler(event), /approval.json/);
  assert.equal(calls, 0);
  artifacts.records.set(`${root}/review/approval.json`, Buffer.from(JSON.stringify(review)));
  assert.equal((await handler(event)).status, "created");
  assert.equal((await handler(event)).status, "reused");
  assert.equal(calls, 1);
  assert.equal(claimed.size, 1);
});

test("a claimed but incomplete image attempt never repeats the paid request automatically", async () => {
  const { edition, direction, review } = await inputs();
  const root = `editions/${edition.editionId}`;
  const artifacts = memoryStore();
  artifacts.records.set(`${root}/editorial/selected-edition.json`, Buffer.from(JSON.stringify(edition)));
  artifacts.records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  artifacts.records.set(`${root}/review/approval.json`, Buffer.from(JSON.stringify(review)));
  let calls = 0;
  const handler = createRawPanoramaHandler({
    artifacts,
    claims: { async claimOnce() { return false; } },
    generator: { async generate() { calls += 1; throw new Error("unreachable"); } },
    model: "test-image-model",
  });
  await assert.rejects(handler({ editionId: edition.editionId, confirmPaidGeneration: true }), /inspect it before retrying/);
  assert.equal(calls, 0);
  await assert.rejects(handler({ editionId: edition.editionId }), /confirmPaidGeneration/);
});
