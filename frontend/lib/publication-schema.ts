import { z } from "zod";

const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case identifier");

const httpsUrlSchema = z
  .url()
  .refine(
    (value) => URL.canParse(value) && new URL(value).protocol === "https:",
    "Use an HTTPS URL",
  );
const assetUrlSchema = z.union([
  httpsUrlSchema,
  z.string().regex(/^\/(?!\/)/, "Use an HTTPS or root-relative asset URL"),
]);
const imageBoundingBoxSchema = z.object({
  xMin: z.number().min(0).max(1),
  yMin: z.number().min(0).max(1),
  xMax: z.number().min(0).max(1),
  yMax: z.number().min(0).max(1),
}).refine((box) => box.xMin < box.xMax && box.yMin < box.yMax, "Image bounding box must have positive area");

export const sourceSchema = z.object({
  title: z.string().min(1).max(300),
  publisher: z.string().min(1).max(160),
  url: httpsUrlSchema,
  publishedAt: z.iso.datetime({ offset: true }),
  kind: z.enum(["primary", "reporting", "context"]),
});

export const storySchema = z.object({
  id: idSchema,
  category: z.string().min(1).max(80),
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(700),
  representation: z.string().min(1).max(240),
  sources: z.array(sourceSchema).max(8),
  interaction: z.object({
    imageTarget: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    }),
    imageBoundingBox: imageBoundingBoxSchema.optional(),
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
          url: assetUrlSchema,
          format: z.enum(["spz", "ply", "sog", "splat", "ksplat"]),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .nullable(),
    }),
    stories: z.array(storySchema).min(1).max(10),
    storyEchoes: z.array(z.object({
      id: idSchema,
      storyId: idSchema,
      label: z.string().min(1).max(100),
      explanation: z.string().min(1).max(300),
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
      }),
    })).max(8).default([]),
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
    const echoIds = new Set<string>();
    const echoStoryIds = new Set<string>();
    manifest.storyEchoes.forEach((echo, index) => {
      if (echoIds.has(echo.id)) {
        context.addIssue({ code: "custom", message: `Duplicate story echo id: ${echo.id}`, path: ["storyEchoes", index, "id"] });
      }
      if (!storyIds.has(echo.storyId)) {
        context.addIssue({ code: "custom", message: `Story echo references unknown story: ${echo.storyId}`, path: ["storyEchoes", index, "storyId"] });
      }
      if (echoStoryIds.has(echo.storyId)) {
        context.addIssue({ code: "custom", message: `Multiple story echoes reference: ${echo.storyId}`, path: ["storyEchoes", index, "storyId"] });
      }
      echoIds.add(echo.id);
      echoStoryIds.add(echo.storyId);
    });
  });

export type PublicationManifest = z.infer<typeof publicationManifestSchema>;
export type PublicationStory = z.infer<typeof storySchema>;

export function parsePublicationManifest(input: unknown): PublicationManifest {
  return publicationManifestSchema.parse(input);
}
