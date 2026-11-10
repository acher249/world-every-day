import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { GeneratedImage, ImageReference, PanoramaGenerator } from "./generator.js";
import { sha256 } from "./hash.js";
import { annotateHorizon, geometryGuide, horizonAssessmentSchema, horizonPasses, horizonPreview, HORIZON_POLICY_VERSION, MAX_PANORAMA_CANDIDATES, type HorizonReviewer } from "./horizon.js";

export class PanoramaCandidateRejected extends Error {
  constructor() { super("Panorama failed horizon review; a bounded correction attempt is required"); this.name = "PanoramaCandidateRejected"; }
}
const receiptSchema = z.object({
  binding: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sha256: z.string(), elapsedMs: z.number().nonnegative(), usage: z.unknown(),
});

/** One new candidate per call: Step Functions owns the bounded retry, not a long-running Lambda loop. */
export function createQualityGenerator(options: {
  generator: PanoramaGenerator; reviewer: HorizonReviewer; artifacts: ArtifactStore;
  claims: { claimOnce(key: string, bytes: Uint8Array): Promise<boolean> };
  root: string; model: string; reviewModel: string; references: ImageReference[];
}): PanoramaGenerator {
  return { async generate(prompt) {
    const { generator, reviewer, artifacts, claims, root, references } = options;
    const binding = sha256(JSON.stringify({ prompt, model: options.model, reviewModel: options.reviewModel,
      version: HORIZON_POLICY_VERSION, references: references.map((image) => sha256(image.bytes)) }));
    let correction: ImageReference | undefined;
    let feedback = "";
    for (let attempt = 1; attempt <= MAX_PANORAMA_CANDIDATES; attempt++) {
      const prefix = `${root}/candidate-${attempt}`;
      const existing = await artifacts.read(`${prefix}/receipt.json`);
      let result: GeneratedImage;
      let created = false;
      if (existing) {
        const receipt = receiptSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
        if (receipt.binding !== binding) throw new Error("Panorama candidate inputs changed; use a new run");
        const bytes = await artifacts.read(`${prefix}/image`);
        if (!bytes || sha256(Buffer.from(bytes)) !== receipt.sha256) throw new Error("Panorama candidate missing or changed");
        result = { ...receipt, bytes: Buffer.from(bytes) };
      } else {
        const guidedPrompt = `${prompt}\n\nREFERENCE GUIDANCE: Image 1 is a composition reference only: borrow spacious distribution and coherent terrain, never its objects, colors or stories. Image 2 is an exact 2:1 geometry guide: its red equator is y=50%. It overrides any apparent horizon in the composition reference. Never copy grid lines, red lines, text or guide colors. ${correction ? `Image 3 is your previous failed candidate. Red is the required equator; amber marks the reviewer's observed horizon where visible. ${feedback} Recompose from a level camera; do not merely shift, crop or stretch the old image. Preserve today's story subjects.` : ""}\n\nCRITICAL FINAL CHECK: The distant level horizon must be on the middle row in every visible direction. Preserve topography. Check your work; correct any failure before returning the clean image without guide marks.`;
        await artifacts.putImmutable({ key: `${prefix}/prompt.txt`, contentType: "text/plain", bytes: Buffer.from(guidedPrompt) });
        if (!await claims.claimOnce(`${prefix}/attempt.json`, Buffer.from(JSON.stringify({ binding })))) {
          throw new Error("An uncertain paid panorama attempt exists; inspect it before retrying");
        }
        result = await generator.generate(guidedPrompt, [...references, ...(correction ? [correction] : [])]);
        if (!result.bytes.length || result.bytes.length > 64 * 1024 * 1024) throw new Error("Invalid panorama image size");
        const receipt = receiptSchema.parse({ binding, mimeType: result.mimeType, elapsedMs: result.elapsedMs, usage: result.usage, sha256: sha256(result.bytes) });
        await artifacts.putImmutable({ key: `${prefix}/image`, contentType: receipt.mimeType, bytes: result.bytes });
        await artifacts.putImmutable({ key: `${prefix}/receipt.json`, contentType: "application/json", bytes: Buffer.from(JSON.stringify(receipt)) });
        created = true;
      }
      const preview = await horizonPreview(result.bytes);
      const savedReview = await artifacts.read(`${prefix}/assessment.json`);
      let assessment;
      if (savedReview) {
        assessment = horizonAssessmentSchema.parse(JSON.parse(Buffer.from(savedReview).toString("utf8")));
      } else {
        if (!await claims.claimOnce(`${prefix}/review-attempt.json`, Buffer.from(JSON.stringify({ binding, imageSha256: sha256(result.bytes) })))) {
          throw new Error("An uncertain horizon review exists; inspect it before retrying");
        }
        assessment = horizonAssessmentSchema.parse(await reviewer(preview));
        await artifacts.putImmutable({ key: `${prefix}/assessment.json`, contentType: "application/json", bytes: Buffer.from(JSON.stringify(assessment)) });
      }
      if (horizonPasses(assessment)) return result;
      correction = { bytes: await annotateHorizon(preview, assessment), mimeType: "image/png" };
      await artifacts.putImmutable({ key: `${prefix}/correction.png`, contentType: "image/png", bytes: correction.bytes });
      feedback = JSON.stringify(assessment);
      if (attempt === MAX_PANORAMA_CANDIDATES) throw new Error("All five panorama candidates failed horizon review; publication stopped");
      if (created) throw new PanoramaCandidateRejected();
    }
    throw new Error("No accepted panorama");
  } };
}

export async function loadPanoramaReferences(): Promise<ImageReference[]> {
  const path = resolve(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), "assets/panorama/composition-reference.jpg");
  return [{ bytes: await readFile(path), mimeType: "image/jpeg" }, await geometryGuide()];
}
