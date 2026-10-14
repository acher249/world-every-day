import { z } from "zod";

const idSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const interactionAnchorSchema = z.object({
  id: idSchema,
  imageTarget: normalizedPointSchema,
  worldPosition: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  }),
});

export const interactionManifestSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("interaction-manifest"),
  editionId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  method: z.enum(["spherical-raycast", "manual"]),
  sourceImageSha256: sha256Schema,
  sourceSplatSha256: sha256Schema,
  anchors: z.array(interactionAnchorSchema).min(1).max(18),
}).superRefine((manifest, context) => {
  const ids = new Set<string>();
  manifest.anchors.forEach((anchor, index) => {
    if (ids.has(anchor.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate interaction anchor: ${anchor.id}`,
        path: ["anchors", index, "id"],
      });
    }
    ids.add(anchor.id);
  });
});

export type InteractionAnchor = z.infer<typeof interactionAnchorSchema>;
export type InteractionManifest = z.infer<typeof interactionManifestSchema>;

