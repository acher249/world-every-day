import assert from "node:assert/strict";
import { test } from "node:test";
import { currentEditionPointerSchema, publicationPathForEdition, unpublishedCurrentSchema } from "../lib/publication-loader.js";

test("the unpublished marker is distinct from a published pointer", () => {
  const marker = { schemaVersion: "1.0.0", status: "unpublished" };
  assert.deepEqual(unpublishedCurrentSchema.parse(marker), marker);
  assert.equal(currentEditionPointerSchema.safeParse(marker).success, false);
  assert.equal(unpublishedCurrentSchema.safeParse({ ...marker, editionId: "test" }).success, false);
});

test("published edition paths and current pointers stay on the generated asset origin", () => {
  const id = "selection-2026-10-15-0900";
  assert.equal(publicationPathForEdition(id), `/generated/editions/${id}/publication.json`);
  assert.ok(currentEditionPointerSchema.parse({
    schemaVersion: "1.0.0",
    editionId: id,
    publicationUrl: publicationPathForEdition(id),
    publishedAt: "2026-10-15T19:00:00.000Z",
    publicationSha256: "a".repeat(64),
  }));
  assert.throws(() => publicationPathForEdition("../secrets"));
  assert.throws(() => currentEditionPointerSchema.parse({
    schemaVersion: "1.0.0",
    editionId: id,
    publicationUrl: "/generated/editions/other-edition/publication.json",
    publishedAt: "2026-10-15T19:00:00.000Z",
    publicationSha256: "a".repeat(64),
  }));
});
