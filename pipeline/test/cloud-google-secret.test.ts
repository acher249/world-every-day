import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGoogleKey } from "../src/cloud/google-secret.js";

test("Google secret parser accepts raw and JSON-formatted keys without logging them", () => {
  assert.equal(parseGoogleKey("  development-key  "), "development-key");
  assert.equal(parseGoogleKey('{"GOOGLE_AI_API_KEY":" development-key "}'), "development-key");
  assert.throws(() => parseGoogleKey(" "), /empty/);
  assert.throws(() => parseGoogleKey("{}"), /GOOGLE_AI_API_KEY/);
});
