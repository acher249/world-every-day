import { readFile } from "node:fs/promises";
import type { ArtDirectionProvider } from "../art-direction/generate.js";
import { ART_DIRECTION_GENERATION_PROMPT_VERSION } from "../art-direction/generate.js";
import type { CandidateAssessment, CandidateEvaluator } from "../editorial/evaluate.js";
import type { ArticleAnalyzer } from "../sources/article.js";
import type { FetchedResource, ResourceFetcher } from "../sources/http.js";
import type { CandidateSet, DiscoveredStory } from "../sources/schema.js";
import type { WorkflowProviders } from "./run.js";

const FIXTURE_ARTICLE_URL = "https://news.example.test/research/farm-trial?view=full";

class FixtureFetcher implements ResourceFetcher {
  readonly #body: Buffer;

  constructor(body: Buffer) {
    this.#body = body;
  }

  async fetch(url: string): Promise<FetchedResource> {
    if (url !== FIXTURE_ARTICLE_URL) throw new Error(`No fixture article is available for ${url}`);
    return { body: this.#body, contentType: "text/html; charset=utf-8", url };
  }
}

class FixtureCandidateEvaluator implements CandidateEvaluator {
  readonly model = "fixture-v1";
  readonly provider = "fixture";
  readonly promptVersion = "editorial-evaluation-v1";

  async evaluate(candidates: DiscoveredStory[]): Promise<{ assessments: CandidateAssessment[] }> {
    return {
      assessments: candidates.map((story, index) => ({
        storyId: story.id,
        eventKey: `fixture-story-${index + 1}`,
        classification: {
          topic: "climate",
          geography: "north-america",
          organization: story.publisher,
        },
        eligibility: { eligible: true, reasons: [] },
        scores: {
          credibility: 0.9,
          constructiveSignificance: 0.85,
          publicRelevance: 0.75,
          novelty: 0.65,
          visualPotential: 0.8,
        },
        rationales: {
          credibility: "Synthetic primary-source fixture with clear attribution.",
          constructiveSignificance: "The fictional trial tests a practical response to water constraints.",
          publicRelevance: "Agricultural water efficiency can affect communities and food systems.",
          novelty: "The fictional result describes a new field-trial outcome.",
          visualPotential: "The farm, irrigation equipment, sensors, crops, and soil provide physical subjects.",
        },
      })),
    };
  }
}

class FixtureArticleAnalyzer implements ArticleAnalyzer {
  readonly model = "fixture-v1";
  readonly provider = "fixture";

  async analyze(): Promise<Awaited<ReturnType<ArticleAnalyzer["analyze"]>>> {
    return {
      headline: "Farm trial reduces irrigation water use",
      summary: "A fictional field trial tested a system intended to reduce agricultural water use.",
      claims: [{
        claim: "The fictional trial used blue soil-moisture sensors.",
        evidence: "Blue moisture sensors were placed beneath rows of young tomato plants in dark volcanic soil.",
      }],
      details: [
        {
          detail: "Blue soil-moisture sensors beneath young tomato plants",
          evidence: "Blue moisture sensors were placed beneath rows of young tomato plants in dark volcanic soil.",
          kind: "instrument",
          confidence: 0.96,
        },
        {
          detail: "A weathered red barn at the north edge of the farm",
          evidence: "The field team worked beside a weathered red barn at the north edge of the farm.",
          kind: "setting",
          confidence: 0.98,
        },
      ],
    };
  }
}

class FixtureArtDirectionProvider implements ArtDirectionProvider {
  readonly model = "fixture-v1";
  readonly provider = "fixture";
  readonly promptVersion = ART_DIRECTION_GENERATION_PROMPT_VERSION;

  async propose(stories: Parameters<ArtDirectionProvider["propose"]>[0]) {
    return {
      proposal: {
        world: {
          title: "A Field of Careful Change",
          concept: "A fictional agricultural development becomes one explorable landscape.",
          setting: "A terraced field surrounding a red barn and irrigation garden.",
          timeOfDay: "Clear early morning.",
          atmosphere: "Calm, curious, constructive, and quietly cinematic.",
          palette: ["barn red", "leaf green", "sensor blue"],
          navigation: "A single path loops through the field and around the central landmark.",
        },
        subjects: stories.map((story) => ({
          storyId: story.storyId,
          subject: "Blue soil sensors arranged beside a weathered red barn",
          placement: "in the open middle ground",
          scale: "a large readable anchor",
          materials: ["painted metal", "weathered timber"],
          visualCues: ["blue sensors", "red barn silhouette"],
          groundedDetailIndexes: story.groundedDetails.length > 0 ? [0] : [],
          artisticInterpretation: "The looping irrigation garden is an artistic connective device.",
        })),
      },
    };
  }
}

export async function createFixtureWorkflowProviders(): Promise<WorkflowProviders> {
  const candidateSet = JSON.parse(
    await readFile(new URL("../../fixtures/candidate-set.v1.json", import.meta.url), "utf8"),
  ) as CandidateSet;
  const articleBody = await readFile(new URL("../../fixtures/sources/example-article.html", import.meta.url));
  return {
    async collect() {
      return candidateSet;
    },
    candidateEvaluator: new FixtureCandidateEvaluator(),
    articleAnalyzer: new FixtureArticleAnalyzer(),
    articleFetcher: () => new FixtureFetcher(articleBody),
    artDirectionProvider: new FixtureArtDirectionProvider(),
  };
}
