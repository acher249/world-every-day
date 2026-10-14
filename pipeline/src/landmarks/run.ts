import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ArtDirection } from "../art-direction/schema.js";
import type { LandmarkDetector } from "./provider.js";
import { landmarkArtifactSchema, type LandmarkArtifact } from "./schema.js";

function panoramaDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const directX = Math.abs(a.x - b.x);
  return Math.hypot(Math.min(directX, 1 - directX), Math.abs(a.y - b.y));
}

function boxesOverlap(
  a: { xMin: number; yMin: number; xMax: number; yMax: number },
  b: { xMin: number; yMin: number; xMax: number; yMax: number },
): boolean {
  return a.xMin <= b.xMax && a.xMax >= b.xMin && a.yMin <= b.yMax && a.yMax >= b.yMin;
}

export async function detectLandmarks({
  editionId,
  imageBytes,
  mimeType,
  sourceImageBytes = imageBytes,
  artDirection,
  detector,
  createdAt = new Date(),
}: {
  editionId: string;
  imageBytes: Buffer;
  mimeType: string;
  sourceImageBytes?: Buffer;
  artDirection: ArtDirection;
  detector: LandmarkDetector;
  createdAt?: Date;
}): Promise<LandmarkArtifact> {
  const metadata = await sharp(sourceImageBytes).metadata();
  const analysisMetadata = await sharp(imageBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Unable to read source-image dimensions");
  if (!analysisMetadata.width || !analysisMetadata.height) {
    throw new Error("Unable to read analysis-image dimensions");
  }
  if (metadata.width !== metadata.height * 2) {
    throw new Error(`Landmark detection requires an exact 2:1 equirectangular image; received ${metadata.width}x${metadata.height}`);
  }

  const result = await detector.detect({ imageBytes, mimeType, artDirection });
  const expectedIds = new Set(artDirection.subjects.map((subject) => subject.storyId));
  const returnedIds = result.landmarks.map((landmark) => landmark.storyId);
  if (new Set(returnedIds).size !== returnedIds.length) {
    throw new Error("Landmark provider returned duplicate story ids");
  }
  const missing = [...expectedIds].filter((id) => !returnedIds.includes(id));
  const unexpected = returnedIds.filter((id) => !expectedIds.has(id));
  if (missing.length || unexpected.length) {
    throw new Error(`Landmark response did not match requested stories; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
  }
  const acceptedContextStoryIds = new Set<string>();
  const acceptedContextMarkers = [...result.contextMarkers]
    .sort((first, second) => second.confidence - first.confidence)
    .filter((marker) => {
      if (!expectedIds.has(marker.storyId) || acceptedContextStoryIds.has(marker.storyId)) return false;
      if (result.landmarks.some((landmark) =>
        boxesOverlap(marker.boundingBox, landmark.boundingBox) ||
        panoramaDistance(marker.target, landmark.target) < 0.035
      )) return false;
      acceptedContextStoryIds.add(marker.storyId);
      return true;
    });

  return landmarkArtifactSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "landmark-detections",
    editionId,
    createdAt: createdAt.toISOString(),
    sourceImage: {
      sha256: createHash("sha256").update(sourceImageBytes).digest("hex"),
      width: metadata.width,
      height: metadata.height,
      projection: "equirectangular",
    },
    analysisImage: {
      sha256: createHash("sha256").update(imageBytes).digest("hex"),
      width: analysisMetadata.width,
      height: analysisMetadata.height,
      mediaType: mimeType,
    },
    provider: { id: detector.id, model: detector.model },
    landmarks: result.landmarks,
    contextMarkers: acceptedContextMarkers.map((marker) => ({
      ...marker,
      id: `${marker.storyId}-echo`,
    })),
  });
}
