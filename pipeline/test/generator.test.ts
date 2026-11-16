import assert from "node:assert/strict";
import test from "node:test";
import { parseConversation } from "../src/panorama/generator.js";

test("parseConversation preserves large opaque image and thought-signature parts", () => {
  const serialized = Buffer.from(JSON.stringify({
    version: 1,
    history: [
      { role: "user", parts: [{ text: "Continue this edit" }, { inlineData: { mimeType: "image/png", data: "AQID" } }] },
      { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: "BAUG" }, thoughtSignature: "opaque-signature" }] },
    ],
  }));
  const padded = Buffer.concat([Buffer.from("prefix"), serialized, Buffer.from("suffix")]);
  const history = parseConversation(padded.subarray(6, 6 + serialized.length));

  assert.equal(history.length, 2);
  assert.equal(history[1]?.parts?.[0]?.thoughtSignature, "opaque-signature");
  assert.equal(history[1]?.parts?.[0]?.inlineData?.data, "BAUG");
});

test("parseConversation rejects malformed saved history", () => {
  assert.throws(() => parseConversation(Buffer.from(JSON.stringify({ version: 1, history: [{ role: "assistant", parts: [] }] }))), /invalid structure/);
});
