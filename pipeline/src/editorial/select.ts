import { createHash } from "node:crypto";
import { candidateSetSchema, type CandidateSet } from "../sources/schema.js";
import {
  candidateEvaluationSetSchema,
  editorialSelectionConfigurationSchema,
  editorialShortlistSchema,
  type CandidateEvaluation,
  type CandidateEvaluationSet,
  type EditorialSelectionConfiguration,
  type EditorialShortlist,
} from "./schema.js";

export const defaultEditorialSelectionConfiguration = editorialSelectionConfigurationSchema.parse({
  targetStories: 15,
  minimumCredibility: 0.7,
  maxPerTopic: 3,
  maxPerPublisher: 2,
  maxPerGeography: 4,
  weights: {
    credibility: 0.3,
    constructiveSignificance: 0.3,
    publicRelevance: 0.2,
    novelty: 0.1,
    recency: 0.1,
  },
});

export function artifactSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function candidateSetSha256(candidateSet: CandidateSet): string {
  return artifactSha256(candidateSetSchema.parse(candidateSet));
}

export function editorialScore(
  evaluation: CandidateEvaluation,
  configuration: EditorialSelectionConfiguration,
): number {
  const { scores } = evaluation;
  const { weights } = configuration;
  return (
    scores.credibility * weights.credibility +
    scores.constructiveSignificance * weights.constructiveSignificance +
    scores.publicRelevance * weights.publicRelevance +
    scores.novelty * weights.novelty +
    scores.recency * weights.recency
  );
}

export function createEditorialShortlist({
  candidateSet,
  configuration = defaultEditorialSelectionConfiguration,
  createdAt = new Date(),
  evaluations,
  sourcePolicy,
  newestFirst = false,
  usedEventKeys = new Set<string>(),
}: {
  candidateSet: CandidateSet;
  configuration?: EditorialSelectionConfiguration;
  createdAt?: Date;
  evaluations: CandidateEvaluationSet;
  newestFirst?: boolean;
  usedEventKeys?: ReadonlySet<string>;
  sourcePolicy?: {
    approvedSourceIds: ReadonlySet<string>;
    configurationSha256: string;
  };
}): EditorialShortlist {
  const validatedCandidates = candidateSetSchema.parse(candidateSet);
  const validatedEvaluations = candidateEvaluationSetSchema.parse(evaluations);
  const validatedConfiguration = editorialSelectionConfigurationSchema.parse(configuration);
  const inputHash = candidateSetSha256(validatedCandidates);
  if (validatedEvaluations.candidateSetSha256 !== inputHash) {
    throw new Error("Candidate evaluations do not match the candidate-set checksum");
  }

  const candidatesById = new Map(
    validatedCandidates.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const evaluationIds = new Set(validatedEvaluations.evaluations.map(({ storyId }) => storyId));
  const missing = validatedCandidates.candidates.filter(({ id }) => !evaluationIds.has(id));
  const unexpected = validatedEvaluations.evaluations.filter(({ storyId }) => !candidatesById.has(storyId));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Evaluation coverage mismatch; missing=${missing.length}; unexpected=${unexpected.length}`,
    );
  }

  const ranked = [...validatedEvaluations.evaluations]
    .map((evaluation) => ({ evaluation, score: editorialScore(evaluation, validatedConfiguration) }))
    .sort((left, right) =>
      (newestFirst ? candidatesById.get(right.evaluation.storyId)!.publishedAt.localeCompare(candidatesById.get(left.evaluation.storyId)!.publishedAt) : 0) ||
      right.score - left.score ||
      left.evaluation.storyId.localeCompare(right.evaluation.storyId),
    );
  const selected: EditorialShortlist["selected"] = [];
  const excluded: EditorialShortlist["excluded"] = [];
  const eventKeys = new Set<string>();
  const topicCounts = new Map<string, number>();
  const publisherCounts = new Map<string, number>();
  const geographyCounts = new Map<string, number>();

  for (const { evaluation, score } of ranked) {
    const candidate = candidatesById.get(evaluation.storyId)!;
    let reason: EditorialShortlist["excluded"][number]["reason"] | undefined;
    if (sourcePolicy && !sourcePolicy.approvedSourceIds.has(candidate.source.adapterId)) {
      reason = "source-not-approved-for-analysis";
    } else if (usedEventKeys.has(evaluation.eventKey)) reason = "previously-published-event";
    else if (!evaluation.eligibility.eligible) reason = "ineligible";
    else if (evaluation.scores.credibility < validatedConfiguration.minimumCredibility) {
      reason = "credibility-below-threshold";
    } else if (eventKeys.has(evaluation.eventKey)) reason = "duplicate-event";
    else if ((topicCounts.get(evaluation.classification.topic) ?? 0) >= validatedConfiguration.maxPerTopic) {
      reason = "topic-cap";
    } else if ((publisherCounts.get(candidate.source.publisherGroup ?? candidate.publisher) ?? 0) >= validatedConfiguration.maxPerPublisher) {
      reason = "publisher-cap";
    } else if ((geographyCounts.get(evaluation.classification.geography) ?? 0) >= validatedConfiguration.maxPerGeography) {
      reason = "geography-cap";
    } else if (selected.length >= validatedConfiguration.targetStories) reason = "below-cut";

    if (reason) {
      excluded.push({ storyId: evaluation.storyId, reason });
      continue;
    }
    eventKeys.add(evaluation.eventKey);
    topicCounts.set(evaluation.classification.topic, (topicCounts.get(evaluation.classification.topic) ?? 0) + 1);
    const publisherGroup = candidate.source.publisherGroup ?? candidate.publisher;
    publisherCounts.set(publisherGroup, (publisherCounts.get(publisherGroup) ?? 0) + 1);
    geographyCounts.set(evaluation.classification.geography, (geographyCounts.get(evaluation.classification.geography) ?? 0) + 1);
    selected.push({
      storyId: evaluation.storyId,
      rank: selected.length + 1,
      editorialScore: Number(score.toFixed(6)),
      visualProminenceScore: evaluation.scores.visualPotential,
    });
  }

  return editorialShortlistSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "editorial-shortlist",
    editionId: validatedEvaluations.editionId,
    createdAt: createdAt.toISOString(),
    candidateSetSha256: inputHash,
    evaluationSetSha256: artifactSha256(validatedEvaluations),
    sourceConfigurationSha256: sourcePolicy?.configurationSha256,
    configuration: validatedConfiguration,
    selected,
    excluded,
  });
}

