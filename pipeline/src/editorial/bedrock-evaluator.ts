import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AMAZON_NOVA_TEXT_MODEL, assertAmazonNovaTextModel } from "../bedrock/model.js";
import { providerUsageSchema, type ProviderUsage } from "../provider-usage.js";
import type { DiscoveredStory } from "../sources/schema.js";
import { candidateEvaluationSchema } from "./schema.js";
import { ZodError } from "zod";
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
    "Reject routine campus, municipal, or administrative updates when the metadata does not show a substantive new development. Do not penalize a story merely because it concerns one country; judge what happened, not the publisher's location.",
    "Keep visual potential separate from editorial importance. Visual potential should favor concrete physical subjects that could remain legible in a human-free 3D environment.",
    "Every score must be a decimal number from 0 to 1 inclusive, where 0 is the lowest possible score and 1 is the highest. Never use a 0-to-10 or percentage scale.",
    "Use concise lowercase kebab-case values for eventKey, topic, and geography. Use the same eventKey for reports that appear to describe the same underlying event.",
    "Return only a JSON object with an assessments array. Return exactly one assessment for every supplied candidate id, using that id as storyId. Each assessment needs storyId, eventKey, classification (topic, geography, organization), eligibility (eligible, reasons), scores (credibility, constructiveSignificance, publicRelevance, novelty, visualPotential), and rationales for those five scores. Do not use Markdown fences.",
    `Candidates:\n${JSON.stringify(input)}`,
  ].join("\n\n");
}

export function candidateEvaluationResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      // Gemini's structured-output schema supports the structural JSON Schema
      // subset used here, but not array-length or numeric range constraints.
      // Keep those invariants in the local Zod and exact-coverage validators.
      assessments: { type: "array", items: {
        type: "object", additionalProperties: false,
        properties: {
          storyId: { type: "string" },
          eventKey: { type: "string" },
          classification: { type: "object", additionalProperties: false, properties: {
            topic: { type: "string" }, geography: { type: "string" }, organization: { type: "string" },
          }, required: ["topic", "geography", "organization"] },
          eligibility: { type: "object", additionalProperties: false, properties: {
            eligible: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } },
          }, required: ["eligible", "reasons"] },
          scores: { type: "object", additionalProperties: false, properties: {
            credibility: { type: "number" },
            constructiveSignificance: { type: "number" },
            publicRelevance: { type: "number" },
            novelty: { type: "number" },
            visualPotential: { type: "number" },
          }, required: ["credibility", "constructiveSignificance", "publicRelevance", "novelty", "visualPotential"] },
          rationales: { type: "object", additionalProperties: false, properties: {
            credibility: { type: "string" }, constructiveSignificance: { type: "string" },
            publicRelevance: { type: "string" }, novelty: { type: "string" }, visualPotential: { type: "string" },
          }, required: ["credibility", "constructiveSignificance", "publicRelevance", "novelty", "visualPotential"] },
        }, required: ["storyId", "eventKey", "classification", "eligibility", "scores", "rationales"],
      } },
    }, required: ["assessments"],
  };
}

function parseAssessmentBatch(value: unknown, candidates: DiscoveredStory[]): CandidateAssessment[] {
  const parsed = value as { assessments?: unknown[] };
  if (!Array.isArray(parsed?.assessments)) throw new Error("missing-assessments-array");
  const assessments = parsed.assessments.map(parseAssessment);
  const expectedIds = new Set(candidates.map(({ id }) => id));
  if (assessments.length !== candidates.length ||
      assessments.some(({ storyId }) => !expectedIds.delete(storyId)) || expectedIds.size) {
    throw new Error("candidate-coverage-mismatch");
  }
  return assessments;
}

function validationIssues(error: unknown): Array<{ path: string; code: string }> {
  if (error instanceof ZodError) return error.issues.slice(0, 8).map(({ path, code }) => ({ path: path.join("."), code }));
  return [{ path: "assessments", code: "invalid-json-or-coverage" }];
}

export function parseAssessment(value: unknown): CandidateAssessment {
  const input = value as Record<string, unknown>;
  const inputScores = input.scores as Record<string, unknown> | undefined;
  // Recency is derived from publication time after model evaluation. Ignore it
  // if a provider returns it anyway; never let model output override the value.
  const { recency: _recency, ...scores } = inputScores ?? {};
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
      let batchAssessments: CandidateAssessment[] | undefined;
      const attempts: (ProviderUsage | undefined)[] = [];
      let lastIssues: Array<{ path: string; code: string }> = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const correction = attempt === 1 ? "" : `\n\nYour previous response failed validation (${JSON.stringify(lastIssues)}). Correct the output and return the complete assessment array for every requested story. Do not omit or add stories.`;
        const response = await this.#client.send(new ConverseCommand({
          modelId: this.model,
          messages: [{ role: "user", content: [{ text: `${prompt}${correction}` }] }],
          inferenceConfig: { maxTokens: 6000, temperature: 0 },
        }));
        requestCount += 1;
        if (!response.usage) providerReported = false;
        attempts.push(response.usage ? providerUsageSchema.parse({ requestCount: 1, unit: "tokens", providerReported: true,
          inputUnits: response.usage.inputTokens, outputUnits: response.usage.outputTokens, totalUnits: response.usage.totalTokens }) : undefined);
        try {
          const content = response.output?.message?.content?.find((part) => typeof part.text === "string")?.text;
          if (!content) throw new Error("missing-json-text");
          batchAssessments = parseAssessmentBatch(JSON.parse(content), batch);
          inputUnits += attempts.reduce((sum, item) => sum + (item?.inputUnits ?? 0), 0);
          outputUnits += attempts.reduce((sum, item) => sum + (item?.outputUnits ?? 0), 0);
          totalUnits += attempts.reduce((sum, item) => sum + (item?.totalUnits ?? 0), 0);
          break;
        } catch (error) {
          const issues = validationIssues(error);
          if (attempt === 3) {
            throw new Error(`Candidate evaluator returned invalid structured assessments after 3 attempts for batch ${Math.floor(start / EVALUATION_BATCH_SIZE) + 1}`);
          }
          console.warn(JSON.stringify({ event: "candidate-evaluation-retry", batch: Math.floor(start / EVALUATION_BATCH_SIZE) + 1,
            attempt, issues, usage: response.usage }));
          lastIssues = issues;
        }
      }
      if (!batchAssessments) throw new Error("Candidate evaluator returned no assessments");
      assessments.push(...batchAssessments);
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
