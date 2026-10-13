import { readFile } from "node:fs/promises";
import { sha256 } from "../panorama/hash.js";
import type { ProviderWorldOutput, WorldGenerator } from "./provider.js";
import {
  generatedWorldManifestSchema,
  worldGenerationRequestSchema,
  worldOperationRecordSchema,
  type WorldGenerationRequest,
  type WorldOperationRecord,
} from "./schema.js";
import type { WorldArtifactStore } from "./store.js";

type StartWorldGenerationOptions = {
  generator: WorldGenerator;
  request: WorldGenerationRequest;
  sourceImagePath: string;
  store: WorldArtifactStore;
  now?: () => Date;
};

type RefreshWorldGenerationOptions = {
  generator: WorldGenerator;
  request: WorldGenerationRequest;
  store: WorldArtifactStore;
  now?: () => Date;
};

function requestHash(request: WorldGenerationRequest): string {
  return sha256(JSON.stringify(request));
}

export function createWorldIdempotencyKey(
  request: WorldGenerationRequest,
  generator: Pick<WorldGenerator, "adapterVersion" | "provider">,
): string {
  const validated = worldGenerationRequestSchema.parse(request);
  return sha256(
    JSON.stringify({
      adapterVersion: generator.adapterVersion,
      provider: generator.provider,
      request: validated,
    }),
  );
}

export async function startWorldGeneration({
  generator,
  request,
  sourceImagePath,
  store,
  now = () => new Date(),
}: StartWorldGenerationOptions): Promise<WorldOperationRecord> {
  const validatedRequest = worldGenerationRequestSchema.parse(request);
  const idempotencyKey = createWorldIdempotencyKey(validatedRequest, generator);
  const existing = await store.loadOperation(validatedRequest.editionId);

  if (existing) {
    if (existing.idempotencyKey !== idempotencyKey) {
      throw new Error(
        `Edition ${validatedRequest.editionId} already has a world operation for different inputs`,
      );
    }
    return existing;
  }

  const sourceImageBytes = await readFile(sourceImagePath);
  if (sha256(sourceImageBytes) !== validatedRequest.sourceImage.sha256) {
    throw new Error("Source-image checksum does not match the generation request");
  }

  const submitted = await generator.submit(
    validatedRequest,
    sourceImagePath,
    idempotencyKey,
  );
  const timestamp = now().toISOString();
  const operation = worldOperationRecordSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "world-operation",
    editionId: validatedRequest.editionId,
    provider: generator.provider,
    adapterVersion: generator.adapterVersion,
    idempotencyKey,
    providerOperationId: submitted.operationId,
    status: "submitted",
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceImageSha256: validatedRequest.sourceImage.sha256,
  });
  await store.saveOperation(operation);
  return operation;
}

function assetFilename(output: ProviderWorldOutput): string {
  return output.format === "mock" ? "world.mock" : `world.${output.format}`;
}

export async function refreshWorldGeneration({
  generator,
  request,
  store,
  now = () => new Date(),
}: RefreshWorldGenerationOptions): Promise<WorldOperationRecord> {
  const validatedRequest = worldGenerationRequestSchema.parse(request);
  const operation = await store.loadOperation(validatedRequest.editionId);
  if (!operation) {
    throw new Error(`No world operation exists for ${validatedRequest.editionId}`);
  }
  const expectedIdempotencyKey = createWorldIdempotencyKey(
    validatedRequest,
    generator,
  );
  if (operation.idempotencyKey !== expectedIdempotencyKey) {
    throw new Error(
      `Stored world operation for ${validatedRequest.editionId} does not match the provider or request`,
    );
  }
  if (operation.status === "completed" || operation.status === "failed") {
    return operation;
  }

  const providerOperation = await generator.getOperation(
    operation.providerOperationId,
    validatedRequest,
  );
  const updatedAt = now().toISOString();

  if (!providerOperation.done) {
    const running = worldOperationRecordSchema.parse({
      ...operation,
      status: "running",
      updatedAt,
    });
    await store.saveOperation(running);
    return running;
  }

  if ("error" in providerOperation) {
    const failed = worldOperationRecordSchema.parse({
      ...operation,
      status: "failed",
      updatedAt,
      error: providerOperation.error,
    });
    await store.saveOperation(failed);
    return failed;
  }

  const providerSucceeded = worldOperationRecordSchema.parse({
    ...operation,
    status: "provider-succeeded",
    updatedAt,
  });
  await store.saveOperation(providerSucceeded);

  const downloaded = await generator.downloadAsset(providerOperation.response);
  if (
    downloaded.format !== providerOperation.response.format ||
    downloaded.mediaType !== providerOperation.response.mediaType
  ) {
    throw new Error("Downloaded world asset does not match provider metadata");
  }
  const stored = await store.saveWorldAsset(
    operation.editionId,
    assetFilename(providerOperation.response),
    downloaded.bytes,
  );
  const manifest = generatedWorldManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "generated-world",
    editionId: operation.editionId,
    createdAt: updatedAt,
    provider: generator.provider,
    adapterVersion: generator.adapterVersion,
    providerOperationId: operation.providerOperationId,
    model: providerOperation.response.model,
    input: {
      sourceImageSha256: validatedRequest.sourceImage.sha256,
      requestSha256: requestHash(validatedRequest),
    },
    asset: {
      storageKey: stored.storageKey,
      format: downloaded.format,
      mediaType: downloaded.mediaType,
      byteLength: stored.byteLength,
      sha256: sha256(downloaded.bytes),
    },
    providerMetadata: providerOperation.response.metadata,
  });
  const manifestPath = await store.saveGeneratedWorld(manifest);
  const completed = worldOperationRecordSchema.parse({
    ...providerSucceeded,
    status: "completed",
    updatedAt,
    generatedWorldManifest: manifestPath,
  });
  await store.saveOperation(completed);
  return completed;
}
