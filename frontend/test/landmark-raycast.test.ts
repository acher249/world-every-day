import assert from "node:assert/strict";
import test from "node:test";
import { landmarkRayTargets, selectLandmarkSurface } from "../lib/landmark-raycast";
const bounds = { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };
const target = { x: 0.5, y: 0.5 };
const sample = (x: number, y: number, distance: number) => ({ imageTarget: { x, y }, distance, point: { x, y, z: -distance } });

test("landmark rays sample the full box without duplicating the center", () => {
  assert.equal(landmarkRayTargets(target, bounds).length, 25);
  assert.equal(landmarkRayTargets({ x: 0.4, y: 0.4 }, bounds).length, 26);
  assert.deepEqual(landmarkRayTargets(target), [target]);
});
test("a center ray through a hole loses to a supported nearby frame", () => {
  const frame = [sample(0.08, 0.29, 10), sample(0.08, 0.5, 11), sample(0.08, 0.71, 10.5)];
  const chosen = selectLandmarkSurface([sample(0.5, 0.5, 80), ...frame], target, bounds);
  assert.ok(chosen && frame.includes(chosen));
});
test("isolated foreground floaters do not outrank supported geometry", () => {
  const surface = [sample(0.29, 0.5, 10), sample(0.5, 0.5, 10), sample(0.71, 0.5, 10)];
  assert.equal(selectLandmarkSurface([sample(0.08, 0.08, 1), ...surface], target, bounds), surface[1]);
});
test("unreliable or missing bounded hits fail instead of inventing an anchor", () => {
  assert.equal(selectLandmarkSurface([sample(0.5, 0.5, 80)], target, bounds), null);
  assert.equal(selectLandmarkSurface([], target, bounds), null);
  assert.equal(selectLandmarkSurface([sample(0.5, 0.5, NaN)], target, bounds), null);
});
