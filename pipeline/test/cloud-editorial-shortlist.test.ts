import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { createEditorialShortlistHandler } from "../src/cloud/editorial-shortlist-handler.js";
import type { CandidateEvaluator } from "../src/editorial/evaluate.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema } from "../src/editorial/schema.js";
import { candidateSetSchema } from "../src/sources/schema.js";
import { parseSourceConfiguration } from "../src/sources/config.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";

test("editorial cloud stage evaluates once, stores a shortlist, and resumes without another model call", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-editorial-cloud-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const candidates = candidateSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
    )));
    const fixtureEvaluations = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8",
    )));
    const editionId = fixtureEvaluations.editionId;
    await artifacts.putImmutable({
      key: `editions/${editionId}/sources/candidate-set.json`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(candidates)),
    });
    let requests = 0;
    const evaluator: CandidateEvaluator = {
      model: "fixture-evaluator",
      provider: "fixture",
      promptVersion: "editorial-evaluation-v1",
      async evaluate() {
        requests += 1;
        return {
          assessments: fixtureEvaluations.evaluations.map(({ scores, ...rest }) => {
            const { recency: _recency, ...modelScores } = scores;
            return { ...rest, scores: modelScores };
          }),
        };
      },
    };
    const handler = createEditorialShortlistHandler({
      artifacts,
      evaluator,
      now: () => new Date("2026-10-13T14:31:00.000Z"),
    });
    const first = await handler({ editionId });
    const resumed = await handler({ editionId });
    assert.deepEqual(resumed, first);
    assert.equal(requests, 1);
    assert.equal(first.candidateCount, 1);
    assert.equal(first.selectedCount, 1);
    const shortlistBytes = await artifacts.read(first.shortlistKey);
    assert.ok(shortlistBytes);
    const shortlist = editorialShortlistSchema.parse(JSON.parse(Buffer.from(shortlistBytes).toString("utf8")));
    assert.equal(shortlist.selected[0].storyId, candidates.candidates[0].id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("editorial cloud stage fails before calling a model when candidates are missing", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-editorial-missing-"));
  try {
    let requests = 0;
    const handler = createEditorialShortlistHandler({
      artifacts: new LocalArtifactStore(directory),
      evaluator: {
        model: "fixture-evaluator",
        provider: "fixture",
        promptVersion: "editorial-evaluation-v1",
        async evaluate() {
          requests += 1;
          return { assessments: [] };
        },
      },
    });
    await assert.rejects(handler({ editionId: "missing-edition" }), /Candidate set is missing/);
    assert.equal(requests, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("editorial cloud stage records source policy and excludes discovery-only stories", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-editorial-policy-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const candidates = candidateSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
    )));
    const fixtureEvaluations = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8",
    )));
    const editionId = fixtureEvaluations.editionId;
    await artifacts.putImmutable({
      key: `editions/${editionId}/sources/candidate-set.json`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(candidates)),
    });
    const handler = createEditorialShortlistHandler({
      artifacts,
      evaluator: {
        model: "fixture-evaluator",
        provider: "fixture",
        promptVersion: "editorial-evaluation-v1",
        async evaluate() {
          return { assessments: fixtureEvaluations.evaluations.map(({ scores, ...rest }) => {
            const { recency: _recency, ...modelScores } = scores;
            return { ...rest, scores: modelScores };
          }) };
        },
      },
      sourceConfiguration: parseSourceConfiguration({
        schemaVersion: "1.0.0",
        artifactType: "source-configuration",
        sources: [{
          id: candidates.candidates[0].source.adapterId,
          type: "rss",
          publisher: candidates.candidates[0].publisher,
          feedUrl: candidates.candidates[0].source.feedUrl,
          kind: "primary",
          articleAccess: "discovery-only",
        }],
      }),
    });
    const result = await handler({ editionId });
    const shortlistBytes = await artifacts.read(result.shortlistKey);
    assert.ok(shortlistBytes);
    const shortlist = editorialShortlistSchema.parse(JSON.parse(Buffer.from(shortlistBytes).toString("utf8")));
    assert.equal(result.selectedCount, 0);
    assert.match(shortlist.sourceConfigurationSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(shortlist.excluded[0].reason, "source-not-approved-for-analysis");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
