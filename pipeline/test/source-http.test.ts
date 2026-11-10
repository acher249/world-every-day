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

test("transient source responses are retried, then returned successfully", async () => {
  let requests = 0;
  const delays: number[] = [];
  const fetcher = new AllowlistedHttpFetcher({
    allowedHosts: ["news.example.test"],
    fetchImpl: async () => {
      requests += 1;
      return requests === 1
        ? new Response("busy", { status: 503 })
        : new Response("<html><article><p>Recovered source article content is available.</p></article></html>", {
            headers: { "content-type": "text/html" },
          });
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
  });

  const result = await fetcher.fetch("https://news.example.test/story");
  assert.equal(requests, 2);
  assert.deepEqual(delays, [250]);
  assert.match(result.body.toString("utf8"), /Recovered source article content/);
});

test("permanent source access denial is not retried", async () => {
  let requests = 0;
  const fetcher = new AllowlistedHttpFetcher({
    allowedHosts: ["news.example.test"],
    fetchImpl: async () => {
      requests += 1;
      return new Response("denied", { status: 403 });
    },
    sleep: async () => assert.fail("403 is permanent and must not be retried"),
  });

  await assert.rejects(fetcher.fetch("https://news.example.test/story"), (error: unknown) => {
    assert.equal((error as Error).name, "SourceFetchError");
    assert.equal((error as { statusCode?: number }).statusCode, 403);
    return true;
  });
  assert.equal(requests, 1);
});

