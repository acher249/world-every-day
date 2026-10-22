import assert from "node:assert/strict";
import test from "node:test";

import { canRenderWorldInteractions, companionOffset, landmarkCompanion } from "../lib/world-interactions";
import { readFile } from "node:fs/promises";
import { parsePublicationManifest } from "../lib/publication-schema";

const checksum = "a".repeat(64);

test("every story has a companion using its original baked location and focus id", async () => {
  const publication = parsePublicationManifest(JSON.parse(await readFile(new URL("../data/fixtures/demo-publication.v1.json", import.meta.url), "utf8")));
  const companions = publication.stories.map(landmarkCompanion);
  assert.equal(companions.length, publication.stories.length);
  assert.equal(new Set(companions.map(({ id }) => id)).size, companions.length);
  companions.forEach((echo, index) => {
    const story = publication.stories[index];
    assert.equal(echo.worldPosition, story.interaction.worldPosition);
    assert.equal(echo.focusStoryId, story.id);
    assert.equal(echo.label, story.representation);
    assert.ok(echo.explanation.includes(story.summary));
    assert.ok(echo.explanation.includes("artistic interpretation"));
    assert.notEqual(echo.id, story.id);
  });
});

test("companion uses the published object explanation when available", async () => {
  const publication = parsePublicationManifest(JSON.parse(await readFile(new URL("../data/fixtures/demo-publication.v1.json", import.meta.url), "utf8")));
  const story = { ...publication.stories[0], representationExplanation: "This branching sculpture illustrates how nerve cells pass signals." };
  assert.equal(landmarkCompanion(story, 0).explanation, story.representationExplanation);
});

test("companion badges sit beside their landmark and turn inward near the right edge", () => {
  assert.equal(companionOffset(50), 62);
  assert.equal(companionOffset(95), -62);
});

test("poster interactions remain available without a splat", () => {
  assert.equal(
    canRenderWorldInteractions({ interactionSplatSha256: checksum }),
    true,
  );
});

test("3D interactions require the exact rendered splat checksum", () => {
  assert.equal(
    canRenderWorldInteractions({
      interactionSplatSha256: checksum,
      renderedSplatSha256: checksum,
      splatUrl: "/generated/world.spz",
    }),
    true,
  );
  assert.equal(
    canRenderWorldInteractions({
      interactionSplatSha256: checksum,
      renderedSplatSha256: "b".repeat(64),
      splatUrl: "/generated/world.spz",
    }),
    false,
  );
});

test("a local splat without a checksum cannot reuse baked hotspots", () => {
  assert.equal(
    canRenderWorldInteractions({
      interactionSplatSha256: checksum,
      splatUrl: "/generated/world.spz",
    }),
    false,
  );
});
