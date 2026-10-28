import { librarySnapshotSchema } from "../editorial/story-library.js";
import { z } from "zod";
import initialSourceConfiguration from "../../config/source-configuration.initial.v1.json" with { type: "json" };
import {
  evaluateCandidateSet,
  type CandidateEvaluator,
} from "../editorial/evaluate.js";
import { MAX_EVALUATION_CANDIDATES } from "../editorial/bedrock-evaluator.js";
import {
  artifactSha256,
  candidateSetSha256,
  createEditorialShortlist,
} from "../editorial/select.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema } from "../editorial/schema.js";
import { parseAssessment } from "../editorial/bedrock-evaluator.js";
import { providerUsageSchema, type ProviderUsage } from "../provider-usage.js";
import { candidateSetSchema } from "../sources/schema.js";
import { assertConfiguredCandidates, parseSourceConfiguration, type SourceConfiguration } from "../sources/config.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { candidateEvaluator, cloudTextEnvironment } from "./text-provider.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createEditorialShortlistHandler({
  artifacts,
  evaluator,
  now = () => new Date(),
  onProgress = () => {},
  sourceConfiguration,
}: {
  artifacts: ArtifactStore;
  evaluator: CandidateEvaluator;
  now?: () => Date;
  onProgress?: (phase: string) => void;
  sourceConfiguration?: SourceConfiguration;
}) {
  return async (rawInput: unknown) => {
    const { editionId } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const candidateKey = `${root}/sources/candidate-set.json`;
    const evaluationKey = `${root}/editorial/candidate-evaluations.json`;
    const shortlistKey = `${root}/editorial/shortlist.json`;
    const candidateBytes = await artifacts.read(candidateKey);
    if (!candidateBytes) throw new Error(`Candidate set is missing: ${candidateKey}`);
    const candidates = candidateSetSchema.parse(JSON.parse(Buffer.from(candidateBytes).toString("utf8")));
    if (sourceConfiguration) assertConfiguredCandidates(candidates.candidates, sourceConfiguration);
    const snapshotBytes = candidates.librarySnapshotSha256 ? await artifacts.read(`${root}/sources/library-snapshot.json`) : null;
    const snapshot = snapshotBytes ? librarySnapshotSchema.parse(JSON.parse(Buffer.from(snapshotBytes).toString("utf8"))) : undefined;
    if (candidates.librarySnapshotSha256 && (!snapshot || artifactSha256(snapshot) !== candidates.librarySnapshotSha256)) {
      throw new Error("Story library snapshot is missing or changed");
    }
    const cached = new Map(snapshot?.entries.filter(({ producer }) => producer.provider === evaluator.provider &&
      producer.model === evaluator.model && producer.promptVersion === evaluator.promptVersion).map((entry) => [entry.candidate.id, entry]) ?? []);
    const effectiveEvaluator: CandidateEvaluator = snapshot ? { ...evaluator, async evaluate(stories) {
      const reusable = stories.filter((story) => {
        const previous = cached.get(story.id)?.candidate;
        // Rediscovery timestamps may differ; the editorial input must not.
        return previous && previous.title === story.title && previous.canonicalUrl === story.canonicalUrl && previous.publishedAt === story.publishedAt;
      });
      const ids = new Set(reusable.map(({ id }) => id));
      const pending = stories.filter(({ id }) => !ids.has(id));
      const assessments = reusable.map(({ id }) => {
        const { scores, ...assessment } = cached.get(id)!.evaluation;
        const { recency: _recency, ...modelScores } = scores;
        return { ...assessment, scores: modelScores };
      });
      let usage: Awaited<ReturnType<CandidateEvaluator["evaluate"]>>["usage"];
      for (let offset = 0; offset < pending.length; offset += MAX_EVALUATION_CANDIDATES) {
        const result = await evaluator.evaluate(pending.slice(offset, offset + MAX_EVALUATION_CANDIDATES));
        assessments.push(...result.assessments);
        if (result.usage) usage = usage ? { ...result.usage, requestCount: usage.requestCount + result.usage.requestCount,
          inputUnits: usage.inputUnits === undefined || result.usage.inputUnits === undefined ? undefined : usage.inputUnits + result.usage.inputUnits, outputUnits: usage.outputUnits === undefined || result.usage.outputUnits === undefined ? undefined : usage.outputUnits + result.usage.outputUnits,
          totalUnits: usage.totalUnits === undefined || result.usage.totalUnits === undefined ? undefined : usage.totalUnits + result.usage.totalUnits } : result.usage;
      }
      return { assessments, usage };
    } } : evaluator;
    const runSignature = artifactSha256({
      candidateSetSha256: candidateSetSha256(candidates),
      provider: evaluator.provider,
      model: evaluator.model,
      promptVersion: evaluator.promptVersion,
    });
    const checkpointedEvaluator: CandidateEvaluator = {
      ...effectiveEvaluator,
      async evaluate(stories) {
        const assessments: Awaited<ReturnType<CandidateEvaluator["evaluate"]>>["assessments"] = [];
        const usageParts: ProviderUsage[] = [];
        for (let offset = 0; offset < stories.length; offset += 10) {
          const batch = stories.slice(offset, offset + 10);
          const storyIds = batch.map(({ id }) => id);
          const batchHash = artifactSha256({ runSignature, storyIds });
          const key = `${root}/editorial/evaluation-batches/${runSignature}/${batchHash}.json`;
          const existing = await artifacts.read(key);
          if (existing) {
            const checkpoint = JSON.parse(Buffer.from(existing).toString("utf8")) as Record<string, unknown>;
            if (checkpoint.schemaVersion !== "1.0.0" || checkpoint.artifactType !== "candidate-evaluation-batch" ||
                checkpoint.runSignature !== runSignature || checkpoint.provider !== evaluator.provider ||
                checkpoint.model !== evaluator.model || checkpoint.promptVersion !== evaluator.promptVersion ||
                JSON.stringify(checkpoint.storyIds) !== JSON.stringify(storyIds) || !Array.isArray(checkpoint.assessments)) {
              throw new Error("Editorial assessment checkpoint is invalid; start a new edition");
            }
            const restored = checkpoint.assessments.map(parseAssessment);
            assertAssessmentCoverage(restored, batch);
            assessments.push(...restored);
            if (checkpoint.usage !== undefined) usageParts.push(providerUsageSchema.parse(checkpoint.usage));
            continue;
          }

          const result = await effectiveEvaluator.evaluate(batch);
          const validated = result.assessments.map(parseAssessment);
          assertAssessmentCoverage(validated, batch);
          const ordered = batch.map(({ id }) => validated.find(({ storyId }) => storyId === id)!);
          await artifacts.putImmutable({
            key,
            contentType: "application/json",
            bytes: Buffer.from(`${JSON.stringify({
              schemaVersion: "1.0.0",
              artifactType: "candidate-evaluation-batch",
              runSignature,
              provider: evaluator.provider,
              model: evaluator.model,
              promptVersion: evaluator.promptVersion,
              storyIds,
              assessments: ordered,
              ...(result.usage ? { usage: result.usage } : {}),
            }, null, 2)}\n`),
            metadata: { editionId, runSignature },
          });
          assessments.push(...ordered);
          if (result.usage) usageParts.push(result.usage);
        }
        return { assessments, usage: aggregateProviderUsage(usageParts) };
      },
    };
    onProgress("candidates-ready");
    if (candidates.candidates.length === 0 || candidates.candidates.length > (snapshot ? 200 : MAX_EVALUATION_CANDIDATES)) {
      throw new Error(`Editorial evaluation requires 1–${MAX_EVALUATION_CANDIDATES} candidates`);
    }

    const existingEvaluation = await artifacts.read(evaluationKey);
    const evaluations = existingEvaluation
      ? candidateEvaluationSetSchema.parse(JSON.parse(Buffer.from(existingEvaluation).toString("utf8")))
      : await evaluateCandidateSet({
          candidateSet: candidates,
          createdAt: now(),
          editionId,
          evaluator: checkpointedEvaluator,
        });
    if (evaluations.editionId !== editionId ||
        evaluations.candidateSetSha256 !== candidateSetSha256(candidates) ||
        evaluations.producer.provider !== evaluator.provider ||
        evaluations.producer.model !== evaluator.model ||
        evaluations.producer.promptVersion !== evaluator.promptVersion) {
      throw new Error("Candidate evaluations do not match this edition, candidate set, or evaluator; start a new edition");
    }
    if (!existingEvaluation) {
      await artifacts.putImmutable({
        key: evaluationKey,
        contentType: "application/json",
        bytes: Buffer.from(`${JSON.stringify(evaluations, null, 2)}\n`),
        metadata: { editionId },
      });
    }
    onProgress("evaluations-ready");

    const existingShortlist = await artifacts.read(shortlistKey);
    const shortlist = existingShortlist
      ? editorialShortlistSchema.parse(JSON.parse(Buffer.from(existingShortlist).toString("utf8")))
      : createEditorialShortlist({
          candidateSet: candidates,
          createdAt: now(),
          evaluations,
          newestFirst: Boolean(snapshot),
          usedEventKeys: new Set(snapshot?.usedEventKeys ?? []),
          sourcePolicy: sourceConfiguration ? {
            approvedSourceIds: new Set(sourceConfiguration.sources
              .filter(({ articleAccess }) => articleAccess === "ephemeral-analysis")
              .map(({ id }) => id)),
            configurationSha256: artifactSha256(sourceConfiguration),
          } : undefined,
        });
    if (shortlist.editionId !== editionId ||
        shortlist.candidateSetSha256 !== candidateSetSha256(candidates) ||
        shortlist.evaluationSetSha256 !== artifactSha256(evaluations) ||
        (sourceConfiguration && shortlist.sourceConfigurationSha256 !== artifactSha256(sourceConfiguration))) {
      throw new Error("Editorial shortlist does not match this edition's inputs");
    }
    if (!existingShortlist) {
      await artifacts.putImmutable({
        key: shortlistKey,
        contentType: "application/json",
        bytes: Buffer.from(`${JSON.stringify(shortlist, null, 2)}\n`),
        metadata: { editionId },
      });
    }
    onProgress("shortlist-ready");
    if (snapshot && shortlist.selected.length === 0) throw new Error("No usable stories remain after recent discovery and unused story-library fallback");
    return {
      candidateCount: candidates.candidates.length,
      editionId,
      evaluationKey,
      selectedCount: shortlist.selected.length,
      shortlistKey,
    };
  };
}

