import assert from "node:assert/strict";
import { test } from "node:test";
import { latestPostId } from "../lib/latest-post";

test("latest post accepts only a versioned numeric identifier", () => {
  assert.equal(latestPostId({ schemaVersion: "1.0.0", postId: "2113305073614979137" }), "2113305073614979137");
  for (const value of [null, {}, { postId: "123" }, { schemaVersion: "1.0.0", postId: 123 },
    { schemaVersion: "1.0.0", postId: "<script>" }, { schemaVersion: "1.0.0", postId: "https://evil.example" }]) {
    assert.equal(latestPostId(value), null);
  }
});
