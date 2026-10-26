const PROJECTION_INSTRUCTIONS = `
CRITICAL: CENTER THE GEOMETRIC HORIZON VERTICALLY AT 50% OF IMAGE HEIGHT.
Keep the camera level with zero pitch and roll. Check the pixel position of
visible distant level horizons against the middle row, y = image height / 2.
Mountains, buildings, and varied terrain may extend above that row; their
skyline is not the geometric horizon. Do not flatten terrain or invent a
visible horizon where it is obscured.

Projection and camera geometry are strict requirements. Create a monoscopic
full-sphere equirectangular panorama covering 360 degrees of longitude and 180
degrees of latitude from one fixed optical center. Use a latitude-longitude
projection, not a conventional wide-angle landscape photograph.

Place the optical center approximately 1.7 meters above the local walking
surface, like a standing visitor, with exactly zero pitch and zero roll. Keep an
open, traversable orientation zone around the camera. Inside roughly 6 meters,
show only continuous ground, low planting, water, or circulation surfaces; no
primary landmark, pedestal, display, or tall obstruction may occupy this zone.
The optical axis must be level.
Place the geometric horizon on a straight
horizontal line at exactly 50% of the image height. Do not use a high,
overlooking, aerial, elevated, or downward-looking viewpoint. Do not place the
horizon on a rule-of-thirds line. The upper half of the spherical panorama is
the sky hemisphere and the lower half is the ground hemisphere.

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

Keep the recognizable mass of each interactive landmark in the equatorial
viewing band, roughly 35% to 65% of image height. Ground each object naturally
below the horizon while allowing its silhouette to cross the horizon. Avoid
placing story subjects near the zenith, nadir, directly overhead, or far below
the viewer. The initial forward direction should reveal only part of the world;
the complete edition must require looking left, right, and behind.

The left and right boundaries represent the same meridian and must join
continuously when wrapped.

Place the complete 2:1 spherical panorama inside the center of the requested
16:9 frame. Reserve the extra height as disposable polar overscan, split evenly
above the zenith and below the nadir. The centered 2:1 crop must retain the full
sphere. Make the zenith and nadir converge coherently, and keep prominent
landmarks away from the longitude boundary.
Keep strong lines away from the exact poles. The surface supporting the camera
must continue naturally beneath it at the nadir, not taper toward a distant
vanishing point. Both poles are directions immediately above and below the same
camera. Put the wrap meridian through simple background, without duplicated or
mirrored subjects, panels, stitched bands, or horizontal overscan.

Return only the panoramic image. Do not create a conventional wide-angle photo,
fisheye circle, frame, border, split panel, duplicated landmark, visible seam,
text, logo, watermark, toy-like miniature, or flat illustration. Before
returning the image, verify again that the
camera is at standing eye height, the horizon is exactly at the vertical
midpoint, the central orientation zone remains open, and the landmarks form an
evenly paced sequence around the full sphere rather than a cluster.
`.trim();

export function buildPanoramaPrompt(scenePrompt: string): string {
  const scene = scenePrompt.trim();
  if (!scene) throw new Error("A non-empty scene prompt is required");
  return `${PROJECTION_INSTRUCTIONS}\n\nScene content:\n${scene}\n\nThe projection and level-horizon requirements above override any conflicting composition language in the scene content.\n\nCRITICAL: CHECK YOUR WORK BEFORE RETURNING THE IMAGE. Inspect the pixel positions: the geometric horizon must align with the horizontal middle row, y = image height / 2, as in a true 2:1 equirectangular panorama. The centered 2:1 crop and the overscan canvas share this same midpoint. Check visible distant level horizons around the full 360-degree view; do not mistake nearby shorelines or mountain ridges for the horizon. If the geometric horizon is clearly too high, too low, or tilted, consider the image a failure and correct it before returning. Preserve varied topography, and do not invent a horizon where it is hidden. Return only the clean panorama, with no guide lines or text.`;
}
