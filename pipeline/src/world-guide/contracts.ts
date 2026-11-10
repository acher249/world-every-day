import { z } from "zod";

const idSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const httpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});

export const worldGuideContextSchema = z.object({
  editionId: idSchema,
  editionDate: z.string().min(1).max(80),
  stories: z.array(z.object({
    id: idSchema,
    title: z.string().min(1).max(180),
    summary: z.string().min(1).max(700),
    representation: z.string().min(1).max(240),
    representationExplanation: z.string().max(300).optional(),
    sources: z.array(z.object({
      title: z.string().min(1).max(300),
      publisher: z.string().min(1).max(160),
      url: httpsUrlSchema,
      kind: z.enum(["primary", "reporting", "context"]),
    })).max(8),
  })).min(1).max(10),
  selectedStoryId: idSchema.nullable(),
}).strict().superRefine((contextValue, context) => {
  const storyIds = new Set(contextValue.stories.map((story) => story.id));
  if (storyIds.size !== contextValue.stories.length) {
    context.addIssue({ code: "custom", message: "Story IDs must be unique", path: ["stories"] });
  }
  if (contextValue.selectedStoryId && !storyIds.has(contextValue.selectedStoryId)) {
    context.addIssue({ code: "custom", message: "Selected story must belong to this edition", path: ["selectedStoryId"] });
  }
});

export const worldGuideResearchInputSchema = z.object({
  editionId: idSchema,
  storyIds: z.array(idSchema).min(1).max(3),
  question: z.string().trim().min(1).max(1000),
}).strict().superRefine((request, context) => {
  if (new Set(request.storyIds).size !== request.storyIds.length) {
    context.addIssue({ code: "custom", message: "Story IDs must be unique", path: ["storyIds"] });
  }
});

export const worldGuideResearchResultSchema = z.object({
  answer: z.string().trim().min(1).max(2400),
  retrievedAt: z.iso.datetime({ offset: true }),
  citations: z.array(z.object({
    storyId: idSchema,
    title: z.string().min(1).max(300),
    publisher: z.string().min(1).max(160),
    url: httpsUrlSchema,
  })).max(8),
});

export type WorldGuideContext = z.infer<typeof worldGuideContextSchema>;
export type WorldGuideResearchInput = z.infer<typeof worldGuideResearchInputSchema>;
export type WorldGuideResearchResult = z.infer<typeof worldGuideResearchResultSchema>;
