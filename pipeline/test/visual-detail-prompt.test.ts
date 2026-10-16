import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { boundEphemeralEvidence, buildArticleAnalysisPrompt } from "../src/sources/article-analysis-prompt.js";
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

  assert.match(prompt, /exact evidence passage of at most 240 characters/i);
  assert.match(prompt, /may be empty/i);
  assert.match(prompt, /directly tied to the reported development/i);
  assert.match(prompt, /not incidental examples/i);
  assert.match(prompt, /weathered red barn/);
  assert.doesNotMatch(prompt, /utm_/i);
});

test("overlong model evidence is bounded before validation and never retained", () => {
  const result = boundEphemeralEvidence({ claim: "A factual claim", evidence: `  ${"word ".repeat(100)}` }) as {
    claim: string;
    evidence: string;
  };
  assert.equal(result.claim, "A factual claim");
  assert.ok(result.evidence.length <= 320);
  assert.equal(result.evidence.endsWith(" "), false);
  assert.equal(boundEphemeralEvidence(null), null);
});

