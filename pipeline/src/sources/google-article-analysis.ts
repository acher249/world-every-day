import { GoogleGenAI } from "@google/genai";
import { providerUsageSchema } from "../provider-usage.js";
import { MAX_ARTICLE_ANALYSIS_CHARACTERS, type ArticleAnalyzer } from "./article.js";
import { analyzedArticleClaimSchema, analyzedVisualDetailSchema, type DiscoveredStory } from "./schema.js";

const responseJsonSchema = {
  type: "object",
  required: ["headline", "summary", "claims", "details"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["claim", "evidence"],
        properties: { claim: { type: "string" }, evidence: { type: "string" } },
      },
    },
    details: {
      type: "array",
      items: {
        type: "object",
        required: ["detail", "evidence", "kind", "confidence"],
        properties: {
          detail: { type: "string" },
          evidence: { type: "string" },
          kind: {
            type: "string",
            enum: ["object", "material", "color", "setting", "species", "instrument", "other"],
          },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

export function buildArticleAnalysisPrompt(story: DiscoveredStory, articleText: string): string {
  return [
    "Analyze this article for a cited daily world edition using only the supplied article text.",
    "Write a clear, factual headline that states the concrete development. Write a concise original summary without copying article prose.",
    "Extract two to four central factual claims. For every claim, copy one short exact evidence passage from the article. Do not invent, infer beyond the text, or reproduce long passages.",
    "Also extract up to four concrete visual details that could help an artist connect a physical world to the story. Prefer specific objects, materials, colors, settings, species, and instruments. For every detail, copy one short exact evidence passage.",
    "Every visual-detail confidence must be a decimal number from 0 to 1 inclusive.",
    "Visual details may be empty when none are useful. Never turn an abstract result into a reported physical object. Do not include people or faces as visual subjects.",
    `Discovery title: ${story.title}`,
    `Publisher: ${story.publisher}`,
    `Article text:\n${articleText}`,
  ].join("\n\n");
}

export class GoogleArticleAnalyzer implements ArticleAnalyzer {
  readonly provider = "google-genai";
  readonly model: string;
  readonly #client: GoogleGenAI;
  readonly #maxInputCharacters: number;

  constructor({
    apiKey,
    maxInputCharacters = MAX_ARTICLE_ANALYSIS_CHARACTERS,
    model,
  }: {
    apiKey: string;
    maxInputCharacters?: number;
    model: string;
  }) {
    if (!apiKey.trim()) throw new Error("GOOGLE_AI_API_KEY is required");
    if (!model.trim()) throw new Error("EDITORIAL_MODEL is required");
    if (!Number.isInteger(maxInputCharacters) || maxInputCharacters <= 0) {
      throw new Error("Editorial input limit must be a positive integer");
    }
    this.#client = new GoogleGenAI({ apiKey: apiKey.trim() });
    this.model = model.trim();
    this.#maxInputCharacters = maxInputCharacters;
  }

  async analyze({ articleText, story }: Parameters<ArticleAnalyzer["analyze"]>[0]) {
    if (articleText.length > this.#maxInputCharacters) {
      throw new Error(
        `Article text exceeds the ${this.#maxInputCharacters}-character editorial input limit`,
      );
    }
    const response = await this.#client.models.generateContent({
      model: this.model,
      contents: buildArticleAnalysisPrompt(story, articleText),
      config: { responseMimeType: "application/json", responseJsonSchema },
    });
    if (!response.text) throw new Error("Article analyzer returned no JSON response");
    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    if (!Array.isArray(parsed.claims) || !Array.isArray(parsed.details)) {
      throw new Error("Article analyzer returned an invalid response");
    }
    const metadata = response.usageMetadata;
    return {
      headline: String(parsed.headline ?? ""),
      summary: String(parsed.summary ?? ""),
      claims: parsed.claims.map((claim) => analyzedArticleClaimSchema.parse(claim)),
      details: parsed.details.map((detail) => analyzedVisualDetailSchema.parse(detail)),
      usage: providerUsageSchema.parse({
        requestCount: 1,
        unit: "tokens",
        inputUnits: metadata?.promptTokenCount,
        outputUnits: metadata?.candidatesTokenCount,
        totalUnits: metadata?.totalTokenCount,
        providerReported: metadata !== undefined,
      }),
    };
  }
}
