import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  createArticleAnalysisWorker,
  createPrepareArticleAnalysisHandler,
} from "../src/cloud/article-analysis-handler.js";
import { artifactSha256, createEditorialShortlist } from "../src/editorial/select.js";
import { candidateEvaluationSetSchema } from "../src/editorial/schema.js";
import { parseSourceConfiguration } from "../src/sources/config.js";
import { articleEvidenceSchema, candidateSetSchema } from "../src/sources/schema.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";

test("article-analysis workers require source policy and reuse immutable evidence", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-article-cloud-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const candidateSet = candidateSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
    )));
    const evaluations = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8",
    )));
    const story = candidateSet.candidates[0];
    const configuration = parseSourceConfiguration({
      schemaVersion: "1.0.0",
      artifactType: "source-configuration",
      sources: [{
        id: story.source.adapterId,
        type: "rss",
        publisher: story.publisher,
        feedUrl: `${story.source.feedUrl}/`,
        kind: "primary",
        articleAccess: "ephemeral-analysis",
        allowedArticleHosts: ["news.example.test"],
      }],
    });
    const editionId = evaluations.editionId;
    const root = `editions/${editionId}`;
    const put = (key: string, value: unknown) => artifacts.putImmutable({
      key: `${root}/${key}`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(value)),
    });
    await put("sources/candidate-set.json", candidateSet);
    const legacyShortlist = createEditorialShortlist({ candidateSet, evaluations });
    await put("editorial/shortlist.json", legacyShortlist);
    const prepare = createPrepareArticleAnalysisHandler({ artifacts, configuration });
    await assert.rejects(prepare({ editionId }), /source-policy checksum/);

    const approvedShortlist = createEditorialShortlist({
      candidateSet,
      evaluations,
      sourcePolicy: {
        approvedSourceIds: new Set([story.source.adapterId]),
        configurationSha256: artifactSha256(configuration),
      },
    });
    const approvedEditionId = `${editionId}-approved`;
    const approvedDirectory = await mkdtemp(resolve(tmpdir(), "world-every-day-approved-"));
    const approvedArtifacts = new LocalArtifactStore(approvedDirectory);
    try {
      const approvedRoot = `editions/${approvedEditionId}`;
      await approvedArtifacts.putImmutable({
        key: `${approvedRoot}/sources/candidate-set.json`,
        contentType: "application/json",
        bytes: Buffer.from(JSON.stringify(candidateSet)),
      });
      await approvedArtifacts.putImmutable({
        key: `${approvedRoot}/editorial/shortlist.json`,
        contentType: "application/json",
        bytes: Buffer.from(JSON.stringify({ ...approvedShortlist, editionId: approvedEditionId })),
      });
      const tasks = await createPrepareArticleAnalysisHandler({
        artifacts: approvedArtifacts,
        configuration,
      })({ editionId: approvedEditionId });
      assert.deepEqual(tasks.tasks, [{ editionId: approvedEditionId, storyId: story.id }]);

      let analyses = 0;
      const worker = createArticleAnalysisWorker({
        artifacts: approvedArtifacts,
        configuration,
        async analyze() {
          analyses += 1;
          return articleEvidenceSchema.parse({
            schemaVersion: "1.0.0",
            artifactType: "article-evidence",
            storyId: story.id,
            createdAt: "2026-10-13T14:35:00.000Z",
            source: {
              canonicalUrl: story.canonicalUrl,
              publisher: story.publisher,
              publishedAt: story.publishedAt,
              fetchedAt: "2026-10-13T14:34:00.000Z",
              retrievedUrl: story.canonicalUrl,
              extractedTextSha256: "a".repeat(64),
              extractedCharacterCount: 100,
            },
            extraction: { provider: "fixture", model: "fixture-v1", status: "analyzed" },
            editorial: { headline: "Farm trial reduces water use", summary: "A test farm reduced water use.", claims: [] },
            details: [],
          });
        },
      });
      const first = await worker(tasks.tasks[0]);
      const resumed = await worker(tasks.tasks[0]);
      assert.equal(first.status, "created");
      assert.equal(resumed.status, "reused");
      assert.equal(analyses, 1);
    } finally {
      await rm(approvedDirectory, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
