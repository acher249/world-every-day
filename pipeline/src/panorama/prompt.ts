const PROJECTION_INSTRUCTIONS = `
Create a monoscopic full-sphere equirectangular panorama covering 360 degrees of
longitude and 180 degrees of latitude from one fixed optical center. Use a
latitude-longitude projection with a level horizon at the vertical midpoint.
The left and right boundaries represent the same meridian and must join
continuously when wrapped.

Place the complete 2:1 spherical panorama inside the center of the requested
16:9 frame. Reserve the extra height as disposable polar overscan, split evenly
above the zenith and below the nadir. The centered 2:1 crop must retain the full
sphere. Make the zenith and nadir converge coherently, and keep prominent
landmarks away from the longitude boundary.

Return only the panoramic image. Do not create a conventional wide-angle photo,
fisheye circle, frame, border, split panel, duplicated landmark, visible seam,
text, logo, or watermark.
`.trim();

export function buildPanoramaPrompt(scenePrompt: string): string {
  const scene = scenePrompt.trim();
  if (!scene) throw new Error("A non-empty scene prompt is required");
  return `${scene}\n\n${PROJECTION_INSTRUCTIONS}`;
}
