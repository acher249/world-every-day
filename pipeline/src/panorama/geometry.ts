/** Scene prose describes content; projection and camera geometry belong only to the renderer prompt. */
const geometryClause = /\b(?:horizon|viewpoint|looking\s+(?:down|up)\s+(?:over|at|across)|camera\s+(?:angle|position|height|pitch|roll|tilt)|(?:aerial|bird['’]s[- ]eye|overhead|downward[- ]looking|upward[- ]looking|elevated)\s+(?:view|perspective|shot)|(?:tilt|pitch|roll)\s+(?:the\s+)?camera|rule[- ]of[- ]thirds)\b/i;

export function cleanSceneGeometry(scene: string): string {
  // Remove complete clauses rather than rewriting source facts or guessing a different camera angle.
  return scene.split(/(?<=[.!?;,])\s+|\n+/u)
    .filter((clause) => !geometryClause.test(clause))
    .join(" ").replace(/[ \t]+/g, " ").trim();
}
