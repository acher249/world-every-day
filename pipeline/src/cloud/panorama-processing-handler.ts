import { annotateHorizon, averageVisibleHorizonY, createHorizonReviewer, hasSeamArtifactEvidence, horizonAssessmentSchema, horizonPasses, horizonPreview, HORIZON_POLICY_VERSION, MAX_HORIZON_MIDPOINT_DEVIATION, MAX_PANORAMA_CANDIDATES, type HorizonAssessment, type HorizonReviewer } from "../panorama/horizon.js";
import { createSeamReviewer, DELIVERY_REVIEW_POLICY_VERSION, seamReviewPasses, seamReviewSchema, type SeamReview, type SeamReviewer } from "../panorama/seam-review.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NanoBananaGenerator, type GeneratorContinuation, type PanoramaGenerator } from "../panorama/generator.js";
import { createPoleRepair } from "../panorama/repair-job.js";
import type { GenerationClaimStore } from "./raw-panorama-handler.js";
import { parseGoogleKey } from "./google-secret.js";
import { buildScenePrompt } from "../art-direction/prompt.js";
import { artDirectionSchema } from "../art-direction/schema.js";
import { artifactSha256 } from "../editorial/select.js";
import { defaultProcessingConfig, type PanoramaProcessingConfig } from "../panorama/config.js";
import { sha256 } from "../panorama/hash.js";
import { buildPanoramaPrompt } from "../panorama/prompt.js";
import { runPanorama } from "../panorama/run.js";
import { editionPanoramaManifestSchema } from "../panorama/schema.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { sourceImageSchema } from "./raw-panorama-handler.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  confirmPaidGeneration: z.boolean().optional(),
  recoverAfterUncertainAttempt: z.number().int().min(3).max(10).optional(),
  panoramaAttemptSet: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/).optional(),
  panoramaSourceRevision: z.boolean().optional(),
});
const MAX_DELIVERY_CORRECTIONS = 3;
const MAX_SEAM_REVIEW_ATTEMPTS = 3;
const MAX_FINAL_HORIZON_REVIEW_ATTEMPTS = 3;
const MIN_CORRECTION_REMAINING_MS = 11 * 60 * 1_000;

function retryableReviewFailure(error: unknown): boolean {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return true;
  if (!(error instanceof Error)) return false;
  const details = error as Error & { status?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number } };
  const status = Number(details.status ?? details.$metadata?.httpStatusCode);
  const code = String(details.code ?? "");
  return status === 408 || status === 429 || status >= 500 ||
    ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code) ||
    /DEADLINE_EXCEEDED|timed? ?out|temporarily unavailable/i.test(error.message);
}

function reviewRetryDelay(attempt: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000 * attempt));
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function relativePanoramaArtifactPath(root: string, key: string): string {
  const prefix = `${root}/panorama/`;
  if (!key.startsWith(prefix)) throw new Error("Panorama review artifact is outside its edition prefix");
  return key.slice(prefix.length);
}

function logCorrectionMemory(stage: string, attempt: number): void {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  console.info(JSON.stringify({ event: "panorama-correction-memory", stage, attempt, rss, heapUsed, external, arrayBuffers }));
}

class InsufficientCorrectionTime extends Error {
  constructor() { super("Not enough Lambda time remains for a bounded image correction; resume from saved processing artifacts"); this.name = "InsufficientCorrectionTime"; }
}

