import { z } from "zod";

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const landmarkDetectionSchema = z.object({
  storyId: idSchema,
  label: z.string().min(1).max(240),
  boundingBox: z.object({
    xMin: z.number().min(0).max(1),
    yMin: z.number().min(0).max(1),
    xMax: z.number().min(0).max(1),
    yMax: z.number().min(0).max(1),
  }),
  target: normalizedPointSchema,
  confidence: z.number().min(0).max(1),
  visibility: z.enum(["clear", "partial", "uncertain", "not-found"]),
}).superRefine((landmark, context) => {
  const { boundingBox, target } = landmark;
  if (boundingBox.xMin > boundingBox.xMax || boundingBox.yMin > boundingBox.yMax) {
    context.addIssue({ code: "custom", message: "Landmark bounding box is inverted" });
  }
  if (
    landmark.visibility !== "not-found" &&
    (target.x < boundingBox.xMin || target.x > boundingBox.xMax ||
      target.y < boundingBox.yMin || target.y > boundingBox.yMax)
  ) {
    context.addIssue({ code: "custom", message: "Landmark target must fall inside its bounding box" });
  }
});

export const landmarkDetectionResponseSchema = z.object({
  landmarks: z.array(landmarkDetectionSchema).min(1).max(10),
});

export const landmarkArtifactSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("landmark-detections"),
  editionId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  sourceImage: z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    projection: z.literal("equirectangular"),
  }),
  analysisImage: z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  }).optional(),
  provider: z.object({
    id: z.string().min(1).max(80),
    model: z.string().min(1).max(160),
  }),
  landmarks: z.array(landmarkDetectionSchema).min(1).max(10),
});

export type LandmarkDetection = z.infer<typeof landmarkDetectionSchema>;
export type LandmarkDetectionResponse = z.infer<typeof landmarkDetectionResponseSchema>;
export type LandmarkArtifact = z.infer<typeof landmarkArtifactSchema>;

export function parseLandmarkDetectionResponse(input: unknown): LandmarkDetectionResponse {
  return landmarkDetectionResponseSchema.parse(input);
}

export function parseLandmarkArtifact(input: unknown): LandmarkArtifact {
  return landmarkArtifactSchema.parse(input);
}
