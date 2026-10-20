import assert from "node:assert/strict";
import { test } from "node:test";
import { GovUkNewsAdapter } from "../src/sources/govuk.js";
import type { ResourceFetcher } from "../src/sources/http.js";

const feedUrl = "https://www.gov.uk/search/news-and-communications.atom";
const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>new</id><updated>2026-10-19T17:00:00Z</updated>
    <link rel="alternate" href="https://www.gov.uk/government/news/new-development"/>
    <title>New development</title></entry>
  <entry><id>old</id><updated>2026-10-19T16:00:00Z</updated>
    <link rel="alternate" href="https://www.gov.uk/government/news/old-updated-story"/>
    <title>Old updated story</title></entry>
  <entry><id>speech</id><updated>2026-10-19T15:00:00Z</updated>
    <link rel="alternate" href="https://www.gov.uk/government/speeches/not-news"/>
    <title>A speech</title></entry>
</feed>`;

test("GOV.UK Atom uses first publication, not update time, and excludes other formats", async () => {
  const calls: string[] = [];
  const fetcher: ResourceFetcher = {
    async fetch(url) {
      calls.push(url);
      if (url === feedUrl) return { url, body: Buffer.from(feed), contentType: "application/atom+xml" };
      const isOld = url.endsWith("old-updated-story");
      return {
        url,
        body: Buffer.from(JSON.stringify({
          base_path: isOld ? "/government/news/old-updated-story" : "/government/news/new-development",
          document_type: "press_release",
          first_published_at: isOld ? "2026-09-01T10:00:00Z" : "2026-10-19T16:30:00Z",
          schema_name: "news_article",
          withdrawn_notice: {},
        })),
        contentType: "application/json",
      };
    },
  };
  const adapter = new GovUkNewsAdapter({
    id: "govuk-news", feedUrl, kind: "primary", publisher: "GOV.UK",
    allowedArticleHosts: ["www.gov.uk"],
  }, fetcher);
  const result = await adapter.discover(new Date("2026-10-19T18:00:00Z"));
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].publishedAt, "2026-10-19T16:30:00.000Z");
  assert.equal(result.candidates[1].publishedAt, "2026-09-01T10:00:00.000Z");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => !url.includes("speeches")));
});

test("GOV.UK source fails closed when no publication dates can be verified", async () => {
  const adapter = new GovUkNewsAdapter({
    id: "govuk-news", feedUrl, kind: "primary", publisher: "GOV.UK",
    allowedArticleHosts: ["www.gov.uk"],
  }, {
    async fetch(url) {
      if (url === feedUrl) return { url, body: Buffer.from(feed), contentType: "application/atom+xml" };
      throw new Error("API unavailable");
    },
  });
  await assert.rejects(adapter.discover(), /publication dates could not be verified/);
});
