import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { buildScenePrompt } from "../src/art-direction/prompt.js";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { createPanoramaProcessingHandler } from "../src/cloud/panorama-processing-handler.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { sha256 } from "../src/panorama/hash.js";
import { HORIZON_POLICY_VERSION, type HorizonAssessment } from "../src/panorama/horizon.js";
import { DELIVERY_REVIEW_POLICY_VERSION, type SeamReview } from "../src/panorama/seam-review.js";
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
        assert.equal((Array.isArray(reference) ? reference[0] : reference)?.mimeType, "image/png");
        assert.ok((Array.isArray(reference) ? reference[0] : reference)!.bytes.length > 0);
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
  const freshRun = "backfill-demo-fresh-source-v1";
  const freshPanoramaRoot = `${root}/panorama/runs/${freshRun}`;
  const freshSourceKey = `${freshPanoramaRoot}/source-original`;
  const freshSourceBytes = await sharp({ create: {
    width: 16,
    height: 10,
    channels: 3,
    background: { r: 120, g: 80, b: 160 },
  } }).png().toBuffer();
  records.set(freshSourceKey, freshSourceBytes);
  records.set(`${freshPanoramaRoot}/source-image.json`, Buffer.from(JSON.stringify({
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
      key: freshSourceKey,
      mimeType: "image/png",
      byteLength: freshSourceBytes.length,
      sha256: sha256(freshSourceBytes),
    },
    elapsedMs: 10,
    usage: null,
  })));
  // The private revision test uses an edition without an already-approved
  // canonical manifest, as a backfill run does when it reaches processing.
  records.delete(first.key);
  assert.equal((await handler({ editionId, confirmPaidGeneration: true, panoramaAttemptSet: freshRun, panoramaSourceRevision: true })).status, "created");
  assert.equal(calls, 2);
  assert.ok(records.has(`${freshPanoramaRoot}/pole-repair/receipt.json`), "fresh source revisions use isolated pole-repair checkpoints");
  records.set(sourceKey, freshSourceBytes);
  records.set(`${root}/panorama/source-image.json`, records.get(`${freshPanoramaRoot}/source-image.json`)!);
  let reviews = 0;
  const rejectingHandler = createPanoramaProcessingHandler({ artifacts, quality: {
    model: "fixture-review", claims: { async claimOnce(key) { if (claims.has(key)) return false; claims.add(key); return true; } },
    seamReviewer: async () => ({ status: "clear", affectedSectors: [], evidence: "No seam artifacts visible." }),
    reviewer: async () => {
      reviews++;
      if (reviews === 1) throw new SyntaxError("Malformed horizon assessment JSON");
      return {
        sectors: [0,1,2,3].map((sector) => ({sector, visible:true, horizonY:0.2, confidence:0.9, evidence:"Distant sea too high"})),
        tilted:false, collageOrSeams:false, textOrGuides:false,
      };
    },
  } });
  await assert.rejects(rejectingHandler({editionId,confirmPaidGeneration:true}), /Final panorama failed/);
  await assert.rejects(rejectingHandler({editionId,confirmPaidGeneration:true}), /Final panorama failed/);
  assert.equal(reviews, 2, "a malformed final assessment gets one bounded retry and the saved result is reused");
  assert.equal(calls, 2);
});

