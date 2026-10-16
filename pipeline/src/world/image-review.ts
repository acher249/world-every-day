import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const imageReviewSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("image-review"),
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  approvedAt: z.iso.datetime({ offset: true }),
  approvedBy: z.string().trim().min(2).max(120),
  decision: z.literal("approved-for-world-generation"),
  inputs: z.object({
    artDirectionSha256: sha256Schema,
    panoramaSha256: sha256Schema,
  }),
});

export type ImageReview = z.infer<typeof imageReviewSchema>;
