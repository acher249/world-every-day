import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { artDirectionSchema } from "../src/art-direction/schema.js";
import { selectedEditionSchema } from "../src/editorial/edition.js";
import { interactionManifestSchema } from "../src/interactions/schema.js";
import { landmarkArtifactSchema } from "../src/landmarks/schema.js";
import { createPublicationManifest } from "../src/publication/create.js";

test("publication includes located stories and omits stories without a verified scene landmark", async () => {
  const selectedFixture = selectedEditionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/selected-edition.example.v1.json", import.meta.url), "utf8",
  )));
  const first = selectedFixture.stories[0]!;
  const secondId = "e".repeat(64);
  const edition = selectedEditionSchema.parse({
    ...selectedFixture,
    targetStories: 2,
    stories: [first, { ...first, storyId: secondId, rank: 2, title: "A second fictional development" }],
  });
  const artFixture = artDirectionSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/demo-art-direction.v1.json", import.meta.url), "utf8",
  )));
  const artDirection = artDirectionSchema.parse({
    ...artFixture,
    editionId: edition.editionId,
    subjects: artFixture.subjects.slice(0, 2).map((subject, index) => ({
      ...subject,
      storyId: index === 0 ? first.storyId : secondId,
      role: index === 0 ? "anchor" : "supporting",
    })),
  });
  const imageSha = "a".repeat(64);
  const landmarks = landmarkArtifactSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "landmark-detections",
    editionId: edition.editionId,
    createdAt: "2026-10-13T15:00:00.000Z",
    sourceImage: { sha256: imageSha, width: 64, height: 32, projection: "equirectangular" },
    provider: { id: "test", model: "fixture" },
    landmarks: [
      { storyId: first.storyId, label: "Visible feature", boundingBox: { xMin: 0.1, yMin: 0.2, xMax: 0.3, yMax: 0.4 }, target: { x: 0.2, y: 0.3 }, confidence: 0.9, visibility: "clear" },
      { storyId: secondId, label: "Not found", boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }, target: { x: 0, y: 0 }, confidence: 0, visibility: "not-found" },
    ],
    contextMarkers: [],
  });
  const splatSha = "b".repeat(64);
  const interactions = interactionManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "interaction-manifest",
    editionId: edition.editionId,
    createdAt: "2026-10-13T15:10:00.000Z",
    method: "spherical-raycast",
    sourceImageSha256: imageSha,
    sourceSplatSha256: splatSha,
    anchors: [{ id: first.storyId, imageTarget: { x: 0.2, y: 0.3 }, worldPosition: { x: 1, y: 2, z: 3 } }],
  });

  const publication = createPublicationManifest({
    artDirection,
    edition,
    fictional: true,
    interactions,
    landmarks,
    poster: { src: "/generated/poster.png", width: 64, height: 32, sha256: "c".repeat(64) },
  });

  assert.equal(publication.stories.length, 1);
  assert.equal(publication.stories[0]?.id, first.storyId);
  assert.match(publication.edition.eyebrow, /^1 story ·/);
});
