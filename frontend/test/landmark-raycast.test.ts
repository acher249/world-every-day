import assert from "node:assert/strict";
import test from "node:test";
import { landmarkRayTargets, landmarkExclusionBounds, selectLandmarkSurface } from "../lib/landmark-raycast";
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

test("a foreground pillar inside a lake's box cannot steal the lake hotspot", () => {
  const lake = { xMin: 0.758, yMin: 0.564, xMax: 0.957, yMax: 0.748 };
  const pillar = { xMin: 0.724, yMin: 0.605, xMax: 0.806, yMax: 0.835 };
  const lakeTarget = { x: 0.871, y: 0.638 };
  const wrong = [sample(0.774, 0.617, 0.48), sample(0.774, 0.656, 0.47), sample(0.774, 0.695, 0.5)];
  const correct = [sample(0.858, 0.617, 3), sample(0.858, 0.656, 3.1), sample(0.9, 0.656, 3.2)];
  assert.ok(correct.includes(selectLandmarkSurface([...wrong, ...correct], lakeTarget, lake)!));
  assert.ok(correct.includes(selectLandmarkSurface([...wrong, ...correct], lakeTarget, lake, [pillar])!));
  assert.ok(landmarkRayTargets(lakeTarget, lake, [pillar]).every((point) => point.x > pillar.xMax || point.y < pillar.yMin));
});

test("fully occluded regions fail instead of placing two stories on the same subject", () => {
  const hits = [sample(0.29, 0.5, 1), sample(0.5, 0.5, 1), sample(0.71, 0.5, 1)];
  assert.equal(selectLandmarkSurface(hits, target, bounds, [bounds]), null);
  assert.deepEqual(landmarkRayTargets(target, bounds, [bounds]), []);
});

test("echoes share their parent region without masking a primary story", () => {
  const story = { id: "story", ...target, boundingBox: bounds };
  const other = { ...story, id: "other", boundingBox: { xMin: 0.8, yMin: 0.8, xMax: 1, yMax: 1 } };
  const echo = { ...story, id: "echo", storyId: story.id };
  const all = [story, other, echo];
  assert.deepEqual(landmarkExclusionBounds(story, all), [other.boundingBox]);
  assert.deepEqual(landmarkExclusionBounds(echo, all), [other.boundingBox]);
});

 test("a nearby bench cannot steal a supported dock target", () => {
  const bench = [sample(0.71, 0.92, 1), sample(0.5, 0.92, 1), sample(0.29, 0.92, 1)];
  const dock = [sample(0.29, 0.5, 3), sample(0.5, 0.5, 3), sample(0.71, 0.5, 3)];
  assert.equal(selectLandmarkSurface([...bench, ...dock], target, bounds), dock[1]);
});
