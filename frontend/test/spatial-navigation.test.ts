import assert from "node:assert/strict";
import test from "node:test";
import {
  clampToNavigationBounds,
  clampToNavigationSphere,
  cycleId,
  getFocusPosition,
  getNavigationFloor,
  getNavigationRadius,
  smootherstep,
} from "../lib/spatial-navigation";

test("camera focus easing starts and finishes without an abrupt velocity change", () => {
  assert.equal(smootherstep(-1), 0);
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(0.5), 0.5);
  assert.equal(smootherstep(1), 1);
  assert.equal(smootherstep(2), 1);
  assert.ok(smootherstep(0.01) < 0.00002);
  assert.ok(1 - smootherstep(0.99) < 0.00002);
});

test("focus approaches a hotspot along its ray while preserving standoff", () => {
  const target = { x: 3, y: 4, z: 0 };
  const position = getFocusPosition(target, 20);
  const distanceToTarget = Math.hypot(
    target.x - position.x,
    target.y - position.y,
    target.z - position.z,
  );

  assert.ok(Math.abs(position.x / position.y - target.x / target.y) < 0.000001);
  assert.ok(Math.abs(distanceToTarget - 4.5) < 0.000001);
  assert.ok(distanceToTarget < Math.hypot(target.x, target.y, target.z));
});

test("nearby hotspots still keep the minimum camera distance", () => {
  const target = { x: 0.45, y: 0, z: 0 };
  const position = getFocusPosition(target, 5.3703);

  assert.ok(Math.abs(position.x + 2.05) < 0.000001);
  assert.ok(Math.abs(target.x - position.x - 2.5) < 0.000001);
});

test("navigation radius uses the configured spherical limit", () => {
  assert.equal(getNavigationRadius(1_000), 5.3703);
});

test("navigation floor stays below the starting height and scales with small worlds", () => {
  assert.equal(getNavigationFloor(5.3703), -0.25);
  assert.equal(getNavigationFloor(0.5), -0.025);
  assert.ok(Math.abs(getNavigationFloor(5.3703, -0.6367) + 0.2367) < 0.000001);
});

test("navigation clamps movement radially to a sphere", () => {
  const point = clampToNavigationSphere({ x: 4, y: -3, z: 0 }, 0.75);
  assert.ok(Math.abs(point.x - 0.6) < 0.000001);
  assert.ok(Math.abs(point.y + 0.45) < 0.000001);
  assert.equal(point.z, 0);
  assert.ok(Math.abs(Math.hypot(point.x, point.y, point.z) - 0.75) < 0.000001);
});

test("navigation also stops at the floor without leaving the sphere", () => {
  const point = clampToNavigationBounds({ x: 3, y: -4, z: 4 }, 5);
  assert.equal(point.y, -0.25);
  assert.ok(Math.hypot(point.x, point.y, point.z) <= 5);
});

test("focus positions for nearby landmarks stay above the floor", () => {
  const target = { x: -0.3047, y: 0.248, z: 0.2099 };
  const floor = getNavigationFloor(5.3703, -0.6367);
  const position = getFocusPosition(target, 5.3703, floor);
  assert.ok(position.y >= floor);
  assert.ok(Math.hypot(
    target.x - position.x,
    target.y - position.y,
    target.z - position.z,
  ) >= 2.5 - 0.000001);
});

test("distant focus positions preserve their origin ray inside the sphere", () => {
  const target = { x: 4, y: 30, z: -22 };
  const position = getFocusPosition(target, 0.75);
  assert.ok(Math.hypot(position.x, position.y, position.z) <= 0.750001);
  assert.ok(Math.abs(position.x / position.y - target.x / target.y) < 0.000001);
  assert.ok(Math.abs(position.z / position.y - target.z / target.y) < 0.000001);
});

test("story cycling wraps in both directions", () => {
  const ids = ["one", "two", "three"];
  assert.equal(cycleId(ids, null, 1), "one");
  assert.equal(cycleId(ids, null, -1), "three");
  assert.equal(cycleId(ids, "three", 1), "one");
  assert.equal(cycleId(ids, "one", -1), "three");
});
