import type { LandmarkArtifact } from "../landmarks/schema.js";
import { interactionManifestSchema, type InteractionAnchor, type InteractionManifest } from "./schema.js";

export interface InteractionBaker {
  readonly method: InteractionManifest["method"];
  bake(input: {
    landmarks: LandmarkArtifact;
    sourceSplatPath: string;
    sourceSplatSha256: string;
  }): Promise<InteractionAnchor[]>;
}

export async function createInteractionManifest({
  baker,
  createdAt = new Date(),
  landmarks,
  sourceSplatPath,
  sourceSplatSha256,
}: {
  baker: InteractionBaker;
  createdAt?: Date;
  landmarks: LandmarkArtifact;
  sourceSplatPath: string;
  sourceSplatSha256: string;
}): Promise<InteractionManifest> {
  const anchors = await baker.bake({ landmarks, sourceSplatPath, sourceSplatSha256 });
  const expectedIds = new Set([
    ...landmarks.landmarks.map(({ storyId }) => storyId),
    ...landmarks.contextMarkers.map(({ id }) => id),
  ]);
  const anchorIds = new Set(anchors.map(({ id }) => id));
  const missing = [...expectedIds].filter((id) => !anchorIds.has(id));
  const unexpected = [...anchorIds].filter((id) => !expectedIds.has(id));
  if (missing.length || unexpected.length || anchorIds.size !== anchors.length) {
    throw new Error(
      `Interaction anchors do not match landmarks; missing=${missing.join(",") || "none"}; ` +
      `unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  return interactionManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "interaction-manifest",
    editionId: landmarks.editionId,
    createdAt: createdAt.toISOString(),
    method: baker.method,
    sourceImageSha256: landmarks.sourceImage.sha256,
    sourceSplatSha256,
    anchors,
  });
}

export class MockInteractionBaker implements InteractionBaker {
  readonly method = "manual" as const;

  async bake({ landmarks }: {
    landmarks: LandmarkArtifact;
    sourceSplatPath: string;
    sourceSplatSha256: string;
  }): Promise<InteractionAnchor[]> {
    const targets = [
      ...landmarks.landmarks.map((landmark) => ({ id: landmark.storyId, target: landmark.target })),
      ...landmarks.contextMarkers.map((marker) => ({ id: marker.id, target: marker.target })),
    ];
    return targets.map(({ id, target }) => {
      const longitude = (target.x - 0.5) * Math.PI * 2;
      const latitude = (0.5 - target.y) * Math.PI;
      const latitudeRadius = Math.cos(latitude);
      return {
        id,
        imageTarget: target,
        worldPosition: {
          x: Math.sin(longitude) * latitudeRadius * 4,
          y: Math.sin(latitude) * 4,
          z: -Math.cos(longitude) * latitudeRadius * 4,
        },
      };
    });
  }
}