test("a blocking seam review corrects once and accepts a localized mismatch", async () => {
  const direction = artDirectionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/demo-art-direction.v1.json", import.meta.url), "utf8",
  )) as unknown);
  const editionId = direction.editionId;
  const root = `editions/${editionId}`;
  const sourceBytes = await sharp({ create: { width: 16, height: 10, channels: 3, background: "#5681a1" } }).png().toBuffer();
  const records = new Map<string, Uint8Array>();
  const artifacts: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({ key, bytes, contentType }) {
      const existing = records.get(key);
      if (existing && !Buffer.from(existing).equals(Buffer.from(bytes))) throw new Error(`Artifact changed: ${key}`);
      records.set(key, bytes);
      return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  const sourceKey = `${root}/panorama/source-original`;
  const promptSha256 = sha256(buildPanoramaPrompt(buildScenePrompt(direction)));
  const sourceSha256 = sha256(sourceBytes);
  const conversation = Buffer.from(JSON.stringify({ version: 1, history: [] }));
  const panoramaAttemptSet = "backfill-2026-11-11-seamreview-v1";
  const candidateRoot = `${root}/panorama/quality/${HORIZON_POLICY_VERSION}/${panoramaAttemptSet}/candidate-1`;
  records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction)));
  records.set(sourceKey, sourceBytes);
  records.set(`${root}/panorama/source-image.json`, Buffer.from(JSON.stringify({
    schemaVersion: "1.0.0", artifactType: "raw-panorama-source", editionId, model: "test-image-model", provider: "google-genai",
    inputs: { selectedEditionSha256: "a".repeat(64), artDirectionSha256: artifactSha256(direction), reviewSha256: "b".repeat(64), promptSha256 },
    image: { key: sourceKey, mimeType: "image/png", byteLength: sourceBytes.length, sha256: sourceSha256 }, elapsedMs: 1, usage: null,
  })));
  records.set(`${candidateRoot}/conversation.json`, conversation);
  records.set(`${candidateRoot}/receipt.json`, Buffer.from(JSON.stringify({ sha256: sourceSha256, continuationSha256: sha256(conversation) })));
  const claims = new Set<string>();
  const claimStore = { async claimOnce(key: string) { if (claims.has(key)) return false; claims.add(key); return true; } };
  const centeredAssessment: HorizonAssessment = {
    sectors: [0, 1, 2, 3].map((sector) => ({ sector, visible: true, horizonY: 0.5, confidence: 0.95, evidence: sector === 3 ? "Horizontal smear at the longitude seam" : "Clear distant horizon" })),
    tilted: false, collageOrSeams: false, textOrGuides: false,
  };
  const acceptedAssessment: HorizonAssessment = { ...centeredAssessment, sectors: centeredAssessment.sectors.map((sector) => ({ ...sector, evidence: "Clear, level distant horizon." })) };
  const seamFailure: HorizonAssessment = {
    ...centeredAssessment,
    sectors: centeredAssessment.sectors.map((sector, index) => ({
      ...sector,
      horizonY: [0.4, 0.45, 0.55, 0.65][index]!,
    })),
    collageOrSeams: false,
  };
  const priorDelivery = await sharp({ create: { width: 32, height: 16, channels: 3, background: "#8a7968" } }).png().toBuffer();
  records.set(`${root}/panorama/equirectangular-8192x4096.png`, priorDelivery);
  records.set(`${root}/panorama/quality/${HORIZON_POLICY_VERSION}/${DELIVERY_REVIEW_POLICY_VERSION}/delivery-assessment.json`, Buffer.from(JSON.stringify({
    binding: { imageSha256: sha256(priorDelivery), model: "fixture-review", policy: DELIVERY_REVIEW_POLICY_VERSION },
    assessment: seamFailure,
  })));
  let reviews = 0;
  let seamReviews = 0;
  let generations = 0;
  let handlerContinuation: Uint8Array | undefined;
  const correctedSource = await sharp({ create: { width: 16, height: 10, channels: 3, background: "#688e7d" } }).png().toBuffer();
  const handler = createPanoramaProcessingHandler({
    artifacts,
    processingConfig: { sourceWidth: 16, sourceHeight: 10, deliveryWidth: 32, deliveryHeight: 16, seamFeatherWidth: 2 },
    quality: {
      model: "fixture-review", generationModel: "test-image-model", claims: claimStore,
      reviewer: async () => { reviews++; return acceptedAssessment; },
      seamReviewer: async () => {
        seamReviews++;
        return seamReviews === 1
          ? { status: "blocking", affectedSectors: [3], evidence: "A broad horizontal blur band is visible near the right edge." }
          : { status: "tolerable", affectedSectors: [0, 3], evidence: "A visible terrain and color mismatch remains at the wrap, but the world is still coherent." } satisfies SeamReview;
      },
      generator: { async generate(prompt, reference, continuation) {
        generations++;
        assert.match(prompt, /Repair the longitude continuity/);
        assert.match(prompt, /average distant horizon passed review: preserve its current near-centered, level position/i);
        assert.equal(continuation?.toString(), generations === 1 ? conversation.toString() : "next-turn");
        handlerContinuation = continuation;
        const image = Array.isArray(reference) ? reference[0] : reference;
        assert.ok(image);
        const pixels = await sharp(image.bytes).raw().toBuffer();
        assert.ok(pixels.some((value, index) => index % 3 === 0 && value > 220), "annotated reference includes visible correction marks");
        return { bytes: correctedSource, mimeType: "image/png", elapsedMs: 5, usage: null, continuation: Buffer.from("next-turn") };
      } },
    },
  });
  const result = await handler({ editionId, confirmPaidGeneration: true, panoramaAttemptSet });
  assert.equal(result.status, "corrected");
  assert.equal(generations, 1, "the prior seam assessment is reused and one focused correction is generated");
  assert.equal(reviews, 1, "only the corrected candidate needs a horizon review");
  assert.equal(seamReviews, 2, "each horizon-passing candidate also needs a separate seam review");
  assert.ok(handlerContinuation);
  assert.ok(records.has(`${root}/panorama/delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}/candidate-1/input-annotated.png`));
  const manifest = JSON.parse(Buffer.from(records.get(result.key)!).toString());
  assert.equal(manifest.inputs.deliveryCorrectionAttempt, 1);
  assert.match(manifest.files.delivery8k, new RegExp(`^delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}/candidate-1/`));
  assert.equal(manifest.files.deliveryAssessment, `delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}/candidate-1/delivery-review.json`);
  const linkedReview = JSON.parse(Buffer.from(records.get(`${root}/panorama/${manifest.files.deliveryAssessment}`)!).toString());
  assert.equal(linkedReview.accepted, true);
  assert.equal(linkedReview.seamAssessment.status, "tolerable");
  assert.ok(records.has(`${root}/panorama/${manifest.files.delivery8k}`));
});
