import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMarketingSiteConfig } from "../lib/site-config.js";

test("marketing links have safe project defaults", () => {
  assert.deepEqual(resolveMarketingSiteConfig({}), {
    explorerUrl: "https://explore.aworldeveryday.com",
    githubUrl: "https://github.com/acher249/world-every-day",
    siteUrl: "https://aworldeveryday.com",
  });
});

test("marketing links accept explicit public HTTP URLs", () => {
  assert.deepEqual(resolveMarketingSiteConfig({
    NEXT_PUBLIC_EXPLORER_URL: "http://localhost:3000/",
    NEXT_PUBLIC_GITHUB_URL: "https://github.com/example/project/",
    NEXT_PUBLIC_SITE_URL: "https://example.com/",
  }), {
    explorerUrl: "http://localhost:3000",
    githubUrl: "https://github.com/example/project",
    siteUrl: "https://example.com",
  });
});

test("marketing links reject non-web protocols", () => {
  assert.throws(
    () => resolveMarketingSiteConfig({ NEXT_PUBLIC_EXPLORER_URL: "javascript:alert(1)" }),
    /HTTP or HTTPS/,
  );
});
