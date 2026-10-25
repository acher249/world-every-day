import { S3Client } from "@aws-sdk/client-s3";
import { createStoryLibrary, listS3Editions, librarySnapshotSchema, isApprovedLibraryCandidate, type StoryLibrary } from "../editorial/story-library.js";
import { artifactSha256 } from "../editorial/select.js";
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
  library?: StoryLibrary;
};

export function createCollectCandidatesHandler({
  artifacts,
  configuration,
  library,
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
      if ((artifact.collectionWindow ?? artifact.window).start !== window.start.toISOString() ||
          (artifact.collectionWindow ?? artifact.window).end !== window.end.toISOString()) {
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
    // Fetch each feed once; the wider set supplies 48/72-hour fallback candidates.
    const discoveryWindow = library ? { start: new Date(window.end.getTime() - 72 * 3_600_000), end: window.end } : window;
    const artifact = await collectCandidateSet({ adapters, createdAt: now(), window: discoveryWindow });
    if (library) {
      const snapshotKey = `editions/${input.editionId}/sources/library-snapshot.json`;
      const existingSnapshot = await artifacts.read(snapshotKey);
      const snapshot = existingSnapshot ? librarySnapshotSchema.parse(JSON.parse(Buffer.from(existingSnapshot).toString("utf8"))) : await library.load(window.end, input.editionId);
      if (!existingSnapshot) await artifacts.putImmutable({ key: snapshotKey, contentType: "application/json", bytes: Buffer.from(JSON.stringify(snapshot)) });
      const used = new Set(snapshot.usedUrls);
      const byId = new Map(snapshot.entries.map(({ candidate }) => [candidate.id, candidate]));
      for (const candidate of artifact.candidates) byId.set(candidate.id, candidate);
      artifact.candidates = [...byId.values()].filter((candidate) => !used.has(candidate.canonicalUrl) && isApprovedLibraryCandidate(candidate, configuration))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
      artifact.collectionWindow = { start: window.start.toISOString(), end: window.end.toISOString() };
      artifact.librarySnapshotSha256 = artifactSha256(snapshot);
      artifact.window.start = artifact.candidates.reduce((start, c) => c.publishedAt < start ? c.publishedAt : start, discoveryWindow.start.toISOString());
    }
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
  const publicBucket = process.env.PUBLIC_ASSET_BUCKET?.trim();
  if (!publicBucket) throw new Error("Missing required environment variable: PUBLIC_ASSET_BUCKET");
  const client = new S3Client({});
  const artifacts = new S3ArtifactStore({ bucket, client });
  const configuration = parseSourceConfiguration(initialSourceConfiguration);
  return createCollectCandidatesHandler({
    artifacts,
    library: createStoryLibrary({ artifacts, publicAssets: new S3ArtifactStore({ bucket: publicBucket, client }), configuration,
      listEditions: () => listS3Editions(client, bucket) }),
    configuration: parseSourceConfiguration(initialSourceConfiguration),
  })(event);
}
