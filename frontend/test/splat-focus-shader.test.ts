import assert from "node:assert/strict";
import { test } from "node:test";
import { withFocusSplatShader } from "../lib/splat-focus-shader";

const sparkAnchors = `uniform float focalAdjustment;
vec3 viewCenter = (!enableCovSplats ? quatVec(renderToViewQuat, center) : (renderToViewBasis * center)) + renderToViewPos;
float scale2 = min(maxPixelRadius, adjustedStdDev * sqrt(eigen2));`;

test("focus shader preserves splat size, shape and opacity with brightness falloff and waves", () => {
  const shader = withFocusSplatShader(sparkAnchors);
  assert.ok(shader);
  assert.match(shader, /if \(focusStrength > 0\.0\)/);
  assert.match(shader, /\(viewCenter - focusCenterView\) \* focusInverseRadii/);
  assert.doesNotMatch(shader, /vec4\(focusCenterWorld/);
  assert.match(shader, /smoothstep\(0\.48, 1\.4, distanceFromCenter\)/);
  assert.match(shader, /distanceFromCenter \/= 1\.0 \+ wobble/);
  assert.doesNotMatch(shader, /focusDotRadius|dotRadius/);
  assert.doesNotMatch(shader, /scale[12] = mix/);
  assert.match(shader, /vRgba\.rgb \*= mix\(1\.0, focusOutsideBrightness, focusFalloff\)/);
  assert.doesNotMatch(shader, /vRgba\.a\s*[*+\/-]?=|focusOutsideOpacity/);
  assert.match(shader, /focusWaveAmplitude \* focusFalloff/);
  assert.match(shader, /viewCenter \+= \(viewMatrix \* vec4\(waveOffset, 0\.0\)\)\.xyz/);
});

test("unknown Spark shader layouts do not get a partial injection", () => {
  assert.equal(withFocusSplatShader("void main() {}"), null);
});

test("camera travel sweeps distant splats at the same projected position without widening resting focus", () => {
  const shader = withFocusSplatShader(sparkAnchors);
  assert.ok(shader);
  assert.match(shader, /uniform float focusSweep/);
  assert.match(shader, /focusSweep > 0\.0 && viewCenter\.z < -0\.01 && focusCenterView\.z < -0\.01/);
  assert.match(shader, /viewCenter\.xy \* \(focusCenterView\.z \/ viewCenter\.z\) - focusCenterView\.xy/);
  assert.match(shader, /focusInverseRadii\.xy \/ 0\.85/);
  assert.match(shader, /vec2\(0\.34, 0\.28\)/);
  assert.match(shader, /mix\(spatialFalloff, apertureFalloff, focusSweep\)/);
  assert.doesNotMatch(shader, /min\(spatialFalloff, apertureFalloff\)/);
});
