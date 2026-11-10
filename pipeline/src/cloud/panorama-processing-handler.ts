import { createHorizonReviewer, horizonAssessmentSchema, horizonPasses, horizonPreview, HORIZON_POLICY_VERSION, type HorizonReviewer } from "../panorama/horizon.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NanoBananaGenerator, type PanoramaGenerator } from "../panorama/generator.js";
import { createPoleRepair } from "../panorama/repair-job.js";
import type { GenerationClaimStore } from "./raw-panorama-handler.js";
import { parseGoogleKey } from "./google-secret.js";
import { buildScenePrompt } from "../art-direction/prompt.js";
import { artDirectionSchema } from "../art-direction/schema.js";
import { artifactSha256 } from "../editorial/select.js";
import { type PanoramaProcessingConfig } from "../panorama/config.js";
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
});

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
  quality?: { reviewer: HorizonReviewer; model: string; claims: GenerationClaimStore };
  poleRepair?: { generator: PanoramaGenerator; claims: GenerationClaimStore; model: string };
}) {
  return async (rawInput: unknown) => {
    const { editionId, confirmPaidGeneration } = inputSchema.parse(rawInput);
    if ((poleRepair || quality) && confirmPaidGeneration !== true) throw new Error("Pole repair requires confirmPaidGeneration=true");
    const root = `editions/${editionId}`;
    async function checkDelivery(bytes: Buffer) {
      if (!quality) return;
      const binding = { imageSha256: sha256(bytes), model: quality.model, policy: HORIZON_POLICY_VERSION };
      const reviewKey = `${root}/panorama/delivery-assessment.json`;
      const saved = await artifacts.read(reviewKey);
      let assessment;
      if (saved) {
        const receipt = z.object({ binding: z.object({ imageSha256: z.string(), model: z.string(), policy: z.string() }), assessment: horizonAssessmentSchema }).parse(JSON.parse(Buffer.from(saved).toString("utf8")));
        if (JSON.stringify(receipt.binding) !== JSON.stringify(binding)) throw new Error("Final panorama review inputs changed");
        assessment = receipt.assessment;
      } else {
        if (!await quality.claims.claimOnce(`${root}/panorama/delivery-review-attempt.json`, Buffer.from(JSON.stringify(binding)))) throw new Error("Uncertain final panorama review; inspect before retrying");
        assessment = horizonAssessmentSchema.parse(await quality.reviewer(await horizonPreview(bytes)));
        await artifacts.putImmutable({ key: reviewKey, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ binding, assessment })) });
      }
      if (!horizonPasses(assessment)) throw new Error("Final panorama failed horizon/visual review; publication stopped");
    }
    const source = sourceImageSchema.parse(await readJson(artifacts, `${root}/panorama/source-image.json`));
    const direction = artDirectionSchema.parse(await readJson(artifacts, `${root}/art-direction/art-direction.json`));
    if (source.editionId !== editionId || direction.editionId !== editionId ||
        source.inputs.artDirectionSha256 !== artifactSha256(direction)) {
      throw new Error("Raw source image does not match this edition's art direction");
    }
    const scenePrompt = buildScenePrompt(direction);
    if (source.inputs.promptSha256 !== sha256(buildPanoramaPrompt(scenePrompt))) {
      throw new Error("Raw source image prompt does not match current art direction");
    }
    const key = `${root}/panorama/manifest.json`;
    const existing = await artifacts.read(key);
    if (existing) {
      const manifest = editionPanoramaManifestSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      const delivery = await artifacts.read(`${root}/panorama/${manifest.files.delivery8k}`);
      if (manifest.editionId !== editionId ||
          manifest.inputs.artDirectionSha256 !== source.inputs.artDirectionSha256 ||
          manifest.response.originalSha256 !== source.image.sha256 ||
          manifest.request.promptSha256 !== source.inputs.promptSha256 ||
          !delivery || sha256(Buffer.from(delivery)) !== manifest.outputs.delivery8kSha256) {
        throw new Error("Existing panorama does not match the approved raw source image");
      }
      await checkDelivery(Buffer.from(delivery));
      return { editionId, key, deliveryKey: `${root}/panorama/${manifest.files.delivery8k}`, status: "reused" };
    }
    const sourceBytes = await artifacts.read(source.image.key);
    if (!sourceBytes || sourceBytes.length !== source.image.byteLength ||
        sha256(Buffer.from(sourceBytes)) !== source.image.sha256) {
      throw new Error("Raw source image is missing or has changed");
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
        repairPoles: poleRepair ? createPoleRepair({ ...poleRepair, artifacts, editionId, scenePrompt }) : undefined,
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
          key: `${root}/panorama/${file}`,
          contentType: file === manifest.files.original ? source.image.mimeType : "image/png",
          bytes,
        });
      }
      await checkDelivery(await readFile(resolve(outputDirectory, manifest.files.delivery8k)));
      await artifacts.putImmutable({
        key,
        contentType: "application/json",
        bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      });
      return { editionId, key, deliveryKey: `${root}/panorama/${manifest.files.delivery8k}`, status: "created" };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  };
}

export async function main(event: unknown) {
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
  return createPanoramaProcessingHandler({
    artifacts: new S3ArtifactStore({ bucket, client }),
    quality: { model: reviewModel, claims, reviewer: createHorizonReviewer(parseGoogleKey(secret.SecretString), reviewModel) },
    poleRepair: { model,
      generator: { async generate(prompt, reference) {
        const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
        if (!result.SecretString) throw new Error("Google secret must contain a string value");
        return new NanoBananaGenerator({ apiKey: parseGoogleKey(result.SecretString), model }).generate(prompt, reference);
      } },
      claims,
    },
  })(event);
}
