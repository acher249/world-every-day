import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { GeneratedImage, GeneratorContinuation, ImageReference, PanoramaGenerator } from "./generator.js";
import { sha256 } from "./hash.js";
import { annotateHorizon, horizonAssessmentSchema, horizonPasses, horizonPreview, HORIZON_POLICY_VERSION, MAX_PANORAMA_CANDIDATES, type HorizonAssessment, type HorizonReviewer } from "./horizon.js";

export class PanoramaCandidateRejected extends Error {
  constructor() { super("Panorama failed horizon review; a bounded correction attempt is required"); this.name = "PanoramaCandidateRejected"; }
}
const MAX_HORIZON_REVIEW_ATTEMPTS = 3;

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

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
}
const receiptSchema = z.object({
  binding: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sha256: z.string(), elapsedMs: z.number().nonnegative(), usage: z.unknown(),
  continuationSha256: z.string().optional(),
});

/** One new candidate per call: Step Functions owns the bounded retry, not a long-running Lambda loop. */
export function createQualityGenerator(options: {
  generator: PanoramaGenerator; reviewer: HorizonReviewer; artifacts: ArtifactStore;
  claims: { claimOnce(key: string, bytes: Uint8Array): Promise<boolean> };
  root: string; model: string; reviewModel: string; references: ImageReference[];
  requireConversationContinuity?: boolean;
  waitBeforeReviewRetry?: (attempt: number) => Promise<void>;
}): PanoramaGenerator {
  return { async generate(prompt) {
    const { generator, reviewer, artifacts, claims, root, references } = options;
    const binding = sha256(JSON.stringify({ prompt, model: options.model, reviewModel: options.reviewModel,
      version: HORIZON_POLICY_VERSION, references: references.map((image) => sha256(image.bytes)) }));
    let correction: ImageReference | undefined;
    let feedback = "";
    for (let attempt = 1; attempt <= MAX_PANORAMA_CANDIDATES; attempt++) {
      const prefix = `${root}/candidate-${attempt}`;
      const continuationKey = `${prefix}/conversation.json`;
      const existing = await artifacts.read(`${prefix}/receipt.json`);
      let result: GeneratedImage;
      let created = false;
      if (existing) {
        const receipt = receiptSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
        if (receipt.binding !== binding) throw new Error("Panorama candidate inputs changed; use a new run");
        const bytes = await artifacts.read(`${prefix}/image`);
        if (!bytes || sha256(Buffer.from(bytes)) !== receipt.sha256) throw new Error("Panorama candidate missing or changed");
        if (receipt.continuationSha256) {
          const saved = await artifacts.read(continuationKey);
          if (!saved || sha256(Buffer.from(saved)) !== receipt.continuationSha256) {
            throw new Error("Saved Nano Banana conversation is missing or changed; inspect the candidate before retrying");
          }
        } else if (options.requireConversationContinuity) {
          throw new Error("Panorama candidate has no saved Nano Banana conversation state; inspect it before retrying");
        }
        result = { ...receipt, bytes: Buffer.from(bytes) };
      } else {
        const guidedPrompt = attempt === 1
          ? `${prompt}\n\nREFERENCE GUIDANCE: Image 1 is a composition reference only: borrow its spacious distribution, near-centered distant horizon, and coherent terrain. Do not copy its landmarks, objects, colors, or stories. The written camera rule is authoritative.\n\nCRITICAL IMAGE QUALITY RULE: Do not create horizontal blur bands, smeared strips, composited overlays, or abrupt changes in texture or geometry anywhere in the panorama. Keep sky, water, and terrain naturally detailed and continuous across every longitude sector, especially the left-right wrap.\n\nCRITICAL FINAL CHECK: Check that the representative far-distance horizon is level and near the middle row overall. Use the average distant mountain skyline when it hides the mathematical horizon; nearby peaks may rise above it. Preserve varied topography. Correct only a clearly high, low, or tilted overall horizon, then return a clean image without guide marks.`
          : `Edit the panorama using the attached annotated review image of the previous failed candidate and the conversation context. Align the representative far-distance horizon near the solid red centerline (y=50%) overall. The dashed amber lines show the measured average distant skyline in each visible sector; the arrows point toward the target. In mountainous terrain, use the average distant skyline as the horizon proxy; local peaks may rise above it. Preserve the story subjects, their identities, natural scale, style, and varied topography while correcting a clearly high, low, or tilted overall horizon. The final centered 2:1 crop is the complete equirectangular sphere; the extra top and bottom rows in the 16:9 source are discarded padding, not directions beyond the poles. Return a clean image without guide marks, grid, or text. Reviewer measurements: ${feedback}`;
        await artifacts.putImmutable({ key: `${prefix}/prompt.txt`, contentType: "text/plain", bytes: Buffer.from(guidedPrompt) });
        let continuation: GeneratorContinuation | undefined;
        if (attempt > 1) {
          const saved = await artifacts.read(`${root}/candidate-${attempt - 1}/conversation.json`);
          if (!saved && options.requireConversationContinuity) {
            throw new Error("Previous Nano Banana conversation state is missing; inspect the failed candidate before retrying");
          }
          continuation = saved ?? undefined;
        }
        const turnReferences = attempt === 1
          ? references
          : continuation && correction
            ? [correction]
            : [...references, ...(correction ? [correction] : [])];
        if (!await claims.claimOnce(`${prefix}/attempt.json`, Buffer.from(JSON.stringify({ binding })))) {
          throw new Error("An uncertain paid panorama attempt exists; inspect it before retrying");
        }
        result = await generator.generate(guidedPrompt, turnReferences, continuation);
        if (!result.bytes.length || result.bytes.length > 64 * 1024 * 1024) throw new Error("Invalid panorama image size");
        if (options.requireConversationContinuity && !result.continuation) {
          throw new Error("Nano Banana returned no conversation state; refusing to continue as a fresh generation");
        }
        const continuationSha256 = result.continuation ? sha256(Buffer.from(result.continuation)) : undefined;
        if (result.continuation) {
          await artifacts.putImmutable({ key: continuationKey, contentType: "application/json", bytes: result.continuation });
        }
        const receipt = receiptSchema.parse({ binding, mimeType: result.mimeType, elapsedMs: result.elapsedMs, usage: result.usage, sha256: sha256(result.bytes), ...(continuationSha256 ? { continuationSha256 } : {}) });
        await artifacts.putImmutable({ key: `${prefix}/image`, contentType: receipt.mimeType, bytes: result.bytes });
        await artifacts.putImmutable({ key: `${prefix}/receipt.json`, contentType: "application/json", bytes: Buffer.from(JSON.stringify(receipt)) });
        created = true;
      }
      const preview = await horizonPreview(result.bytes);
      const savedReview = await artifacts.read(`${prefix}/assessment.json`);
      let assessment!: HorizonAssessment;
      if (savedReview) {
        assessment = horizonAssessmentSchema.parse(JSON.parse(Buffer.from(savedReview).toString("utf8")));
      } else {
        const imageSha256 = sha256(result.bytes);
        const priorAttempt = await artifacts.read(`${prefix}/review-attempt.json`);
        let reviewed = false;
        let lastError: unknown;
        for (let attempt = 1; attempt <= MAX_HORIZON_REVIEW_ATTEMPTS; attempt++) {
          const attemptKey = `${prefix}/review-attempt-${attempt}.json`;
          // Migrate the old one-shot marker as a consumed first attempt. Review
          // is safe to repeat: each request assesses the same immutable image.
          if ((attempt === 1 && priorAttempt) || await artifacts.read(attemptKey)) continue;
          const claimed = await claims.claimOnce(attemptKey, Buffer.from(JSON.stringify({ binding, imageSha256, attempt })));
          if (!claimed) continue;
          try {
            assessment = horizonAssessmentSchema.parse(await reviewer(preview));
            await artifacts.putImmutable({ key: `${prefix}/assessment.json`, contentType: "application/json", bytes: Buffer.from(JSON.stringify(assessment)) });
            reviewed = true;
            break;
          } catch (error) {
            lastError = error;
            if (!retryableReviewFailure(error)) throw error;
            console.warn(JSON.stringify({ event: "panorama-horizon-review-retry", attempt, maxAttempts: MAX_HORIZON_REVIEW_ATTEMPTS, reason: error instanceof Error ? error.message : "unknown" }));
            if (attempt < MAX_HORIZON_REVIEW_ATTEMPTS) await (options.waitBeforeReviewRetry ?? retryDelay)(attempt);
          }
        }
        if (!reviewed) {
          if (lastError) throw new Error(`Horizon review failed after ${MAX_HORIZON_REVIEW_ATTEMPTS} attempts`, { cause: lastError });
          throw new Error("Horizon review attempts were already consumed without a saved assessment; inspect the candidate before retrying");
        }
      }
      if (horizonPasses(assessment)) return result;
      correction = { bytes: await annotateHorizon(preview, assessment), mimeType: "image/png" };
      await artifacts.putImmutable({ key: `${prefix}/correction.png`, contentType: "image/png", bytes: correction.bytes });
      feedback = assessment.sectors
        .filter((sector) => sector.visible && sector.horizonY !== null)
        .map((sector) => `sector ${sector.sector}: horizon y=${(sector.horizonY! * 100).toFixed(1)}%, confidence=${sector.confidence.toFixed(2)}`)
        .join("; ");
      if (attempt === MAX_PANORAMA_CANDIDATES) throw new Error("All five panorama candidates failed horizon review; publication stopped");
      if (created) throw new PanoramaCandidateRejected();
    }
    throw new Error("No accepted panorama");
  } };
}

export async function loadPanoramaReferences(): Promise<ImageReference[]> {
  const path = resolve(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), "assets/panorama/composition-reference.jpg");
  return [{ bytes: await readFile(path), mimeType: "image/jpeg" }];
}
