import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const publicationReviewSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("publication-review"),
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  approvedAt: z.iso.datetime({ offset: true }),
  approvedBy: z.string().trim().min(2).max(120),
  decision: z.literal("approved-for-publication"),
  inputs: z.object({ publicationSha256: sha256Schema }),
});

export const currentEditionPointerSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  publicationUrl: z.string().regex(/^\/generated\/editions\/[a-z0-9-]+\/publication\.json$/),
  publishedAt: z.iso.datetime({ offset: true }),
  publicationSha256: sha256Schema,
});

export const unpublishedCurrentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  status: z.literal("unpublished"),
}).strict();
