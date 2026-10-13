import { z } from "zod";
import { articleEvidenceSchema, candidateSetSchema, type ArticleEvidence, type CandidateSet } from "../sources/schema.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema, type CandidateEvaluationSet, type EditorialShortlist } from "./schema.js";
import { artifactSha256, candidateSetSha256 } from "./select.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === "https:");

export const selectedEditionSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("selected-edition"),
  editionId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  inputs: z.object({
    candidateSetSha256: sha256Schema,
    evaluationSetSha256: sha256Schema,
    shortlistSha256: sha256Schema,
  }),
  targetStories: z.number().int().positive().max(10),
  stories: z.array(z.object({
    storyId: sha256Schema,
    rank: z.number().int().positive(),
    topic: idSchema,
    geography: idSchema,
    title: z.string().min(1).max(180),
    summary: z.string().min(1).max(700),
    editorialScore: z.number().min(0).max(1),
    visualProminenceScore: z.number().min(0).max(1),
    sources: z.array(z.object({
      title: z.string().min(1).max(300),
      publisher: z.string().min(1).max(160),
      url: httpsUrlSchema,
      publishedAt: z.iso.datetime({ offset: true }),
      kind: z.enum(["primary", "reporting"]),
    })).min(1).max(8),
    claims: z.array(z.object({
      claim: z.string().min(1).max(320),
    })).min(1).max(6),
    visualDetails: z.array(z.object({
      detail: z.string().min(1).max(240),
      kind: z.enum(["object", "material", "color", "setting", "species", "instrument", "other"]),
      confidence: z.number().min(0).max(1),
    })).max(6),
    articleEvidenceSha256: sha256Schema,
  })).max(10),
  excluded: z.array(z.object({
    storyId: sha256Schema,
    reason: z.enum(["missing-article-evidence", "insufficient-evidence", "below-final-cut"]),
  })),
}).superRefine((edition, context) => {
  const ids = new Set<string>();
  edition.stories.forEach((story, index) => {
    if (ids.has(story.storyId)) {
      context.addIssue({ code: "custom", message: `Duplicate selected story: ${story.storyId}`, path: ["stories", index, "storyId"] });
    }
    ids.add(story.storyId);
    if (story.rank !== index + 1) {
      context.addIssue({ code: "custom", message: "Story ranks must be contiguous", path: ["stories", index, "rank"] });
    }
  });
});

export type SelectedEdition = z.infer<typeof selectedEditionSchema>;

export function createSelectedEdition({
  articleEvidence,
  candidateSet,
  createdAt = new Date(),
  evaluations,
  shortlist,
  targetStories = 10,
}: {
  articleEvidence: ArticleEvidence[];
  candidateSet: CandidateSet;
  createdAt?: Date;
  evaluations: CandidateEvaluationSet;
  shortlist: EditorialShortlist;
  targetStories?: number;
}): SelectedEdition {
  const candidates = candidateSetSchema.parse(candidateSet);
  const evaluationSet = candidateEvaluationSetSchema.parse(evaluations);
  const preliminary = editorialShortlistSchema.parse(shortlist);
  if (!Number.isInteger(targetStories) || targetStories < 1 || targetStories > 10) {
    throw new Error("Final edition target must be an integer between 1 and 10");
  }
  const candidateHash = candidateSetSha256(candidates);
  const evaluationHash = artifactSha256(evaluationSet);
  if (evaluationSet.candidateSetSha256 !== candidateHash || preliminary.candidateSetSha256 !== candidateHash) {
    throw new Error("Editorial artifacts do not match the candidate-set checksum");
  }
  if (preliminary.evaluationSetSha256 !== evaluationHash || preliminary.editionId !== evaluationSet.editionId) {
    throw new Error("Editorial shortlist does not match the evaluation artifact");
  }

  const candidatesById = new Map(candidates.candidates.map((candidate) => [candidate.id, candidate]));
  const evaluationsById = new Map(evaluationSet.evaluations.map((evaluation) => [evaluation.storyId, evaluation]));
  const evidenceById = new Map<string, ArticleEvidence>();
  for (const input of articleEvidence) {
    const evidence = articleEvidenceSchema.parse(input);
    if (evidenceById.has(evidence.storyId)) throw new Error(`Duplicate article evidence: ${evidence.storyId}`);
    evidenceById.set(evidence.storyId, evidence);
  }

  const stories: SelectedEdition["stories"] = [];
  const excluded: SelectedEdition["excluded"] = [];
  for (const selection of preliminary.selected) {
    const candidate = candidatesById.get(selection.storyId);
    const evaluation = evaluationsById.get(selection.storyId);
    if (!candidate || !evaluation) throw new Error(`Missing editorial input for ${selection.storyId}`);
    const evidence = evidenceById.get(selection.storyId);
    if (!evidence) {
      excluded.push({ storyId: selection.storyId, reason: "missing-article-evidence" });
      continue;
    }
    if (evidence.source.canonicalUrl !== candidate.canonicalUrl) {
      throw new Error(`Article evidence URL does not match candidate ${selection.storyId}`);
    }
    if (evidence.editorial.claims.length === 0 || evidence.extraction.status !== "analyzed") {
      excluded.push({ storyId: selection.storyId, reason: "insufficient-evidence" });
      continue;
    }
    if (stories.length >= targetStories) {
      excluded.push({ storyId: selection.storyId, reason: "below-final-cut" });
      continue;
    }
    stories.push({
      storyId: selection.storyId,
      rank: stories.length + 1,
      topic: evaluation.classification.topic,
      geography: evaluation.classification.geography,
      title: evidence.editorial.headline,
      summary: evidence.editorial.summary,
      editorialScore: selection.editorialScore,
      visualProminenceScore: selection.visualProminenceScore,
      sources: [{
        title: candidate.title,
        publisher: candidate.publisher,
        url: candidate.canonicalUrl,
        publishedAt: candidate.publishedAt,
        kind: candidate.source.kind,
      }],
      claims: evidence.editorial.claims,
      visualDetails: evidence.details,
      articleEvidenceSha256: artifactSha256(evidence),
    });
  }

  return selectedEditionSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "selected-edition",
    editionId: evaluationSet.editionId,
    createdAt: createdAt.toISOString(),
    inputs: {
      candidateSetSha256: candidateHash,
      evaluationSetSha256: evaluationHash,
      shortlistSha256: artifactSha256(preliminary),
    },
    targetStories,
    stories,
    excluded,
  });
}
