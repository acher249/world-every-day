import type { ArtDirection } from "../art-direction/schema.js";

export function buildLandmarkDetectionPrompt(artDirection: ArtDirection): string {
  const subjects = artDirection.subjects.map((subject) => ({
    storyId: subject.storyId,
    subject: subject.subject,
    placement: subject.placement,
    visualCues: subject.visualCues,
  }));

  return [
    "Analyze the attached 2:1 equirectangular panorama.",
    "Locate each requested physical landmark. Coordinates must be normalized from 0 to 1 over the complete uncropped image, with the origin at its top-left corner.",
    "For each storyId, return one tight bounding box and one target point on a solid, visually central surface suitable for casting a ray into a reconstructed 3D Gaussian-splat scene.",
    "Do not target sky, water reflections, shadows, gaps, labels, or empty space. Mark a landmark not-found rather than guessing.",
    `Requested landmarks: ${JSON.stringify(subjects)}`,
  ].join("\n\n");
}
