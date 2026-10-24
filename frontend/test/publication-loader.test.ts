import assert from "node:assert/strict";
import { test } from "node:test";
import { currentEditionPointerSchema, editionHref, pastWorldLabel, publicationPathForEdition, resolveEditionRequest, unpublishedCurrentSchema } from "../lib/publication-loader.js";

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
  assert.ok(currentEditionPointerSchema.parse({
    schemaVersion: "1.0.0",
    editionId: `${id}-test`,
    publicationUrl: `/generated/editions/${id}-test/publication-public.json`,
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

test("past worlds are valid, distinct published pointers with readable dates", () => {
  const current = {
    schemaVersion: "1.0.0",
    editionId: "daily-2026-10-20",
    publicationUrl: "/generated/editions/daily-2026-10-20/publication.json",
    publishedAt: "2026-10-20T15:00:00.000Z",
    publicationSha256: "a".repeat(64),
  };
  const yesterday = {
    ...current,
    editionId: "source-expansion-2026-10-19-test",
    publicationUrl: "/generated/editions/source-expansion-2026-10-19-test/publication-public.json",
  };
  assert.equal(pastWorldLabel(yesterday.editionId), "October 19, 2026");
  assert.deepEqual(currentEditionPointerSchema.parse({ ...current, pastWorlds: [yesterday] }).pastWorlds, [yesterday]);
  assert.equal(currentEditionPointerSchema.safeParse({ ...current, pastWorlds: [yesterday, yesterday] }).success, false);
  assert.equal(currentEditionPointerSchema.safeParse({ ...current, pastWorlds: [current] }).success, false);
  assert.equal(currentEditionPointerSchema.safeParse({ ...current, pastWorlds: [{ ...yesterday, publicationUrl: "/secret" }] }).success, false);
});

test("date links resolve promoted historical worlds without renaming immutable assets", () => {
  const yesterday = {
    schemaVersion: "1.0.0" as const, editionId: "source-expansion-2026-10-19-test",
    publicationUrl: "/generated/editions/source-expansion-2026-10-19-test/publication-public.json",
    publishedAt: "2026-10-19T15:00:00Z", publicationSha256: "a".repeat(64),
  };
  const current = currentEditionPointerSchema.parse({ ...yesterday, editionId: "daily-2026-10-20",
    publicationUrl: "/generated/editions/daily-2026-10-20/publication.json", pastWorlds: [yesterday] });
  assert.equal(editionHref(yesterday.editionId), "/?edition=2026-10-19");
  assert.deepEqual(resolveEditionRequest("2026-10-19", current), yesterday);
  assert.deepEqual(resolveEditionRequest(yesterday.editionId, current), yesterday);
  assert.equal(resolveEditionRequest("2026-10-20", current).editionId, current.editionId);
  assert.throws(() => resolveEditionRequest("2026-10-18", current), /No published world/);
  assert.throws(() => resolveEditionRequest("2026-02-30", current), /Invalid edition date/);
});

test("direct preview IDs remain supported but dates cannot guess unlisted worlds", () => {
  assert.equal(resolveEditionRequest("preview-2026-10-19-test", null).publicationUrl,
    "/generated/editions/preview-2026-10-19-test/publication.json");
  assert.throws(() => resolveEditionRequest("2026-10-19", null), /No published world/);
  assert.throws(() => resolveEditionRequest("../secrets", null));
  assert.equal(editionHref("special-edition"), "/?edition=special-edition");
});
