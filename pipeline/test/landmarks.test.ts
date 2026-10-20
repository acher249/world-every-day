import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { parseArtDirection } from "../src/art-direction/schema.js";
import { buildLandmarkDetectionPrompt } from "../src/landmarks/prompt.js";
import type { LandmarkDetector } from "../src/landmarks/provider.js";
import { detectLandmarks } from "../src/landmarks/run.js";
import { parseLandmarkDetectionResponse } from "../src/landmarks/schema.js";

const fixtureUrl = new URL("../fixtures/demo-art-direction.v1.json", import.meta.url);

async function readArtDirection() {
  return parseArtDirection(JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8")));
}

test("the vision prompt preserves every requested story id", async () => {
  const artDirection = await readArtDirection();
  const prompt = buildLandmarkDetectionPrompt(artDirection);

  for (const subject of artDirection.subjects) assert.match(prompt, new RegExp(subject.storyId));
  assert.match(prompt, /equirectangular panorama/i);
  assert.match(prompt, /solid, visually central surface/i);
  assert.match(prompt, /contextMarkers/);
  assert.match(prompt, /distinct from every primary landmark/i);
  assert.match(prompt, /six to eight context markers/i);
  assert.match(prompt, /short, literal label/i);
});

test("landmark detection creates a provenance-bearing 2:1 artifact", async () => {
  const artDirection = await readArtDirection();
  const imageBytes = await sharp({
    create: { width: 16, height: 8, channels: 3, background: "#234b4b" },
  }).png().toBuffer();
  const detector: LandmarkDetector = {
    id: "mock-vision",
    model: "mock-v1",
    async detect() {
      return {
        landmarks: artDirection.subjects.map((subject) => ({
          storyId: subject.storyId,
          label: subject.subject,
          boundingBox: { xMin: 0.2, yMin: 0.2, xMax: 0.4, yMax: 0.4 },
          target: { x: 0.3, y: 0.3 },
          confidence: 0.9,
          visibility: "clear" as const,
        })),
        contextMarkers: [{
          storyId: artDirection.subjects[0].storyId,
          label: "Terraced ground",
          explanation: "The terrain echoes a detail grounded in the first story.",
          boundingBox: { xMin: 0.66, yMin: 0.56, xMax: 0.74, yMax: 0.66 },
          target: { x: 0.7, y: 0.61 },
          confidence: 0.88,
        }],
      };
    },
  };

  const artifact = await detectLandmarks({
    editionId: artDirection.editionId,
    imageBytes,
    mimeType: "image/png",
    artDirection,
    detector,
    createdAt: new Date("2026-10-12T15:00:00.000Z"),
  });

  assert.equal(artifact.landmarks.length, 10);
  assert.equal(artifact.sourceImage.projection, "equirectangular");
  assert.equal(artifact.sourceImage.width, artifact.sourceImage.height * 2);
  assert.ok(artifact.analysisImage);
  assert.equal(artifact.analysisImage.sha256, artifact.sourceImage.sha256);
  assert.equal(artifact.analysisImage.mediaType, "image/png");
  assert.equal(artifact.provider.id, "mock-vision");
  assert.equal(artifact.contextMarkers[0].id, `${artDirection.subjects[0].storyId}-echo`);
});

test("a visible landmark target must be inside its bounding box", () => {
  assert.throws(() => parseLandmarkDetectionResponse({
    landmarks: [{
      storyId: "example",
      label: "Example",
      boundingBox: { xMin: 0.2, yMin: 0.2, xMax: 0.4, yMax: 0.4 },
      target: { x: 0.8, y: 0.8 },
      confidence: 0.5,
      visibility: "clear",
    }],
  }), /inside its bounding box/);
});
