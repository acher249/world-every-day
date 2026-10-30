/** Extend Spark's installed vertex shader without copying its implementation. */
export function withFocusSplatShader(source: string): string | null {
  const uniforms = "uniform float focalAdjustment;";
  const center = "vec3 viewCenter = (!enableCovSplats ? quatVec(renderToViewQuat, center) : (renderToViewBasis * center)) + renderToViewPos;";
  const radius = "float scale2 = min(maxPixelRadius, adjustedStdDev * sqrt(eigen2));";
  if (![uniforms, center, radius].every((anchor) => source.includes(anchor))) return null;

  return source
    .replace(uniforms, `${uniforms}
uniform vec3 focusCenterView;
uniform vec3 focusInverseRadii;
uniform float focusSweep;
uniform float focusStrength;
uniform float focusOutsideBrightness;
uniform float focusWaveTime;
uniform float focusWaveFrequency;
uniform float focusWaveAmplitude;
float focusBlobFalloff(vec3 point) {
  float distanceFromCenter = length(point);
  // Distort only the feathered boundary; avoid noise textures and extra passes.
  if (distanceFromCenter > 0.25 && distanceFromCenter < 2.1) {
    float phase = focusWaveTime * 0.32;
    float wobble = 0.115 * sin(point.x * 2.3 + point.y * 1.4 + phase)
      + 0.075 * sin(point.y * 2.7 - point.x * 1.1 - phase * 0.7);
    distanceFromCenter /= 1.0 + wobble;
  }
  return smoothstep(0.48, 1.4, distanceFromCenter);
}`)
    .replace(center, `${center}
    float focusFalloff = 0.0;
    // Uniform branch: the whole draw skips focus work when the effect is idle.
    if (focusStrength > 0.0) {
      float spatialFalloff = focusBlobFalloff((viewCenter - focusCenterView) * focusInverseRadii);
      // Travel uses a tighter aperture, capped in angular size so a large
      // landmark cannot expand the sweep across most of the view.
      if (focusSweep > 0.0 && viewCenter.z < -0.01 && focusCenterView.z < -0.01) {
        vec2 projectedOffset = viewCenter.xy * (focusCenterView.z / viewCenter.z) - focusCenterView.xy;
        vec2 sweepInverseRadii = max(focusInverseRadii.xy / 0.85,
          vec2(1.0) / (-focusCenterView.z * vec2(0.34, 0.28)));
        float apertureFalloff = focusBlobFalloff(vec3(projectedOffset * sweepInverseRadii, 0.0));
        // Replace, rather than union with, the broad spatial bubble during travel.
        spatialFalloff = mix(spatialFalloff, apertureFalloff, focusSweep);
      }
      focusFalloff = focusStrength * spatialFalloff;
    }
    // Broad, slow world-space swells affect only the dimmed outer splats.
    if (focusWaveAmplitude > 0.0 && focusFalloff > 0.001) {
      float wavePhase = dot(center.xz, vec2(0.82, 0.57)) * focusWaveFrequency - focusWaveTime * 0.5;
      float waveSin = sin(wavePhase);
      float swell = waveSin + 0.35 * sin(wavePhase * 1.7 + focusWaveTime * 0.12);
      vec3 waveOffset = vec3(0.22 * cos(wavePhase), swell, 0.22 * waveSin)
        * (focusWaveAmplitude * focusFalloff);
      viewCenter += (viewMatrix * vec4(waveOffset, 0.0)).xyz;
    }`)
    .replace(radius, `${radius}
    // Preserve size, anisotropy and opacity; dim color without creating holes.
    if (focusStrength > 0.0) {
      vRgba.rgb *= mix(1.0, focusOutsideBrightness, focusFalloff);
    }`);
}
