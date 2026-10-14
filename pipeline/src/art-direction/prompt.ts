import type { ArtDirection } from "./schema.js";

export type SphericalSubjectPlacement = {
  azimuthDegrees: number;
  distance: string;
  sectorHalfWidthDegrees: number;
};

const roleAzimuths = {
  anchor: [18, 162],
  supporting: [90, 234, 306],
  detail: [54, 126, 198, 270, 342],
} as const;

const roleDistances = {
  anchor: "12 to 18 meters",
  supporting: "9 to 14 meters",
  detail: "7 to 11 meters",
} as const;

export function assignSphericalSubjectPlacements(
  subjects: ArtDirection["subjects"],
): Map<string, SphericalSubjectPlacement> {
  const roleIndexes = { anchor: 0, supporting: 0, detail: 0 };
  return new Map(subjects.map((subject) => {
    const index = roleIndexes[subject.role]++;
    const azimuthDegrees = roleAzimuths[subject.role][index];
    if (azimuthDegrees === undefined) {
      throw new Error(`Too many ${subject.role} subjects for the spherical layout`);
    }
    return [subject.storyId, {
      azimuthDegrees,
      distance: roleDistances[subject.role],
      sectorHalfWidthDegrees: 13,
    }];
  }));
}

function sentenceList(items: string[]): string {
  return items.map((item) => item.replace(/[.]+$/, "")).join("; ");
}

export function buildScenePrompt(artDirection: ArtDirection): string {
  const sphericalPlacements = assignSphericalSubjectPlacements(artDirection.subjects);
  const subjects = artDirection.subjects
    .map((item) => {
      const spherical = sphericalPlacements.get(item.storyId)!;
      const sectorStart = (spherical.azimuthDegrees - spherical.sectorHalfWidthDegrees + 360) % 360;
      const sectorEnd = (spherical.azimuthDegrees + spherical.sectorHalfWidthDegrees) % 360;
      const grounding = item.grounding
        ? `${item.grounding.sourceDetails.length > 0
          ? ` Grounded details: ${sentenceList(item.grounding.sourceDetails)}.`
          : " No source-grounded visual detail was available."} Artistic interpretation: ${sentenceList([item.grounding.artisticInterpretation])}.`
        : "";
      return `- ${item.role.toUpperCase()} · ${item.subject}. ` +
        `Spherical location: azimuth ${spherical.azimuthDegrees}° clockwise from the initial forward direction, ` +
        `inside its own ${sectorStart}°–${sectorEnd}° viewing sector, approximately ${spherical.distance} from the camera. ` +
        `Keep its identifying visual mass within the eye-level interaction band, crossing the horizon with its base below it. ` +
        `Terrain relationship: ${item.placement}. ` +
        `Scale: ${item.scale}. Materials: ${item.materials.join(", ")}. ` +
        `Visual cues: ${sentenceList(item.visualCues)}.${grounding}`;
    })
    .join("\n");

  return `Create “${artDirection.world.title},” an expansive, cinematic, physically grounded world with playful diagrammatic clarity. It must read as one coherent physical place that feels inhabitable rather than a collage, infographic, illustration, or miniature.

World concept: ${artDirection.world.concept}
Setting: ${artDirection.world.setting}
Time and light: ${artDirection.world.timeOfDay}
Atmosphere: ${artDirection.world.atmosphere}
Palette: ${artDirection.world.palette.join(", ")}
Navigation: ${artDirection.world.navigation}

Spherical exploration layout: the camera stands inside a calm, open orientation zone. The numbered azimuth sectors below are authoritative and override flat-image implications in the terrain relationship notes. Treat every sector as an exclusive landmark bay: center that subject near its assigned azimuth, keep its primary silhouette and grounded base inside the sector, and leave a clearly visible interval of low-detail ground, path, vegetation, water, or sky before the next landmark. Do not let neighboring subjects touch, overlap, share a pedestal, occupy the same terrace, or merge into one display cluster. Do not pull subjects toward the initial view. The viewer should need to turn left, right, and behind to discover the full edition. Vary radial distance within the specified bands so the landmarks form a spacious sequence of discoveries rather than a wall or a clump.

Circulation and openness: use the supplied navigation concept as one coherent spatial organizer, but let its geometry suit the setting. It may be a loop, oval, meander, branching path, terraced route, shoreline, boardwalk, or another continuous system. It does not need to be circular. Keep the camera area visually quiet and traversable, preserve clear outward sightlines, and place the story landmarks beyond or alongside the circulation structure in separate bays. The circulation should make the distribution legible without making every edition look like the same plaza.

Visual treatment and scale: use believable environmental scale, physically plausible materials, natural texture variation, atmospheric perspective, coherent cinematic light, and multiple layers of depth. Anchor and supporting landmarks should feel architectural, landscape-scale, or otherwise substantial enough to inhabit and walk around. Preserve the diagrammatic quality through clear spatial organization, strong silhouettes, and readable relationships, not through a cartoon, toy, or diorama aesthetic.

Environmental story echoes: weave six to eight clearly visible secondary traces from different stories into terrain, paths, materials, ecological features, or surrounding structures. Each trace must be grounded in that story's supplied visual cues, visually separate from every primary landmark, and legible as its own small discovery. Do not duplicate a landmark or invent unsupported symbolism. These echoes should enrich the environment without competing with the primary subjects.

Final spatial check: mentally sweep the complete panorama in four 90-degree quadrants before returning it. Confirm that each quadrant contains two or three primary landmarks, that no narrow view is overloaded, that all landmark silhouettes remain individually readable, and that the open orientation zone and circulation system remain continuous.

Story subjects and spatial roles:
${subjects}

Required qualities: ${sentenceList(artDirection.constraints.required)}.
Avoid: ${sentenceList(artDirection.constraints.prohibited)}.`;
}
