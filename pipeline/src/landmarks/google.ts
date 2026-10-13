import { GoogleGenAI } from "@google/genai";
import { buildLandmarkDetectionPrompt } from "./prompt.js";
import type { LandmarkDetectionInput, LandmarkDetector } from "./provider.js";
import { parseLandmarkDetectionResponse } from "./schema.js";

const responseJsonSchema = {
  type: "object",
  required: ["landmarks"],
  properties: {
    landmarks: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        required: ["storyId", "label", "boundingBox", "target", "confidence", "visibility"],
        properties: {
          storyId: { type: "string" },
          label: { type: "string" },
          boundingBox: {
            type: "object",
            required: ["xMin", "yMin", "xMax", "yMax"],
            properties: {
              xMin: { type: "number", minimum: 0, maximum: 1 },
              yMin: { type: "number", minimum: 0, maximum: 1 },
              xMax: { type: "number", minimum: 0, maximum: 1 },
              yMax: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          target: {
            type: "object",
            required: ["x", "y"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["clear", "partial", "uncertain", "not-found"] },
        },
      },
    },
  },
} as const;

export class GoogleLandmarkDetector implements LandmarkDetector {
  readonly id = "google-genai";
  readonly model: string;
  readonly #client: GoogleGenAI;

  constructor({ apiKey, model }: { apiKey: string; model: string }) {
    if (!apiKey.trim()) throw new Error("GOOGLE_AI_API_KEY is required");
    if (!model.trim()) throw new Error("LANDMARK_VISION_MODEL is required");
    this.#client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async detect(input: LandmarkDetectionInput) {
    const response = await this.#client.models.generateContent({
      model: this.model,
      contents: [{
        role: "user",
        parts: [
          { text: buildLandmarkDetectionPrompt(input.artDirection) },
          { inlineData: { mimeType: input.mimeType, data: input.imageBytes.toString("base64") } },
        ],
      }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    });

    if (!response.text) throw new Error("Landmark provider returned no JSON response");
    return parseLandmarkDetectionResponse(JSON.parse(response.text));
  }
}
