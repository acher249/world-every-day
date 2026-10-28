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
  claimAttempt,
}: {
  editionId: string;
  imageBytes: Buffer;
  mimeType: string;
  sourceImageBytes?: Buffer;
  artDirection: ArtDirection;
  detector: LandmarkDetector;
  createdAt?: Date;
  claimAttempt?: (attempt: number) => Promise<boolean>;
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

  const expectedIds = new Set(artDirection.subjects.map((subject) => subject.storyId));
  let result: Awaited<ReturnType<LandmarkDetector["detect"]>> | undefined;
  let degradedResult: Awaited<ReturnType<LandmarkDetector["detect"]>> | undefined;
  let retryInstructions: string | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (claimAttempt && !(await claimAttempt(attempt))) continue;
    try {
      const response = await detector.detect({ imageBytes, mimeType, artDirection, retryInstructions });
      const returnedIds = response.landmarks.map((landmark) => landmark.storyId);
      if (new Set(returnedIds).size !== returnedIds.length) {
        throw new Error("Landmark provider returned duplicate story ids");
      }
      const missing = [...expectedIds].filter((id) => !returnedIds.includes(id));
      const unexpected = returnedIds.filter((id) => !expectedIds.has(id));
      if (missing.length || unexpected.length) {
        throw new Error(`Landmark response did not match requested stories; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
      }
      const notFound = response.landmarks.filter(({ visibility }) => visibility === "not-found");
      if (notFound.length) {
        degradedResult = response;
        const labels = notFound.map(({ storyId }) => {
          const subject = artDirection.subjects.find(({ storyId: id }) => id === storyId);
          return `${storyId}${subject ? ` (${subject.subject})` : ""}`;
        });
        throw new Error(`Requested subjects were marked not-found: ${labels.join(", ")}. Re-scan the entire panorama, checking the supplied subject descriptions and visual cues. Do not infer absence from a difficult viewpoint; return a tight box and visible surface target if any matching object is present. Use not-found only after checking the full image.`);
      }
      result = response;
      break;
    } catch (error) {
      lastError = error;
      retryInstructions = error instanceof Error ? error.message.slice(0, 1_000) : "The previous response failed validation.";
      if (attempt < 3) {
        console.warn(JSON.stringify({ event: "landmark-detection-retry", attempt, reason: retryInstructions }));
      }
    }
  }
  result ??= degradedResult;
  if (!result) throw lastError instanceof Error ? lastError : new Error("No valid landmark response after three attempts");
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
