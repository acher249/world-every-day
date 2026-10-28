import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { createEditorialShortlistHandler } from "../src/cloud/editorial-shortlist-handler.js";
import type { CandidateEvaluator } from "../src/editorial/evaluate.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema } from "../src/editorial/schema.js";
import { candidateSetSchema } from "../src/sources/schema.js";
import { parseSourceConfiguration } from "../src/sources/config.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { parseAssessment } from "../src/editorial/bedrock-evaluator.js";

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

test("library-backed evaluation keeps model assessments separate from derived recency", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-editorial-library-snapshot-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const fixture = candidateSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
    )));
    const fixtureEvaluations = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8",
    )));
    const editionId = "editorial-library-snapshot-test";
    const snapshot = { version: 1 as const, entries: [], usedUrls: [], usedEventKeys: [] };
    const candidates = candidateSetSchema.parse({ ...fixture, librarySnapshotSha256: artifactSha256(snapshot) });
    await artifacts.putImmutable({
      key: `editions/${editionId}/sources/candidate-set.json`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(candidates)),
    });
    await artifacts.putImmutable({
      key: `editions/${editionId}/sources/library-snapshot.json`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(snapshot)),
    });
    const assessment = fixtureEvaluations.evaluations[0]!;
    const handler = createEditorialShortlistHandler({
      artifacts,
      evaluator: {
        model: "fixture-evaluator", provider: "fixture", promptVersion: "library-snapshot-test-v1",
        async evaluate() {
          const { recency: _recency, ...scores } = assessment.scores;
          const { scores: _scores, ...rest } = assessment;
          return { assessments: [{ ...rest, scores }] };
        },
      },
    });
    const result = await handler({ editionId });
    assert.equal(result.candidateCount, 1);
    const evaluationBytes = await artifacts.read(`editions/${editionId}/editorial/candidate-evaluations.json`);
    assert.ok(evaluationBytes);
    const evaluation = candidateEvaluationSetSchema.parse(JSON.parse(Buffer.from(evaluationBytes).toString("utf8"))).evaluations[0]!;
    assert.ok(evaluation.scores.recency > 0 && evaluation.scores.recency < 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("editorial cloud stage resumes from immutable validated batch checkpoints", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-editorial-checkpoint-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const fixture = candidateSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
    )));
    const fixtureEvaluations = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8",
    )));
    const base = fixture.candidates[0]!;
    const candidates = candidateSetSchema.parse({
      ...fixture,
      candidates: Array.from({ length: 11 }, (_, index) => ({
        ...base,
        id: index.toString(16).padStart(64, "0"),
        title: `Candidate ${index}`,
        canonicalUrl: `https://example.org/story-${index}`,
      })),
    });
    const editionId = "editorial-checkpoint-test";
    await artifacts.putImmutable({
      key: `editions/${editionId}/sources/candidate-set.json`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(candidates)),
    });
    let requests = 0;
    const evaluator: CandidateEvaluator = {
      model: "fixture-evaluator", provider: "fixture", promptVersion: "checkpoint-test-v1",
      async evaluate(batch) {
        requests += 1;
        if (requests === 2) throw new Error("simulated temporary provider failure");
        const baseAssessment = fixtureEvaluations.evaluations[0]!;
        return { assessments: batch.map(({ id }) => ({
          storyId: id,
          eventKey: baseAssessment.eventKey,
          classification: baseAssessment.classification,
          eligibility: baseAssessment.eligibility,
          scores: (({ recency: _recency, ...scores }) => scores)(baseAssessment.scores),
          rationales: baseAssessment.rationales,
        })) };
      },
    };
    const handler = createEditorialShortlistHandler({ artifacts, evaluator });
    await assert.rejects(handler({ editionId }), /simulated temporary provider failure/);
    const completedBatchCount = await countCheckpointArtifacts(directory, editionId);
    assert.equal(completedBatchCount, 1);

    await handler({ editionId });
    assert.equal(requests, 3, "retry should evaluate only the unfinished second batch");
    const finalBytes = await artifacts.read(`editions/${editionId}/editorial/candidate-evaluations.json`);
    assert.ok(finalBytes);
    const finalArtifact = candidateEvaluationSetSchema.parse(JSON.parse(Buffer.from(finalBytes).toString("utf8")));
    assert.equal(finalArtifact.evaluations.length, 11);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider recency is discarded because recency is derived locally", async () => {
  const fixture = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8",
  )));
  const assessment = fixture.evaluations[0]!;
  const normalized = parseAssessment(assessment);
  assert.equal("recency" in normalized.scores, false);
  assert.notEqual(normalized.scores, assessment.scores);
});

async function countCheckpointArtifacts(root: string, editionId: string): Promise<number> {
  const checkpointRoot = resolve(root, `editions/${editionId}/editorial/evaluation-batches`);
  try {
    const signatures = await readdir(checkpointRoot);
    let count = 0;
    for (const signature of signatures) count += (await readdir(resolve(checkpointRoot, signature))).filter((name) => name.endsWith(".json")).length;
    return count;
  } catch {
    return 0;
  }
}

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

test("editorial cloud stage rejects removed sources before model evaluation", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-editorial-removed-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const candidates = candidateSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
    )));
    const editionId = "old-source-edition";
    await artifacts.putImmutable({
      key: `editions/${editionId}/sources/candidate-set.json`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(candidates)),
    });
    let calls = 0;
    const handler = createEditorialShortlistHandler({
      artifacts,
      evaluator: {
        model: "fixture-evaluator",
        provider: "fixture",
        promptVersion: "editorial-evaluation-v1",
        async evaluate() { calls += 1; return { assessments: [] }; },
      },
      sourceConfiguration: parseSourceConfiguration({
        schemaVersion: "1.0.0",
        artifactType: "source-configuration",
        sources: [{
          id: "replacement-source",
          type: "rss",
          publisher: "Replacement Source",
          feedUrl: "https://replacement.example.org/feed.xml",
          kind: "primary",
          articleAccess: "ephemeral-analysis",
        }],
      }),
    });
    await assert.rejects(handler({ editionId }), /outside the current allowlist/);
    assert.equal(calls, 0);
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
