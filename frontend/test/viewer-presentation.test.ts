import assert from "node:assert/strict";
import { test } from "node:test";
import { depthOfFieldTarget, focusEffectId, focusPanelYaw, hotspotVisualScale, updateProjectionCamera, viewerPixelRatio } from "../lib/viewer-presentation";
import { Group, PerspectiveCamera, Scene, Vector3 } from "three";

test("hotspot projection matches continuous rendering across offline batch boundaries", () => {
  function projections(batchStart: number) {
    const scene = new Scene();
    const rig = new Group();
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    scene.add(rig); rig.add(camera);
    const result: number[][] = [];
    for (let frame = 0; frame < 60; frame++) {
      rig.position.set(0.3 * Math.cos(frame / 90), 0.1 * Math.sin(frame / 70), 0);
      camera.rotation.y = frame / 400;
      updateProjectionCamera(camera);
      const projected = new Vector3(1, 0, -5).project(camera);
      if (frame >= batchStart) {
        result.push(projected.toArray());
        scene.updateMatrixWorld(); // The matrix update normally performed by rendering.
        assert.ok(projected.distanceTo(new Vector3(1, 0, -5).project(camera)) < 1e-12);
      }
    }
    return result;
  }
  const continuous = projections(0);
  for (const start of [0, 10, 20, 30, 40, 50]) {
    assert.deepEqual(projections(start), continuous.slice(start));
  }
});

test("hotspot artwork grows at center and shrinks at viewport edges", () => {
  assert.equal(hotspotVisualScale(50, 50), 1.35);
  assert.equal(hotspotVisualScale(0, 50), 0.8);
  assert.equal(hotspotVisualScale(100, 100), 0.8);
  assert.ok(hotspotVisualScale(25, 50) < hotspotVisualScale(40, 50));
});

test("right panel offsets the camera aim toward the remaining view", () => {
  assert.equal(focusPanelYaw(1440, 0, 1440 / 900, 60), 0);
  const yaw = focusPanelYaw(1440, 430, 1440 / 900, 60);
  assert.ok(yaw < 0);
  assert.ok(yaw > -0.5);
  const projectedNdcX = Math.tan(yaw) / ((1440 / 900) * Math.tan(Math.PI / 6));
  assert.ok(Math.abs(projectedNdcX + 430 / 1440) < 1e-10);
});

test("story cycling keeps its target when another hotspot passes under the pointer", () => {
  assert.equal(focusEffectId("next", "old", true, true), "next");
  assert.equal(focusEffectId("next", "old", true, false), "old");
  assert.equal(focusEffectId("next", null, true, false), "next");
  assert.equal(focusEffectId(null, null, false, false), null);
});

test("left story list centers previews in the viewport to its right", () => {
  const yaw = focusPanelYaw(1440, 430, 1440 / 900, 60, "left");
  const projectedNdcX = Math.tan(yaw) / ((1440 / 900) * Math.tan(Math.PI / 6));
  assert.ok(Math.abs(projectedNdcX - 430 / 1440) < 1e-10);
  assert.equal(yaw, -focusPanelYaw(1440, 430, 1440 / 900, 60, "right"));
});

test("depth of field follows highlighted landmarks and returns to a gentler idle focus", () => {
  const idle = depthOfFieldTarget(20, null, false);
  const near = depthOfFieldTarget(20, 3, false);
  const far = depthOfFieldTarget(20, 12, false);
  const mobile = depthOfFieldTarget(20, 3, true);
  assert.equal(idle.focalDistance, 14);
  assert.equal(near.focalDistance, 3);
  assert.equal(far.focalDistance, 12);
  assert.ok(near.apertureAngle < far.apertureAngle);
  assert.ok(far.apertureAngle < idle.apertureAngle);
  assert.ok(mobile.apertureAngle < near.apertureAngle);
});

test("mobile splat rendering uses a lower pixel ratio cap", () => {
  assert.equal(viewerPixelRatio(3, true), 1.5);
  assert.equal(viewerPixelRatio(3, false), 3);
  assert.equal(viewerPixelRatio(1, true), 1);
  assert.equal(viewerPixelRatio(0.8, false), 0.8);
  assert.equal(viewerPixelRatio(NaN, false), 1);
});
