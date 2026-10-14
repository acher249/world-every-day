import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const panoramaManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifactType: z.literal("panorama-manifest"),
  editionId: z.string().min(1).max(100).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  stage: z.literal("panorama-generation"),
  inputs: z.object({ artDirectionSha256: sha256Schema }).optional(),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(160),
  request: z.object({
    prompt: z.string().min(1),
    promptSha256: sha256Schema,
    aspectRatio: z.string().min(1),
    imageSize: z.string().min(1),
    thinkingLevel: z.string().min(1),
  }),
  response: z.object({
    mimeType: z.string().min(1),
    elapsedMs: z.number().nonnegative(),
    usage: z.unknown(),
    originalSha256: sha256Schema,
  }),
  transforms: z.object({
    centeredEquirectangularCrop: z.object({
      top: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    longitudeRepair: z.object({ method: z.string().min(1), width: z.number().int().positive() }),
    deliveryResize: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      kernel: z.string().min(1),
      nativeDetail: z.boolean(),
    }),
  }),
  metrics: z.object({
    longitudeSeam: z.object({
      wrapMeanAbsoluteDifference: z.number().nonnegative(),
      leftFeatherBoundaryDifference: z.number().nonnegative(),
      rightFeatherBoundaryDifference: z.number().nonnegative(),
    }),
  }),
  outputs: z.object({ delivery8kSha256: sha256Schema }),
  files: z.object({
    original: z.string().min(1),
    normalizedSource: z.string().min(1),
    nativeEquirectangular: z.string().min(1),
    seamRepairedEquirectangular: z.string().min(1),
    delivery8k: z.string().min(1),
  }),
});

export const editionPanoramaManifestSchema = panoramaManifestSchema.extend({
  editionId: z.string().min(1).max(100),
  inputs: z.object({ artDirectionSha256: sha256Schema }),
});

export type PanoramaManifest = z.infer<typeof panoramaManifestSchema>;

