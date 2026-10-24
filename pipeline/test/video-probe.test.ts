import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureStaticKey, captureFrames } from "../src/video/capture-browser.js";
import { probeInputSchema } from "../src/video/probe-handler.js";

test("capture only serves its page and static build files", () => {
  assert.equal(captureStaticKey("/capture/"), "capture/index.html");
  assert.equal(captureStaticKey("/_next/static/chunks/a.js"), "_next/static/chunks/a.js");
  for (const path of ["/.env.local", "/generated/current.json", "/_next/static/../secret", "/_next/static/%2e%2e/secret"]) {
    assert.equal(captureStaticKey(path), null);
  }
});

test("a changed world is rejected before starting Chromium", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capture-checksum-"));
  try {
    const worldPath = join(directory, "world.spz");
    await writeFile(worldPath, "changed world");
    await assert.rejects(captureFrames({ worldPath, expectedSha256: "0".repeat(64), executablePath: "must-not-start",
      readStatic: async () => { throw new Error("must not read build"); }, onFrame: async () => {} }), /checksum mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("probe rejects arbitrary asset paths and unbounded jobs", async () => {
  assert.equal(probeInputSchema.parse({ editionId: "daily-example" }).frameCount, 1);
  for (const input of [{ editionId: "../secret" }, { editionId: "day", frameCount: 301 },
    { editionId: "day", frameCount: 0 }, { editionId: "day", url: "https://example.com" }]) {
    assert.equal(probeInputSchema.safeParse(input).success, false);
  }
  await assert.rejects(captureFrames({ worldPath: "unused", executablePath: "unused", frameCount: 301,
    readStatic: async () => new Uint8Array(), onFrame: async () => {} }), /1–300/);
});
