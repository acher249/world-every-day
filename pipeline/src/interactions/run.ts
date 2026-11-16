import type { LandmarkArtifact } from "../landmarks/schema.js";
import { interactionAnchorSchema, interactionManifestSchema, type InteractionAnchor, type InteractionBakeResult, type InteractionManifest } from "./schema.js";

export interface InteractionBaker {
  readonly algorithmVersion?: string;
  readonly method: InteractionManifest["method"];
  bake(input: {
    landmarks: LandmarkArtifact;
    sourceSplatPath: string;
    sourceSplatSha256: string;
  }): Promise<InteractionBakeResult[]>;
}

/** Remove unlocated stories before raycasting; their details remain in the private landmark artifact. */
export function renderableLandmarkArtifact(landmarks: LandmarkArtifact): LandmarkArtifact {
  const located = landmarks.landmarks.filter(({ visibility }) => visibility !== "not-found");
  if (located.length === 0) {
    throw new Error("No story landmarks were found; refusing to create a zero-story world");
  }
  const storyIds = new Set(located.map(({ storyId }) => storyId));
  return {
    ...landmarks,
    landmarks: located,
    contextMarkers: landmarks.contextMarkers.filter(({ storyId }) => storyIds.has(storyId)),
  };
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
  const renderableLandmarks = renderableLandmarkArtifact(landmarks);
  const results = await baker.bake({ landmarks: renderableLandmarks, sourceSplatPath, sourceSplatSha256 });
  const expectedIds = new Set([
    ...renderableLandmarks.landmarks.map(({ storyId }) => storyId),
    ...renderableLandmarks.contextMarkers.map(({ id }) => id),
  ]);
  const resultIds = new Set(results.map(({ id }) => id));
  const missingResults = [...expectedIds].filter((id) => !resultIds.has(id));
  const unexpected = [...resultIds].filter((id) => !expectedIds.has(id));
  if (missingResults.length || unexpected.length || resultIds.size !== results.length) {
    throw new Error(
      `Interaction bake results do not match landmarks; missing=${missingResults.join(",") || "none"}; ` +
      `unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  const storyIds = new Set(renderableLandmarks.landmarks.map(({ storyId }) => storyId));
  const missedStoryIds = new Set(results
    .filter(({ id, worldPosition }) => storyIds.has(id) && worldPosition === null)
    .map(({ id }) => id));
  const locatedStoryIds = [...storyIds].filter((id) => {
    const result = results.find((item) => item.id === id);
    return result?.worldPosition !== null && result?.worldPosition !== undefined;
  });
  if (locatedStoryIds.length === 0) {
    throw new Error("No selected stories have a supported 3D surface; refusing to create a zero-story world");
  }

  const echoStoryById = new Map(renderableLandmarks.contextMarkers.map(({ id, storyId }) => [id, storyId]));
  const anchors = interactionAnchorSchema.array().parse(results
    .filter((result) => result.worldPosition !== null)
    .filter((result) => {
      const storyId = echoStoryById.get(result.id);
      return storyId === undefined || !missedStoryIds.has(storyId);
    }));

  return interactionManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "interaction-manifest",
    editionId: landmarks.editionId,
    createdAt: createdAt.toISOString(),
    method: baker.method,
    algorithmVersion: baker.algorithmVersion,
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
      ...landmarks.landmarks.filter(({ visibility }) => visibility !== "not-found")
        .map((landmark) => ({ id: landmark.storyId, target: landmark.target })),
      ...landmarks.contextMarkers.filter((marker) =>
        landmarks.landmarks.some(({ storyId, visibility }) => storyId === marker.storyId && visibility !== "not-found"),
      ).map((marker) => ({ id: marker.id, target: marker.target })),
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

