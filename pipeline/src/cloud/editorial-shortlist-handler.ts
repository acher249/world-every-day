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
    onProgress("candidates-ready");
    if (candidates.candidates.length === 0 || candidates.candidates.length > MAX_EVALUATION_CANDIDATES) {
      throw new Error(`Editorial evaluation requires 1–${MAX_EVALUATION_CANDIDATES} candidates`);
    }

    const existingEvaluation = await artifacts.read(evaluationKey);
    const evaluations = existingEvaluation
      ? candidateEvaluationSetSchema.parse(JSON.parse(Buffer.from(existingEvaluation).toString("utf8")))
      : await evaluateCandidateSet({
          candidateSet: candidates,
          createdAt: now(),
          editionId,
          evaluator,
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
    return {
      candidateCount: candidates.candidates.length,
      editionId,
      evaluationKey,
      selectedCount: shortlist.selected.length,
      shortlistKey,
    };
  };
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
