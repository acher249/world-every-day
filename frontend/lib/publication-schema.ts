import { z } from "zod";

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case identifier");

const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL");

export const sourceSchema = z.object({
  title: z.string().min(1).max(240),
  publisher: z.string().min(1).max(120),
  url: httpsUrlSchema,
  publishedAt: z.iso.datetime({ offset: true }),
  kind: z.enum(["primary", "reporting", "context"]),
});

export const storySchema = z.object({
  id: idSchema,
  category: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(600),
  representation: z.string().min(1).max(240),
  sources: z.array(sourceSchema).max(8),
  interaction: z.object({
    imageTarget: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    }),
    worldPosition: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      z: z.number().finite(),
    }),
    screenRegion: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      tone: z.enum(["cyan", "amber", "green"]),
    }),
  }),
});

export const publicationManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("publication-manifest"),
    createdAt: z.iso.datetime({ offset: true }),
    edition: z.object({
      id: idSchema,
      slug: idSchema,
      sequence: z.number().int().positive(),
      status: z.enum(["demonstration", "staged", "published", "withdrawn"]),
      fictional: z.boolean(),
      displayDate: z.string().min(1).max(80),
      eyebrow: z.string().min(1).max(120),
      title: z.string().min(1).max(160),
      description: z.string().min(1).max(400),
    }),
    world: z.object({
      interactionMapping: z.object({
        bakedAt: z.iso.datetime({ offset: true }),
        coordinateSystem: z.literal("world-space"),
        method: z.enum(["spherical-raycast", "manual"]),
        sourceSplatSha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      poster: z.object({
        src: z.string().regex(/^\/(?!\/)/, "Use a root-relative asset path"),
        alt: z.string().min(1).max(300),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      splat: z
        .object({
          url: httpsUrlSchema,
          format: z.enum(["spz", "ply", "sog", "splat", "ksplat"]),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .nullable(),
    }),
    stories: z.array(storySchema).min(1).max(10),
  })
  .superRefine((manifest, context) => {
    const storyIds = new Set<string>();

    if (
      manifest.world.splat &&
      manifest.world.splat.sha256 !== manifest.world.interactionMapping.sourceSplatSha256
    ) {
      context.addIssue({
        code: "custom",
        message: "Baked interactions must match the published splat checksum",
        path: ["world", "interactionMapping", "sourceSplatSha256"],
      });
    }

    manifest.stories.forEach((story, index) => {
      if (storyIds.has(story.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate story id: ${story.id}`,
          path: ["stories", index, "id"],
        });
      }
      storyIds.add(story.id);

      if (!manifest.edition.fictional && story.sources.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Published factual stories require at least one source",
          path: ["stories", index, "sources"],
        });
      }
    });
  });

export type PublicationManifest = z.infer<typeof publicationManifestSchema>;
export type PublicationStory = z.infer<typeof storySchema>;

export function parsePublicationManifest(input: unknown): PublicationManifest {
  return publicationManifestSchema.parse(input);
}
