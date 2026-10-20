import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundaryFragmentShader,
  boundaryCircleColumns,
  boundaryCircleRows,
  boundaryLatitudeSegments,
  boundaryLongitudeSegments,
  boundaryOpacity,
} from "../lib/navigation-boundary";

test("navigation boundary stays hidden centrally and fades in near the limit", () => {
  assert.equal(boundaryOpacity(0, 20), 0);
  assert.equal(boundaryOpacity(15, 20), 0);
  assert.ok(boundaryOpacity(18, 20) > 0);
  assert.ok(boundaryOpacity(18, 20) < 1);
  assert.equal(boundaryOpacity(19.6, 20), 1);
  assert.equal(boundaryOpacity(22, 20), 1);
  assert.equal(boundaryOpacity(1, 0), 0);
});

test("boundary pattern tiles circles over the low-poly sphere", () => {
  assert.equal(boundaryCircleColumns, boundaryLongitudeSegments * 7);
  assert.equal(boundaryCircleRows, boundaryLatitudeSegments * 7);
  assert.match(boundaryFragmentShader, new RegExp(`vec2\\(${boundaryCircleColumns}\\.0, ${boundaryCircleRows}\\.0\\)`));
  assert.match(boundaryFragmentShader, /smoothstep\(0\.09, 1\.96, normalizedDistanceSquared\)/);
  assert.match(boundaryFragmentShader, /if \(nearby < 0\.001\) discard/);
  assert.match(boundaryFragmentShader, /circleProximity = 1\.0 - smoothstep\(0\.0036, 0\.25, normalizedDistanceSquared\)/);
  assert.match(boundaryFragmentShader, /circleRadius = mix\(0\.05, 0\.48, circleProximity\)/);
  assert.match(boundaryFragmentShader, /circleDistance/);
  assert.match(boundaryFragmentShader, /grid \* mix\(0\.13, 0\.3, circleProximity\)/);
});
