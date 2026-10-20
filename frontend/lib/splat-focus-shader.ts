/** Extend Spark's installed vertex shader without copying its implementation. */
export function withFocusSplatShader(source: string): string | null {
  const uniforms = "uniform float focalAdjustment;";
  const center = "vec3 viewCenter = (!enableCovSplats ? quatVec(renderToViewQuat, center) : (renderToViewBasis * center)) + renderToViewPos;";
  const radius = "float scale2 = min(maxPixelRadius, adjustedStdDev * sqrt(eigen2));";
  if (![uniforms, center, radius].every((anchor) => source.includes(anchor))) return null;

  return source
    .replace(uniforms, `${uniforms}
uniform vec3 focusCenterWorld;
uniform vec3 focusRadii;
uniform float focusStrength;
uniform float focusDotRadius;
uniform float focusOutsideOpacity;
uniform float focusWaveTime;
uniform float focusWaveFrequency;
uniform float focusWaveAmplitude;`)
    .replace(center, `${center}
    vec3 focusCenterView = (viewMatrix * vec4(focusCenterWorld, 1.0)).xyz;
    float focusDistance = length((viewCenter - focusCenterView) / focusRadii);
    float focusFalloff = focusStrength * smoothstep(0.72, 1.32, focusDistance);
    // Broad, slow world-space swells affect only the reduced outer splats.
    if (focusWaveAmplitude > 0.0 && focusFalloff > 0.001) {
      float wavePhase = dot(center.xz, vec2(0.82, 0.57)) * focusWaveFrequency - focusWaveTime * 0.5;
      float swell = sin(wavePhase) + 0.35 * sin(wavePhase * 1.7 + focusWaveTime * 0.12);
      vec3 waveOffset = vec3(0.22 * cos(wavePhase), swell, 0.22 * sin(wavePhase))
        * (focusWaveAmplitude * focusFalloff);
      viewCenter += (viewMatrix * vec4(waveOffset, 0.0)).xyz;
    }`)
    .replace(radius, `${radius}
    // A uniform screen-space radius keeps the distant dots circular and even.
    float dotRadius = focusDotRadius;
    scale1 = mix(scale1, dotRadius, focusFalloff);
    scale2 = mix(scale2, dotRadius, focusFalloff);
    vRgba.a *= mix(1.0, focusOutsideOpacity, focusFalloff);`);
}
