import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { DEFAULT_PANORAMA_CONFIG } from "./config.js";

export type GeneratedImage = {
  bytes: Buffer;
  mimeType: string;
  elapsedMs: number;
  usage: unknown;
};

export type PanoramaGenerator = {
  generate(prompt: string): Promise<GeneratedImage>;
};

type NanoBananaGeneratorOptions = {
  apiKey: string;
  model: string;
};

export class NanoBananaGenerator implements PanoramaGenerator {
  readonly #client: GoogleGenAI;
  readonly #model: string;

  constructor({ apiKey, model }: NanoBananaGeneratorOptions) {
    if (!apiKey.trim()) throw new Error("GOOGLE_AI_API_KEY is required");
    if (!model.trim()) throw new Error("NANO_BANANA_MODEL is required");
    this.#client = new GoogleGenAI({ apiKey });
    this.#model = model;
  }

  async generate(prompt: string): Promise<GeneratedImage> {
    const startedAt = Date.now();
    const response = await this.#client.models.generateContent({
      model: this.#model,
      contents: prompt,
      config: {
        responseModalities: ["IMAGE"],
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
        imageConfig: {
          aspectRatio: DEFAULT_PANORAMA_CONFIG.generation.aspectRatio,
          imageSize: DEFAULT_PANORAMA_CONFIG.generation.imageSize,
        },
      },
    });

    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data,
    );
    const encoded = imagePart?.inlineData?.data;
    if (!encoded) {
      const providerMessage = response.candidates?.[0]?.content?.parts
        ?.flatMap((part) => (part.text ? [part.text] : []))
        .join(" ");
      throw new Error(
        `Image provider returned no image${providerMessage ? `: ${providerMessage}` : ""}`,
      );
    }

    return {
      bytes: Buffer.from(encoded, "base64"),
      mimeType: imagePart.inlineData?.mimeType ?? "image/png",
      elapsedMs: Date.now() - startedAt,
      usage: response.usageMetadata ?? null,
    };
  }
}
