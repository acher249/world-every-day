import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { candidateSetSchema } from "../src/sources/schema.js";
import { candidateEvaluationSetSchema, editorialSelectionConfigurationSchema } from "../src/editorial/schema.js";
import { candidateSetSha256, createEditorialShortlist, editorialScore } from "../src/editorial/select.js";

function id(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inputs() {
  const definitions = [
    ["one", "science", "north-america", "Publisher A", "event-one", 0.98, 0.2],
    ["two", "science", "europe", "Publisher B", "event-two", 0.96, 0.9],
    ["duplicate", "health", "europe", "Publisher C", "event-two", 0.95, 1],
    ["three", "climate", "africa", "Publisher C", "event-three", 0.94, 0.6],
    ["four", "culture", "asia", "Publisher D", "event-four", 0.93, 0.8],
    ["weak", "technology", "asia", "Publisher E", "event-five", 0.5, 1],
  ] as const;
  const candidates = candidateSetSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "candidate-set",
    createdAt: "2026-10-13T14:30:00.000Z",
    window: { start: "2026-10-12T14:30:00.000Z", end: "2026-10-13T14:30:00.000Z" },
    sourceRuns: [],
    candidates: definitions.map(([name, , , publisher]) => ({
      id: id(name),
      canonicalUrl: `https://news.example.test/${name}`,
      title: `Story ${name}`,
      publisher,
      publishedAt: "2026-10-13T10:00:00.000Z",
      discoveredAt: "2026-10-13T14:30:00.000Z",
      source: {
        adapterId: "example",
        feedUrl: "https://news.example.test/feed.xml",
        kind: "reporting",
      },
    })),
  });
  const evaluations = candidateEvaluationSetSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "candidate-evaluations",
    editionId: "edition-2026-10-13",
    createdAt: "2026-10-13T14:31:00.000Z",
    candidateSetSha256: candidateSetSha256(candidates),
    producer: { type: "fixture", promptVersion: "editorial-v1" },
    evaluations: definitions.map(([name, topic, geography, publisher, eventKey, significance, visual]) => ({
      storyId: id(name),
      eventKey,
      classification: { topic, geography, organization: publisher },
      eligibility: { eligible: true, reasons: [] },
      scores: {
        credibility: name === "weak" ? 0.5 : 0.9,
        constructiveSignificance: significance,
        publicRelevance: significance,
        novelty: significance,
        recency: 1,
        visualPotential: visual,
      },
      rationales: {
        credibility: "Synthetic source-quality rationale.",
        constructiveSignificance: "Synthetic constructive-significance rationale.",
        publicRelevance: "Synthetic public-relevance rationale.",
        novelty: "Synthetic novelty rationale.",
        visualPotential: "Synthetic visual-potential rationale.",
      },
    })),
  });
  return { candidates, evaluations };
}

test("editorial selection deduplicates events and rejects weak credibility", () => {
  const { candidates, evaluations } = inputs();
  const configuration = editorialSelectionConfigurationSchema.parse({
    targetStories: 4,
    minimumCredibility: 0.7,
    maxPerTopic: 2,
    maxPerPublisher: 2,
    maxPerGeography: 2,
    weights: {
      credibility: 0.3,
      constructiveSignificance: 0.3,
      publicRelevance: 0.2,
      novelty: 0.1,
      recency: 0.1,
    },
  });
  const shortlist = createEditorialShortlist({ candidateSet: candidates, configuration, evaluations });

  assert.equal(shortlist.selected.length, 4);
  assert.ok(shortlist.excluded.some(({ storyId, reason }) => storyId === id("duplicate") && reason === "duplicate-event"));
  assert.ok(shortlist.excluded.some(({ storyId, reason }) => storyId === id("weak") && reason === "credibility-below-threshold"));
});

test("visual potential remains separate from editorial importance", () => {
  const { evaluations } = inputs();
  const lowVisual = evaluations.evaluations.find(({ storyId }) => storyId === id("one"))!;
  const highVisual = evaluations.evaluations.find(({ storyId }) => storyId === id("four"))!;
  const configuration = editorialSelectionConfigurationSchema.parse({
    targetStories: 4,
    minimumCredibility: 0.7,
    maxPerTopic: 4,
    maxPerPublisher: 4,
    maxPerGeography: 4,
    weights: { credibility: 0.3, constructiveSignificance: 0.3, publicRelevance: 0.2, novelty: 0.1, recency: 0.1 },
  });

  assert.ok(lowVisual.scores.visualPotential < highVisual.scores.visualPotential);
  assert.ok(editorialScore(lowVisual, configuration) > editorialScore(highVisual, configuration));
});

test("selection publishes fewer stories rather than violating diversity caps", () => {
  const { candidates, evaluations } = inputs();
  const configuration = editorialSelectionConfigurationSchema.parse({
    targetStories: 6,
    minimumCredibility: 0.7,
    maxPerTopic: 1,
    maxPerPublisher: 1,
    maxPerGeography: 1,
    weights: { credibility: 0.3, constructiveSignificance: 0.3, publicRelevance: 0.2, novelty: 0.1, recency: 0.1 },
  });
  const shortlist = createEditorialShortlist({ candidateSet: candidates, configuration, evaluations });

  assert.ok(shortlist.selected.length < 6);
  assert.ok(shortlist.excluded.some(({ reason }) => ["topic-cap", "publisher-cap", "geography-cap"].includes(reason)));
});

