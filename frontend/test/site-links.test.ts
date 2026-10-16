import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProjectSiteUrl } from "../lib/site-links";

test("project link defaults to the public site", () => {
  assert.equal(resolveProjectSiteUrl(undefined), "https://aworldeveryday.com/");
});

test("project link can be configured for another deployment", () => {
  assert.equal(
    resolveProjectSiteUrl("https://example.com/project"),
    "https://example.com/project",
  );
});

test("project link rejects unsafe or relative URLs", () => {
  assert.throws(
    () => resolveProjectSiteUrl("javascript:alert(1)"),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => resolveProjectSiteUrl("/about"),
    /absolute HTTP or HTTPS/,
  );
});
