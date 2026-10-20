import { z } from "zod";
import initialSourceConfiguration from "../../config/source-configuration.initial.v1.json" with { type: "json" };
import { artifactSha256, candidateSetSha256 } from "../editorial/select.js";
import { editorialShortlistSchema } from "../editorial/schema.js";
import { analyzeArticle } from "../sources/article.js";
import { parseSourceConfiguration, type SourceConfiguration } from "../sources/config.js";
import { AllowlistedHttpFetcher } from "../sources/http.js";
import { DynamoDbRequestPacer } from "../sources/pacing.js";
import { canonicalizeSourceUrl } from "../sources/url.js";
import {
  articleEvidenceSchema,
  candidateSetSchema,
  type ArticleEvidence,
  type DiscoveredStory,
} from "../sources/schema.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { articleAnalyzer, cloudTextEnvironment } from "./text-provider.js";

const editionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const prepareInputSchema = z.object({ editionId: editionIdSchema });
const workerInputSchema = prepareInputSchema.extend({ storyId: z.string().regex(/^[a-f0-9]{64}$/) });
type Source = SourceConfiguration["sources"][number];

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function readInputs(artifacts: ArtifactStore, editionId: string, configuration: SourceConfiguration) {
  const root = `editions/${editionId}`;
  const candidateBytes = await artifacts.read(`${root}/sources/candidate-set.json`);
  const shortlistBytes = await artifacts.read(`${root}/editorial/shortlist.json`);
  if (!candidateBytes || !shortlistBytes) throw new Error("Candidate set and editorial shortlist are required");
  const candidates = candidateSetSchema.parse(JSON.parse(Buffer.from(candidateBytes).toString("utf8")));
  const shortlist = editorialShortlistSchema.parse(JSON.parse(Buffer.from(shortlistBytes).toString("utf8")));
  if (shortlist.editionId !== editionId || shortlist.candidateSetSha256 !== candidateSetSha256(candidates)) {
    throw new Error("Editorial shortlist does not match the candidate set");
  }
  if (shortlist.sourceConfigurationSha256 !== artifactSha256(configuration)) {
    throw new Error("Editorial shortlist lacks the current source-policy checksum");
  }
  if (shortlist.selected.length === 0 || shortlist.selected.length > 15) {
    throw new Error("Article analysis requires 1–15 shortlisted stories");
  }
  const candidatesById = new Map(candidates.candidates.map((story) => [story.id, story]));
  const sourcesById = new Map(configuration.sources.map((source) => [source.id, source]));
  const stories = shortlist.selected.map(({ storyId }) => {
    const story = candidatesById.get(storyId);
    if (!story) throw new Error(`Shortlisted story is missing: ${storyId}`);
    const source = sourcesById.get(story.source.adapterId);
    if (!source || source.articleAccess !== "ephemeral-analysis" ||
        canonicalizeSourceUrl(source.feedUrl) !== story.source.feedUrl ||
        source.publisher !== story.publisher || source.kind !== story.source.kind) {
      throw new Error(`Story source is not approved for article analysis: ${story.source.adapterId}`);
    }
    return { source, story };
  });
  return stories;
}

export function createPrepareArticleAnalysisHandler({
  artifacts,
  configuration,
}: {
  artifacts: ArtifactStore;
  configuration: SourceConfiguration;
}) {
  return async (rawInput: unknown) => {
    const { editionId } = prepareInputSchema.parse(rawInput);
    const stories = await readInputs(artifacts, editionId, configuration);
    return { editionId, tasks: stories.map(({ story }) => ({ editionId, storyId: story.id })) };
  };
}

export function createArticleAnalysisWorker({
  analyze,
  artifacts,
  configuration,
  producer,
}: {
  analyze: (story: DiscoveredStory, source: Source) => Promise<ArticleEvidence>;
  artifacts: ArtifactStore;
  configuration: SourceConfiguration;
  producer: Pick<ArticleEvidence["extraction"], "provider" | "model">;
}) {
  return async (rawInput: unknown) => {
    const { editionId, storyId } = workerInputSchema.parse(rawInput);
    const stories = await readInputs(artifacts, editionId, configuration);
    const selected = stories.find(({ story }) => story.id === storyId);
    if (!selected) throw new Error(`Story is not in the approved shortlist: ${storyId}`);
    const key = `editions/${editionId}/editorial/article-evidence/${storyId}.json`;
    const existing = await artifacts.read(key);
    if (existing) {
      const evidence = articleEvidenceSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      if (evidence.storyId !== storyId || evidence.source.canonicalUrl !== selected.story.canonicalUrl ||
          evidence.extraction.provider !== producer.provider || evidence.extraction.model !== producer.model) {
        throw new Error(`Existing article evidence does not match story ${storyId} or its provider; start a new edition`);
      }
      return { key, status: "reused", storyId };
    }
    const evidence = articleEvidenceSchema.parse(await analyze(selected.story, selected.source));
    if (evidence.storyId !== storyId || evidence.source.canonicalUrl !== selected.story.canonicalUrl ||
        evidence.extraction.provider !== producer.provider || evidence.extraction.model !== producer.model) {
      throw new Error(`Article analysis did not match story ${storyId} or its provider`);
    }
    await artifacts.putImmutable({
      key,
      contentType: "application/json",
      bytes: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
      metadata: { editionId, storyId },
    });
    return { key, status: "created", storyId };
  };
}

export async function prepare(event: unknown) {
  return createPrepareArticleAnalysisHandler({
    artifacts: new S3ArtifactStore({ bucket: requiredEnvironment("ARTIFACT_BUCKET") }),
    configuration: parseSourceConfiguration(initialSourceConfiguration),
  })(event);
}

export async function analyze(event: unknown) {
  const analyzer = articleAnalyzer(await cloudTextEnvironment());
  return createArticleAnalysisWorker({
    artifacts: new S3ArtifactStore({ bucket: requiredEnvironment("ARTIFACT_BUCKET") }),
    configuration: parseSourceConfiguration(initialSourceConfiguration),
    producer: { provider: analyzer.provider, model: analyzer.model },
    async analyze(story, source) {
      return analyzeArticle({
        analyzer,
        fetcher: new AllowlistedHttpFetcher({
          allowedHosts: source.allowedArticleHosts,
          pacer: source.crawlDelayMs ? new DynamoDbRequestPacer({
            delayMs: source.crawlDelayMs,
            tableName: requiredEnvironment("EDITION_TABLE"),
          }) : undefined,
        }),
        story,
      });
    },
  })(event);
}
