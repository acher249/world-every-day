import { z } from "zod";
import { providerUsageSchema } from "../provider-usage.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const scoreSchema = z.number().min(0).max(1);

export const candidateEvaluationSchema = z.object({
  storyId: sha256Schema,
  eventKey: idSchema,
  classification: z.object({
    topic: idSchema,
    geography: idSchema,
    organization: z.string().min(1).max(160),
  }),
  eligibility: z.object({
    eligible: z.boolean(),
    reasons: z.array(z.string().min(1).max(240)).max(8),
  }),
  scores: z.object({
    credibility: scoreSchema,
    constructiveSignificance: scoreSchema,
    publicRelevance: scoreSchema,
    novelty: scoreSchema,
    recency: scoreSchema,
    visualPotential: scoreSchema,
  }),
  rationales: z.object({
    credibility: z.string().min(1).max(300),
    constructiveSignificance: z.string().min(1).max(300),
    publicRelevance: z.string().min(1).max(300),
    novelty: z.string().min(1).max(300),
    visualPotential: z.string().min(1).max(300),
  }),
});

export const candidateEvaluationSetSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("candidate-evaluations"),
  editionId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  candidateSetSha256: sha256Schema,
  producer: z.object({
    type: z.enum(["fixture", "model", "human"]),
    provider: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(160).optional(),
    promptVersion: z.string().min(1).max(100),
    usage: providerUsageSchema.optional(),
  }),
  evaluations: z.array(candidateEvaluationSchema),
}).superRefine((artifact, context) => {
  const ids = new Set<string>();
  artifact.evaluations.forEach((evaluation, index) => {
    if (ids.has(evaluation.storyId)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate candidate evaluation: ${evaluation.storyId}`,
        path: ["evaluations", index, "storyId"],
      });
    }
    ids.add(evaluation.storyId);
  });
});

export const editorialSelectionConfigurationSchema = z.object({
  targetStories: z.number().int().positive().max(30),
  minimumCredibility: scoreSchema,
  maxPerTopic: z.number().int().positive(),
  maxPerPublisher: z.number().int().positive(),
  maxPerGeography: z.number().int().positive(),
  weights: z.object({
    credibility: z.number().nonnegative(),
    constructiveSignificance: z.number().nonnegative(),
    publicRelevance: z.number().nonnegative(),
    novelty: z.number().nonnegative(),
    recency: z.number().nonnegative(),
  }),
}).superRefine((configuration, context) => {
  const total = Object.values(configuration.weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.000001) {
    context.addIssue({ code: "custom", message: "Editorial score weights must sum to 1" });
  }
});

const exclusionReasonSchema = z.enum([
  "ineligible",
  "previously-published-event",
  "source-not-approved-for-analysis",
  "credibility-below-threshold",
  "duplicate-event",
  "topic-cap",
  "publisher-cap",
  "geography-cap",
  "below-cut",
]);

export const editorialShortlistSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("editorial-shortlist"),
  editionId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  candidateSetSha256: sha256Schema,
  evaluationSetSha256: sha256Schema,
  sourceConfigurationSha256: sha256Schema.optional(),
  configuration: editorialSelectionConfigurationSchema,
  selected: z.array(z.object({
    storyId: sha256Schema,
    rank: z.number().int().positive(),
    editorialScore: scoreSchema,
    visualProminenceScore: scoreSchema,
  })),
  excluded: z.array(z.object({
    storyId: sha256Schema,
    reason: exclusionReasonSchema,
  })),
});

export type CandidateEvaluation = z.infer<typeof candidateEvaluationSchema>;
export type CandidateEvaluationSet = z.infer<typeof candidateEvaluationSetSchema>;
export type EditorialSelectionConfiguration = z.infer<typeof editorialSelectionConfigurationSchema>;
export type EditorialShortlist = z.infer<typeof editorialShortlistSchema>;