async function readJson(artifacts: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await artifacts.read(key);
  if (!bytes) throw new Error(`Required panorama artifact is missing: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

export function createPanoramaProcessingHandler({
  artifacts,
  processingConfig,
  poleRepair,
  quality,
}: {
  artifacts: ArtifactStore;
  processingConfig?: PanoramaProcessingConfig;
  quality?: { reviewer: HorizonReviewer; seamReviewer?: SeamReviewer; model: string; claims: GenerationClaimStore; generator?: PanoramaGenerator; generationModel?: string; remainingTimeMs?: () => number };
  poleRepair?: { generator: PanoramaGenerator; claims: GenerationClaimStore; model: string };
}) {
  return async (rawInput: unknown) => {
    const { editionId, confirmPaidGeneration, recoverAfterUncertainAttempt, panoramaAttemptSet = "primary", panoramaSourceRevision = false } = inputSchema.parse(rawInput);
    if (panoramaSourceRevision && panoramaAttemptSet === "primary") throw new Error("A fresh source revision requires a named panoramaAttemptSet");
    if ((poleRepair || quality) && confirmPaidGeneration !== true) throw new Error("Pole repair requires confirmPaidGeneration=true");
    const root = `editions/${editionId}`;
    const panoramaRoot = `${root}/panorama${panoramaSourceRevision ? `/runs/${panoramaAttemptSet}` : ""}`;
    const canonicalManifestKey = `${root}/panorama/manifest.json`;
    const publicManifest = (manifest: z.infer<typeof editionPanoramaManifestSchema>) => {
      if (!panoramaSourceRevision) return manifest;
      const prefix = `runs/${panoramaAttemptSet}/`;
      return editionPanoramaManifestSchema.parse({
        ...manifest,
        files: Object.fromEntries(Object.entries(manifest.files).map(([name, file]) => [name, file ? `${prefix}${file}` : undefined])),
      });
    };
    type DeliveryReview = { assessment: HorizonAssessment; assessmentKey: string; accepted: boolean; seamReview?: SeamReview; seamReviewKey?: string };
    function applySeamReview(assessment: HorizonAssessment, seam: SeamReview): HorizonAssessment {
      if (seamReviewPasses(seam)) return assessment;
      const sectors = new Set(seam.affectedSectors.length ? seam.affectedSectors : [0, 1, 2, 3]);
      return {
        ...assessment,
        collageOrSeams: true,
        sectors: assessment.sectors.map((sector) => sectors.has(sector.sector)
          ? { ...sector, evidence: `${sector.evidence}; focused seam review ${seam.status}: ${seam.evidence}`.slice(0, 500) }
          : sector),
      };
    }
    async function reviewDelivery(
      bytes: Buffer,
      reviewKey = `${panoramaRoot}/quality/${HORIZON_POLICY_VERSION}/${DELIVERY_REVIEW_POLICY_VERSION}/delivery-assessment.json`,
      seamReviewKey = reviewKey.replace(/delivery-assessment\.json$/, "delivery-seam-assessment.json"),
    ): Promise<DeliveryReview | undefined> {
      if (!quality) return undefined;
      const binding = { imageSha256: sha256(bytes), model: quality.model, policy: DELIVERY_REVIEW_POLICY_VERSION };
      const saved = await artifacts.read(reviewKey);
      let assessment;
      if (saved) {
        const receipt = z.object({ binding: z.object({ imageSha256: z.string(), model: z.string(), policy: z.string() }), assessment: horizonAssessmentSchema }).parse(JSON.parse(Buffer.from(saved).toString("utf8")));
        if (JSON.stringify(receipt.binding) !== JSON.stringify(binding)) throw new Error("Final panorama review inputs changed");
        assessment = receipt.assessment;
      } else {
        let reviewed = false;
        let lastError: unknown;
        const preview = await horizonPreview(bytes);
        for (let attempt = 1; attempt <= MAX_FINAL_HORIZON_REVIEW_ATTEMPTS; attempt += 1) {
          const attemptKey = `${reviewKey}.attempt-${attempt}.json`;
          if (await artifacts.read(attemptKey)) continue;
          if (!await quality.claims.claimOnce(attemptKey, Buffer.from(JSON.stringify({ ...binding, attempt })))) continue;
          try {
            assessment = horizonAssessmentSchema.parse(await quality.reviewer(preview));
            await artifacts.putImmutable({ key: reviewKey, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ binding, assessment })) });
            reviewed = true;
            break;
          } catch (error) {
            lastError = error;
            if (!retryableReviewFailure(error)) throw error;
            console.warn(JSON.stringify({ event: "final-panorama-horizon-review-retry", attempt, maxAttempts: MAX_FINAL_HORIZON_REVIEW_ATTEMPTS, reason: error instanceof Error ? error.message : "unknown" }));
            if (attempt < MAX_FINAL_HORIZON_REVIEW_ATTEMPTS) await reviewRetryDelay(attempt);
          }
        }
        if (!reviewed) {
          if (lastError) throw new Error(`Final panorama horizon review failed after ${MAX_FINAL_HORIZON_REVIEW_ATTEMPTS} attempts`, { cause: lastError });
          throw new Error("Final panorama review attempts were already consumed without a saved assessment; inspect the image before retrying");
        }
        if (!assessment) throw new Error("Final panorama horizon reviewer completed without an assessment");
      }
      if (!horizonPasses(assessment)) return { assessment, assessmentKey: reviewKey, accepted: false };
      if (!quality.seamReviewer) throw new Error("Final panorama approval requires the configured focused seam reviewer");
      const seamBinding = { imageSha256: binding.imageSha256, model: quality.model, policy: DELIVERY_REVIEW_POLICY_VERSION };
      const savedSeam = await artifacts.read(seamReviewKey);
      let seamReview: SeamReview | undefined;
      if (savedSeam) {
        const receipt = z.object({ binding: z.object({ imageSha256: z.string(), model: z.string(), policy: z.string() }), assessment: seamReviewSchema }).parse(JSON.parse(Buffer.from(savedSeam).toString("utf8")));
        if (JSON.stringify(receipt.binding) !== JSON.stringify(seamBinding)) throw new Error("Final panorama seam review inputs changed");
        seamReview = receipt.assessment;
      } else {
        let lastError: unknown;
        for (let attempt = 1; attempt <= MAX_SEAM_REVIEW_ATTEMPTS; attempt += 1) {
          const attemptKey = `${seamReviewKey}.attempt-${attempt}.json`;
          if (!await quality.claims.claimOnce(attemptKey, Buffer.from(JSON.stringify({ ...seamBinding, attempt })))) continue;
          try {
            seamReview = seamReviewSchema.parse(await quality.seamReviewer(await horizonPreview(bytes)));
            await artifacts.putImmutable({ key: seamReviewKey, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ binding: seamBinding, assessment: seamReview })) });
            break;
          } catch (error) {
            lastError = error;
            console.warn(JSON.stringify({ event: "panorama-seam-review-retry", attempt, maxAttempts: MAX_SEAM_REVIEW_ATTEMPTS, reason: error instanceof Error ? error.message : "unknown" }));
            if (attempt < MAX_SEAM_REVIEW_ATTEMPTS) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000 * attempt));
          }
        }
        if (!seamReview) throw new Error(`Panorama seam review failed after ${MAX_SEAM_REVIEW_ATTEMPTS} attempts`, { cause: lastError });
      }
      const combinedReviewKey = reviewKey.replace(/delivery-assessment\.json$/, "delivery-review.json");
      await artifacts.putImmutable({
        key: combinedReviewKey,
        contentType: "application/json",
        bytes: Buffer.from(JSON.stringify({
          binding,
          horizonAssessment: assessment,
          seamBinding,
          seamAssessment: seamReview,
          accepted: horizonPasses(assessment) && seamReviewPasses(seamReview),
        })),
      });
      const accepted = horizonPasses(assessment) && seamReviewPasses(seamReview);
      return { assessment: applySeamReview(assessment, seamReview), assessmentKey: combinedReviewKey, accepted, seamReview, seamReviewKey };
    }

    async function continuationForSource(sourceSha256: string): Promise<GeneratorContinuation | undefined> {
      const candidatesRoot = `${root}/panorama/quality/${HORIZON_POLICY_VERSION}${panoramaAttemptSet === "primary" ? "" : `/${panoramaAttemptSet}`}`;
      for (let index = 1; index <= MAX_PANORAMA_CANDIDATES; index += 1) {
        const prefix = `${candidatesRoot}/candidate-${index}`;
        const receiptBytes = await artifacts.read(`${prefix}/receipt.json`);
        if (!receiptBytes) continue;
        const receipt = z.object({ sha256: z.string(), continuationSha256: z.string().optional() }).parse(JSON.parse(Buffer.from(receiptBytes).toString("utf8")));
        if (receipt.sha256 !== sourceSha256) continue;
        if (!receipt.continuationSha256) throw new Error("Accepted panorama candidate has no saved conversation state");
        const continuation = await artifacts.read(`${prefix}/conversation.json`);
        if (!continuation || sha256(continuation) !== receipt.continuationSha256) throw new Error("Accepted panorama conversation state is missing or changed");
        return continuation;
      }
      return undefined;
    }

    async function saveManifestAndFiles(manifestPath: string, outputDirectory: string, prefix = `${panoramaRoot}/`) {
      const manifest = editionPanoramaManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
      for (const file of Object.values(manifest.files)) {
        if (!file) continue;
        const bytes = await readFile(resolve(outputDirectory, file));
        await artifacts.putImmutable({
          key: `${prefix}${file}`,
          contentType: file === manifest.files.original ? manifest.response.mimeType : "image/png",
          bytes,
        });
      }
      if (prefix !== `${root}/panorama/`) {
        await artifacts.putImmutable({
          key: `${prefix}manifest.json`,
          contentType: "application/json",
          bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
        });
      }
      return manifest;
    }

    async function correctDelivery(input: {
      delivery: Buffer; assessment: HorizonAssessment; scenePrompt: string;
      artDirectionSha256: string; source: z.infer<typeof sourceImageSchema>;
    }): Promise<{ manifest: z.infer<typeof editionPanoramaManifestSchema>; deliveryKey: string }> {
      if (!quality?.generator || !quality.generationModel) throw new Error("Delivery correction requires the configured panorama generator and model");
      let previousDelivery = input.delivery;
      let previousAssessment = input.assessment;
      let continuation = await continuationForSource(input.source.image.sha256);
      if (!continuation) throw new Error("Cannot correct the final panorama without its saved generation conversation");
      const candidatesRoot = `${panoramaRoot}/delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}`;
      let correctionLimit = MAX_DELIVERY_CORRECTIONS;
      if (recoverAfterUncertainAttempt !== undefined) {
        const uncertainPrefix = `${candidatesRoot}/candidate-${recoverAfterUncertainAttempt}`;
        const [claim, response, receipt] = await Promise.all([
          artifacts.read(`${uncertainPrefix}/attempt.json`),
          artifacts.read(`${uncertainPrefix}/response`),
          artifacts.read(`${uncertainPrefix}/receipt.json`),
        ]);
        if (!claim || response || receipt) throw new Error("Recovery must target an existing uncertain paid attempt with no saved response or receipt");
        correctionLimit = recoverAfterUncertainAttempt + 1;
      }
      const config = processingConfig ?? defaultProcessingConfig();
      const deliveryFilename = `equirectangular-${config.deliveryWidth}x${config.deliveryHeight}.png`;
      for (let attempt = 1; attempt <= correctionLimit; attempt += 1) {
        const prefix = `${candidatesRoot}/candidate-${attempt}`;
        const annotated = await annotateHorizon(await horizonPreview(previousDelivery), previousAssessment);
        const averageHorizonY = averageVisibleHorizonY(previousAssessment);
        const confidentHorizonSectors = previousAssessment.sectors.filter((sector) => sector.visible && sector.horizonY !== null && sector.confidence >= 0.8).length;
        const horizonNeedsCorrection = previousAssessment.tilted || confidentHorizonSectors < 2 || averageHorizonY === null || Math.abs(averageHorizonY - 0.5) > MAX_HORIZON_MIDPOINT_DEVIATION;
        const correctionPrompt = `${buildPanoramaPrompt(input.scenePrompt)}\n\nCRITICAL DELIVERY CORRECTION: The annotated image is a 2:1 review of the previous candidate. Correct only the marked visual defect. Magenta outlined sectors identify the reported seam/collage/smear area; the red line marks the y=50% equator and horizon target. Amber lines and arrows show the measured representative distant skyline in each visible sector. ${previousAssessment.collageOrSeams || hasSeamArtifactEvidence(previousAssessment) ? "Repair the longitude continuity and remove the smeared or composited band in the marked sectors; preserve the unaffected scene." : "Preserve the existing longitude seam and scene."} ${horizonNeedsCorrection ? "Make the overall average far-distance skyline level and near the red centerline. A distant mountain skyline is a valid horizon proxy; allow isolated local peaks to rise above it. If the skyline was unobservable, make it clearly estimable in multiple sectors." : "The average distant horizon passed review: preserve its current near-centered, level position. Local skyline variation and peaks above it are acceptable."} ${previousAssessment.textOrGuides ? "Remove all visible text and guide marks from the scene." : "Do not add text or guide marks."} Preserve story landmark identities, scale, locations, style, and varied terrain. Do not shift the horizon to make room for any subject. Recreate a clean 16:9 source whose centered 2:1 crop is the full sphere. Remove all review marks from the output.`;
        const binding = {
          sourceImageSha256: input.source.image.sha256,
          previousDeliverySha256: sha256(previousDelivery),
          assessmentSha256: sha256(Buffer.from(JSON.stringify(previousAssessment))),
          model: quality.generationModel,
          policy: DELIVERY_REVIEW_POLICY_VERSION,
          attempt,
          promptSha256: sha256(correctionPrompt),
        };
        await artifacts.putImmutable({ key: `${prefix}/input-annotated.png`, contentType: "image/png", bytes: annotated });
        await artifacts.putImmutable({ key: `${prefix}/prompt.txt`, contentType: "text/plain", bytes: Buffer.from(correctionPrompt) });
        let generatedBytes = await artifacts.read(`${prefix}/response`);
        let generatedMimeType = "image/png";
        let correctionContinuation: Uint8Array | null = await artifacts.read(`${prefix}/conversation.json`);
        const receiptBytes = await artifacts.read(`${prefix}/receipt.json`);
        if (receiptBytes) {
          const receipt = z.object({ binding: z.record(z.string(), z.unknown()), responseSha256: z.string(), continuationSha256: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).parse(JSON.parse(Buffer.from(receiptBytes).toString("utf8")));
          if (JSON.stringify(receipt.binding) !== JSON.stringify(binding) || !generatedBytes || !correctionContinuation || sha256(generatedBytes) !== receipt.responseSha256 || sha256(correctionContinuation) !== receipt.continuationSha256) throw new Error("Saved delivery correction does not match its immutable inputs");
          generatedMimeType = receipt.mimeType;

          // Failed candidates have already been fully processed and stored. Reuse
          // those immutable outputs instead of running 8K image transforms again
          // when a later correction resumes from the saved conversation.
          const savedDelivery = await artifacts.read(`${prefix}/${deliveryFilename}`);
          const savedAssessmentBytes = await artifacts.read(`${prefix}/delivery-assessment.json`);
          if (savedDelivery && savedAssessmentBytes) {
            const savedReview = z.object({
              binding: z.object({ imageSha256: z.string(), model: z.string(), policy: z.string() }),
              assessment: horizonAssessmentSchema,
            }).parse(JSON.parse(Buffer.from(savedAssessmentBytes).toString("utf8")));
            if (savedReview.binding.imageSha256 !== sha256(savedDelivery) ||
                savedReview.binding.model !== quality.model || savedReview.binding.policy !== DELIVERY_REVIEW_POLICY_VERSION) {
              throw new Error("Saved delivery correction output does not match its immutable review inputs");
            }
            const savedDeliveryReview = await reviewDelivery(
              asBuffer(savedDelivery),
              `${prefix}/delivery-assessment.json`,
              `${prefix}/delivery-seam-assessment.json`,
            );
            if (!savedDeliveryReview?.accepted) {
              previousDelivery = asBuffer(savedDelivery);
              previousAssessment = savedDeliveryReview?.assessment ?? savedReview.assessment;
              continuation = correctionContinuation;
              continue;
            }

            const savedManifestBytes = await artifacts.read(`${prefix}/manifest.json`);
            if (savedManifestBytes) {
              const candidate = editionPanoramaManifestSchema.parse(JSON.parse(Buffer.from(savedManifestBytes).toString("utf8")));
              const files = Object.fromEntries(Object.entries(candidate.files).map(([name, file]) => [name, file ? `delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}/candidate-${attempt}/${file}` : undefined]));
              const correctedManifest = editionPanoramaManifestSchema.parse({
                ...candidate,
                inputs: { artDirectionSha256: input.artDirectionSha256, rawSourceSha256: input.source.image.sha256, rawPromptSha256: input.source.inputs.promptSha256, deliveryCorrectionAttempt: attempt },
                files: { ...files, deliveryAssessment: `delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}/candidate-${attempt}/delivery-review.json` },
              });
              const publishedManifest = publicManifest(correctedManifest);
              await artifacts.putImmutable({ key: canonicalManifestKey, contentType: "application/json", bytes: Buffer.from(`${JSON.stringify(publishedManifest, null, 2)}\n`) });
              return { manifest: publishedManifest, deliveryKey: `${root}/panorama/${publishedManifest.files.delivery8k}` };
            }
          }
        } else {
          if (quality.remainingTimeMs && quality.remainingTimeMs() < MIN_CORRECTION_REMAINING_MS) throw new InsufficientCorrectionTime();
          const existingAttempt = await artifacts.read(`${prefix}/attempt.json`);
          if (existingAttempt) {
            const claimedBinding = JSON.parse(Buffer.from(existingAttempt).toString("utf8")) as unknown;
            if (recoverAfterUncertainAttempt !== undefined && attempt <= recoverAfterUncertainAttempt &&
                !generatedBytes && !receiptBytes && JSON.stringify(claimedBinding) === JSON.stringify(binding)) {
              console.warn(JSON.stringify({ event: "panorama-correction-uncertain-attempt-skipped", attempt }));
              continue;
            }
            throw new Error("An uncertain paid delivery-correction attempt exists; inspect it before retrying");
          }
          if (!await quality.claims.claimOnce(`${prefix}/attempt.json`, Buffer.from(JSON.stringify(binding)))) throw new Error("An uncertain paid delivery-correction attempt exists; inspect it before retrying");
          logCorrectionMemory("before-generation", attempt);
          const generated = await quality.generator.generate(correctionPrompt, { bytes: annotated, mimeType: "image/png" }, continuation);
          logCorrectionMemory("after-generation", attempt);
          if (!generated.bytes.length || generated.bytes.length > 64 * 1024 * 1024 || !generated.continuation) throw new Error("Delivery correction returned an invalid image or missing conversation state");
          generatedBytes = generated.bytes;
          correctionContinuation = generated.continuation;
          generatedMimeType = generated.mimeType;
          await artifacts.putImmutable({ key: `${prefix}/response`, contentType: generated.mimeType, bytes: generated.bytes });
          await artifacts.putImmutable({ key: `${prefix}/conversation.json`, contentType: "application/json", bytes: generated.continuation });
          const mimeType = z.enum(["image/png", "image/jpeg", "image/webp"]).parse(generated.mimeType);
          await artifacts.putImmutable({ key: `${prefix}/receipt.json`, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ binding, responseSha256: sha256(generated.bytes), continuationSha256: sha256(generated.continuation), mimeType, elapsedMs: generated.elapsedMs, usage: generated.usage })) });
        }

        const attemptRoot = await mkdtemp(join(tmpdir(), "world-panorama-correction-"));
        try {
          const outputDirectory = resolve(attemptRoot, "output");
          const manifestPath = await runPanorama({
            artDirectionSha256: input.artDirectionSha256,
            editionId,
            scenePrompt: input.scenePrompt,
            requestPrompt: correctionPrompt,
            model: quality.generationModel,
            outputDirectory,
            processingConfig,
            // The corrected source is an edit of a pole-repaired delivery; avoid a
            // second paid pole call in this bounded correction pass.
            generator: { async generate() { return { bytes: Buffer.from(generatedBytes!), mimeType: generatedMimeType, elapsedMs: 0, usage: null, continuation: correctionContinuation ?? undefined }; } },
          });
          const candidate = editionPanoramaManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
          const delivery = await readFile(resolve(outputDirectory, candidate.files.delivery8k));
          const deliveryAssessmentKey = `${prefix}/delivery-assessment.json`;
          let assessment: HorizonAssessment;
          const savedAssessment = await artifacts.read(deliveryAssessmentKey);
          if (savedAssessment) {
            const saved = z.object({ binding: z.object({ imageSha256: z.string(), model: z.string(), policy: z.string() }), assessment: horizonAssessmentSchema }).parse(JSON.parse(Buffer.from(savedAssessment).toString("utf8")));
            if (saved.binding.imageSha256 !== sha256(delivery) || saved.binding.model !== quality.model || saved.binding.policy !== DELIVERY_REVIEW_POLICY_VERSION) throw new Error("Saved correction review does not match its delivery image");
            assessment = saved.assessment;
          } else {
            const reviewBinding = { imageSha256: sha256(delivery), model: quality.model, policy: DELIVERY_REVIEW_POLICY_VERSION };
            if (!await quality.claims.claimOnce(`${prefix}/delivery-review-attempt.json`, Buffer.from(JSON.stringify(reviewBinding)))) throw new Error("Uncertain delivery-correction review; inspect it before retrying");
            assessment = horizonAssessmentSchema.parse(await quality.reviewer(await horizonPreview(delivery)));
            await artifacts.putImmutable({ key: deliveryAssessmentKey, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ binding: reviewBinding, assessment })) });
          }
          await saveManifestAndFiles(manifestPath, outputDirectory, `${prefix}/`);
          const seamReviewKey = `${prefix}/delivery-seam-assessment.json`;
          const deliveryReview = await reviewDelivery(delivery, deliveryAssessmentKey, seamReviewKey);
          if (deliveryReview?.accepted) {
          const files = Object.fromEntries(Object.entries(candidate.files).map(([name, file]) => [name, file ? `delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}/candidate-${attempt}/${file}` : undefined]));
            const correctedManifest = editionPanoramaManifestSchema.parse({
              ...candidate,
              inputs: { artDirectionSha256: input.artDirectionSha256, rawSourceSha256: input.source.image.sha256, rawPromptSha256: input.source.inputs.promptSha256, deliveryCorrectionAttempt: attempt },
                files: { ...files, deliveryAssessment: `delivery-corrections/${DELIVERY_REVIEW_POLICY_VERSION}/candidate-${attempt}/delivery-review.json` },
            });
            const publishedManifest = publicManifest(correctedManifest);
            await artifacts.putImmutable({ key: canonicalManifestKey, contentType: "application/json", bytes: Buffer.from(`${JSON.stringify(publishedManifest, null, 2)}\n`) });
            return { manifest: publishedManifest, deliveryKey: `${root}/panorama/${publishedManifest.files.delivery8k}` };
          }
          previousDelivery = delivery;
          previousAssessment = deliveryReview?.assessment ?? assessment;
          continuation = correctionContinuation ?? undefined;
        } finally {
          await rm(attemptRoot, { recursive: true, force: true });
        }
      }
      throw new Error(`Final panorama failed visual review after ${correctionLimit} seam/horizon corrections; publication stopped`);
    }

    const source = sourceImageSchema.parse(await readJson(artifacts, `${panoramaRoot}/source-image.json`));
    const direction = artDirectionSchema.parse(await readJson(artifacts, `${root}/art-direction/art-direction.json`));
    if (source.editionId !== editionId || direction.editionId !== editionId ||
        source.inputs.artDirectionSha256 !== artifactSha256(direction)) {
      throw new Error("Raw source image does not match this edition's art direction");
    }
    const scenePrompt = buildScenePrompt(direction);
    const key = canonicalManifestKey;
    const existing = await artifacts.read(key);
    if (existing) {
      const manifest = editionPanoramaManifestSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      const delivery = await artifacts.read(`${root}/panorama/${manifest.files.delivery8k}`);
      const rawSourceSha256 = manifest.inputs?.rawSourceSha256 ?? manifest.response.originalSha256;
      const rawPromptSha256 = manifest.inputs?.rawPromptSha256 ?? manifest.request.promptSha256;
      if (manifest.editionId !== editionId ||
          manifest.inputs.artDirectionSha256 !== source.inputs.artDirectionSha256 ||
          rawSourceSha256 !== source.image.sha256 ||
          rawPromptSha256 !== source.inputs.promptSha256 ||
          !delivery || sha256(Buffer.from(delivery)) !== manifest.outputs.delivery8kSha256) {
        throw new Error("Existing panorama does not match the approved raw source image");
      }
      const review = await reviewDelivery(Buffer.from(delivery));
      if (review && !review.accepted) throw new Error("Final panorama failed visual review; publication stopped");
      return { editionId, key, deliveryKey: `${root}/panorama/${manifest.files.delivery8k}`, status: "reused" };
    }
    const sourceBytes = await artifacts.read(source.image.key);
    if (!sourceBytes || sourceBytes.length !== source.image.byteLength ||
        sha256(Buffer.from(sourceBytes)) !== source.image.sha256) {
      throw new Error("Raw source image is missing or has changed");
    }
    // Recover a prior private final review without repeating pole repair. This is
    // important when a delivery was generated but failed its gate before a
    // manifest was written.
    const priorDeliveryKey = `${panoramaRoot}/equirectangular-8192x4096.png`;
    const priorDelivery = await artifacts.read(priorDeliveryKey);
    if (priorDelivery && quality) {
      const priorReview = await reviewDelivery(Buffer.from(priorDelivery));
      if (priorReview && !priorReview.accepted) {
        if (!quality.generator || !quality.generationModel) throw new Error("Final panorama failed horizon/visual review; publication stopped");
        const corrected = await correctDelivery({ delivery: Buffer.from(priorDelivery), assessment: priorReview.assessment, scenePrompt, artDirectionSha256: source.inputs.artDirectionSha256, source });
        return { editionId, key, deliveryKey: corrected.deliveryKey, status: "corrected" };
      }
    }
    const temporaryRoot = await mkdtemp(join(tmpdir(), "world-panorama-"));
    try {
      const outputDirectory = resolve(temporaryRoot, "output");
      const manifestPath = await runPanorama({
        artDirectionSha256: source.inputs.artDirectionSha256,
        editionId,
        scenePrompt,
        model: source.model,
        outputDirectory,
        provider: source.provider,
        processingConfig,
        repairPoles: poleRepair ? createPoleRepair({
          ...poleRepair,
          artifacts,
          editionId,
          scenePrompt,
          // A fresh panorama revision must own its own pole-repair checkpoint;
          // otherwise an older image's immutable receipt blocks processing.
          artifactRoot: `${panoramaRoot}/pole-repair`,
        }) : undefined,
        generator: {
          async generate() {
            return {
              bytes: Buffer.from(sourceBytes),
              mimeType: source.image.mimeType,
              elapsedMs: source.elapsedMs,
              usage: source.usage,
            };
          },
        },
      });
      const manifest = editionPanoramaManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
      for (const file of Object.values(manifest.files)) {
        if (!file) continue;
        const bytes = await readFile(resolve(outputDirectory, file));
        await artifacts.putImmutable({
          key: `${panoramaRoot}/${file}`,
          contentType: file === manifest.files.original ? source.image.mimeType : "image/png",
          bytes,
        });
      }
      const deliveryBytes = await readFile(resolve(outputDirectory, manifest.files.delivery8k));
      const review = await reviewDelivery(deliveryBytes);
      if (review && !review.accepted) {
        if (!quality?.generator || !quality.generationModel) throw new Error("Final panorama failed horizon/visual review; publication stopped");
        const corrected = await correctDelivery({ delivery: deliveryBytes, assessment: review.assessment, scenePrompt, artDirectionSha256: source.inputs.artDirectionSha256, source });
        return { editionId, key, deliveryKey: corrected.deliveryKey, status: "corrected" };
      }
      const approvedManifest = editionPanoramaManifestSchema.parse({
        ...manifest,
        inputs: { artDirectionSha256: source.inputs.artDirectionSha256, rawSourceSha256: source.image.sha256, rawPromptSha256: source.inputs.promptSha256 },
        files: { ...manifest.files, deliveryAssessment: review ? relativePanoramaArtifactPath(root, review.assessmentKey) : undefined },
      });
      const publishedManifest = publicManifest(approvedManifest);
      await artifacts.putImmutable({
        key,
        contentType: "application/json",
        bytes: Buffer.from(`${JSON.stringify(publishedManifest, null, 2)}\n`),
      });
      return { editionId, key, deliveryKey: `${root}/panorama/${publishedManifest.files.delivery8k}`, status: "created" };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  };
}

export async function main(event: unknown, context?: { getRemainingTimeInMillis(): number }) {
  const bucket = process.env.ARTIFACT_BUCKET?.trim();
  if (!bucket) throw new Error("Missing required environment variable: ARTIFACT_BUCKET");
  const secretId = process.env.GOOGLE_SECRET_NAME?.trim();
  const model = process.env.NANO_BANANA_MODEL?.trim();
  if (!secretId || !model) throw new Error("Pole repair requires GOOGLE_SECRET_NAME and NANO_BANANA_MODEL");
  const client = new S3Client({});
  const secrets = new SecretsManagerClient({});
  const claims: GenerationClaimStore = { async claimOnce(key, bytes) {
    try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/json", IfNoneMatch: "*" })); return true; }
    catch (error) { if (error instanceof Error && error.name === "PreconditionFailed") return false; throw error; }
  } };
  const reviewModel = process.env.PANORAMA_REVIEW_MODEL?.trim();
  if (!reviewModel) throw new Error("PANORAMA_REVIEW_MODEL is required");
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!secret.SecretString) throw new Error("Google secret must contain a string value");
  const generator = new NanoBananaGenerator({ apiKey: parseGoogleKey(secret.SecretString), model });
  return createPanoramaProcessingHandler({
    artifacts: new S3ArtifactStore({ bucket, client }),
    quality: {
      model: reviewModel,
      claims,
      reviewer: createHorizonReviewer(parseGoogleKey(secret.SecretString), reviewModel),
      seamReviewer: createSeamReviewer(parseGoogleKey(secret.SecretString), reviewModel),
      generator,
      generationModel: model,
      remainingTimeMs: context ? () => context.getRemainingTimeInMillis() : undefined,
    },
    poleRepair: { model,
      generator,
      claims,
    },
  })(event);
}
