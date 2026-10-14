import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assignSphericalSubjectPlacements,
  buildScenePrompt,
} from "../src/art-direction/prompt.js";
import {
  parseArtDirection,
  type ArtDirection,
} from "../src/art-direction/schema.js";

const fixtureUrl = new URL("../fixtures/demo-art-direction.v1.json", import.meta.url);
const publicationFixtureUrl = new URL(
  "../../frontend/data/fixtures/demo-publication.v1.json",
  import.meta.url,
);

async function readFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8"));
}

test("the demonstration art direction covers ten unique story subjects", async () => {
  const artDirection = parseArtDirection(await readFixture());

  assert.equal(artDirection.subjects.length, 10);
  assert.equal(new Set(artDirection.subjects.map((subject) => subject.storyId)).size, 10);
  assert.equal(artDirection.subjects.filter((subject) => subject.role === "anchor").length, 2);
});

test("art direction produces a deterministic scene prompt", async () => {
  const artDirection = parseArtDirection(await readFixture());
  const first = buildScenePrompt(artDirection);
  const second = buildScenePrompt(artDirection);

  assert.equal(first, second);
  assert.match(first, /one coherent physical place/i);
  assert.match(first, /monumental luminous DNA helix/i);
  assert.match(first, /people, faces, portraits/i);
  assert.match(first, /viewer should need to turn left, right, and behind/i);
  assert.match(first, /exclusive landmark bay/i);
  assert.match(first, /does not need to be circular/i);
  assert.match(first, /two or three primary landmarks/i);
  assert.match(first, /azimuth 18°/i);
  assert.match(first, /azimuth 342°/i);
});

test("spherical placement separates anchors and fills the full turn", async () => {
  const artDirection = parseArtDirection(await readFixture());
  const placements = assignSphericalSubjectPlacements(artDirection.subjects);
  const azimuthsFor = (role: "anchor" | "supporting" | "detail") =>
    artDirection.subjects
      .filter((subject) => subject.role === role)
      .map((subject) => placements.get(subject.storyId)?.azimuthDegrees);

  assert.deepEqual(azimuthsFor("anchor"), [18, 162]);
  assert.deepEqual(azimuthsFor("supporting"), [90, 234, 306]);
  assert.deepEqual(azimuthsFor("detail"), [54, 126, 198, 270, 342]);
});

test("art direction rejects duplicate story subjects", async () => {
  const fixture = (await readFixture()) as ArtDirection;
  fixture.subjects[1].storyId = fixture.subjects[0].storyId;

  assert.throws(() => parseArtDirection(fixture), /Duplicate story id/);
});

test("art direction covers the same stories as the demonstration publication", async () => {
  const artDirection = parseArtDirection(await readFixture());
  const publication = JSON.parse(
    await readFile(fileURLToPath(publicationFixtureUrl), "utf8"),
  ) as { stories: Array<{ id: string }> };

  assert.deepEqual(
    artDirection.subjects.map((subject) => subject.storyId).sort(),
    publication.stories.map((story) => story.id).sort(),
  );
});
