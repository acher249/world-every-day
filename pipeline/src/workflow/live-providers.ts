import { resolve } from "node:path";
import { ART_DIRECTION_GENERATION_PROMPT_VERSION, type ArtDirectionProvider } from "../art-direction/generate.js";
import { AMAZON_NOVA_TEXT_MODEL } from "../bedrock/model.js";
import { EDITORIAL_EVALUATION_PROMPT_VERSION, type CandidateEvaluator } from "../editorial/evaluate.js";
import {
  articleAnalyzer as selectedArticleAnalyzer,
  artDirectionProvider as selectedArtDirectionProvider,
  candidateEvaluator as selectedCandidateEvaluator,
  textProvider,
} from "../cloud/text-provider.js";
import { DEFAULT_GEMINI_EDITORIAL_MODEL } from "../gemini/client.js";
import { BrowserInteractionBaker } from "../interactions/browser.js";
import { GoogleLandmarkDetector } from "../landmarks/google.js";
import type { LandmarkDetector } from "../landmarks/provider.js";
import { NanoBananaGenerator, type PanoramaGenerator } from "../panorama/generator.js";
import type { ArticleAnalyzer } from "../sources/article.js";
import { assertConfiguredCandidates, type SourceConfiguration } from "../sources/config.js";
import { collectCandidateSet, FeedSourceAdapter } from "../sources/feed.js";
import { localRequestPacer } from "../sources/pacing.js";
import { AllowlistedHttpFetcher } from "../sources/http.js";
import type { WorldGenerator } from "../world/provider.js";
import { worldLabsGeneratorFromEnvironment } from "../world/world-labs.js";
import type { EditionProviders } from "./edition-run.js";

function textModel(environment: NodeJS.ProcessEnv, stage: "evaluation" | "article" | "art"): string {
  const provider = textProvider(environment);
  if (provider === "google-gemini") return environment.GEMINI_EDITORIAL_MODEL?.trim() || DEFAULT_GEMINI_EDITORIAL_MODEL;
  if (stage === "article") return environment.ARTICLE_ANALYSIS_MODEL?.trim() || AMAZON_NOVA_TEXT_MODEL;
  if (stage === "art") return environment.ART_DIRECTION_MODEL?.trim() || AMAZON_NOVA_TEXT_MODEL;
  return environment.EDITORIAL_MODEL?.trim() || AMAZON_NOVA_TEXT_MODEL;
}

function lazyCandidateEvaluator(environment: NodeJS.ProcessEnv, configuration: SourceConfiguration): CandidateEvaluator {
  return {
    provider: textProvider(environment),
    model: textModel(environment, "evaluation"),
    promptVersion: EDITORIAL_EVALUATION_PROMPT_VERSION,
    evaluate(candidates) {
      assertConfiguredCandidates(candidates, configuration);
      return selectedCandidateEvaluator(environment).evaluate(candidates);
    },
  };
}

function lazyArticleAnalyzer(environment: NodeJS.ProcessEnv): ArticleAnalyzer {
  return {
    provider: textProvider(environment),
    model: textModel(environment, "article"),
    analyze(input) {
      return selectedArticleAnalyzer(environment).analyze(input);
    },
  };
}

function lazyArtDirectionProvider(environment: NodeJS.ProcessEnv): ArtDirectionProvider {
  return {
    provider: textProvider(environment),
    model: textModel(environment, "art"),
    promptVersion: ART_DIRECTION_GENERATION_PROMPT_VERSION,
    propose(stories) {
      return selectedArtDirectionProvider(environment).propose(stories);
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
        allowedArticleHosts: source.allowedArticleHosts,
        upgradeHttpArticleLinksToHttps: source.upgradeHttpArticleLinksToHttps,
      }, new AllowlistedHttpFetcher({
        allowedHosts: [new URL(source.feedUrl).hostname, ...source.allowedArticleHosts],
        pacer: localRequestPacer(source.crawlDelayMs),
      })));
      return collectCandidateSet({ adapters, window });
    },
    candidateEvaluator: lazyCandidateEvaluator(environment, sourceConfiguration),
    articleAnalyzer: lazyArticleAnalyzer(environment),
    articleFetcher(story) {
      const source = sourcesById.get(story.source.adapterId);
      if (!source) {
        throw new Error(`Story source is not approved for ephemeral analysis: ${story.source.adapterId}`);
      }
      return new AllowlistedHttpFetcher({
        allowedHosts: source.allowedArticleHosts,
        pacer: localRequestPacer(source.crawlDelayMs),
      });
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

