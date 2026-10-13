import { GoogleGenAI } from "@google/genai";
import { providerUsageSchema } from "../provider-usage.js";
import type { DiscoveredStory } from "../sources/schema.js";
import { candidateEvaluationSchema } from "./schema.js";
import {
  EDITORIAL_EVALUATION_PROMPT_VERSION,
  type CandidateAssessment,
  type CandidateEvaluator,
} from "./evaluate.js";

export const MAX_EVALUATION_CANDIDATES = 100;
const MAX_PROMPT_CHARACTERS = 80_000;

const assessmentSchema = {
  type: "object",
  required: ["storyId", "eventKey", "classification", "eligibility", "scores", "rationales"],
  properties: {
    storyId: { type: "string" },
    eventKey: { type: "string" },
    classification: {
      type: "object",
      required: ["topic", "geography", "organization"],
      properties: {
        topic: { type: "string" },
        geography: { type: "string" },
        organization: { type: "string" },
      },
    },
    eligibility: {
      type: "object",
      required: ["eligible", "reasons"],
      properties: {
        eligible: { type: "boolean" },
        reasons: { type: "array", maxItems: 8, items: { type: "string" } },
      },
    },
    scores: {
      type: "object",
      required: ["credibility", "constructiveSignificance", "publicRelevance", "novelty", "visualPotential"],
      properties: {
        credibility: { type: "number", minimum: 0, maximum: 1 },
        constructiveSignificance: { type: "number", minimum: 0, maximum: 1 },
        publicRelevance: { type: "number", minimum: 0, maximum: 1 },
        novelty: { type: "number", minimum: 0, maximum: 1 },
        visualPotential: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    rationales: {
      type: "object",
      required: ["credibility", "constructiveSignificance", "publicRelevance", "novelty", "visualPotential"],
      properties: {
        credibility: { type: "string" },
        constructiveSignificance: { type: "string" },
        publicRelevance: { type: "string" },
        novelty: { type: "string" },
        visualPotential: { type: "string" },
      },
    },
  },
} as const;

const responseJsonSchema = {
  type: "object",
  required: ["assessments"],
  properties: {
    assessments: { type: "array", maxItems: MAX_EVALUATION_CANDIDATES, items: assessmentSchema },
  },
} as const;

export function buildCandidateEvaluationPrompt(candidates: DiscoveredStory[]): string {
  const input = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    publisher: candidate.publisher,
    publishedAt: candidate.publishedAt,
    sourceKind: candidate.source.kind,
  }));
  return [
    "Evaluate every candidate for a constructive, credible daily editorial shortlist.",
    "Use only the supplied discovery metadata. Do not claim to have read the article. Low-information, promotional, unsafe, weakly sourced, or ambiguous candidates should be marked ineligible or scored conservatively.",
    "Constructive significance means credible progress, possibility, discovery, repair, cooperation, or a meaningful attempt to address a real problem. It does not mean cheerful tone.",
    "Keep visual potential separate from editorial importance. Visual potential should favor concrete physical subjects that could remain legible in a human-free 3D environment.",
    "Use concise lowercase kebab-case values for eventKey, topic, and geography. Use the same eventKey for reports that appear to describe the same underlying event. Return exactly one assessment for every supplied id.",
    `Candidates:\n${JSON.stringify(input)}`,
  ].join("\n\n");
}

function parseAssessment(value: unknown): CandidateAssessment {
  const input = value as Record<string, unknown>;
  const scores = input.scores as Record<string, unknown> | undefined;
  const parsed = candidateEvaluationSchema.omit({ scores: true }).extend({
    scores: candidateEvaluationSchema.shape.scores.omit({ recency: true }),
  }).parse({ ...input, scores });
  return parsed;
}

export class GoogleCandidateEvaluator implements CandidateEvaluator {
  readonly provider = "google-genai";
  readonly promptVersion = EDITORIAL_EVALUATION_PROMPT_VERSION;
  readonly model: string;
  readonly #client: GoogleGenAI;

  constructor({ apiKey, model }: { apiKey: string; model: string }) {
    if (!apiKey.trim()) throw new Error("GOOGLE_AI_API_KEY is required");
    if (!model.trim()) throw new Error("EDITORIAL_MODEL is required");
    this.#client = new GoogleGenAI({ apiKey: apiKey.trim() });
    this.model = model.trim();
  }

  async evaluate(candidates: DiscoveredStory[]) {
    if (candidates.length === 0 || candidates.length > MAX_EVALUATION_CANDIDATES) {
      throw new Error(`Candidate evaluation requires between 1 and ${MAX_EVALUATION_CANDIDATES} stories`);
    }
    const prompt = buildCandidateEvaluationPrompt(candidates);
    if (prompt.length > MAX_PROMPT_CHARACTERS) {
      throw new Error(`Candidate evaluation prompt exceeds ${MAX_PROMPT_CHARACTERS} characters`);
    }
    const response = await this.#client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: { responseMimeType: "application/json", responseJsonSchema },
    });
    if (!response.text) throw new Error("Candidate evaluator returned no JSON response");
    const parsed = JSON.parse(response.text) as { assessments?: unknown[] };
    if (!Array.isArray(parsed.assessments)) {
      throw new Error("Candidate evaluator returned an invalid response");
    }
    const metadata = response.usageMetadata;
    const usage = providerUsageSchema.parse({
      requestCount: 1,
      unit: "tokens",
      inputUnits: metadata?.promptTokenCount,
      outputUnits: metadata?.candidatesTokenCount,
      totalUnits: metadata?.totalTokenCount,
      providerReported: metadata !== undefined,
    });
    return { assessments: parsed.assessments.map(parseAssessment), usage };
  }
}
