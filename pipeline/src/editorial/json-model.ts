import { buildArtDirectionPrompt } from "../art-direction/bedrock.js";
import { ART_DIRECTION_GENERATION_PROMPT_VERSION, parseArtDirectionProposal, type ArtDirectionProvider } from "../art-direction/generate.js";
import { buildCandidateEvaluationPrompt, EVALUATION_BATCH_SIZE, MAX_EVALUATION_CANDIDATES, parseAssessment } from "./bedrock-evaluator.js";
import { EDITORIAL_EVALUATION_PROMPT_VERSION, type CandidateAssessment, type CandidateEvaluator } from "./evaluate.js";
import { providerUsageSchema, type ProviderUsage } from "../provider-usage.js";
import { ZodError } from "zod";
import { MAX_ARTICLE_ANALYSIS_CHARACTERS, type ArticleAnalyzer } from "../sources/article.js";
import { boundEphemeralEvidence, buildArticleAnalysisPrompt } from "../sources/article-analysis-prompt.js";
import { analyzedArticleClaimSchema, analyzedVisualDetailSchema, type DiscoveredStory } from "../sources/schema.js";

export type JsonCompletionClient = {
  model: string;
  completeJson(prompt: string, maxTokens: number, temperature: number): Promise<{
    text: string;
    usage?: ProviderUsage;
  }>;
};

