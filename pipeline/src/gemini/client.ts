import { GoogleGenAI } from "@google/genai";
import { providerUsageSchema } from "../provider-usage.js";
import type { JsonCompletionClient } from "../editorial/json-model.js";

export const DEFAULT_GEMINI_EDITORIAL_MODEL = "gemini-3.8-flash";

export class GeminiJsonClient implements JsonCompletionClient {
  readonly model: string;
  readonly #client: Pick<GoogleGenAI["models"], "generateContent">;

  constructor({ apiKey, model }: { apiKey: string; model: string }, options: {
    client?: Pick<GoogleGenAI["models"], "generateContent">;
  } = {}) {
    if (!apiKey.trim()) throw new Error("GOOGLE_AI_API_KEY is required for Gemini editorial analysis");
    if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error("GEMINI_EDITORIAL_MODEL must be a Gemini model ID");
    this.model = model;
    this.#client = options.client ?? new GoogleGenAI({ apiKey }).models;
  }

  async completeJson(prompt: string, maxTokens: number, temperature: number, responseSchema?: Record<string, unknown>) {
    let response;
    try {
      response = await this.#client.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          maxOutputTokens: maxTokens,
          temperature,
          responseMimeType: "application/json",
          ...(responseSchema ? { responseSchema } : {}),
          httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
        },
      });
    } catch (error) {
      const details = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number } } : {};
      const status = Number(details.status ?? details.$metadata?.httpStatusCode);
      const code = String(details.code ?? "");
      if (status === 429 || status >= 500 || ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
        const transient = new Error("Gemini editorial provider temporarily unavailable");
        transient.name = "EditorialProviderTransientError";
        throw transient;
      }
      throw error;
    }
    const text = response.text;
    if (!text) throw new Error("Gemini editorial model returned no JSON response");
    const reported = response.usageMetadata;
    return {
      text,
      usage: providerUsageSchema.parse({
        requestCount: 1,
        unit: "tokens",
        providerReported: reported !== undefined,
        inputUnits: reported?.promptTokenCount,
        outputUnits: reported?.candidatesTokenCount,
        totalUnits: reported?.totalTokenCount,
      }),
    };
  }
}
