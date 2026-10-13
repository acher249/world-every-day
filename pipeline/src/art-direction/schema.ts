import { z } from "zod";

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case identifier");

export const artDirectionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("art-direction"),
    editionId: idSchema,
    createdAt: z.iso.datetime({ offset: true }),
    promptVersion: z.literal("panorama-scene-v1"),
    world: z.object({
      title: z.string().min(1).max(160),
      concept: z.string().min(1).max(500),
      setting: z.string().min(1).max(300),
      timeOfDay: z.string().min(1).max(120),
      atmosphere: z.string().min(1).max(300),
      palette: z.array(z.string().min(1).max(80)).min(3).max(8),
      navigation: z.string().min(1).max(300),
    }),
    subjects: z
      .array(
        z.object({
          storyId: idSchema,
          role: z.enum(["anchor", "supporting", "detail"]),
          subject: z.string().min(1).max(240),
          placement: z.string().min(1).max(200),
          scale: z.string().min(1).max(160),
          materials: z.array(z.string().min(1).max(80)).min(1).max(6),
          visualCues: z.array(z.string().min(1).max(160)).min(1).max(6),
        }),
      )
      .min(1)
      .max(10),
    constraints: z.object({
      required: z.array(z.string().min(1).max(240)).min(1).max(20),
      prohibited: z.array(z.string().min(1).max(240)).min(1).max(20),
    }),
  })
  .superRefine((artDirection, context) => {
    const ids = new Set<string>();
    let anchors = 0;

    artDirection.subjects.forEach((subject, index) => {
      if (ids.has(subject.storyId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate story id: ${subject.storyId}`,
          path: ["subjects", index, "storyId"],
        });
      }
      ids.add(subject.storyId);
      if (subject.role === "anchor") anchors += 1;
    });

    if (anchors === 0) {
      context.addIssue({
        code: "custom",
        message: "Art direction requires at least one anchor subject",
        path: ["subjects"],
      });
    }
  });

export type ArtDirection = z.infer<typeof artDirectionSchema>;

export function parseArtDirection(input: unknown): ArtDirection {
  return artDirectionSchema.parse(input);
}
