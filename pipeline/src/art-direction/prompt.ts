import type { ArtDirection } from "./schema.js";

function sentenceList(items: string[]): string {
  return items.map((item) => item.replace(/[.]+$/, "")).join("; ");
}

export function buildScenePrompt(artDirection: ArtDirection): string {
  const subjects = artDirection.subjects
    .map(
      (item) =>
        `- ${item.role.toUpperCase()} · ${item.subject}. Place it ${item.placement}. ` +
        `Scale: ${item.scale}. Materials: ${item.materials.join(", ")}. ` +
        `Visual cues: ${sentenceList(item.visualCues)}.`,
    )
    .join("\n");

  return `Create “${artDirection.world.title},” a playful, diagrammatic world that reads as one coherent physical place rather than a collage or infographic.

World concept: ${artDirection.world.concept}
Setting: ${artDirection.world.setting}
Time and light: ${artDirection.world.timeOfDay}
Atmosphere: ${artDirection.world.atmosphere}
Palette: ${artDirection.world.palette.join(", ")}
Navigation: ${artDirection.world.navigation}

Story subjects and spatial roles:
${subjects}

Required qualities: ${sentenceList(artDirection.constraints.required)}.
Avoid: ${sentenceList(artDirection.constraints.prohibited)}.`;
}