function parseModelJson(text: string, stage: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${stage} returned invalid JSON`);
  }
}

function aggregateUsage(values: (ProviderUsage | undefined)[]): ProviderUsage {
  const reported = values.every((value) => value?.providerReported);
  return providerUsageSchema.parse({
    requestCount: values.length,
    unit: "tokens",
    providerReported: reported,
    inputUnits: reported ? values.reduce((sum, value) => sum + (value?.inputUnits ?? 0), 0) : undefined,
    outputUnits: reported ? values.reduce((sum, value) => sum + (value?.outputUnits ?? 0), 0) : undefined,
    totalUnits: reported ? values.reduce((sum, value) => sum + (value?.totalUnits ?? 0), 0) : undefined,
  });
}

export class JsonCandidateEvaluator implements CandidateEvaluator {
  readonly promptVersion = EDITORIAL_EVALUATION_PROMPT_VERSION;
  readonly model: string;
  constructor(readonly provider: string, private readonly client: JsonCompletionClient) {
    this.model = client.model;
  }

  async evaluate(candidates: DiscoveredStory[]) {
    if (candidates.length < 1 || candidates.length > MAX_EVALUATION_CANDIDATES) {
      throw new Error(`Candidate evaluation requires 1–${MAX_EVALUATION_CANDIDATES} stories`);
    }
    const assessments: CandidateAssessment[] = [];
    const usage: (ProviderUsage | undefined)[] = [];
    for (let start = 0; start < candidates.length; start += EVALUATION_BATCH_SIZE) {
      const batch = candidates.slice(start, start + EVALUATION_BATCH_SIZE);
      const prompt = buildCandidateEvaluationPrompt(batch);
      if (prompt.length > 80_000) throw new Error("Candidate evaluation prompt exceeds 80000 characters");
      let batchAssessments: CandidateAssessment[] | undefined;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await this.client.completeJson(prompt, 8000, 0);
        usage.push(response.usage);
        try {
          const parsed = parseModelJson(response.text, "Candidate evaluator") as { assessments?: unknown[] };
          if (!Array.isArray(parsed.assessments)) throw new Error("Candidate evaluator returned invalid JSON");
          const parsedAssessments = parsed.assessments.map(parseAssessment);
          const expectedIds = new Set(batch.map(({ id }) => id));
          if (parsedAssessments.length !== batch.length ||
              parsedAssessments.some(({ storyId }) => !expectedIds.delete(storyId)) || expectedIds.size) {
            throw new Error("Candidate evaluator did not cover its complete batch");
          }
          batchAssessments = parsedAssessments;
          break;
        } catch {
          if (attempt === 2) {
            throw new Error(`Candidate evaluator returned invalid structured assessments after 2 attempts for batch ${Math.floor(start / EVALUATION_BATCH_SIZE) + 1}; requests=${usage.length}`);
          }
          console.warn(JSON.stringify({
            event: "candidate-evaluation-retry",
            batch: Math.floor(start / EVALUATION_BATCH_SIZE) + 1,
            attempt,
            usage: response.usage,
          }));
        }
      }
      if (!batchAssessments) throw new Error("Candidate evaluator returned no assessments");
      assessments.push(...batchAssessments);
    }
    return { assessments, usage: aggregateUsage(usage) };
  }
}

export class JsonArticleAnalyzer implements ArticleAnalyzer {
  readonly model: string;
  constructor(readonly provider: string, private readonly client: JsonCompletionClient) {
    this.model = client.model;
  }

  async analyze({ articleText, story }: Parameters<ArticleAnalyzer["analyze"]>[0]) {
    if (articleText.length > MAX_ARTICLE_ANALYSIS_CHARACTERS) {
      throw new Error(`Article text exceeds ${MAX_ARTICLE_ANALYSIS_CHARACTERS} characters`);
    }
    const prompt = buildArticleAnalysisPrompt(story, articleText);
    const usage: (ProviderUsage | undefined)[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.client.completeJson(
        attempt === 1 ? prompt : [
          "Your previous response did not match the required JSON structure. Return exactly one JSON object with headline and summary strings, claims as an array of {claim, evidence}, and details as an array of {detail, evidence, kind, confidence}. Confidence must be a number from 0 to 1. Use empty arrays when necessary.",
          prompt,
        ].join("\n\n"),
        attempt === 1 ? 2400 : 3600,
        0,
      );
      usage.push(response.usage);
      try {
        const parsed = parseModelJson(response.text, "Article analyzer") as Record<string, unknown>;
        if (!Array.isArray(parsed.claims) || !Array.isArray(parsed.details)) {
          throw new Error("Missing claims or details array");
        }
        return {
          headline: String(parsed.headline ?? ""),
          summary: String(parsed.summary ?? ""),
          claims: parsed.claims.map((claim) => analyzedArticleClaimSchema.parse(boundEphemeralEvidence(claim))),
          details: parsed.details.map((detail) => analyzedVisualDetailSchema.parse(boundEphemeralEvidence(detail))),
          usage: attempt === 1 ? response.usage : aggregateUsage(usage),
        };
      } catch (error) {
        // Never log the model response or Zod messages: they may contain source text.
        const issues = error instanceof ZodError
          ? error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join("."), code: issue.code }))
          : [{ code: "invalid-json-or-shape" }];
        if (attempt === 2) {
          throw new Error("Article analyzer returned invalid structured evidence after 2 attempts");
        }
        console.warn(JSON.stringify({ event: "article-analysis-retry", attempt, issues, usage: response.usage }));
      }
    }
    throw new Error("Article analyzer returned no evidence");
  }
}

export class JsonArtDirectionProvider implements ArtDirectionProvider {
  readonly promptVersion = ART_DIRECTION_GENERATION_PROMPT_VERSION;
  readonly model: string;
  constructor(readonly provider: string, private readonly client: JsonCompletionClient) {
    this.model = client.model;
  }

  async propose(stories: Parameters<ArtDirectionProvider["propose"]>[0]) {
    if (stories.length < 1 || stories.length > 10) throw new Error("Art direction requires 1–10 stories");
    const prompt = buildArtDirectionPrompt(stories);
    if (prompt.length > 50_000) throw new Error("Art-direction prompt exceeds 50000 characters");
    const usage: (ProviderUsage | undefined)[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.client.completeJson(
        attempt === 1 ? prompt : [
          "Your previous response failed validation. Return the requested JSON structure with exactly one subject per storyId. Keep artisticInterpretation under 300 characters and every field concise.",
          prompt,
        ].join("\n\n"),
        6500,
        0.2,
      );
      usage.push(response.usage);
      try {
        const proposal = parseArtDirectionProposal(parseModelJson(response.text, "Art direction"));
        const remaining = new Set(stories.map(({ storyId }) => storyId));
        if (proposal.subjects.length !== remaining.size ||
            proposal.subjects.some(({ storyId }) => !remaining.delete(storyId)) || remaining.size) {
          throw new Error("Art direction did not cover every story exactly once");
        }
        return { proposal, usage: attempt === 1 ? response.usage : aggregateUsage(usage) };
      } catch (error) {
        const issues = error instanceof ZodError
          ? error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join("."), code: issue.code }))
          : [{ code: "invalid-json-or-coverage" }];
        if (attempt === 2) throw new Error("Art direction returned invalid structured proposal after 2 attempts");
        console.warn(JSON.stringify({ event: "art-direction-retry", attempt, issues, usage: response.usage }));
      }
    }
    throw new Error("Art direction returned no proposal");
  }
}
