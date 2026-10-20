import assert from "node:assert/strict";
import { test } from "node:test";
import { withFocusSplatShader } from "../lib/splat-focus-shader";

const sparkAnchors = `uniform float focalAdjustment;
vec3 viewCenter = (!enableCovSplats ? quatVec(renderToViewQuat, center) : (renderToViewBasis * center)) + renderToViewPos;
float scale2 = min(maxPixelRadius, adjustedStdDev * sqrt(eigen2));`;

test("focus shader retains Spark's base rendering and adds circular falloff", () => {
  const shader = withFocusSplatShader(sparkAnchors);
  assert.ok(shader);
  assert.match(shader, /smoothstep\(0\.72, 1\.32, focusDistance\)/);
  assert.match(shader, /float dotRadius = focusDotRadius/);
  assert.match(shader, /scale1 = mix\(scale1, dotRadius, focusFalloff\)/);
  assert.match(shader, /scale2 = mix\(scale2, dotRadius, focusFalloff\)/);
  assert.match(shader, /vRgba\.a \*= mix\(1\.0, focusOutsideOpacity, focusFalloff\)/);
  assert.match(shader, /focusWaveAmplitude \* focusFalloff/);
  assert.match(shader, /viewCenter \+= \(viewMatrix \* vec4\(waveOffset, 0\.0\)\)\.xyz/);
});

test("unknown Spark shader layouts do not get a partial injection", () => {
  assert.equal(withFocusSplatShader("void main() {}"), null);
});
