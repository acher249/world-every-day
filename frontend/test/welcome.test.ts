import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSeenWelcome, rememberWelcome, WELCOME_STORAGE_KEY } from "../lib/welcome";

test("welcome completion uses one persistent flag only after dismissal", () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  assert.equal(hasSeenWelcome(storage), false);
  assert.equal(entries.size, 0);
  rememberWelcome(storage);
  assert.equal(hasSeenWelcome(storage), true);
  assert.deepEqual([...entries], [[WELCOME_STORAGE_KEY, "1"]]);
});

test("blocked storage does not break welcome dismissal", () => {
  const storage = { getItem: () => { throw Error("Blocked"); }, setItem: () => { throw Error("Blocked"); } };
  assert.equal(hasSeenWelcome(storage), false);
  assert.doesNotThrow(() => rememberWelcome(storage));
});
