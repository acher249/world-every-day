import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AMAZON_NOVA_TEXT_MODEL, assertAmazonNovaTextModel } from "../bedrock/model.js";
import { providerUsageSchema } from "../provider-usage.js";
import {
  ART_DIRECTION_GENERATION_PROMPT_VERSION,
  parseArtDirectionProposal,
  type ArtDirectionProvider,
  type ArtDirectionStoryInput,
} from "./generate.js";

type ConverseClient = Pick<BedrockRuntimeClient, "send">;

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
    "Name each subject in short, plain language that identifies the visible object, such as 'reservoir and dam' or 'robot tending plants'. This name is shown beside its hotspot to explain what visitors are seeing. Avoid invented technical names, poetic titles, and unexplained jargon; put richer visual description in materials and visualCues instead.",
    "artisticInterpretation is also the visitor-facing landmark echo. In one or two plain-language sentences, explain what the visible object is, what the real thing or process does according to the supplied story, and how this representation conveys that idea. Explain technical terms. Explicitly identify invented forms as sculptures or visual metaphors, never as objects reported in the article. Use only supplied facts; omit unsupported functions. Do not repeat the article title or merely say it represents the article.",
    "Return three to eight palette entries. For each subject return one to six materials, one to six visual cues, and no more than six nonnegative grounded-detail indexes. Keep artisticInterpretation under 300 characters and all other fields concise.",
    "Return exactly one subject for every storyId. Favor strong silhouettes, simple forms, readable materials, quiet cinematic light, and a human-free environment. Preserve low-detail ground or open space between neighboring subjects so they remain separable after world reconstruction.",
    "Return only a JSON object with world and subjects. World needs title, concept, setting, timeOfDay, atmosphere, palette, and navigation. Each subject needs storyId, subject, placement, scale, materials, visualCues, groundedDetailIndexes, and artisticInterpretation. Do not use Markdown fences.",
    `Stories:\n${JSON.stringify(stories)}`,
  ].join("\n\n");
}

export class BedrockArtDirectionProvider implements ArtDirectionProvider {
  readonly provider = "aws-bedrock";
  readonly promptVersion = ART_DIRECTION_GENERATION_PROMPT_VERSION;
  readonly model: string;
  readonly #client: ConverseClient;

  constructor({ client = new BedrockRuntimeClient({}), model = AMAZON_NOVA_TEXT_MODEL }: {
    client?: ConverseClient;
    model?: string;
  } = {}) {
    assertAmazonNovaTextModel(model);
    this.#client = client;
    this.model = model;
  }

  async propose(stories: ArtDirectionStoryInput[]) {
    if (stories.length === 0 || stories.length > 10) {
      throw new Error("Art direction requires between 1 and 10 stories");
    }
    const prompt = buildArtDirectionPrompt(stories);
    if (prompt.length > 50_000) throw new Error("Art-direction prompt exceeds 50000 characters");
    const response = await this.#client.send(new ConverseCommand({
      modelId: this.model,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 6500, temperature: 0.2 },
    }));
    const content = response.output?.message?.content?.find((part) => typeof part.text === "string")?.text;
    if (!content) throw new Error("Bedrock art-direction provider returned no text response");
    return {
      proposal: parseArtDirectionProposal(JSON.parse(content) as unknown),
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
