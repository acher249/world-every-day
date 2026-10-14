import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserInteractionBaker } from "../src/interactions/browser.js";

test("browser interaction baking accepts only local HTTP endpoints", () => {
  assert.throws(
    () => new BrowserInteractionBaker({
      browserUrl: "https://browser.example.test",
      frontendDirectory: "/tmp/frontend",
      pageUrl: "http://localhost:3000/bake",
    }),
    /local HTTP URL/,
  );
  assert.throws(
    () => new BrowserInteractionBaker({
      browserUrl: "http://127.0.0.1:9222",
      frontendDirectory: "/tmp/frontend",
      pageUrl: "https://example.test/bake",
    }),
    /local HTTP URL/,
  );
});

test("browser interaction baking accepts loopback endpoints", () => {
  assert.doesNotThrow(() => new BrowserInteractionBaker({
    browserUrl: "http://127.0.0.1:9222",
    frontendDirectory: "/tmp/frontend",
    pageUrl: "http://localhost:3000/bake",
  }));
});
