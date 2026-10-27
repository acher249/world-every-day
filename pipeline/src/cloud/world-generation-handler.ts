import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { artifactSha256 } from "../editorial/select.js";
import { sha256 } from "../panorama/hash.js";
import { editionPanoramaManifestSchema } from "../panorama/schema.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import type { WorldGenerator } from "../world/provider.js";
import { imageReviewSchema } from "../world/image-review.js";
import { createWorldIdempotencyKey } from "../world/run.js";
import {
  generatedWorldManifestSchema,
  worldGenerationRequestSchema,
  worldOperationRecordSchema,
} from "../world/schema.js";
import { MAX_WORLD_ATTEMPTS, retryableWorldFailure } from "../world/retry-policy.js";
import { WorldLabsGenerator } from "../world/world-labs.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  mode: z.enum(["start", "poll"]),
  confirmPaidWorld: z.literal(true),
  pollCount: z.number().int().min(0).max(90).optional(),
});

type ClaimStore = { claimOnce(key: string, bytes: Uint8Array): Promise<boolean> };

async function readJson(artifacts: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await artifacts.read(key);
  if (!bytes) throw new Error(`Required world artifact is missing: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createCloudWorldHandler({
  artifacts,
  claims,
  generator,
  model,
  now = () => new Date(),
}: {
  artifacts: ArtifactStore;
  claims: ClaimStore;
  generator: WorldGenerator;
  model: string;
  now?: () => Date;
}) {
  if (!model.trim()) throw new Error("WORLD_LABS_MODEL is required");
  return async (rawInput: unknown) => {
    const { editionId, mode, pollCount = 0 } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const requestKey = `${root}/world/request.json`;

    const manifestKey = `${root}/world/generated-world.json`;
    const existingManifest = await artifacts.read(manifestKey);
    if (existingManifest) {
      const manifest = generatedWorldManifestSchema.parse(JSON.parse(Buffer.from(existingManifest).toString("utf8")));
      const asset = await artifacts.read(manifest.asset.storageKey);
      if (manifest.editionId !== editionId || !asset || sha256(Buffer.from(asset)) !== manifest.asset.sha256) {
        throw new Error("Stored generated world is missing or does not match its manifest");
      }
      return { editionId, status: "completed" as const, manifestKey, pollCount };
    }

    // Attempt one retains its historical keys. Later attempts never overwrite it.
    let attempt = 1;
    let attemptRoot = `${root}/world`;
    const attemptIdempotencyKey = (request: Parameters<typeof createWorldIdempotencyKey>[0], number: number) => {
      const base = createWorldIdempotencyKey(request, generator);
      return number === 1 ? base : sha256(`${base}:attempt:${number}`);
    };
    while (true) {
      const failureBytes = await artifacts.read(`${attemptRoot}/operation-failed.json`);
      if (!failureBytes) break;
      const failed = worldOperationRecordSchema.parse(JSON.parse(Buffer.from(failureBytes).toString("utf8")));
      const storedRequest = worldGenerationRequestSchema.parse(await readJson(artifacts, requestKey));
      const storedOperation = worldOperationRecordSchema.parse(await readJson(artifacts, `${attemptRoot}/operation.json`));
      if (storedRequest.editionId !== editionId || failed.editionId !== editionId || failed.status !== "failed" ||
          failed.providerOperationId !== storedOperation.providerOperationId ||
          storedOperation.idempotencyKey !== attemptIdempotencyKey(storedRequest, attempt) ||
          failed.idempotencyKey !== storedOperation.idempotencyKey ||
          failed.sourceImageSha256 !== storedRequest.sourceImage.sha256) {
        throw new Error("Stored world failure does not match the operation");
      }
      if (!failed.error || !retryableWorldFailure(failed.error) || attempt >= MAX_WORLD_ATTEMPTS) {
        return { editionId, status: "failed" as const, operationKey: `${attemptRoot}/operation.json`, pollCount, attempt, error: failed.error };
      }
      // Reuse the state machine's wait/poll loop; no Lambda sleeps or reset of its poll budget.
      if (now().getTime() < Date.parse(failed.updatedAt) + attempt * 60_000) {
        return { editionId, status: "running" as const, operationKey: `${attemptRoot}/operation.json`, pollCount: pollCount + 1, attempt };
      }
      attempt += 1;
      attemptRoot = `${root}/world/attempts/${attempt}`;
    }
    const operationKey = `${attemptRoot}/operation.json`;
    if (mode === "start" || (attempt > 1 && !(await artifacts.read(operationKey)))) {
      const panorama = editionPanoramaManifestSchema.parse(
        await readJson(artifacts, `${root}/panorama/manifest.json`),
      );
      const review = imageReviewSchema.parse(await readJson(artifacts, `${root}/review/image-approval.json`));
      const deliveryKey = `${root}/panorama/${panorama.files.delivery8k}`;
      if (panorama.editionId !== editionId || review.editionId !== editionId ||
          review.inputs.artDirectionSha256 !== panorama.inputs.artDirectionSha256 ||
          review.inputs.panoramaSha256 !== panorama.outputs.delivery8kSha256) {
        throw new Error("Image approval does not match this edition's panorama");
      }
      const request = worldGenerationRequestSchema.parse({
        schemaVersion: "1.0.0",
        artifactType: "world-generation-request",
        editionId,
        sourceImage: {
          storageKey: deliveryKey,
          sha256: panorama.outputs.delivery8kSha256,
          mediaType: "image/png",
          width: panorama.transforms.deliveryResize.width,
          height: panorama.transforms.deliveryResize.height,
        },
        generation: { mode: "image-to-world", model },
      });
      const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);
      const operationBytes = await artifacts.read(operationKey);
      if (operationBytes) {
        const operation = worldOperationRecordSchema.parse(JSON.parse(Buffer.from(operationBytes).toString("utf8")));
        if (operation.editionId !== editionId ||
            operation.idempotencyKey !== attemptIdempotencyKey(request, attempt)) {
          throw new Error("Existing world operation does not match the approved panorama");
        }
        return { editionId, status: "running" as const, operationKey, pollCount, attempt };
      }
      await artifacts.putImmutable({ key: requestKey, bytes: requestBytes, contentType: "application/json" });
      const source = await artifacts.read(deliveryKey);
      if (!source || sha256(Buffer.from(source)) !== request.sourceImage.sha256) {
        throw new Error("Approved panorama is missing or has changed");
      }
      const claimed = await claims.claimOnce(
        `${attemptRoot}/submission-attempt.json`,
        Buffer.from(`${JSON.stringify({
          editionId,
          requestSha256: sha256(requestBytes),
          reviewSha256: artifactSha256(review),
        })}\n`),
      );
      if (!claimed) throw new Error("A paid World Labs submission attempt already exists; inspect it before retrying");
      const directory = await mkdtemp(join(tmpdir(), "world-submit-"));
      try {
        const sourcePath = join(directory, "panorama.png");
        await writeFile(sourcePath, source);
        const submitted = await generator.submit(request, sourcePath, attemptIdempotencyKey(request, attempt));
        const timestamp = now().toISOString();
        const operation = worldOperationRecordSchema.parse({
          schemaVersion: "1.0.0",
          artifactType: "world-operation",
          editionId,
          provider: generator.provider,
          adapterVersion: generator.adapterVersion,
          idempotencyKey: attemptIdempotencyKey(request, attempt),
          providerOperationId: submitted.operationId,
          status: "submitted",
          createdAt: timestamp,
          updatedAt: timestamp,
          sourceImageSha256: request.sourceImage.sha256,
        });
        await artifacts.putImmutable({
          key: operationKey,
          bytes: Buffer.from(`${JSON.stringify(operation, null, 2)}\n`),
          contentType: "application/json",
        });
        return { editionId, status: "running" as const, operationKey, pollCount, attempt };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }

    const request = worldGenerationRequestSchema.parse(await readJson(artifacts, requestKey));
    const operation = worldOperationRecordSchema.parse(await readJson(artifacts, operationKey));
    if (request.editionId !== editionId || operation.editionId !== editionId ||
        operation.idempotencyKey !== attemptIdempotencyKey(request, attempt)) {
      throw new Error("Stored world request and operation do not match");
    }
    const providerResult = await generator.getOperation(operation.providerOperationId, request);
    if (!providerResult.done) return { editionId, status: "running" as const, operationKey, pollCount: pollCount + 1 };
    if ("error" in providerResult) {
      await artifacts.putImmutable({
        key: `${attemptRoot}/operation-failed.json`,
        bytes: Buffer.from(`${JSON.stringify({ ...operation, status: "failed", error: providerResult.error, updatedAt: now().toISOString() }, null, 2)}\n`),
        contentType: "application/json",
      });
      return { editionId, status: retryableWorldFailure(providerResult.error) && attempt < MAX_WORLD_ATTEMPTS ? "running" as const : "failed" as const, operationKey, pollCount: pollCount + 1, attempt, error: providerResult.error };
    }
    const downloaded = await generator.downloadAsset(providerResult.response);
    if (downloaded.format !== providerResult.response.format ||
        downloaded.mediaType !== providerResult.response.mediaType) {
      throw new Error("Downloaded world asset does not match provider metadata");
    }
    const assetKey = `${root}/world/assets/world.${downloaded.format}`;
    await artifacts.putImmutable({ key: assetKey, bytes: downloaded.bytes, contentType: downloaded.mediaType });
    const manifest = generatedWorldManifestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "generated-world",
      editionId,
      createdAt: now().toISOString(),
      provider: generator.provider,
      adapterVersion: generator.adapterVersion,
      providerOperationId: operation.providerOperationId,
      model: providerResult.response.model,
      input: { sourceImageSha256: request.sourceImage.sha256, requestSha256: sha256(JSON.stringify(request)) },
      asset: {
        storageKey: assetKey,
        format: downloaded.format,
        mediaType: downloaded.mediaType,
        byteLength: downloaded.bytes.length,
        sha256: sha256(downloaded.bytes),
      },
      providerMetadata: providerResult.response.metadata,
    });
    await artifacts.putImmutable({
      key: manifestKey,
      bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      contentType: "application/json",
    });
    return { editionId, status: "completed" as const, manifestKey, pollCount: pollCount + 1 };
  };
}

export async function main(event: unknown) {
  const bucket = requiredEnvironment("ARTIFACT_BUCKET");
  const secretId = requiredEnvironment("WORLD_LABS_SECRET_NAME");
  const model = requiredEnvironment("WORLD_LABS_MODEL");
  const secrets = new SecretsManagerClient({});
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!secret.SecretString) throw new Error("World Labs secret must contain a string value");
  const value = secret.SecretString.trim();
  const key = value.startsWith("{")
    ? z.object({ WORLD_LABS_KEY: z.string().min(1) }).parse(JSON.parse(value)).WORLD_LABS_KEY
    : value;
  const s3 = new S3Client({});
  return createCloudWorldHandler({
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
    generator: new WorldLabsGenerator({ apiKey: key }),
    model,
  })(event);
}
