import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { createFinalizeEditionHandler } from "../src/cloud/finalize-edition-handler.js";
import { artifactSha256, createEditorialShortlist } from "../src/editorial/select.js";
import { candidateEvaluationSetSchema } from "../src/editorial/schema.js";
import { parseSourceConfiguration } from "../src/sources/config.js";
import { articleEvidenceSchema, candidateSetSchema } from "../src/sources/schema.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";

test("cloud finalization requires complete evidence and reuses an immutable edition", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-finalize-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const candidates = candidateSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
    )));
    const evaluations = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8",
    )));
    const story = candidates.candidates[0];
    const configuration = parseSourceConfiguration({
      schemaVersion: "1.0.0",
      artifactType: "source-configuration",
      sources: [{
        id: story.source.adapterId,
        type: "rss",
        publisher: story.publisher,
        feedUrl: story.source.feedUrl,
        kind: story.source.kind,
        articleAccess: "ephemeral-analysis",
        allowedArticleHosts: [new URL(story.canonicalUrl).hostname],
      }],
    });
    const shortlist = createEditorialShortlist({
      candidateSet: candidates,
      evaluations,
      sourcePolicy: {
        approvedSourceIds: new Set([story.source.adapterId]),
        configurationSha256: artifactSha256(configuration),
      },
    });
    const editionId = evaluations.editionId;
    const root = `editions/${editionId}`;
    const put = (key: string, value: unknown) => artifacts.putImmutable({
      key: `${root}/${key}`,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(value)),
    });
    await put("sources/candidate-set.json", candidates);
    await put("editorial/candidate-evaluations.json", evaluations);
    await put("editorial/shortlist.json", shortlist);

    const finalize = createFinalizeEditionHandler({
      artifacts,
      configuration,
      now: () => new Date("2026-10-13T14:36:00.000Z"),
    });
    await assert.rejects(finalize({ editionId }), /Required editorial artifact is missing/);
    const evidence = articleEvidenceSchema.parse({
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
        extractedCharacterCount: 500,
      },
      extraction: { provider: "fixture", model: "fixture-v1", status: "analyzed" },
      editorial: {
        headline: "Farm trial reduces irrigation water use",
        summary: "A fictional field trial tested agricultural water savings.",
        claims: [{ claim: "The fictional trial used moisture sensors." }],
      },
      details: [{ detail: "Blue soil-moisture sensors", kind: "instrument", confidence: 0.9 }],
    });
    await put(`editorial/article-evidence/${story.id}.json`, evidence);
    const first = await finalize({ editionId });
    const resumed = await finalize({ editionId });
    assert.equal(first.status, "created");
    assert.equal(first.selectedCount, 1);
    assert.equal(resumed.status, "reused");
    assert.equal(resumed.key, first.key);
    const bytes = await artifacts.read(first.key);
    assert.ok(bytes);
    const selected = JSON.parse(Buffer.from(bytes).toString("utf8"));
    assert.equal(selected.stories[0].sources[0].url, story.canonicalUrl);
    assert.equal(selected.stories[0].articleEvidenceSha256, artifactSha256(evidence));

    const changedConfiguration = parseSourceConfiguration({
      ...configuration,
      sources: [{ ...configuration.sources[0], articleAccess: "discovery-only" }],
    });
    await assert.rejects(createFinalizeEditionHandler({
      artifacts,
      configuration: changedConfiguration,
    })({ editionId }), /current source policy/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
