import type { PublicationStory } from "./publication-schema";

/** A companion shares its landmark's baked anchor, not a second inferred location. */
export function landmarkCompanion(story: PublicationStory, index: number) {
  return {
    kind: "echo" as const,
    id: `companion:${story.id}`,
    focusStoryId: story.id,
    storyId: story.id,
    label: story.representation,
    explanation: story.representationExplanation ?? `An artistic interpretation of this story: ${story.summary}`,
    storyNumber: String(index + 1).padStart(2, "0"),
    storyTitle: story.title,
    fallbackScreenPosition: story.interaction.imageTarget,
    worldPosition: story.interaction.worldPosition,
  };
}

export function companionOffset(screenX: number): number {
  return screenX > 70 ? -62 : 62;
}

export function canRenderWorldInteractions({
  interactionSplatSha256,
  renderedSplatSha256,
  splatUrl,
}: {
  interactionSplatSha256: string;
  renderedSplatSha256?: string;
  splatUrl?: string;
}): boolean {
  if (!splatUrl) return true;
  return renderedSplatSha256 === interactionSplatSha256;
}
