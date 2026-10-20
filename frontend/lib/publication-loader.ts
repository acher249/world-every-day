import { z } from "zod";

const editionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

export const unpublishedCurrentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  status: z.literal("unpublished"),
}).strict();

const editionPointerFields = {
  schemaVersion: z.literal("1.0.0"),
  editionId: editionIdSchema,
  publicationUrl: z.string().regex(/^\/generated\/editions\/[a-z0-9-]+\/publication(?:-public)?\.json$/),
  publishedAt: z.iso.datetime({ offset: true }),
  publicationSha256: z.string().regex(/^[a-f0-9]{64}$/),
};

const publishedEditionPointerSchema = z.object(editionPointerFields).superRefine((pointer, context) => {
  if (pointer.publicationUrl !== publicationPathForEdition(pointer.editionId) &&
      !(pointer.editionId.endsWith("-test") &&
        pointer.publicationUrl === `/generated/editions/${pointer.editionId}/publication-public.json`)) {
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

export type PastWorld = NonNullable<z.infer<typeof currentEditionPointerSchema>["pastWorlds"]>[number];

export function pastWorldLabel(editionId: string): string {
  const date = editionId.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date) return editionId;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return editionId;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })
    .format(parsed);
}

export function publicationPathForEdition(editionId: string): string {
  return `/generated/editions/${editionIdSchema.parse(editionId)}/publication.json`;
}
