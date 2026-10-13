import assert from "node:assert/strict";
import { test } from "node:test";
import { AllowlistedHttpFetcher } from "../src/sources/http.js";

test("the source fetcher blocks hosts outside the explicit allowlist", async () => {
  let called = false;
  const fetcher = new AllowlistedHttpFetcher({
    allowedHosts: ["news.example.test"],
    fetchImpl: async () => {
      called = true;
      return new Response("unexpected");
    },
  });

  await assert.rejects(
    fetcher.fetch("https://other.example.test/story"),
    /not allowlisted/,
  );
  assert.equal(called, false);
});

test("redirects are revalidated against the source allowlist", async () => {
  const fetcher = new AllowlistedHttpFetcher({
    allowedHosts: ["news.example.test"],
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://private.example.test/article" },
    }),
  });

  await assert.rejects(
    fetcher.fetch("https://news.example.test/story"),
    /not allowlisted/,
  );
});

test("private literal addresses remain blocked even if configured", async () => {
  const fetcher = new AllowlistedHttpFetcher({
    allowedHosts: ["127.0.0.1"],
    fetchImpl: async () => new Response("unexpected"),
  });

  await assert.rejects(fetcher.fetch("https://127.0.0.1/story"), /Private or local/);
});

test("source responses are bounded while streaming", async () => {
  const fetcher = new AllowlistedHttpFetcher({
    allowedHosts: ["news.example.test"],
    fetchImpl: async () => new Response("six bytes"),
    maxBytes: 4,
  });

  await assert.rejects(
    fetcher.fetch("https://news.example.test/story"),
    /exceeds the 4-byte limit/,
  );
});

