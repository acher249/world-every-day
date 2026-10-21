import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  parsePublicationManifest,
  type PublicationManifest,
} from "../lib/publication-schema";

const fixtureUrl = new URL("../data/fixtures/demo-publication.v1.json", import.meta.url);

async function readFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8"));
}

test("the demonstration publication is a valid ten-story artifact", async () => {
  const manifest = parsePublicationManifest(await readFixture());

  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.edition.fictional, true);
  assert.equal(manifest.stories.length, 10);
  assert.equal(new Set(manifest.stories.map((story) => story.id)).size, 10);
  assert.equal(manifest.world.interactionMapping.method, "spherical-raycast");
  assert.deepEqual(manifest.storyEchoes, []);
});

test("story echoes remain separate from stories and reference an existing story", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.storyEchoes = [{
    id: `${fixture.stories[0].id}-echo`,
    storyId: fixture.stories[0].id,
    label: "Cratered terrain",
    explanation: "The crater reflects the terrain described in this story.",
    interaction: {
      imageTarget: { x: 0.72, y: 0.57 },
      worldPosition: { x: 2, y: 0.4, z: -3 },
    },
  }];

  assert.equal(parsePublicationManifest(fixture).storyEchoes.length, 1);
  fixture.storyEchoes[0].storyId = "missing-story";
  assert.throws(() => parsePublicationManifest(fixture), /unknown story/);
});

test("baked interactions identify the exact source splat", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.world.interactionMapping.sourceSplatSha256 = "not-a-checksum";

  assert.throws(() => parsePublicationManifest(fixture));
});

test("baked interactions must match a published splat", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.world.splat = {
    url: "https://assets.example.test/world.spz",
    format: "spz",
    sha256: "a".repeat(64),
  };

  assert.throws(
    () => parsePublicationManifest(fixture),
    /must match the published splat checksum/,
  );
});

test("screen regions must use normalized coordinates", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.stories[0].interaction.screenRegion.x = 31;

  assert.throws(() => parsePublicationManifest(fixture));
});

test("optional panorama bounds are validated without breaking older editions", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  assert.equal(parsePublicationManifest(fixture).stories[0].interaction.imageBoundingBox, undefined);
  fixture.stories[0].interaction.imageBoundingBox = {
    xMin: 0.1, yMin: 0.2, xMax: 0.3, yMax: 0.4,
  };
  assert.deepEqual(parsePublicationManifest(fixture).stories[0].interaction.imageBoundingBox, fixture.stories[0].interaction.imageBoundingBox);
  fixture.stories[0].interaction.imageBoundingBox.xMax = 0.05;
  assert.throws(() => parsePublicationManifest(fixture), /positive area/);
});

test("every story requires a finite 3D world anchor", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.stories[0].interaction.worldPosition.x = Number.POSITIVE_INFINITY;

  assert.throws(() => parsePublicationManifest(fixture));
});

test("factual stories cannot be published without a source", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.edition.fictional = false;

  assert.throws(() => parsePublicationManifest(fixture), /require at least one source/);
});

test("story identifiers must be unique", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.stories[1].id = fixture.stories[0].id;

  assert.throws(() => parsePublicationManifest(fixture), /Duplicate story id/);
});

test("source links must use HTTPS", async () => {
  const fixture = (await readFixture()) as PublicationManifest;
  fixture.stories[0].sources.push({
    title: "Unsafe fixture",
    publisher: "Example",
    url: "javascript:alert(1)",
    publishedAt: "2026-10-12T12:00:00.000Z",
    kind: "primary",
  });

  assert.throws(() => parsePublicationManifest(fixture), /Use an HTTPS URL/);
});
