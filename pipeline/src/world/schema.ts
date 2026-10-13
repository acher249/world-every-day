import { z } from "zod";

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case identifier");

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const worldGenerationRequestSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("world-generation-request"),
  editionId: idSchema,
  sourceImage: z.object({
    storageKey: z.string().min(1).max(500),
    sha256: sha256Schema,
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  generation: z.object({
    mode: z.literal("image-to-world"),
    model: z.string().min(1).max(120).optional(),
    prompt: z.string().min(1).max(2_000).optional(),
  }),
});

const operationStatusSchema = z.enum([
  "submitted",
  "running",
  "provider-succeeded",
  "completed",
  "failed",
]);

export const worldOperationRecordSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("world-operation"),
  editionId: idSchema,
  provider: idSchema,
  adapterVersion: z.string().min(1).max(80),
  idempotencyKey: sha256Schema,
  providerOperationId: z.string().min(1).max(500),
  status: operationStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  sourceImageSha256: sha256Schema,
  generatedWorldManifest: z.string().min(1).max(500).optional(),
  error: z
    .object({
      code: z.string().min(1).max(120),
      message: z.string().min(1).max(1_000),
      retryable: z.boolean(),
    })
    .optional(),
});

export const generatedWorldManifestSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("generated-world"),
  editionId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  provider: idSchema,
  adapterVersion: z.string().min(1).max(80),
  providerOperationId: z.string().min(1).max(500),
  model: z.string().min(1).max(120).optional(),
  input: z.object({
    sourceImageSha256: sha256Schema,
    requestSha256: sha256Schema,
  }),
  asset: z.object({
    storageKey: z.string().min(1).max(500),
    format: z.enum(["spz", "ply", "sog", "splat", "ksplat", "mock"]),
    mediaType: z.string().min(1).max(120),
    byteLength: z.number().int().nonnegative(),
    sha256: sha256Schema,
  }),
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
});

export type WorldGenerationRequest = z.infer<typeof worldGenerationRequestSchema>;
export type WorldOperationRecord = z.infer<typeof worldOperationRecordSchema>;
export type GeneratedWorldManifest = z.infer<typeof generatedWorldManifestSchema>;
export type WorldAssetFormat = GeneratedWorldManifest["asset"]["format"];
