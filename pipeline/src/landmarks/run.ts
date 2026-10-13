import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ArtDirection } from "../art-direction/schema.js";
import type { LandmarkDetector } from "./provider.js";
import { landmarkArtifactSchema, type LandmarkArtifact } from "./schema.js";

export async function detectLandmarks({
  editionId,
  imageBytes,
  mimeType,
  artDirection,
  detector,
  createdAt = new Date(),
}: {
  editionId: string;
  imageBytes: Buffer;
  mimeType: string;
  artDirection: ArtDirection;
  detector: LandmarkDetector;
  createdAt?: Date;
}): Promise<LandmarkArtifact> {
  const metadata = await sharp(imageBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Unable to read source-image dimensions");
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

  return landmarkArtifactSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "landmark-detections",
    editionId,
    createdAt: createdAt.toISOString(),
    sourceImage: {
      sha256: createHash("sha256").update(imageBytes).digest("hex"),
      width: metadata.width,
      height: metadata.height,
      projection: "equirectangular",
    },
    provider: { id: detector.id, model: detector.model },
    landmarks: result.landmarks,
  });
}
