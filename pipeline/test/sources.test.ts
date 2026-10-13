import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectCandidateSet, FeedSourceAdapter, parseFeedCandidates } from "../src/sources/feed.js";
import type { ResourceFetcher } from "../src/sources/http.js";
import { candidateSetSchema } from "../src/sources/schema.js";
import { canonicalizeSourceUrl } from "../src/sources/url.js";

const feedUrl = new URL("../fixtures/sources/example-feed.xml", import.meta.url);

async function feedXml() {
  return readFile(fileURLToPath(feedUrl), "utf8");
}

function fixtureFetcher(xml: string): ResourceFetcher {
  return {
    async fetch(url) {
      return {
        body: Buffer.from(xml),
        contentType: "application/rss+xml",
        url,
      };
    },
  };
}

const configuration = {
  id: "example-research",
  feedUrl: "https://news.example.test/feed.xml",
  kind: "primary" as const,
  publisher: "Example Research News",
};

test("RSS discovery preserves provenance and normalizes tracking URLs", async () => {
  const candidates = parseFeedCandidates({
    configuration,
    discoveredAt: new Date("2026-10-13T07:30:00-07:00"),
    xml: await feedXml(),
  });

  assert.equal(candidates.length, 2);
  assert.equal(
    candidates[0].canonicalUrl,
    "https://news.example.test/research/farm-trial?view=full",
  );
  assert.equal(candidates[0].source.adapterId, "example-research");
  assert.equal(candidates[0].source.kind, "primary");
});

test("candidate collection applies the editorial window and deterministic deduplication", async () => {
  const xml = await feedXml();
  const adapters = [
    new FeedSourceAdapter(configuration, fixtureFetcher(xml)),
    new FeedSourceAdapter(
      { ...configuration, id: "duplicate-feed", kind: "reporting" },
      fixtureFetcher(xml),
    ),
  ];

  const artifact = await collectCandidateSet({
    adapters,
    createdAt: new Date("2026-10-13T14:30:00.000Z"),
    window: {
      start: new Date("2026-10-12T07:30:00-07:00"),
      end: new Date("2026-10-13T07:30:00-07:00"),
    },
  });

  assert.equal(artifact.candidates.length, 1);
  assert.equal(artifact.candidates[0].source.kind, "primary");
  assert.equal(artifact.candidates[0].title, "Farm trial reduces water use");
  assert.equal(artifact.sourceRuns.length, 2);
  assert.ok(artifact.sourceRuns.every((run) => run.status === "succeeded"));
  assert.ok(artifact.sourceRuns.every((run) => run.contentSha256?.length === 64));
});

test("Atom discovery resolves alternate links", () => {
  const candidates = parseFeedCandidates({
    configuration,
    discoveredAt: new Date("2026-10-13T14:30:00.000Z"),
    xml: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>atom-1</id><title>Wetland restoration expands</title><link rel="alternate" href="https://news.example.test/wetlands?utm_medium=feed"/><published>2026-10-12T18:00:00Z</published><summary>A restored marsh.</summary></entry></feed>`,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].canonicalUrl, "https://news.example.test/wetlands");
});

test("a failed feed is isolated and recorded", async () => {
  const successful = new FeedSourceAdapter(configuration, fixtureFetcher(await feedXml()));
  const failed = new FeedSourceAdapter(
    { ...configuration, id: "unavailable-feed", feedUrl: "https://unavailable.example.test/feed.xml" },
    { async fetch() { throw new Error("Synthetic feed outage"); } },
  );
  const artifact = await collectCandidateSet({
    adapters: [successful, failed],
    createdAt: new Date("2026-10-13T14:30:00.000Z"),
    window: {
      start: new Date("2026-10-12T14:30:00.000Z"),
      end: new Date("2026-10-13T14:30:00.000Z"),
    },
  });

  assert.equal(artifact.candidates.length, 1);
  assert.deepEqual(
    artifact.sourceRuns.map(({ adapterId, status }) => ({ adapterId, status })),
    [
      { adapterId: "example-research", status: "succeeded" },
      { adapterId: "unavailable-feed", status: "failed" },
    ],
  );
});

test("source URL normalization rejects insecure URLs", () => {
  assert.throws(() => canonicalizeSourceUrl("http://example.test/story"), /HTTPS/);
  assert.throws(
    () => canonicalizeSourceUrl("https://user:secret@example.test/story"),
    /credentials/,
  );
});

test("the checked-in candidate artifact validates", async () => {
  const fixtureUrl = new URL("../fixtures/candidate-set.v1.json", import.meta.url);
  const artifact = candidateSetSchema.parse(
    JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8")),
  );

  assert.equal(artifact.candidates.length, 1);
  assert.equal(artifact.sourceRuns[0].status, "succeeded");
});

