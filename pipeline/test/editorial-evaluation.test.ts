import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { evaluateCandidateSet, type CandidateEvaluator } from "../src/editorial/evaluate.js";
import { buildCandidateEvaluationPrompt } from "../src/editorial/google-evaluator.js";
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
  assert.match(prompt, /separate from editorial importance/i);
  assert.match(prompt, /decimal number from 0 to 1 inclusive/i);
  assert.match(prompt, /exactly one assessment/i);
});
