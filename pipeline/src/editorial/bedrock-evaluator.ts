import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AMAZON_NOVA_TEXT_MODEL, assertAmazonNovaTextModel } from "../bedrock/model.js";
import { providerUsageSchema } from "../provider-usage.js";
import type { DiscoveredStory } from "../sources/schema.js";
import { candidateEvaluationSchema } from "./schema.js";
import {
  EDITORIAL_EVALUATION_PROMPT_VERSION,
  type CandidateAssessment,
  type CandidateEvaluator,
} from "./evaluate.js";

export const MAX_EVALUATION_CANDIDATES = 100;
export const EVALUATION_BATCH_SIZE = 10;
const MAX_PROMPT_CHARACTERS = 80_000;

type ConverseClient = Pick<BedrockRuntimeClient, "send">;

export function buildCandidateEvaluationPrompt(candidates: DiscoveredStory[]): string {
  const input = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    publisher: candidate.publisher,
    publishedAt: candidate.publishedAt,
    sourceKind: candidate.source.kind,
  }));
  return [
    "Evaluate every candidate for a constructive, credible daily editorial shortlist.",
    "Use only the supplied discovery metadata. Do not claim to have read the article. Low-information, promotional, unsafe, weakly sourced, or ambiguous candidates should be marked ineligible or scored conservatively.",
    "Constructive significance means credible progress, possibility, discovery, repair, cooperation, or a meaningful attempt to address a real problem. It does not mean cheerful tone.",
    "Prefer a specific, newly reported development: a result, discovery, deployment, implemented change, concrete action, or consequential decision. Judge what happened in this story, not the general importance of its subject or organization.",
    "A scheduled briefing, routine announcement, award roundup, generic explainer, opinion, or recap is not by itself a substantive new development. Mark it ineligible unless the metadata clearly identifies a concrete consequential change. Do not infer one from a promising topic or future plans; when uncertain, score conservatively.",
    "Keep visual potential separate from editorial importance. Visual potential should favor concrete physical subjects that could remain legible in a human-free 3D environment.",
    "Every score must be a decimal number from 0 to 1 inclusive, where 0 is the lowest possible score and 1 is the highest. Never use a 0-to-10 or percentage scale.",
    "Use concise lowercase kebab-case values for eventKey, topic, and geography. Use the same eventKey for reports that appear to describe the same underlying event.",
    "Return only a JSON object with an assessments array. Return exactly one assessment for every supplied candidate id, using that id as storyId. Each assessment needs storyId, eventKey, classification (topic, geography, organization), eligibility (eligible, reasons), scores (credibility, constructiveSignificance, publicRelevance, novelty, visualPotential), and rationales for those five scores. Do not use Markdown fences.",
    `Candidates:\n${JSON.stringify(input)}`,
  ].join("\n\n");
}

function parseAssessment(value: unknown): CandidateAssessment {
  const input = value as Record<string, unknown>;
  const scores = input.scores as Record<string, unknown> | undefined;
  return candidateEvaluationSchema.omit({ scores: true }).extend({
    scores: candidateEvaluationSchema.shape.scores.omit({ recency: true }),
  }).parse({ ...input, scores });
}

export class BedrockCandidateEvaluator implements CandidateEvaluator {
  readonly provider = "aws-bedrock";
  readonly promptVersion = EDITORIAL_EVALUATION_PROMPT_VERSION;
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

  async evaluate(candidates: DiscoveredStory[]) {
    if (candidates.length === 0 || candidates.length > MAX_EVALUATION_CANDIDATES) {
      throw new Error(`Candidate evaluation requires between 1 and ${MAX_EVALUATION_CANDIDATES} stories`);
    }
    const assessments: CandidateAssessment[] = [];
    let inputUnits = 0;
    let outputUnits = 0;
    let totalUnits = 0;
    let providerReported = true;
    let requestCount = 0;

    for (let start = 0; start < candidates.length; start += EVALUATION_BATCH_SIZE) {
      const batch = candidates.slice(start, start + EVALUATION_BATCH_SIZE);
      const prompt = buildCandidateEvaluationPrompt(batch);
      if (prompt.length > MAX_PROMPT_CHARACTERS) {
        throw new Error(`Candidate evaluation prompt exceeds ${MAX_PROMPT_CHARACTERS} characters`);
      }
      const response = await this.#client.send(new ConverseCommand({
        modelId: this.model,
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 6000, temperature: 0 },
      }));
      requestCount += 1;
      const content = response.output?.message?.content?.find((part) => typeof part.text === "string")?.text;
      if (!content) throw new Error("Bedrock candidate evaluator returned no text response");
      const parsed = JSON.parse(content) as { assessments?: unknown[] };
      if (!Array.isArray(parsed.assessments)) {
        throw new Error("Bedrock candidate evaluator returned an invalid response");
      }
      const batchAssessments = parsed.assessments.map(parseAssessment);
      const expectedIds = new Set(batch.map(({ id }) => id));
      if (batchAssessments.length !== batch.length ||
          batchAssessments.some(({ storyId }) => !expectedIds.delete(storyId)) || expectedIds.size > 0) {
        throw new Error("Bedrock candidate evaluator did not cover its complete batch");
      }
      assessments.push(...batchAssessments);
      if (!response.usage) providerReported = false;
      inputUnits += response.usage?.inputTokens ?? 0;
      outputUnits += response.usage?.outputTokens ?? 0;
      totalUnits += response.usage?.totalTokens ?? 0;
    }

    return {
      assessments,
      usage: providerUsageSchema.parse({
        requestCount,
        unit: "tokens",
        inputUnits: providerReported ? inputUnits : undefined,
        outputUnits: providerReported ? outputUnits : undefined,
        totalUnits: providerReported ? totalUnits : undefined,
        providerReported,
      }),
    };
  }
}
