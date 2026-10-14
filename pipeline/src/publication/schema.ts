import { z } from "zod";

const idSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const httpsUrlSchema = z.url().refine(
  (value) => URL.canParse(value) && new URL(value).protocol === "https:",
);
const assetUrlSchema = z.union([httpsUrlSchema, z.string().regex(/^\/(?!\/)/)]);

export const publicationManifestSchema = z.object({
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
      sourceSplatSha256: sha256Schema,
    }),
    poster: z.object({
      src: z.string().regex(/^\/(?!\/)/),
      alt: z.string().min(1).max(300),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      sha256: sha256Schema,
    }),
    splat: z.object({
      url: assetUrlSchema,
      format: z.enum(["spz", "ply", "sog", "splat", "ksplat"]),
      sha256: sha256Schema,
    }).nullable(),
  }),
  stories: z.array(z.object({
    id: idSchema,
    category: z.string().min(1).max(80),
    title: z.string().min(1).max(180),
    summary: z.string().min(1).max(700),
    representation: z.string().min(1).max(240),
    sources: z.array(z.object({
      title: z.string().min(1).max(300),
      publisher: z.string().min(1).max(160),
      url: httpsUrlSchema,
      publishedAt: z.iso.datetime({ offset: true }),
      kind: z.enum(["primary", "reporting", "context"]),
    })).max(8),
    interaction: z.object({
      imageTarget: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
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
  })).min(1).max(10),
  storyEchoes: z.array(z.object({
    id: idSchema,
    storyId: idSchema,
    label: z.string().min(1).max(100),
    explanation: z.string().min(1).max(300),
    interaction: z.object({
      imageTarget: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
      worldPosition: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite(),
      }),
    }),
  })).max(8).default([]),
}).superRefine((manifest, context) => {
  const ids = new Set<string>();
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
    if (ids.has(story.id)) {
      context.addIssue({ code: "custom", message: `Duplicate story id: ${story.id}`, path: ["stories", index, "id"] });
    }
    ids.add(story.id);
    if (!manifest.edition.fictional && story.sources.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Factual stories require a source",
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
    if (!ids.has(echo.storyId)) {
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

