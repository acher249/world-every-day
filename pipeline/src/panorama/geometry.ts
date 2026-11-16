/** Scene prose describes content; projection and camera geometry belong only to the renderer prompt. */
const geometryClause = /\b(?:horizon|equator|centerline|midpoint|viewpoint|rule[- ]of[- ]thirds|(?:high|low|raised|lowered|centered|off[- ]center)\s+(?:camera|horizon|view)|(?:camera|horizon)\s+(?:angle|position|height|elevation|pitch|roll|tilt|level|above|below|higher|lower|at)|(?:camera\s+)?(?:pitch|roll|tilt)|looking\s+(?:down|up)\s+(?:(?:over|at|across|from)\s+)?|from\s+(?:directly\s+)?(?:above|below)|(?:aerial|bird['’]s[- ]eye|overhead|downward[- ]looking|upward[- ]looking|elevated)\s+(?:view|perspective|shot|angle)|(?:tilt|pitch|roll)\s+(?:the\s+)?camera|(?:move|place|put|keep|set|raise|lower|center|shift)\s+(?:the\s+)?(?:geometric\s+)?(?:horizon|skyline|equator|camera)|(?:horizon|skyline|equator)\s+(?:is|should\s+be|sits|lies|runs|appears|at))\b/i;

export function cleanSceneGeometry(scene: string): string {
  // Keep comma-separated setting details when only one phrase conflicts with
  // camera geometry; fall back to removing the full sentence for cross-phrase rules.
  return scene.split(/(?<=[.!?;])\s+|\n+/u)
    .flatMap((sentence) => {
      const phrases = sentence.split(/,\s*/u);
      const retained = phrases.filter((phrase) => !geometryClause.test(phrase));
      if (retained.length === phrases.length) return geometryClause.test(sentence) ? [] : [sentence];
      const cleaned = retained
        .map((phrase) => phrase.replace(/^\s*(?:and|or|but)\s+/iu, "").trim())
        .filter(Boolean);
      return cleaned.length ? [cleaned.join(", ")] : [];
    })
    .join(" ").replace(/[ \t]+/g, " ").trim();
}
