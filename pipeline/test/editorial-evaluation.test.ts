import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { evaluateCandidateSet, type CandidateEvaluator } from "../src/editorial/evaluate.js";
import { BedrockCandidateEvaluator, buildCandidateEvaluationPrompt } from "../src/editorial/bedrock-evaluator.js";
import { candidateSetSchema } from "../src/sources/schema.js";

function id(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidates() {
  return candidateSetSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "candidate-set",
    createdAt: "2026-10-13T14:30:00.000Z",
    window: { start: "2026-10-12T02:30:00.000Z", end: "2026-10-13T14:30:00.000Z" },
    sourceRuns: [],
    candidates: ["one", "two"].map((name, index) => ({
      id: id(name),
      canonicalUrl: `https://news.example.test/${name}`,
      title: `Concrete development ${name}`,
      publisher: `Publisher ${index + 1}`,
      publishedAt: index === 0 ? "2026-10-13T08:30:00.000Z" : "2026-10-12T02:30:00.000Z",
      discoveredAt: "2026-10-13T14:30:00.000Z",
      source: {
        adapterId: `source-${name}`,
        feedUrl: `https://news.example.test/${name}/feed.xml`,
        kind: index === 0 ? "primary" : "reporting",
      },
    })),
  });
}

function assessment(storyId: string) {
  return {
    storyId,
    eventKey: `event-${storyId.slice(0, 8)}`,
    classification: { topic: "science", geography: "global", organization: "Example" },
    eligibility: { eligible: true, reasons: [] },
    scores: {
      credibility: 0.9,
      constructiveSignificance: 0.8,
      publicRelevance: 0.7,
      novelty: 0.6,
      visualPotential: 0.5,
    },
    rationales: {
      credibility: "The supplied metadata identifies an attributable source.",
      constructiveSignificance: "The development addresses a real problem.",
      publicRelevance: "The reported outcome may affect a broad public.",
      novelty: "The metadata describes a recent result.",
      visualPotential: "The title offers a concrete physical subject.",
    },
  };
}

test("candidate evaluation preserves coverage and computes recency locally", async () => {
  const candidateSet = candidates();
  const evaluator: CandidateEvaluator = {
    provider: "fixture",
    model: "fixture-v1",
    promptVersion: "editorial-evaluation-v1",
    async evaluate(input) {
      return {
        assessments: [...input].reverse().map(({ id: storyId }) => assessment(storyId)),
        usage: { requestCount: 1, unit: "tokens", inputUnits: 100, providerReported: true },
      };
    },
  };
  const artifact = await evaluateCandidateSet({
    candidateSet,
    createdAt: new Date("2026-10-13T14:31:00.000Z"),
    editionId: "edition-2026-10-13",
    evaluator,
  });

  assert.deepEqual(artifact.evaluations.map(({ storyId }) => storyId), candidateSet.candidates.map(({ id }) => id));
  assert.ok(artifact.evaluations[0].scores.recency > artifact.evaluations[1].scores.recency);
  assert.equal(artifact.producer.usage?.requestCount, 1);
});

test("candidate evaluation rejects incomplete model output", async () => {
  const candidateSet = candidates();
  const evaluator: CandidateEvaluator = {
    provider: "fixture",
    model: "fixture-v1",
    promptVersion: "editorial-evaluation-v1",
    async evaluate(input) {
      return { assessments: [assessment(input[0].id)] };
    },
  };

  await assert.rejects(
    evaluateCandidateSet({ candidateSet, editionId: "edition-2026-10-13", evaluator }),
    /coverage mismatch/,
  );
});

test("candidate evaluation prompt separates constructive significance from visual potential", () => {
  const prompt = buildCandidateEvaluationPrompt(candidates().candidates);

  assert.match(prompt, /does not mean cheerful tone/i);
  assert.match(prompt, /what happened in this story, not the general importance/i);
  assert.match(prompt, /scheduled briefing.*not by itself a substantive new development/i);
  assert.match(prompt, /when uncertain, score conservatively/i);
  assert.match(prompt, /routine campus, municipal, or administrative updates/i);
  assert.match(prompt, /do not penalize a story merely because it concerns one country/i);
  assert.match(prompt, /separate from editorial importance/i);
  assert.match(prompt, /decimal number from 0 to 1 inclusive/i);
  assert.match(prompt, /exactly one assessment/i);
});

test("Bedrock candidate evaluation pins Amazon Nova, batches metadata, and records usage", async () => {
  assert.throws(() => new BedrockCandidateEvaluator({ model: "anthropic.claude-v1" }), /Amazon-operated/);
  const input = Array.from({ length: 11 }, (_, index) => ({
    ...candidates().candidates[0],
    id: id(`candidate-${index}`),
    title: `Development ${index}`,
  }));
  const batchSizes: number[] = [];
  const client = {
    async send(command: ConverseCommand) {
      assert.equal(command.input.modelId, "amazon.nova-lite-v1:0");
      const prompt = command.input.messages?.[0]?.content?.[0]?.text ?? "";
      const batch = JSON.parse(prompt.split("Candidates:\n")[1]) as Array<{ id: string }>;
      batchSizes.push(batch.length);
      return {
        output: { message: { content: [{ text: JSON.stringify({
          assessments: batch.map(({ id: storyId }) => assessment(storyId)),
        }) }] } },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    },
  } as unknown as BedrockRuntimeClient;
  const result = await new BedrockCandidateEvaluator({ client }).evaluate(input);
  assert.deepEqual(batchSizes, [10, 1]);
  assert.deepEqual(result.assessments.map(({ storyId }) => storyId), input.map(({ id }) => id));
  assert.equal(result.usage.requestCount, 2);
  assert.equal(result.usage.totalUnits, 300);
});
