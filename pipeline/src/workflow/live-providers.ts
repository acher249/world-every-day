import { resolve } from "node:path";
import { ART_DIRECTION_GENERATION_PROMPT_VERSION, type ArtDirectionProvider } from "../art-direction/generate.js";
import { GoogleArtDirectionProvider } from "../art-direction/google.js";
import { EDITORIAL_EVALUATION_PROMPT_VERSION, type CandidateEvaluator } from "../editorial/evaluate.js";
import { GoogleCandidateEvaluator } from "../editorial/google-evaluator.js";
import { BrowserInteractionBaker } from "../interactions/browser.js";
import { GoogleLandmarkDetector } from "../landmarks/google.js";
import type { LandmarkDetector } from "../landmarks/provider.js";
import { NanoBananaGenerator, type PanoramaGenerator } from "../panorama/generator.js";
import type { ArticleAnalyzer } from "../sources/article.js";
import type { SourceConfiguration } from "../sources/config.js";
import { collectCandidateSet, FeedSourceAdapter } from "../sources/feed.js";
import { GoogleArticleAnalyzer } from "../sources/google-article-analysis.js";
import { AllowlistedHttpFetcher } from "../sources/http.js";
import type { WorldGenerator } from "../world/provider.js";
import { worldLabsGeneratorFromEnvironment } from "../world/world-labs.js";
import type { EditionProviders } from "./edition-run.js";

function lazyCandidateEvaluator(environment: NodeJS.ProcessEnv): CandidateEvaluator {
  const model = environment.EDITORIAL_MODEL?.trim() ?? "";
  return {
    provider: "google-genai",
    model,
    promptVersion: EDITORIAL_EVALUATION_PROMPT_VERSION,
    evaluate(candidates) {
      return new GoogleCandidateEvaluator({
        apiKey: environment.GOOGLE_AI_API_KEY ?? "",
        model,
      }).evaluate(candidates);
    },
  };
}

function lazyArticleAnalyzer(environment: NodeJS.ProcessEnv): ArticleAnalyzer {
  const model = environment.EDITORIAL_MODEL?.trim() ?? "";
  return {
    provider: "google-genai",
    model,
    analyze(input) {
      return new GoogleArticleAnalyzer({
        apiKey: environment.GOOGLE_AI_API_KEY ?? "",
        model,
      }).analyze(input);
    },
  };
}

function lazyArtDirectionProvider(environment: NodeJS.ProcessEnv): ArtDirectionProvider {
  const model = environment.ART_DIRECTION_MODEL?.trim() ?? "";
  return {
    provider: "google-genai",
    model,
    promptVersion: ART_DIRECTION_GENERATION_PROMPT_VERSION,
    propose(stories) {
      return new GoogleArtDirectionProvider({
        apiKey: environment.GOOGLE_AI_API_KEY ?? "",
        model,
      }).propose(stories);
    },
  };
}

function lazyPanoramaGenerator(environment: NodeJS.ProcessEnv): PanoramaGenerator {
  return {
    generate(prompt) {
      return new NanoBananaGenerator({
        apiKey: environment.GOOGLE_AI_API_KEY ?? "",
        model: environment.NANO_BANANA_MODEL?.trim() ?? "",
      }).generate(prompt);
    },
  };
}

function lazyLandmarkDetector(environment: NodeJS.ProcessEnv): LandmarkDetector {
  const model = environment.LANDMARK_VISION_MODEL?.trim() ?? "";
  return {
    id: "google-genai",
    model,
    detect(input) {
      return new GoogleLandmarkDetector({
        apiKey: environment.GOOGLE_AI_API_KEY ?? "",
        model,
      }).detect(input);
    },
  };
}

function lazyWorldGenerator(): WorldGenerator {
  let generator: ReturnType<typeof worldLabsGeneratorFromEnvironment> | undefined;
  const get = () => generator ??= worldLabsGeneratorFromEnvironment();
  return {
    provider: "world-labs",
    adapterVersion: "marble-v1-adapter-v1",
    submit(...arguments_) {
      return get().submit(...arguments_);
    },
    getOperation(...arguments_) {
      return get().getOperation(...arguments_);
    },
    downloadAsset(...arguments_) {
      return get().downloadAsset(...arguments_);
    },
  };
}

export function createLiveEditionProviders({
  browserUrl,
  environment = process.env,
  frontendDirectory,
  frontendUrl,
  sourceConfiguration,
  window,
}: {
  browserUrl: string;
  environment?: NodeJS.ProcessEnv;
  frontendDirectory: string;
  frontendUrl: string;
  sourceConfiguration: SourceConfiguration;
  window: { start: Date; end: Date };
}): EditionProviders {
  const analysisSources = sourceConfiguration.sources.filter(
    ({ articleAccess }) => articleAccess === "ephemeral-analysis",
  );
  if (analysisSources.length === 0) {
    throw new Error("Live edition workflow requires at least one ephemeral-analysis source");
  }
  const sourcesById = new Map(analysisSources.map((source) => [source.id, source]));

  return {
    async collect() {
      const adapters = analysisSources.map((source) => new FeedSourceAdapter({
        id: source.id,
        feedUrl: source.feedUrl,
        kind: source.kind,
        publisher: source.publisher,
      }, new AllowlistedHttpFetcher({
        allowedHosts: [new URL(source.feedUrl).hostname, ...source.allowedArticleHosts],
      })));
      return collectCandidateSet({ adapters, window });
    },
    candidateEvaluator: lazyCandidateEvaluator(environment),
    articleAnalyzer: lazyArticleAnalyzer(environment),
    articleFetcher(story) {
      const source = sourcesById.get(story.source.adapterId);
      if (!source) {
        throw new Error(`Story source is not approved for ephemeral analysis: ${story.source.adapterId}`);
      }
      return new AllowlistedHttpFetcher({ allowedHosts: source.allowedArticleHosts });
    },
    artDirectionProvider: lazyArtDirectionProvider(environment),
    interactionBaker: new BrowserInteractionBaker({
      browserUrl,
      frontendDirectory,
      pageUrl: frontendUrl,
    }),
    landmarkDetector: lazyLandmarkDetector(environment),
    localPublishDirectory: resolve(frontendDirectory, "public", "generated"),
    panorama: {
      generator: lazyPanoramaGenerator(environment),
      model: environment.NANO_BANANA_MODEL?.trim() || "gemini-nano-banana-2.1",
      provider: "google",
    },
    world: {
      generator: lazyWorldGenerator(),
      maxPolls: 120,
      model: environment.WORLD_LABS_MODEL?.trim() || "marble-1.1",
      pollIntervalMs: 10_000,
    },
  };
}

