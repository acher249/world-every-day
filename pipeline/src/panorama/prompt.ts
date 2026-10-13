const PROJECTION_INSTRUCTIONS = `
Projection and camera geometry are strict requirements. Create a monoscopic
full-sphere equirectangular panorama covering 360 degrees of longitude and 180
degrees of latitude from one fixed optical center. Use a latitude-longitude
projection, not a conventional wide-angle landscape photograph.

Keep the camera at ground-level eye height with exactly zero pitch and zero
roll. The optical axis must be level. Place the geometric horizon on a straight
horizontal line at exactly 50% of the image height. Do not use a high,
overlooking, aerial, elevated, or downward-looking viewpoint. Do not place the
horizon on a rule-of-thirds line. The upper half of the spherical panorama is
the sky hemisphere and the lower half is the ground hemisphere.

The left and right boundaries represent the same meridian and must join
continuously when wrapped.

Place the complete 2:1 spherical panorama inside the center of the requested
16:9 frame. Reserve the extra height as disposable polar overscan, split evenly
above the zenith and below the nadir. The centered 2:1 crop must retain the full
sphere. Make the zenith and nadir converge coherently, and keep prominent
landmarks away from the longitude boundary.

Return only the panoramic image. Do not create a conventional wide-angle photo,
fisheye circle, frame, border, split panel, duplicated landmark, visible seam,
text, logo, or watermark. Before returning the image, verify again that the
camera is level and the horizon is exactly at the vertical midpoint.
`.trim();

export function buildPanoramaPrompt(scenePrompt: string): string {
  const scene = scenePrompt.trim();
  if (!scene) throw new Error("A non-empty scene prompt is required");
  return `${PROJECTION_INSTRUCTIONS}\n\nScene content:\n${scene}\n\nThe projection and level-horizon requirements above override any conflicting composition language in the scene content.`;
}
