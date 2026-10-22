import type { ArtDirection } from "../art-direction/schema.js";
import type { SelectedEdition } from "../editorial/edition.js";
import type { InteractionManifest } from "../interactions/schema.js";
import type { LandmarkArtifact } from "../landmarks/schema.js";
import { publicationManifestSchema, type PublicationManifest } from "./schema.js";

function titleCase(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function createPublicationManifest({
  artDirection,
  createdAt = new Date(),
  edition,
  fictional,
  interactions,
  landmarks,
  poster,
  sequence = 1,
  splat = null,
}: {
  artDirection: ArtDirection;
  createdAt?: Date;
  edition: SelectedEdition;
  fictional: boolean;
  interactions: InteractionManifest;
  landmarks: LandmarkArtifact;
  poster: { src: string; width: number; height: number; sha256: string };
  sequence?: number;
  splat?: PublicationManifest["world"]["splat"];
}): PublicationManifest {
  if (
    artDirection.editionId !== edition.editionId ||
    interactions.editionId !== edition.editionId ||
    landmarks.editionId !== edition.editionId
  ) {
    throw new Error("Publication inputs must share one edition id");
  }
  const subjects = new Map(artDirection.subjects.map((subject) => [subject.storyId, subject]));
  const anchors = new Map(interactions.anchors.map((anchor) => [anchor.id, anchor]));
  const detectedLandmarks = new Map(landmarks.landmarks.map((landmark) => [landmark.storyId, landmark]));
  const tones = ["cyan", "amber", "green"] as const;
  const stories = edition.stories.map((story, index) => {
    const subject = subjects.get(story.storyId);
    const anchor = anchors.get(story.storyId);
    const landmark = detectedLandmarks.get(story.storyId);
    if (!subject || !anchor) throw new Error(`Missing publication mapping for ${story.storyId}`);
    return {
      id: story.storyId,
      category: titleCase(story.topic),
      title: story.title,
      summary: story.summary,
      representation: subject.subject,
      ...(subject.grounding ? { representationExplanation: subject.grounding.artisticInterpretation } : {}),
      sources: story.sources,
      interaction: {
        imageTarget: anchor.imageTarget,
        ...(landmark && landmark.visibility !== "not-found" ? { imageBoundingBox: landmark.boundingBox } : {}),
        worldPosition: anchor.worldPosition,
        screenRegion: { ...anchor.imageTarget, tone: tones[index % tones.length] },
      },
    };
  });
  const storyEchoes = landmarks.contextMarkers.map((marker) => {
    const anchor = anchors.get(marker.id);
    if (!anchor) throw new Error(`Missing story echo mapping for ${marker.id}`);
    return {
      id: marker.id,
      storyId: marker.storyId,
      label: marker.label,
      explanation: marker.explanation,
      interaction: {
        imageTarget: anchor.imageTarget,
        worldPosition: anchor.worldPosition,
      },
    };
  });
  const date = edition.editionId.match(/\d{4}-\d{2}-\d{2}/)?.[0];

  return publicationManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "publication-manifest",
    createdAt: createdAt.toISOString(),
    edition: {
      id: edition.editionId,
      slug: edition.editionId,
      sequence,
      status: fictional ? "demonstration" : "staged",
      fictional,
      displayDate: date
        ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeZone: "UTC",
        }).format(new Date(`${date}T12:00:00.000Z`))
        : edition.editionId,
      eyebrow: `${stories.length} ${stories.length === 1 ? "story" : "stories"} · ` +
        `${fictional ? "Demonstration" : "Staged edition"}`,
      title: "A World Every Day",
      description: `${stories.length} ` +
        `${stories.length === 1 ? "development" : "developments"} ` +
        "gathered into one interactive world.",
    },
    world: {
      interactionMapping: {
        bakedAt: interactions.createdAt,
        coordinateSystem: "world-space",
        method: interactions.method,
        sourceSplatSha256: interactions.sourceSplatSha256,
      },
      poster: {
        ...poster,
        alt: `The generated panorama for ${edition.editionId}`,
      },
      splat,
    },
    stories,
    storyEchoes,
  });
}

