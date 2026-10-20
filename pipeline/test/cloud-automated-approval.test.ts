import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { createAutomatedApprovalHandler } from "../src/cloud/automated-approval-handler.js";
import { selectedEditionSchema } from "../src/editorial/edition.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { sha256 } from "../src/panorama/hash.js";
import type { ArtifactStore } from "../src/storage/artifact-store.js";
import { editionReviewSchema } from "../src/workflow/review.js";

test("unattended edition decision is traceable, checksum-bound, and idempotent", async () => {
  const edition = selectedEditionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/selected-edition.example.v1.json", import.meta.url), "utf8",
  )));
  const direction = artDirectionSchema.parse({
    ...JSON.parse(await readFile(new URL("../fixtures/demo-art-direction.v1.json", import.meta.url), "utf8")) as object,
    editionId: edition.editionId,
    inputs: { selectedEditionSha256: artifactSha256(edition) },
  });
  const root = `editions/${edition.editionId}`;
  const records = new Map<string, Uint8Array>([
    [`${root}/editorial/selected-edition.json`, Buffer.from(JSON.stringify(edition))],
    [`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify(direction))],
  ]);
  const artifacts: ArtifactStore = {
    async read(key) { return records.get(key) ?? null; },
    async putImmutable({ key, bytes, contentType }) {
      if (records.has(key)) throw new Error(`Unexpected overwrite: ${key}`);
      records.set(key, bytes);
      return { key, contentType, byteLength: bytes.length, sha256: sha256(Buffer.from(bytes)) };
    },
  };
  const run = createAutomatedApprovalHandler({ artifacts, now: () => new Date("2026-10-18T18:00:00.000Z") });
  const event = { editionId: edition.editionId, stage: "edition" };
  assert.equal((await run(event)).status, "created");
  assert.equal((await run(event)).status, "reused");
  const review = editionReviewSchema.parse(JSON.parse(Buffer.from(records.get(`${root}/review/approval.json`)!).toString("utf8")));
  assert.equal(review.approvedBy, "automated-unattended-run");
  assert.equal(review.inputs.selectedEditionSha256, artifactSha256(edition));
  assert.equal(review.inputs.artDirectionSha256, artifactSha256(direction));
  records.set(`${root}/art-direction/art-direction.json`, Buffer.from(JSON.stringify({
    ...direction, world: { ...direction.world, title: "Changed world" },
  })));
  await assert.rejects(run(event), /different inputs|Art direction does not match/);
});
