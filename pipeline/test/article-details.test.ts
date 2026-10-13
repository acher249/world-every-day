import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeArticle, extractArticleText, type ArticleAnalyzer } from "../src/sources/article.js";
import type { ResourceFetcher } from "../src/sources/http.js";
import { discoveredStorySchema } from "../src/sources/schema.js";

const articleUrl = new URL("../fixtures/sources/example-article.html", import.meta.url);

async function articleHtml() {
  return readFile(fileURLToPath(articleUrl), "utf8");
}

function fixtureStory() {
  const canonicalUrl = "https://news.example.test/research/farm-trial?view=full";
  return discoveredStorySchema.parse({
    id: createHash("sha256").update(canonicalUrl).digest("hex"),
    canonicalUrl,
    title: "Farm trial reduces water use",
    publisher: "Example Research News",
    publishedAt: "2026-10-12T17:00:00.000Z",
    discoveredAt: "2026-10-13T14:30:00.000Z",
    source: {
      adapterId: "example-research",
      feedUrl: "https://news.example.test/feed.xml",
      entryId: "research-2026-10-12",
      kind: "primary",
    },
  });
}

function fixtureFetcher(html: string): ResourceFetcher {
  return {
    async fetch(url) {
      return {
        body: Buffer.from(html),
        contentType: "text/html; charset=utf-8",
        url,
      };
    },
  };
}

test("article reading excludes page furniture and keeps granular story details", async () => {
  const text = extractArticleText(await articleHtml());

  assert.match(text, /weathered red barn/);
  assert.match(text, /Blue moisture sensors/);
  assert.doesNotMatch(text, /Topics and subscriptions/);
  assert.doesNotMatch(text, /Copyright fictional fixture/);
});

test("shortlisted articles produce compact, source-grounded visual detail artifacts", async () => {
  const analyzer: ArticleAnalyzer = {
    provider: "fixture",
    model: "fixture-v1",
    async analyze() {
      return {
        headline: "Farm irrigation trial reduces water use",
        summary: "A field trial tested an irrigation system designed to reduce agricultural water use.",
        claims: [
          {
            claim: "The trial took place beside a weathered red barn.",
            evidence: "The field team worked beside a weathered red barn at the north edge of the farm.",
          },
          {
            claim: "The trial doubled crop yields.",
            evidence: "This unsupported sentence does not appear in the article.",
          },
        ],
        details: [{
          detail: "A weathered red barn at the north edge of the farm",
          evidence: "The field team worked beside a weathered red barn at the north edge of the farm.",
          kind: "setting",
          confidence: 0.98,
        },
        {
          detail: "Blue soil-moisture sensors beneath young tomato plants",
          evidence: "Blue moisture sensors were placed beneath rows of young tomato plants in dark volcanic soil.",
          kind: "instrument",
          confidence: 0.96,
        },
        {
          detail: "An invented glass tower",
          evidence: "This sentence does not appear in the article.",
          kind: "object",
          confidence: 0.4,
        }],
      };
    },
  };

  const artifact = await analyzeArticle({
    createdAt: new Date("2026-10-13T14:35:00.000Z"),
    analyzer,
    fetchedAt: new Date("2026-10-13T14:34:00.000Z"),
    fetcher: fixtureFetcher(await articleHtml()),
    story: fixtureStory(),
  });

  assert.equal(artifact.details.length, 2);
  assert.equal(artifact.editorial.claims.length, 1);
  assert.equal(artifact.extraction.status, "analyzed");
  assert.equal(artifact.source.canonicalUrl, fixtureStory().canonicalUrl);
  assert.ok(artifact.source.extractedCharacterCount > 0);
  assert.equal("articleText" in artifact, false);
  assert.equal(JSON.stringify(artifact).includes('"evidence"'), false);
  assert.doesNotMatch(
    JSON.stringify(artifact),
    /The field team worked beside a weathered red barn at the north edge of the farm\./,
  );
});

test("a story remains valid when no grounded visual details are available", async () => {
  const analyzer: ArticleAnalyzer = {
    provider: "fixture",
    model: "fixture-v1",
    async analyze() {
      return {
        headline: "Farm irrigation trial reduces water use",
        summary: "A field trial tested an irrigation system designed to reduce agricultural water use.",
        claims: [{
          claim: "The trial occurred beside a red barn.",
          evidence: "The field team worked beside a weathered red barn at the north edge of the farm.",
        }],
        details: [],
      };
    },
  };

  const artifact = await analyzeArticle({
    analyzer,
    fetcher: fixtureFetcher(await articleHtml()),
    story: fixtureStory(),
  });

  assert.equal(artifact.extraction.status, "analyzed");
  assert.deepEqual(artifact.details, []);
});

