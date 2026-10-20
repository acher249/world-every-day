import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const publicationReviewSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("publication-review"),
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  approvedAt: z.iso.datetime({ offset: true }),
  approvedBy: z.string().trim().min(2).max(120),
  decision: z.enum(["approved-for-publication", "approved-for-test-preview"]),
  inputs: z.object({ publicationSha256: sha256Schema }),
});

const editionPointerFields = {
  schemaVersion: z.literal("1.0.0"),
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  publicationUrl: z.string().regex(/^\/generated\/editions\/[a-z0-9-]+\/publication(?:-public)?\.json$/),
  publishedAt: z.iso.datetime({ offset: true }),
  publicationSha256: sha256Schema,
};

const publishedEditionPointerSchema = z.object(editionPointerFields).superRefine((pointer, context) => {
  const root = `/generated/editions/${pointer.editionId}`;
  if (pointer.publicationUrl !== `${root}/publication.json` &&
      !(pointer.editionId.endsWith("-test") && pointer.publicationUrl === `${root}/publication-public.json`)) {
    context.addIssue({ code: "custom", message: "Current pointer references a different edition" });
  }
});

export const currentEditionPointerSchema = z.object({
  ...editionPointerFields,
  pastWorlds: z.array(publishedEditionPointerSchema).optional(),
}).superRefine((pointer, context) => {
  const result = publishedEditionPointerSchema.safeParse(pointer);
  if (!result.success) {
    context.addIssue({ code: "custom", message: "Current pointer has an invalid publication path" });
  }
  const ids = pointer.pastWorlds?.map((world) => world.editionId) ?? [];
  if (ids.includes(pointer.editionId) || new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Past worlds must have distinct edition IDs" });
  }
});

export const unpublishedCurrentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  status: z.literal("unpublished"),
}).strict();
