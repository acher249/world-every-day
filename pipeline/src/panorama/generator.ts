import { GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import { DEFAULT_PANORAMA_CONFIG } from "./config.js";

export type GeneratedImage = {
  bytes: Buffer;
  mimeType: string;
  elapsedMs: number;
  usage: unknown;
  /** Opaque serialized provider conversation, retained for a later edit turn. */
  continuation?: Uint8Array;
};

export type ImageReference = { bytes: Buffer; mimeType: string };

export type GeneratorContinuation = Uint8Array;

export type PanoramaGenerator = {
  generate(
    prompt: string,
    reference?: ImageReference | ImageReference[],
    continuation?: GeneratorContinuation,
  ): Promise<GeneratedImage>;
};

function logContinuationMemory(stage: string): void {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  console.info(JSON.stringify({ event: "nano-banana-continuation-memory", stage, rss, heapUsed, external, arrayBuffers }));
}

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

  async generate(
    prompt: string,
    reference?: ImageReference | ImageReference[],
    continuation?: Uint8Array,
  ): Promise<GeneratedImage> {
    const startedAt = Date.now();
    const history = continuation ? parseConversation(continuation) : undefined;
    if (continuation) logContinuationMemory("history-parsed");
    const images = reference ? (Array.isArray(reference) ? reference : [reference]) : [];
    const inputContent: Content = {
      role: "user",
      parts: [
        { text: prompt },
        ...images.map((image) => ({ inlineData: { data: image.bytes.toString("base64"), mimeType: image.mimeType } })),
      ],
    };
    const requestHistory = [...(history ?? []), inputContent];
    if (continuation) logContinuationMemory("before-request");
    const response = await this.#client.models.generateContent({
      model: this.#model,
      contents: requestHistory,
      config: {
        responseModalities: ["IMAGE"],
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        imageConfig: {
          aspectRatio: DEFAULT_PANORAMA_CONFIG.generation.aspectRatio,
          imageSize: DEFAULT_PANORAMA_CONFIG.generation.imageSize,
        },
        httpOptions: { timeout: 540_000, retryOptions: { attempts: 1 } },
      },
    });
    if (continuation) logContinuationMemory("after-response");

    const modelContent = response.candidates?.[0]?.content;
    const imagePart = modelContent?.parts?.find(
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

    const conversationOutput = modelContent?.role !== undefined
      ? modelContent
      : { role: "model", parts: [] };
    const conversationHistory = [...requestHistory, conversationOutput];
    if (continuation) logContinuationMemory("before-save-history");
    const savedConversation = Buffer.from(JSON.stringify({ version: 1, history: conversationHistory }));
    if (continuation) logContinuationMemory("after-save-history");

    return {
      bytes: Buffer.from(encoded, "base64"),
      mimeType: imagePart.inlineData?.mimeType ?? "image/png",
      elapsedMs: Date.now() - startedAt,
      usage: response.usageMetadata ?? null,
      continuation: savedConversation,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConversation(bytes: Uint8Array): Content[] {
  let parsed: unknown;
  try {
    const view = Buffer.isBuffer(bytes)
      ? bytes
      : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    parsed = JSON.parse(view.toString("utf8"));
  } catch (error) {
    throw new Error("Saved Nano Banana conversation state is invalid JSON", { cause: error });
  }

  // Zod's normal parse clones the complete object graph. A continued image
  // conversation can contain hundreds of megabytes of image and thought-signature
  // strings, so validate its shape in place and hand the original graph to the SDK.
  if (!isRecord(parsed) || parsed.version !== 1 || Object.keys(parsed).some((key) => key !== "version" && key !== "history") ||
      !Array.isArray(parsed.history) || parsed.history.length === 0) {
    throw new Error("Saved Nano Banana conversation state has an invalid structure");
  }
  for (const message of parsed.history) {
    if (!isRecord(message) || (message.role !== "user" && message.role !== "model") ||
        !Array.isArray(message.parts) || message.parts.length === 0 ||
        message.parts.some((part) => !isRecord(part))) {
      throw new Error("Saved Nano Banana conversation state has an invalid structure");
    }
  }
  return parsed.history as Content[];
}
