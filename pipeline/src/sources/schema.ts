import { z } from "zod";
import { providerUsageSchema } from "../provider-usage.js";

const httpsUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS URL without embedded credentials");

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const discoveredStorySchema = z.object({
  id: sha256Schema,
  canonicalUrl: httpsUrlSchema,
  title: z.string().min(1).max(300),
  publisher: z.string().min(1).max(160),
  publishedAt: z.iso.datetime({ offset: true }),
  discoveredAt: z.iso.datetime({ offset: true }),
  source: z.object({
    adapterId: z.string().min(1).max(100),
    feedUrl: httpsUrlSchema,
    entryId: z.string().min(1).max(500).optional(),
    kind: z.enum(["primary", "reporting"]),
  }),
});

export const candidateSetSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("candidate-set"),
  createdAt: z.iso.datetime({ offset: true }),
  window: z.object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  }),
  sourceRuns: z.array(z.object({
    adapterId: z.string().min(1).max(100),
    feedUrl: httpsUrlSchema,
    status: z.enum(["succeeded", "failed"]),
    candidateCount: z.number().int().nonnegative(),
    contentSha256: sha256Schema.optional(),
    etag: z.string().max(500).optional(),
    lastModified: z.string().max(200).optional(),
    error: z.string().max(300).optional(),
  })),
  candidates: z.array(discoveredStorySchema),
});

export const visualDetailSchema = z.object({
  detail: z.string().min(1).max(240),
  kind: z.enum([
    "object",
    "material",
    "color",
    "setting",
    "species",
    "instrument",
    "other",
  ]),
  confidence: z.number().min(0).max(1),
});

export const articleClaimSchema = z.object({
  claim: z.string().min(1).max(320),
});

export const analyzedArticleClaimSchema = articleClaimSchema.extend({
  evidence: z.string().min(1).max(320),
});

export const analyzedVisualDetailSchema = visualDetailSchema.extend({
  evidence: z.string().min(1).max(320),
});

export const articleEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("article-evidence"),
  storyId: sha256Schema,
  createdAt: z.iso.datetime({ offset: true }),
  source: z.object({
    canonicalUrl: httpsUrlSchema,
    publisher: z.string().min(1).max(160),
    publishedAt: z.iso.datetime({ offset: true }),
    fetchedAt: z.iso.datetime({ offset: true }),
    retrievedUrl: httpsUrlSchema,
    extractedTextSha256: sha256Schema,
    extractedCharacterCount: z.number().int().positive(),
  }),
  extraction: z.object({
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(160),
    status: z.enum(["analyzed", "insufficient-evidence"]),
    usage: providerUsageSchema.optional(),
  }),
  editorial: z.object({
    headline: z.string().min(1).max(180),
    summary: z.string().min(1).max(700),
    claims: z.array(articleClaimSchema).max(6),
  }),
  details: z.array(visualDetailSchema).max(6),
});

export type DiscoveredStory = z.infer<typeof discoveredStorySchema>;
export type CandidateSet = z.infer<typeof candidateSetSchema>;
export type VisualDetail = z.infer<typeof visualDetailSchema>;
export type ArticleClaim = z.infer<typeof articleClaimSchema>;
export type AnalyzedArticleClaim = z.infer<typeof analyzedArticleClaimSchema>;
export type AnalyzedVisualDetail = z.infer<typeof analyzedVisualDetailSchema>;
export type ArticleEvidence = z.infer<typeof articleEvidenceSchema>;