function assertAssessmentCoverage(
  assessments: Awaited<ReturnType<CandidateEvaluator["evaluate"]>>["assessments"],
  candidates: Array<{ id: string }>,
): void {
  const expected = new Set(candidates.map(({ id }) => id));
  if (assessments.length !== candidates.length || assessments.some(({ storyId }) => !expected.delete(storyId)) || expected.size) {
    throw new Error("Candidate evaluator did not return one valid assessment per story");
  }
}

function aggregateProviderUsage(values: ProviderUsage[]): ProviderUsage | undefined {
  if (values.length === 0) return undefined;
  const reported = values.every(({ providerReported }) => providerReported);
  return providerUsageSchema.parse({
    requestCount: values.reduce((sum, value) => sum + value.requestCount, 0),
    unit: "tokens",
    providerReported: reported,
    inputUnits: reported ? values.reduce((sum, value) => sum + (value.inputUnits ?? 0), 0) : undefined,
    outputUnits: reported ? values.reduce((sum, value) => sum + (value.outputUnits ?? 0), 0) : undefined,
    totalUnits: reported ? values.reduce((sum, value) => sum + (value.totalUnits ?? 0), 0) : undefined,
  });
}

export async function main(event: unknown) {
  const startedAt = Date.now();
  const onProgress = (phase: string) => console.info(JSON.stringify({
    event: "editorial-shortlist-progress",
    phase,
    elapsedMs: Date.now() - startedAt,
  }));
  onProgress("started");
  const bucket = requiredEnvironment("ARTIFACT_BUCKET");
  const selectedEvaluator = candidateEvaluator(await cloudTextEnvironment());
  const evaluator: CandidateEvaluator = {
    model: selectedEvaluator.model,
    provider: selectedEvaluator.provider,
    promptVersion: selectedEvaluator.promptVersion,
    async evaluate(candidates) {
      onProgress("model-started");
      const result = await selectedEvaluator.evaluate(candidates);
      onProgress("model-completed");
      return result;
    },
  };
  return createEditorialShortlistHandler({
    artifacts: new S3ArtifactStore({ bucket }),
    evaluator,
    onProgress,
    sourceConfiguration: parseSourceConfiguration(initialSourceConfiguration),
  })(event);
}
