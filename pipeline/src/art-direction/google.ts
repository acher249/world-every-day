import { GoogleGenAI } from "@google/genai";
import { providerUsageSchema } from "../provider-usage.js";
import {
  ART_DIRECTION_GENERATION_PROMPT_VERSION,
  parseArtDirectionProposal,
  type ArtDirectionProvider,
  type ArtDirectionStoryInput,
} from "./generate.js";

const responseJsonSchema = {
  type: "object",
  required: ["world", "subjects"],
  properties: {
    world: {
      type: "object",
      required: ["title", "concept", "setting", "timeOfDay", "atmosphere", "palette", "navigation"],
      properties: {
        title: { type: "string" },
        concept: { type: "string" },
        setting: { type: "string" },
        timeOfDay: { type: "string" },
        atmosphere: { type: "string" },
        palette: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
        navigation: { type: "string" },
      },
    },
    subjects: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        required: ["storyId", "subject", "placement", "scale", "materials", "visualCues", "groundedDetailIndexes", "artisticInterpretation"],
        properties: {
          storyId: { type: "string" },
          subject: { type: "string" },
          placement: { type: "string" },
          scale: { type: "string" },
          materials: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
          visualCues: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
          groundedDetailIndexes: { type: "array", maxItems: 6, items: { type: "integer", minimum: 0 } },
          artisticInterpretation: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildArtDirectionPrompt(stories: ArtDirectionStoryInput[]): string {
  return [
    "Design one coherent, playful, diagrammatic physical world from these stories. The output remains an image composition, but every subject should be spatially legible and suitable for reconstruction as a navigable 3D environment.",
    "Create one continuous setting with foreground, middle ground, background, paths, open sightlines, and distinct landmarks. Do not make a collage, infographic, blueprint, news layout, or set of isolated panels.",
    "Use recognizable objects, architecture, tools, ecosystems, animals, and scientific forms. Avoid people, faces, crowds, portraits, humanoid figures, text, labels, logos, flags, interfaces, and watermarks.",
    "Respect each assigned compositional role. Anchor subjects should be the largest spatial landmarks, supporting subjects should be clearly readable, and details should reward exploration. Roles express visual composition, not human importance.",
    "For each subject, groundedDetailIndexes may reference only indexes in that story's groundedDetails array. Use an empty array when no supplied detail applies. Explain invented connective forms or metaphors in artisticInterpretation and never present them as reported facts.",
    "Return exactly one subject for every storyId. Favor strong silhouettes, simple forms, readable materials, quiet cinematic light, and a human-free environment.",
    `Stories:\n${JSON.stringify(stories)}`,
  ].join("\n\n");
}

export class GoogleArtDirectionProvider implements ArtDirectionProvider {
  readonly provider = "google-genai";
  readonly promptVersion = ART_DIRECTION_GENERATION_PROMPT_VERSION;
  readonly model: string;
  readonly #client: GoogleGenAI;

  constructor({ apiKey, model }: { apiKey: string; model: string }) {
    if (!apiKey.trim()) throw new Error("GOOGLE_AI_API_KEY is required");
    if (!model.trim()) throw new Error("ART_DIRECTION_MODEL is required");
    this.#client = new GoogleGenAI({ apiKey: apiKey.trim() });
    this.model = model.trim();
  }

  async propose(stories: ArtDirectionStoryInput[]) {
    if (stories.length === 0 || stories.length > 10) {
      throw new Error("Art direction requires between 1 and 10 stories");
    }
    const response = await this.#client.models.generateContent({
      model: this.model,
      contents: buildArtDirectionPrompt(stories),
      config: { responseMimeType: "application/json", responseJsonSchema },
    });
    if (!response.text) throw new Error("Art-direction provider returned no JSON response");
    const metadata = response.usageMetadata;
    return {
      proposal: parseArtDirectionProposal(JSON.parse(response.text) as unknown),
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
