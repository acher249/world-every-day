import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildArticleAnalysisPrompt } from "../src/sources/google-article-analysis.js";
import { discoveredStorySchema } from "../src/sources/schema.js";

test("the article-analysis prompt requires exact evidence and permits no visual details", () => {
  const canonicalUrl = "https://news.example.test/story";
  const story = discoveredStorySchema.parse({
    id: createHash("sha256").update(canonicalUrl).digest("hex"),
    canonicalUrl,
    title: "A field trial reduces water use",
    publisher: "Example Research News",
    publishedAt: "2026-10-12T17:00:00.000Z",
    discoveredAt: "2026-10-13T14:30:00.000Z",
    source: {
      adapterId: "example",
      feedUrl: "https://news.example.test/feed.xml",
      kind: "primary",
    },
  });
  const prompt = buildArticleAnalysisPrompt(
    story,
    "The team worked beside a weathered red barn.",
  );

  assert.match(prompt, /short exact evidence passage/i);
  assert.match(prompt, /may be empty/i);
  assert.match(prompt, /weathered red barn/);
  assert.doesNotMatch(prompt, /utm_/i);
});

