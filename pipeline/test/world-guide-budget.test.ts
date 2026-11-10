import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorldGuideBudget } from "../src/world-guide/budget.js";

test("budget defaults to a five-dollar allowance but requires a reviewed reservation", () => {
  assert.deepEqual(readWorldGuideBudget({}), { dailyCents: 500, sessionCents: 0, configured: false });
  assert.equal(readWorldGuideBudget({ WORLD_GUIDE_SESSION_RESERVATION_CENTS: "100" }).configured, true);
  assert.equal(readWorldGuideBudget({ WORLD_GUIDE_SESSION_RESERVATION_CENTS: "501" }).configured, false);
  for (const value of ["NaN", "-1", "1.5", "Infinity"]) {
    assert.throws(() => readWorldGuideBudget({ WORLD_GUIDE_SESSION_RESERVATION_CENTS: value }), /integer cents/);
  }
});
