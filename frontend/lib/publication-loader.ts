import { z } from "zod";

const editionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

export const unpublishedCurrentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  status: z.literal("unpublished"),
}).strict();

export const currentEditionPointerSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  editionId: editionIdSchema,
  publicationUrl: z.string().regex(/^\/generated\/editions\/[a-z0-9-]+\/publication\.json$/),
  publishedAt: z.iso.datetime({ offset: true }),
  publicationSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((pointer, context) => {
  if (pointer.publicationUrl !== publicationPathForEdition(pointer.editionId)) {
    context.addIssue({ code: "custom", message: "Current pointer references a different edition" });
  }
});

export function publicationPathForEdition(editionId: string): string {
  return `/generated/editions/${editionIdSchema.parse(editionId)}/publication.json`;
}
