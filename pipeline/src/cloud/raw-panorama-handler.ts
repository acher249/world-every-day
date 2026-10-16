import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { buildScenePrompt } from "../art-direction/prompt.js";
import { artDirectionSchema } from "../art-direction/schema.js";
import { selectedEditionSchema } from "../editorial/edition.js";
import { artifactSha256 } from "../editorial/select.js";
import { NanoBananaGenerator, type PanoramaGenerator } from "../panorama/generator.js";
import { sha256 } from "../panorama/hash.js";
import { buildPanoramaPrompt } from "../panorama/prompt.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { editionReviewSchema } from "../workflow/review.js";
import { parseGoogleKey } from "./google-secret.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  confirmPaidGeneration: z.literal(true),
});

export const sourceImageSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("raw-panorama-source"),
  editionId: inputSchema.shape.editionId,
  model: z.string().min(1).max(160),
  provider: z.literal("google-genai"),
  inputs: z.object({
    selectedEditionSha256: z.string().regex(/^[a-f0-9]{64}$/),
    artDirectionSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewSha256: z.string().regex(/^[a-f0-9]{64}$/),
    promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  image: z.object({
    key: z.string().min(1),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    byteLength: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  elapsedMs: z.number().nonnegative(),
  usage: z.unknown(),
});

export type GenerationClaimStore = {
  claimOnce(key: string, bytes: Uint8Array): Promise<boolean>;
};

async function readJson(artifacts: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await artifacts.read(key);
  if (!bytes) throw new Error(`Required generation input is missing: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

export function createRawPanoramaHandler({
  artifacts,
  claims,
  generator,
  model,
}: {
  artifacts: ArtifactStore;
  claims: GenerationClaimStore;
  generator: PanoramaGenerator;
  model: string;
}) {
  if (!model.trim()) throw new Error("NANO_BANANA_MODEL is required");
  return async (rawInput: unknown) => {
    const { editionId } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const edition = selectedEditionSchema.parse(await readJson(artifacts, `${root}/editorial/selected-edition.json`));
    const direction = artDirectionSchema.parse(await readJson(artifacts, `${root}/art-direction/art-direction.json`));
    const review = editionReviewSchema.parse(await readJson(artifacts, `${root}/review/approval.json`));
    if (edition.editionId !== editionId || direction.editionId !== editionId || review.editionId !== editionId) {
      throw new Error("Generation inputs belong to different editions");
    }
    const selectedEditionSha256 = artifactSha256(edition);
    const artDirectionSha256 = artifactSha256(direction);
    if (direction.inputs?.selectedEditionSha256 !== selectedEditionSha256 ||
        review.inputs.selectedEditionSha256 !== selectedEditionSha256 ||
        review.inputs.artDirectionSha256 !== artDirectionSha256) {
      throw new Error("Generation review does not match the selected edition and art direction");
    }
    const promptSha256 = sha256(buildPanoramaPrompt(buildScenePrompt(direction)));
    const inputs = {
      selectedEditionSha256,
      artDirectionSha256,
      reviewSha256: artifactSha256(review),
      promptSha256,
    };
    const manifestKey = `${root}/panorama/source-image.json`;
    const existing = await artifacts.read(manifestKey);
    if (existing) {
      const manifest = sourceImageSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      if (manifest.editionId !== editionId || manifest.model !== model ||
          JSON.stringify(manifest.inputs) !== JSON.stringify(inputs)) {
        throw new Error("Existing source image does not match the approved generation inputs");
      }
      const image = await artifacts.read(manifest.image.key);
      if (!image || sha256(Buffer.from(image)) !== manifest.image.sha256) {
        throw new Error("Existing source image is missing or has changed");
      }
      return { editionId, key: manifestKey, imageKey: manifest.image.key, status: "reused" };
    }

    const claimed = await claims.claimOnce(
      `${root}/panorama/generation-attempt.json`,
      Buffer.from(`${JSON.stringify({ editionId, model, inputs })}\n`),
    );
    if (!claimed) {
      throw new Error("A paid image-generation attempt already exists; inspect it before retrying");
    }
    const generated = await generator.generate(buildPanoramaPrompt(buildScenePrompt(direction)));
    const mimeType = z.enum(["image/png", "image/jpeg", "image/webp"]).parse(generated.mimeType);
    if (generated.bytes.length === 0 || generated.bytes.length > 64 * 1024 * 1024) {
      throw new Error("Image provider returned an empty or oversized source image");
    }
    const imageKey = `${root}/panorama/source-original`;
    await artifacts.putImmutable({ key: imageKey, contentType: mimeType, bytes: generated.bytes });
    const manifest = sourceImageSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "raw-panorama-source",
      editionId,
      model,
      provider: "google-genai",
      inputs,
      image: { key: imageKey, mimeType, byteLength: generated.bytes.length, sha256: sha256(generated.bytes) },
      elapsedMs: generated.elapsedMs,
      usage: generated.usage,
    });
    await artifacts.putImmutable({
      key: manifestKey,
      contentType: "application/json",
      bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    });
    return { editionId, key: manifestKey, imageKey, status: "created" };
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function main(event: unknown) {
  const bucket = requiredEnvironment("ARTIFACT_BUCKET");
  const secretId = requiredEnvironment("GOOGLE_SECRET_NAME");
  const model = requiredEnvironment("NANO_BANANA_MODEL");
  const secrets = new SecretsManagerClient({});
  const s3 = new S3Client({});
  const generator: PanoramaGenerator = {
    async generate(prompt) {
      const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      if (!response.SecretString) throw new Error("Google secret must contain a string value");
      return new NanoBananaGenerator({ apiKey: parseGoogleKey(response.SecretString), model }).generate(prompt);
    },
  };
  return createRawPanoramaHandler({
    artifacts: new S3ArtifactStore({ bucket, client: s3 }),
    claims: {
      async claimOnce(key, bytes) {
        try {
          await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: "application/json",
            IfNoneMatch: "*",
          }));
          return true;
        } catch (error) {
          if (error instanceof Error && error.name === "PreconditionFailed") return false;
          throw error;
        }
      },
    },
    generator,
    model,
  })(event);
}
