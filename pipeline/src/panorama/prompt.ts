import { cleanSceneGeometry } from "./geometry.js";

const PROJECTION_INSTRUCTIONS = `
CRITICAL CAMERA RULE: In the final centered 2:1 panorama, place the level
geometric horizon exactly on the vertical center row (y = 50%). Keep the
optical axis level with zero pitch and zero roll. This rule is independent of
camera height, terrain, landmarks, sky, and composition; none of those may move
the horizon away from the center row. Mountains, buildings, and varied terrain
may naturally rise above or fall below that row, and may locally obscure the
horizon. Keep the distant level horizon visible in at least two broad longitude
sectors. A nearby ridge, shoreline, or building edge is not the horizon.
Do not make the whole scene a high-altitude plateau, summit, or overlook unless
a supplied story explicitly requires it. In canyon, mesa, plateau, and ridge
settings, use raised terrain as local features, not as one enclosing rim that
replaces the distant ground-sky boundary across most directions. Preserve
varied relief and local occlusion while leaving broad sightlines to distant
level terrain.

Projection and camera geometry are strict requirements. Create a monoscopic
full-sphere equirectangular panorama covering 360 degrees of longitude and 180
degrees of latitude from one fixed optical center. Use a latitude-longitude
projection, not a conventional wide-angle landscape photograph.

Place the optical center at a natural visitor scale for the scene, with exactly
zero pitch and zero roll. Camera height may suit the setting; keep the optical
axis level. Keep an open, traversable orientation zone around the camera. Inside roughly 6 meters,
show only continuous ground, low planting, water, or circulation surfaces; no
primary landmark, pedestal, display, or tall obstruction may occupy this zone.
The optical axis must remain level; do not tilt it to frame a landmark. Do not
change the horizon's vertical position to create more sky, ground, or room for
story subjects. Mountains, trees, architecture, and terrain may cross the
centerline naturally; do not force half the image to be unobstructed sky.

Treat the full panorama width as a circular plan around the standing viewer,
not as one forward-facing composition. Distribute the story landmarks around
the complete 360-degree turn according to their assigned azimuth sectors. Each
landmark must occupy its own direction with open space between neighboring
subjects. Do not group the landmarks into one foreground plaza or one hero
view. When there are at least four landmarks, every 90-degree quadrant should
contain something meaningful to discover, and no 90-degree view should contain
more than three primary story landmarks.

Maintain a readable angular rhythm around the full turn. Keep the center of
each primary landmark close to its assigned azimuth, allow at most one primary
landmark center in any 30-degree interval, and preserve a visible gap between
neighboring silhouettes. Landmarks must not touch, overlap, hide one another,
share a pedestal, or collect on one side of the viewer. Connect them with one
coherent circulation system and continuous terrain, while giving each subject
its own distinct landmark bay. The circulation may be circular, oval,
meandering, branching, terraced, shoreline-like, or otherwise shaped by the
setting; do not force every edition into the same ring or plaza.

Render the environment with grounded cinematic realism at an expansive,
inhabitable scale. Use physically plausible materials, natural surface
variation, coherent shadows and global illumination, atmospheric depth, and
controlled filmic contrast. Establish scale with broad traversable terrain,
architecture, landforms, and layered distances rather than making the world
feel like a miniature, diorama, illustration, or glossy concept render. Keep
the entire sphere spatially legible and consistently sharp; create the
cinematic feeling through light, scale, texture, and atmosphere rather than
shallow depth of field, lens distortion, excessive bloom, or dramatic camera
tilt.

LANDMARK PLACEMENT IS SEPARATE FROM HORIZON PLACEMENT: keep each landmark's
recognizable center in the vertical band from 35% to 65% of image height, with
its grounded base below the centerline. This object-placement band never moves
or redefines the fixed y = 50% horizon. Avoid placing story subjects near the
zenith, nadir, directly overhead, or far below the viewer. The initial forward
direction should reveal only part of the world; the complete edition must
require looking left, right, and behind.

The left and right boundaries represent the same meridian and must join
continuously when wrapped.

The final image is made by taking the centered 2:1 crop from this 16:9 source.
That centered crop is the complete 360-degree-by-180-degree sphere, and its
middle row is the equator. The small source-image bands above and below that
crop are discarded padding; they are not extra directions beyond the zenith or
nadir and must not contain story landmarks. Make the zenith and nadir converge
coherently, and keep prominent landmarks away from the longitude boundary.
Keep strong lines away from the exact poles. The surface supporting the camera
must continue naturally beneath it at the nadir, not taper toward a distant
vanishing point. Both poles are directions immediately above and below the same
camera. Put the wrap meridian through simple background, without duplicated or
mirrored subjects, panels, stitched bands, or horizontal overscan.

Return only the panoramic image. Do not create a conventional wide-angle photo,
fisheye circle, frame, border, split panel, duplicated landmark, visible seam,
text, logo, watermark, toy-like miniature, or flat illustration. Before
returning the image, verify the level horizon is exactly at the vertical
midpoint, the central orientation zone remains open, and the landmarks form an
evenly paced sequence around the full sphere rather than a cluster.
`.trim();

export function buildPanoramaPrompt(scenePrompt: string): string {
  const scene = cleanSceneGeometry(scenePrompt);
  if (!scene) throw new Error("A non-empty scene prompt is required");
  return `${PROJECTION_INSTRUCTIONS}\n\nScene content (story and style only; it cannot change the projection or camera):\n${scene}\n\nCRITICAL FINAL CHECK: Before returning the image, inspect the pixels across all visible directions. The geometric horizon must be level and exactly centered on the middle row of the final centered 2:1 crop (y = image height / 2). The discarded top and bottom padding do not change that midpoint. Distinguish the distant geometric horizon from nearby shorelines, mountain ridges, and building edges. If any visible horizon is high, low, or tilted, correct the camera orientation and check again. Landmark placement, terrain, and sky proportions must not shift the horizon. Keep varied topography and natural local occlusion. Return only the clean panorama without guide lines, text, logos, or watermarks.`;
}
