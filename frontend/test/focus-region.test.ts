import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraRelativeFocusCenter, focusShapeForLandmark, focusRadiusForLandmark, focusSweepWeight, shouldTravelFocus } from "../lib/focus-region";
import { Quaternion, Vector3 } from "three";

test("focus follows a rotating camera rather than cutting a straight chord through the world", () => {
  const start = new Vector3(0, 0, -8);
  const end = new Vector3(0, 0, -12);
  const position = new Vector3(1, 0, 2);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const output = new Vector3();
  assert.equal(cameraRelativeFocusCenter(start, end, .5, position, rotation, output), output);
  assert.ok(output.distanceTo(new Vector3(-9, 0, 2)) < 1e-10);
  const inView = output.clone().sub(position).applyQuaternion(rotation.clone().invert());
  assert.ok(inView.distanceTo(new Vector3(0, 0, -10)) < 1e-10);
  const offset = new Vector3(-2, 1, -12); // Sidebar-adjusted destination remains exact.
  cameraRelativeFocusCenter(start, offset, 1, position, rotation, output);
  assert.ok(output.distanceTo(offset.clone().applyQuaternion(rotation).add(position)) < 1e-10);
});

const target = { x: 0.5, y: 0.5 };

test("only transitions between distinct selected highlights use the traveling blob", () => {
  assert.equal(shouldTravelFocus(null, "a", null), false); // First arrow.
  assert.equal(shouldTravelFocus(null, "a", "a"), false); // Hover, then click.
  assert.equal(shouldTravelFocus(null, "b", "a"), false); // First selection after another hover.
  assert.equal(shouldTravelFocus("a", "a", "a"), false);
  assert.equal(shouldTravelFocus("a", "b", "b"), false); // Already hovering the destination.
  assert.equal(shouldTravelFocus("a", "b", "a"), true);
  assert.equal(shouldTravelFocus("b", "a", "b"), true);
  assert.equal(shouldTravelFocus("a", null, "a"), false);
});

test("travel focus settles gradually before arrival with continuous endpoints", () => {
  assert.equal(focusSweepWeight(0), 0);
  assert.equal(focusSweepWeight(1), 0);
  assert.equal(focusSweepWeight(.3), 1);
  assert.ok(focusSweepWeight(.6) > focusSweepWeight(.8));
  assert.ok(focusSweepWeight(.8) > focusSweepWeight(.95));
  assert.ok(focusSweepWeight(.999) < .000001);
  for (let i = 0; i <= 100; i++) {
    const value = focusSweepWeight(i / 100);
    assert.ok(value >= 0 && value <= 1);
  }
});

test("focus shape follows wide and tall bounds with bounded distortion", () => {
  const position = { x: 0, y: 0, z: -6 };
  const wide = focusShapeForLandmark(5, target, position, { xMin: .3, xMax: .7, yMin: .45, yMax: .55 });
  const tall = focusShapeForLandmark(5, target, position, { xMin: .49, xMax: .51, yMin: .3, yMax: .7 });
  assert.ok(wide.x > wide.y);
  assert.ok(tall.y > tall.x);
  const middle = new Vector3(wide.x, wide.y, wide.z).lerp(new Vector3(tall.x, tall.y, tall.z), .5);
  assert.ok(Math.abs(middle.x - (wide.x + tall.x) / 2) < 1e-10);
  assert.ok(Math.abs(middle.y - (wide.y + tall.y) / 2) < 1e-10);
  for (const value of Object.values(wide)) assert.ok(Number.isFinite(value) && value > 0);
});

test("older editions retain the fixed focus radius", () => {
  assert.ok(Math.abs(focusRadiusForLandmark(5, target, { x: 0, y: 0, z: -4 }) - 1.82) < 1e-12);
});

test("large and distant landmark boxes receive wider focus regions", () => {
  const small = { xMin: 0.48, yMin: 0.46, xMax: 0.52, yMax: 0.54 };
  const large = { xMin: 0.4, yMin: 0.35, xMax: 0.6, yMax: 0.65 };
  const nearRadius = focusRadiusForLandmark(5, target, { x: 0, y: 0, z: -2 }, large);
  const farRadius = focusRadiusForLandmark(5, target, { x: 0, y: 0, z: -6 }, large);
  assert.ok(focusRadiusForLandmark(5, target, { x: 0, y: 0, z: -6 }, small) < farRadius);
  assert.ok(nearRadius < farRadius);
});

test("extreme and malformed boxes cannot create unbounded focus regions", () => {
  const fallback = focusRadiusForLandmark(5, target, { x: 0, y: 0, z: -2 });
  assert.equal(focusRadiusForLandmark(5, target, { x: 0, y: 0, z: -2 }, {
    xMin: 0.6, yMin: 0.4, xMax: 0.4, yMax: 0.6,
  }), fallback);
  assert.equal(focusRadiusForLandmark(5, target, { x: 0, y: 0, z: -100 }, {
    xMin: 0, yMin: 0, xMax: 1, yMax: 1,
  }), fallback * 5);
});
