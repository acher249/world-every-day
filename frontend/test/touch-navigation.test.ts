import assert from "node:assert/strict";
import { test } from "node:test";
import { stickValueAt } from "../lib/touch-navigation.js";

const bounds = { left: 10, top: 20, width: 120, height: 120 };

test("touch stick is centered, analog, and bounded", () => {
  assert.deepEqual(stickValueAt(70, 80, bounds), { x: 0, y: 0 });
  assert.deepEqual(stickValueAt(70, 20, bounds), { x: 0, y: 1 });
  assert.deepEqual(stickValueAt(130, 80, bounds), { x: 1, y: 0 });
  assert.equal(stickValueAt(100, 80, bounds).x, 0.5);
  assert.ok(Math.hypot(...Object.values(stickValueAt(200, -100, bounds))) <= 1.000001);
});
