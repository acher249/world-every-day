import assert from "node:assert/strict";
import test from "node:test";

import { canRenderWorldInteractions } from "../lib/world-interactions";

const checksum = "a".repeat(64);

test("poster interactions remain available without a splat", () => {
  assert.equal(
    canRenderWorldInteractions({ interactionSplatSha256: checksum }),
    true,
  );
});

test("3D interactions require the exact rendered splat checksum", () => {
  assert.equal(
    canRenderWorldInteractions({
      interactionSplatSha256: checksum,
      renderedSplatSha256: checksum,
      splatUrl: "/generated/world.spz",
    }),
    true,
  );
  assert.equal(
    canRenderWorldInteractions({
      interactionSplatSha256: checksum,
      renderedSplatSha256: "b".repeat(64),
      splatUrl: "/generated/world.spz",
    }),
    false,
  );
});

test("a local splat without a checksum cannot reuse baked hotspots", () => {
  assert.equal(
    canRenderWorldInteractions({
      interactionSplatSha256: checksum,
      splatUrl: "/generated/world.spz",
    }),
    false,
  );
});
