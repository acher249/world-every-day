import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { createRawPanoramaHandler } from "../src/cloud/raw-panorama-handler.js";
import { selectedEditionSchema } from "../src/editorial/edition.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { sha256 } from "../src/panorama/hash.js";
import { buildScenePrompt } from "../src/art-direction/prompt.js";
import { buildPanoramaPrompt } from "../src/panorama/prompt.js";
import { HORIZON_POLICY_VERSION, type HorizonAssessment } from "../src/panorama/horizon.js";
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

test("historical source reuse permits only a prompt-hash difference when explicitly requested", async () => {
  const { edition, direction, review } = await inputs();
  const root = `editions/${edition.editionId}`;
  const artifacts = memoryStore();
  const sourceBytes = Buffer.from("previously approved source image");
  const sourceKey = `${root}/panorama/source-original`;
  const currentInputs = {
    selectedEditionSha256: artifactSha256(edition),
    artDirectionSha256: artifactSha256(direction),
    reviewSha256: artifactSha256(review),
    promptSha256: sha256(buildPanoramaPrompt(buildScenePrompt(direction))),
  };
  artifacts.records.set(`${root}/editorial/selected-edition.json`, Buffer.from(JSON.stringify(edition)));
  artifacts.records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  artifacts.records.set(`${root}/review/approval.json`, Buffer.from(JSON.stringify(review)));
  artifacts.records.set(sourceKey, sourceBytes);
  artifacts.records.set(`${root}/panorama/source-image.json`, Buffer.from(JSON.stringify({
    schemaVersion: "1.0.0",
    artifactType: "raw-panorama-source",
    editionId: edition.editionId,
    model: "test-image-model",
    provider: "google-genai",
    inputs: { ...currentInputs, promptSha256: "0".repeat(64) },
    image: { key: sourceKey, mimeType: "image/png", byteLength: sourceBytes.length, sha256: sha256(sourceBytes) },
    elapsedMs: 10,
    usage: null,
  })));
  let calls = 0;
  const handler = createRawPanoramaHandler({
    artifacts,
    claims: { async claimOnce() { return true; } },
    generator: { async generate() { calls += 1; throw new Error("must not regenerate an existing source"); } },
    model: "test-image-model",
  });

  await assert.rejects(handler({ editionId: edition.editionId, confirmPaidGeneration: true }), /approved generation inputs/);
  assert.equal((await handler({
    editionId: edition.editionId,
    confirmPaidGeneration: true,
    allowPromptDriftForExistingSource: true,
  })).status, "reused");
  assert.equal(calls, 0);
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

test("a named panorama source revision writes separately and leaves the primary source immutable", async () => {
  const { edition, direction, review } = await inputs();
  const root = `editions/${edition.editionId}`;
  const artifacts = memoryStore();
  artifacts.records.set(`${root}/editorial/selected-edition.json`, Buffer.from(JSON.stringify(edition)));
  artifacts.records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  artifacts.records.set(`${root}/review/approval.json`, Buffer.from(JSON.stringify(review)));
  const primary = Buffer.from("original source");
  artifacts.records.set(`${root}/panorama/source-original`, primary);
  artifacts.records.set(`${root}/panorama/source-image.json`, Buffer.from(JSON.stringify({ immutable: true })));
  const revision = "backfill-2026-11-12-fresh-v1";
  let calls = 0;
  const handler = createRawPanoramaHandler({
    artifacts,
    claims: { async claimOnce() { return true; } },
    generator: { async generate() { calls++; return { bytes: Buffer.from("fresh source"), mimeType: "image/png", elapsedMs: 10, usage: null }; } },
    model: "test-image-model",
  });
  const result = await handler({
    editionId: edition.editionId,
    confirmPaidGeneration: true,
    panoramaAttemptSet: revision,
    panoramaSourceRevision: true,
  });
  assert.equal(result.status, "created");
  assert.equal(result.key, `${root}/panorama/runs/${revision}/source-image.json`);
  assert.deepEqual(artifacts.records.get(`${root}/panorama/source-original`), primary);
  assert.equal(calls, 1);
  await assert.rejects(handler({ editionId: edition.editionId, confirmPaidGeneration: true, panoramaSourceRevision: true }), /named panoramaAttemptSet/);
});

test("cloud retry restores the saved Nano Banana conversation and sends only the annotated image", async () => {
  const { edition, direction, review } = await inputs();
  const root = `editions/${edition.editionId}`;
  const artifacts = memoryStore();
  artifacts.records.set(`${root}/editorial/selected-edition.json`, Buffer.from(JSON.stringify(edition)));
  artifacts.records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  artifacts.records.set(`${root}/review/approval.json`, Buffer.from(JSON.stringify(review)));
  const claims = new Set<string>();
  const image = await sharp({ create: { width: 128, height: 72, channels: 3, background: "#789" } }).png().toBuffer();
  const firstConversation = Buffer.from('{"history":"first turn with thought signature"}');
  const secondConversation = Buffer.from('{"history":"second turn with thought signatures"}');
  const calls: Array<{ references: unknown; continuation: Uint8Array | undefined }> = [];
  let reviews = 0;
  const centered = (y: number): HorizonAssessment => ({
    sectors: [0, 1, 2, 3].map((sector) => ({ sector, visible: true, horizonY: y, confidence: 0.95, evidence: "Distant ocean horizon" })),
    tilted: false,
    collageOrSeams: false,
    textOrGuides: false,
  });
  const handler = createRawPanoramaHandler({
    artifacts,
    claims: { async claimOnce(key) { if (claims.has(key)) return false; claims.add(key); return true; } },
    generator: { async generate(_prompt, references, continuation) {
      calls.push({ references, continuation });
      return {
        bytes: image,
        mimeType: "image/png",
        elapsedMs: 10,
        usage: null,
        continuation: calls.length === 1 ? firstConversation : secondConversation,
      };
    } },
    model: "test-image-model",
    quality: {
      reviewModel: "test-review-model",
      references: [{ bytes: image, mimeType: "image/png" }],
      reviewer: async () => centered(reviews++ === 0 ? 0.3 : 0.5),
    },
  });
  const event = { editionId: edition.editionId, confirmPaidGeneration: true, panoramaAttemptSet: "backfill-2026-11-11-seamreview-v1" };

  await assert.rejects(handler(event), (error: unknown) => error instanceof Error && error.name === "PanoramaCandidateRejected");
  const attemptRoot = `${root}/panorama/quality/${HORIZON_POLICY_VERSION}/backfill-2026-11-11-seamreview-v1`;
  assert.deepEqual(artifacts.records.get(`${attemptRoot}/candidate-1/conversation.json`), firstConversation);
  assert.equal((await handler(event)).status, "created");

  assert.equal(calls.length, 2);
  assert.equal(Array.isArray(calls[0]?.references) && calls[0].references.length, 1);
  assert.equal(Array.isArray(calls[1]?.references) && calls[1].references.length, 1);
  assert.deepEqual(calls[1]?.continuation, firstConversation);
  assert.deepEqual(artifacts.records.get(`${attemptRoot}/candidate-2/conversation.json`), secondConversation);
  const source = JSON.parse(Buffer.from(artifacts.records.get(`${root}/panorama/source-image.json`)!).toString());
  assert.equal(source.inputs.qualityRunId, "backfill-2026-11-11-seamreview-v1");
  assert.equal(reviews, 2);
});
