import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createSelectedEdition, selectedEditionSchema } from "../src/editorial/edition.js";
import { candidateEvaluationSetSchema } from "../src/editorial/schema.js";
import { createEditorialShortlist } from "../src/editorial/select.js";
import { articleEvidenceSchema, candidateSetSchema } from "../src/sources/schema.js";

async function jsonFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8")) as unknown;
}

test("the example selected edition validates", async () => {
  const edition = selectedEditionSchema.parse(await jsonFixture("selected-edition.example.v1.json"));

  assert.equal(edition.stories.length, 1);
  assert.equal(edition.stories[0].visualDetails.length, 2);
});

test("final edition carries citations, claims, and granular visual details", async () => {
  const candidateSet = candidateSetSchema.parse(await jsonFixture("candidate-set.v1.json"));
  const evaluations = candidateEvaluationSetSchema.parse(await jsonFixture("candidate-evaluations.v1.json"));
  const shortlist = createEditorialShortlist({
    candidateSet,
    createdAt: new Date("2026-10-13T14:32:00.000Z"),
    evaluations,
  });
  const candidate = candidateSet.candidates[0];
  const evidence = articleEvidenceSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "article-evidence",
    storyId: candidate.id,
    createdAt: "2026-10-13T14:35:00.000Z",
    source: {
      canonicalUrl: candidate.canonicalUrl,
      publisher: candidate.publisher,
      publishedAt: candidate.publishedAt,
      fetchedAt: "2026-10-13T14:34:00.000Z",
      retrievedUrl: candidate.canonicalUrl,
      extractedTextSha256: "a".repeat(64),
      extractedCharacterCount: 500,
    },
    extraction: { provider: "fixture", model: "fixture-v1", status: "analyzed" },
    editorial: {
      headline: "Farm trial reduces irrigation water use",
      summary: "A field trial tested a system intended to reduce agricultural water use.",
      claims: [{
        claim: "The trial used blue soil-moisture sensors.",
      }],
    },
    details: [{
      detail: "Blue moisture sensors beneath young tomato plants",
      kind: "instrument",
      confidence: 0.96,
    }],
  });

  const edition = createSelectedEdition({
    articleEvidence: [evidence],
    candidateSet,
    createdAt: new Date("2026-10-13T14:36:00.000Z"),
    evaluations,
    shortlist,
    targetStories: 1,
  });

  assert.equal(edition.stories.length, 1);
  assert.equal(edition.stories[0].sources[0].url, candidate.canonicalUrl);
  assert.equal(edition.stories[0].claims.length, 1);
  assert.equal(edition.stories[0].visualDetails[0].kind, "instrument");
});

test("final edition excludes shortlisted stories without article evidence", async () => {
  const candidateSet = candidateSetSchema.parse(await jsonFixture("candidate-set.v1.json"));
  const evaluations = candidateEvaluationSetSchema.parse(await jsonFixture("candidate-evaluations.v1.json"));
  const shortlist = createEditorialShortlist({ candidateSet, evaluations });
  const edition = createSelectedEdition({
    articleEvidence: [],
    candidateSet,
    evaluations,
    shortlist,
    targetStories: 1,
  });

  assert.equal(edition.stories.length, 0);
  assert.deepEqual(edition.excluded, [{
    storyId: candidateSet.candidates[0].id,
    reason: "missing-article-evidence",
  }]);
});
