import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { createCollectCandidatesHandler } from "../src/cloud/collect-candidates-handler.js";
import { parseSourceConfiguration } from "../src/sources/config.js";
import { candidateSetSchema } from "../src/sources/schema.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";

const configuration = parseSourceConfiguration({
  artifactType: "source-configuration",
  schemaVersion: "1.0.0",
  sources: [{
    id: "example-news",
    type: "rss",
    publisher: "Example News",
    feedUrl: "https://news.example.com/feed/",
    kind: "primary",
    articleAccess: "ephemeral-analysis",
    allowedArticleHosts: ["news.example.com"],
  }],
});

const input = {
  editionId: "edition-2026-10-14",
  windowStart: "2026-10-13T14:30:00.000Z",
  windowEnd: "2026-10-14T14:30:00.000Z",
};

test("cloud collection stores candidate metadata once and resumes without refetching", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-collect-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    let requests = 0;
    const handler = createCollectCandidatesHandler({
      artifacts,
      configuration,
      now: () => new Date("2026-10-14T14:31:00.000Z"),
      fetcherForSource: () => ({
        async fetch() {
          requests += 1;
          return {
            body: Buffer.from(`<?xml version="1.0"?><rss><channel>
              <item><title>New discovery</title><link>https://news.example.com/story</link>
              <pubDate>Wed, 14 Oct 2026 12:00:00 GMT</pubDate></item>
              <item><title>Older story</title><link>https://news.example.com/old</link>
              <pubDate>Mon, 12 Oct 2026 12:00:00 GMT</pubDate></item>
            </channel></rss>`),
            contentType: "application/rss+xml",
            url: "https://news.example.com/feed/",
          };
        },
      }),
    });

    const first = await handler(input);
    const resumed = await handler(input);
    assert.deepEqual(resumed, first);
    assert.equal(requests, 1);
    assert.equal(first.candidateCount, 1);
    assert.equal(first.failedSourceCount, 0);
    const stored = await artifacts.read(first.key);
    assert.ok(stored);
    const artifact = candidateSetSchema.parse(JSON.parse(Buffer.from(stored).toString("utf8")));
    assert.equal(artifact.candidates[0].canonicalUrl, "https://news.example.com/story");
    assert.equal(artifact.sourceRuns[0]?.feedUrl, "https://news.example.com/feed");
    assert.equal(artifact.window.start, input.windowStart);

    const revised = createCollectCandidatesHandler({
      artifacts,
      configuration: parseSourceConfiguration({
        ...configuration,
        sources: [{ ...configuration.sources[0], id: "replacement-news" }],
      }),
    });
    await assert.rejects(revised(input), /different source allowlist/);

    await assert.rejects(
      handler({ ...input, windowStart: "2026-10-13T15:30:00.000Z" }),
      /different window/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cloud collection rejects empty results and invalid windows", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-empty-collect-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const handler = createCollectCandidatesHandler({
      artifacts,
      configuration,
      fetcherForSource: () => ({
        async fetch() {
          throw new Error("Source unavailable");
        },
      }),
    });
    await assert.rejects(handler(input), /No candidate stories/);
    assert.equal(await artifacts.read(`editions/${input.editionId}/sources/candidate-set.json`), null);
    await assert.rejects(handler({ ...input, windowStart: input.windowEnd }), /Collection window/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
