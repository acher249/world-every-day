import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const editionReviewSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("edition-review"),
  editionId: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  approvedAt: z.iso.datetime({ offset: true }),
  approvedBy: z.string().trim().min(1).max(160),
  inputs: z.object({
    selectedEditionSha256: sha256Schema,
    artDirectionSha256: sha256Schema,
  }),
  decision: z.literal("approved-for-generation"),
});

export type EditionReview = z.infer<typeof editionReviewSchema>;

