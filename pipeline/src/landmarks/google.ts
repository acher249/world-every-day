import { GoogleGenAI } from "@google/genai";
import { buildLandmarkDetectionPrompt } from "./prompt.js";
import type { LandmarkDetectionInput, LandmarkDetector } from "./provider.js";
import { parseLandmarkDetectionResponse } from "./schema.js";

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
      },
    });

    if (!response.text) throw new Error("Landmark provider returned no JSON response");
    return parseLandmarkDetectionResponse(JSON.parse(response.text));
  }
}
