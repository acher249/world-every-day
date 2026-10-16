import { candidateSetSchema, type CandidateSet, type DiscoveredStory } from "../sources/schema.js";
import type { ProviderUsage } from "../provider-usage.js";
import {
  candidateEvaluationSchema,
  candidateEvaluationSetSchema,
  type CandidateEvaluation,
  type CandidateEvaluationSet,
} from "./schema.js";
import { candidateSetSha256 } from "./select.js";

export const EDITORIAL_EVALUATION_PROMPT_VERSION = "editorial-evaluation-v2";

export type CandidateAssessment = Omit<CandidateEvaluation, "scores"> & {
  scores: Omit<CandidateEvaluation["scores"], "recency">;
};

export type CandidateEvaluator = {
  model: string;
  provider: string;
  promptVersion: string;
  evaluate(candidates: DiscoveredStory[]): Promise<{
    assessments: CandidateAssessment[];
    usage?: ProviderUsage;
  }>;
};

function recencyScore(publishedAt: string, windowEnd: string): number {
  const ageHours = Math.max(
    0,
    (new Date(windowEnd).getTime() - new Date(publishedAt).getTime()) / 3_600_000,
  );
  return Number(Math.max(0, 1 - ageHours / 72).toFixed(6));
}

export async function evaluateCandidateSet({
  candidateSet,
  createdAt = new Date(),
  editionId,
  evaluator,
}: {
  candidateSet: CandidateSet;
  createdAt?: Date;
  editionId: string;
  evaluator: CandidateEvaluator;
}): Promise<CandidateEvaluationSet> {
  const candidates = candidateSetSchema.parse(candidateSet);
  const { assessments, usage } = await evaluator.evaluate(candidates.candidates);
  const byId = new Map(assessments.map((assessment) => [assessment.storyId, assessment]));

  if (byId.size !== assessments.length) {
    throw new Error("Candidate evaluator returned duplicate story ids");
  }
  const expectedIds = new Set(candidates.candidates.map(({ id }) => id));
  const missing = candidates.candidates.filter(({ id }) => !byId.has(id));
  const unexpected = assessments.filter(({ storyId }) => !expectedIds.has(storyId));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Candidate evaluator coverage mismatch; missing=${missing.length}; unexpected=${unexpected.length}`,
    );
  }

  const evaluations = candidates.candidates.map((candidate) => {
    const assessment = byId.get(candidate.id)!;
    return candidateEvaluationSchema.parse({
      ...assessment,
      scores: {
        ...assessment.scores,
        recency: recencyScore(candidate.publishedAt, candidates.window.end),
      },
    });
  });

  return candidateEvaluationSetSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "candidate-evaluations",
    editionId,
    createdAt: createdAt.toISOString(),
    candidateSetSha256: candidateSetSha256(candidates),
    producer: {
      type: evaluator.provider === "fixture" ? "fixture" : "model",
      provider: evaluator.provider,
      model: evaluator.model,
      promptVersion: evaluator.promptVersion,
      usage,
    },
    evaluations,
  });
}
