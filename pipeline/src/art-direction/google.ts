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
        palette: { type: "array", items: { type: "string" } },
        navigation: { type: "string" },
      },
    },
    subjects: {
      type: "array",
      items: {
        type: "object",
        required: ["storyId", "subject", "placement", "scale", "materials", "visualCues", "groundedDetailIndexes", "artisticInterpretation"],
        properties: {
          storyId: { type: "string" },
          subject: { type: "string" },
          placement: { type: "string" },
          scale: { type: "string" },
          materials: { type: "array", items: { type: "string" } },
          visualCues: { type: "array", items: { type: "string" } },
          groundedDetailIndexes: { type: "array", items: { type: "integer" } },
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
    "Design the setting for a viewer standing near an open orientation zone who must turn through the full 360 degrees to discover every story. Give every landmark its own spatial address, silhouette, ground contact, and breathing room. Never place multiple story subjects on one shared platform, terrace, garden bed, or viewing direction.",
    "Choose one coherent circulation structure suited to the setting. It may be a loop, oval, meandering trail, branching boardwalk, terraced switchback, courtyard perimeter, shoreline, or another continuous navigable system. It should organize separate landmark bays around the viewer and preserve outward sightlines, but do not default every world to the same circular plaza or ring.",
    "The panorama stage assigns deterministic azimuth sectors later. Describe each placement as a terrain or circulation relationship only. Avoid flat-frame terms such as center, center-left, center-right, image edge, or framing the view. Navigation must support discovery in every direction rather than lead only toward one distant endpoint.",
    "Use recognizable objects, architecture, tools, ecosystems, animals, and scientific forms. Avoid people, faces, crowds, portraits, humanoid figures, text, labels, logos, flags, interfaces, and watermarks.",
    "Respect each assigned compositional role. Anchor subjects should be the largest spatial landmarks, supporting subjects should be clearly readable, and details should reward exploration. Roles express visual composition, not human importance.",
    "For each subject, groundedDetailIndexes may reference only indexes in that story's groundedDetails array. Use an empty array when no supplied detail applies. Explain invented connective forms or metaphors in artisticInterpretation and never present them as reported facts.",
    "Return three to eight palette entries. For each subject return one to six materials, one to six visual cues, and no more than six nonnegative grounded-detail indexes.",
    "Return exactly one subject for every storyId. Favor strong silhouettes, simple forms, readable materials, quiet cinematic light, and a human-free environment. Preserve low-detail ground or open space between neighboring subjects so they remain separable after world reconstruction.",
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
