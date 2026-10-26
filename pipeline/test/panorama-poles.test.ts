import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { extractPolePatch, createMaskedPoleRepairSheet, extractRepairedPoleSheet, compositePolePatch, stabilizePoleConvergence, harmonizePeriodicExposure } from "../src/panorama/poles.js";
import { createPoleRepair } from "../src/panorama/repair-job.js";
import { sha256 } from "../src/panorama/hash.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";

const solid = (color: string, width = 128, height = 64) => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

test("pole projection points up/down, repair mask is explicit, and unchanged masks are rejected", async () => {
  const upper = await solid("#e04020", 128, 32), lower = await solid("#2040e0", 128, 32);
  const erp = await sharp(await solid("black")).composite([{ input: upper, top: 0, left: 0 }, { input: lower, top: 32, left: 0 }]).png().toBuffer();
  const zenith = await extractPolePatch(erp, "zenith", 32), nadir = await extractPolePatch(erp, "nadir", 32);
  assert.deepEqual([...(await sharp(zenith).raw().toBuffer()).subarray(0, 3)], [224, 64, 32]);
  assert.deepEqual([...(await sharp(nadir).raw().toBuffer()).subarray(0, 3)], [32, 64, 224]);
  const sheet = await createMaskedPoleRepairSheet(zenith, nadir);
  assert.equal((await sharp(sheet).metadata()).width, 4096);
  await assert.rejects(extractRepairedPoleSheet(sheet), /mask unfilled/);
  await assert.rejects(extractRepairedPoleSheet(await solid("white")), /16:9/);
});

test("repaired poles preserve the equator and color matching avoids a bright circular patch", async () => {
  const base = await solid("#507090", 512, 256);
  const repaired = await compositePolePatch(base, await solid("#6080a0", 64, 64), "zenith");
  const before = await sharp(base).raw().toBuffer(), after = await sharp(repaired).raw().toBuffer();
  assert.deepEqual(after.subarray(100 * 512 * 3, 200 * 512 * 3), before.subarray(100 * 512 * 3, 200 * 512 * 3));
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(after[c] - before[c]) <= 1);
});

test("convergence stabilizes pole rows while leaving middle latitudes intact", async () => {
  const width = 128, height = 256, bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bytes.fill(x % 2 ? 200 : 40, (y * width + x) * 3, (y * width + x + 1) * 3);
  const input = await sharp(bytes, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const output = await sharp(await stabilizePoleConvergence(input)).raw().toBuffer();
  assert.equal(output[0], output[3]);
  assert.deepEqual(output.subarray(100 * width * 3, 150 * width * 3), bytes.subarray(100 * width * 3, 150 * width * 3));
  const balanced = await sharp(await harmonizePeriodicExposure(await solid("#507090"))).raw().toBuffer();
  assert.deepEqual([...balanced.subarray(0, 3)], [80, 112, 144]);
});

test("paid repair checkpoints bind inputs and block uncertain retries", async () => {
  const records = new Map<string, Uint8Array>(), claims = new Set<string>();
  const artifacts: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({ key, bytes, contentType }) {
      const previous = records.get(key);
      if (previous && !Buffer.from(previous).equals(bytes)) throw new Error("Immutable artifact changed");
      records.set(key, bytes); return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  let calls = 0;
  const sheet = await solid("gray", 160, 90);
  const options = { artifacts, claims: { async claimOnce(key: string) { if (claims.has(key)) return false; claims.add(key); return true; } },
    generator: { async generate() { calls++; return { bytes: sheet, mimeType: "image/png", elapsedMs: 1, usage: null }; } },
    editionId: "daily-2026-10-26", model: "fixture", scenePrompt: "A coastal garden",
  };
  assert.deepEqual(await createPoleRepair(options)(sheet), sheet);
  assert.deepEqual(await createPoleRepair(options)(sheet), sheet);
  assert.equal(calls, 1);
  await assert.rejects(createPoleRepair({ ...options, scenePrompt: "Different scene" })(sheet), /does not match/);
  records.delete(`editions/${options.editionId}/panorama/pole-repair/receipt.json`);
  await assert.rejects(createPoleRepair(options)(sheet), /attempt already exists/);
  assert.equal(calls, 1);
});
