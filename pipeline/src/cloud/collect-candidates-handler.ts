import { z } from "zod";
import initialSourceConfiguration from "../../config/source-configuration.initial.v1.json" with { type: "json" };
import { createSourceAdapter } from "../sources/adapter.js";
import { assertConfiguredCandidates, parseSourceConfiguration, type SourceConfiguration } from "../sources/config.js";
import { collectCandidateSet } from "../sources/feed.js";
import { AllowlistedHttpFetcher, type ResourceFetcher } from "../sources/http.js";
import { DynamoDbRequestPacer } from "../sources/pacing.js";
import { candidateSetSchema } from "../sources/schema.js";
import { canonicalizeSourceUrl } from "../sources/url.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  windowStart: z.iso.datetime({ offset: true }),
  windowEnd: z.iso.datetime({ offset: true }),
});

type Source = SourceConfiguration["sources"][number];

type Dependencies = {
  artifacts: ArtifactStore;
  configuration: SourceConfiguration;
  fetcherForSource?: (source: Source) => ResourceFetcher;
  now?: () => Date;
};

export function createCollectCandidatesHandler({
  artifacts,
  configuration,
  fetcherForSource = (source) => new AllowlistedHttpFetcher({
    allowedHosts: [new URL(source.feedUrl).hostname],
    pacer: source.crawlDelayMs ? new DynamoDbRequestPacer({
      delayMs: source.crawlDelayMs,
      tableName: process.env.EDITION_TABLE ?? "",
    }) : undefined,
  }),
  now = () => new Date(),
}: Dependencies) {
  return async (rawInput: unknown) => {
    const input = inputSchema.parse(rawInput);
    const window = {
      start: new Date(input.windowStart),
      end: new Date(input.windowEnd),
    };
    const windowLength = window.end.getTime() - window.start.getTime();
    if (windowLength <= 0 || windowLength > 72 * 60 * 60 * 1_000) {
      throw new Error("Collection window must be greater than zero and at most 72 hours");
    }

    const key = `editions/${input.editionId}/sources/candidate-set.json`;
    const existing = await artifacts.read(key);
    if (existing) {
      const artifact = candidateSetSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      const sourceRuns = new Map(artifact.sourceRuns.map((run) => [run.adapterId, run.feedUrl]));
      if (sourceRuns.size !== configuration.sources.length ||
          configuration.sources.some((source) => sourceRuns.get(source.id) !== canonicalizeSourceUrl(source.feedUrl))) {
        throw new Error("Candidate set was collected with a different source allowlist; start a new edition");
      }
      assertConfiguredCandidates(artifact.candidates, configuration);
      if (artifact.window.start !== window.start.toISOString() ||
          artifact.window.end !== window.end.toISOString()) {
        throw new Error(`Candidate set already exists for a different window: ${key}`);
      }
      return {
        candidateCount: artifact.candidates.length,
        editionId: input.editionId,
        failedSourceCount: artifact.sourceRuns.filter(({ status }) => status === "failed").length,
        key,
        omittedCandidateCount: artifact.omittedCandidateCount ?? 0,
      };
    }

    const adapters = configuration.sources.map((source) => createSourceAdapter(
      source, fetcherForSource(source),
    ));
    const artifact = await collectCandidateSet({ adapters, createdAt: now(), window });
    if (artifact.candidates.length === 0) {
      throw new Error("No candidate stories were discovered; refusing to advance the edition");
    }
    await artifacts.putImmutable({
      key,
      contentType: "application/json",
      bytes: Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`),
      metadata: { editionId: input.editionId },
    });
    return {
      candidateCount: artifact.candidates.length,
      editionId: input.editionId,
      failedSourceCount: artifact.sourceRuns.filter(({ status }) => status === "failed").length,
      key,
      omittedCandidateCount: artifact.omittedCandidateCount ?? 0,
    };
  };
}

export async function main(event: unknown) {
  const bucket = process.env.ARTIFACT_BUCKET?.trim();
  if (!bucket) throw new Error("Missing required environment variable: ARTIFACT_BUCKET");
  return createCollectCandidatesHandler({
    artifacts: new S3ArtifactStore({ bucket }),
    configuration: parseSourceConfiguration(initialSourceConfiguration),
  })(event);
}
