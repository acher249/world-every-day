import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AMAZON_NOVA_TEXT_MODEL, assertAmazonNovaTextModel } from "../bedrock/model.js";
import { providerUsageSchema } from "../provider-usage.js";
import { MAX_ARTICLE_ANALYSIS_CHARACTERS, type ArticleAnalyzer } from "./article.js";
import { boundEphemeralEvidence, buildArticleAnalysisPrompt } from "./article-analysis-prompt.js";
import { analyzedArticleClaimSchema, analyzedVisualDetailSchema } from "./schema.js";

// Keep full article text on an Amazon-operated model, not a third-party model.
export const ARTICLE_ANALYSIS_MODEL = AMAZON_NOVA_TEXT_MODEL;

type ConverseClient = Pick<BedrockRuntimeClient, "send">;

export class BedrockArticleAnalyzer implements ArticleAnalyzer {
  readonly provider = "aws-bedrock";
  readonly model = ARTICLE_ANALYSIS_MODEL;
  readonly #client: ConverseClient;

  constructor({ client = new BedrockRuntimeClient({}), model = ARTICLE_ANALYSIS_MODEL }: {
    client?: ConverseClient;
    model?: string;
  } = {}) {
    assertAmazonNovaTextModel(model);
    this.#client = client;
  }

  async analyze({ articleText, story }: Parameters<ArticleAnalyzer["analyze"]>[0]) {
    if (articleText.length > MAX_ARTICLE_ANALYSIS_CHARACTERS) {
      throw new Error(`Article text exceeds the ${MAX_ARTICLE_ANALYSIS_CHARACTERS}-character editorial input limit`);
    }
    const response = await this.#client.send(new ConverseCommand({
      modelId: this.model,
      messages: [{ role: "user", content: [{ text: buildArticleAnalysisPrompt(story, articleText) }] }],
      inferenceConfig: { maxTokens: 2400, temperature: 0 },
    }));
    const content = response.output?.message?.content?.find((part) => typeof part.text === "string")?.text;
    if (!content) throw new Error("Bedrock article analyzer returned no text response");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!Array.isArray(parsed.claims) || !Array.isArray(parsed.details)) {
      throw new Error("Bedrock article analyzer returned an invalid response");
    }
    return {
      headline: String(parsed.headline ?? ""),
      summary: String(parsed.summary ?? ""),
      claims: parsed.claims.map((claim) => analyzedArticleClaimSchema.parse(boundEphemeralEvidence(claim))),
      details: parsed.details.map((detail) => analyzedVisualDetailSchema.parse(boundEphemeralEvidence(detail))),
      usage: providerUsageSchema.parse({
        requestCount: 1,
        unit: "tokens",
        inputUnits: response.usage?.inputTokens,
        outputUnits: response.usage?.outputTokens,
        totalUnits: response.usage?.totalTokens,
        providerReported: response.usage !== undefined,
      }),
    };
  }
}
