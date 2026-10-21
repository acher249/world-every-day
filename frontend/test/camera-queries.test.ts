import assert from "node:assert/strict";
import test from "node:test";
import { Object3D, Vector3 } from "three";
import { createCameraQueries } from "../lib/camera-queries";

test("camera ground checks use the nearest surface and clear stale hits", () => {
  let empty = false;
  const object = new Object3D();
  const queries = createCameraQueries({ raycast(_ray, hits) {
    if (!empty) hits.push(
      {distance: 4, point: new Vector3(0, -4, 0), object},
      {distance: 1, point: new Vector3(0, -1, 0), object},
    );
  }});
  assert.equal(queries.groundHeight(5), -1);
  empty = true;
  assert.equal(queries.groundHeight(5), undefined);
});

test("camera visibility scores obstructions and handles coincident targets", () => {
  let blocked = false;
  const queries = createCameraQueries({ raycast(ray, hits) {
    if (blocked) hits.push({distance: ray.far / 2, point: new Vector3(), object: new Object3D()});
  }});
  const origin = {x: 0, y: 0, z: 0};
  assert.equal(queries.visibility(origin, {x: 0, y: 0, z: -10}), 1);
  blocked = true;
  assert.equal(queries.visibility(origin, {x: 0, y: 0, z: -10}), 0.5);
  assert.equal(queries.visibility(origin, origin), 1);
});
