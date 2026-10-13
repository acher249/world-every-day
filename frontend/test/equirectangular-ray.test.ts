import assert from "node:assert/strict";
import test from "node:test";

import { equirectangularTargetToDirection } from "../lib/equirectangular-ray";

test("the panorama center looks down the viewer's initial forward axis", () => {
  assert.deepEqual(equirectangularTargetToDirection({ x: 0.5, y: 0.5 }), {
    x: 0,
    y: 0,
    z: -1,
  });
});

test("longitude wraps through the rear axis", () => {
  const direction = equirectangularTargetToDirection({ x: 0, y: 0.5 });
  assert.ok(Math.abs(direction.x) < 1e-12);
  assert.equal(direction.y, 0);
  assert.equal(direction.z, 1);
});

test("latitude maps the top edge to the zenith", () => {
  const direction = equirectangularTargetToDirection({ x: 0.25, y: 0 });
  assert.ok(Math.abs(direction.x) < 1e-12);
  assert.equal(direction.y, 1);
  assert.ok(Math.abs(direction.z) < 1e-12);
});

test("targets outside the panorama are rejected", () => {
  assert.throws(
    () => equirectangularTargetToDirection({ x: 1.1, y: 0.5 }),
    /normalized coordinates/,
  );
});
