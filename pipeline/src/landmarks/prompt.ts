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
    "Also return zero to eight contextMarkers, with at most one per story. A context marker is a clearly visible secondary environmental detail that helps explain why the world looks this way, such as terrain, a material, a trail, or an ecosystem feature drawn from that story's supplied visual cues.",
    "Inspect the entire panorama methodically for these secondary traces, including environmental features that surround or connect the primary subjects. Aim for six to eight context markers across different stories when the image and supplied visual cues support them. Look beyond the most obvious foreground objects before returning fewer than six; use an empty array only when no distinct connection is defensible.",
    "Each context marker needs a short label, a concise explanation of its connection to the story, a tight bounding box, a target on a solid surface, and confidence. Never invent a connection. Omit a marker when the connection is weak or the feature is unclear.",
    "Context markers must be distinct from every primary landmark: never place one inside or immediately beside any primary bounding box, and do not reuse the primary subject under another name.",
    "Return only one JSON object with this exact shape: {\"landmarks\":[{\"storyId\":\"...\",\"label\":\"...\",\"boundingBox\":{\"xMin\":0,\"yMin\":0,\"xMax\":1,\"yMax\":1},\"target\":{\"x\":0.5,\"y\":0.5},\"confidence\":0.9,\"visibility\":\"clear\"}],\"contextMarkers\":[{\"storyId\":\"...\",\"label\":\"...\",\"explanation\":\"...\",\"boundingBox\":{\"xMin\":0,\"yMin\":0,\"xMax\":1,\"yMax\":1},\"target\":{\"x\":0.5,\"y\":0.5},\"confidence\":0.9}]}. Always include contextMarkers, using an empty array when no secondary feature qualifies.",
    `Requested landmarks: ${JSON.stringify(subjects)}`,
  ].join("\n\n");
}
