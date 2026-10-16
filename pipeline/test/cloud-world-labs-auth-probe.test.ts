import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorldLabsAuthProbe,
  parseWorldLabsKey,
} from "../src/cloud/world-labs-auth-probe.js";

test("World Labs probe is explicit, read-only, and returns only status", async () => {
  let reads = 0;
  let calls = 0;
  const probe = createWorldLabsAuthProbe({
    async readSecret() {
      reads += 1;
      return "test-secret";
    },
    async fetchImpl(input, init) {
      calls += 1;
      assert.equal(input, "https://api.worldlabs.ai/marble/v1/worlds:list");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, "{}");
      assert.equal(init?.redirect, "error");
      assert.equal((init?.headers as Record<string, string>)["WLT-Api-Key"], "test-secret");
      return new Response(JSON.stringify({ worlds: [{ id: "private-world" }] }), { status: 200 });
    },
  });
  await assert.rejects(probe({}), /confirmReadOnlyProbe/);
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  const result = await probe({ confirmReadOnlyProbe: true });
  assert.deepEqual(result, { authenticated: true, httpStatus: 200, operation: "list-worlds" });
  assert.equal(reads, 1);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes("private-world"), false);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
});

test("World Labs probe reports authentication failure without leaking the response", async () => {
  const probe = createWorldLabsAuthProbe({
    readSecret: async () => "test-secret",
    fetchImpl: async () => new Response("secret echoed in error", { status: 401 }),
  });
  assert.deepEqual(await probe({ confirmReadOnlyProbe: true }), {
    authenticated: false,
    httpStatus: 401,
    operation: "list-worlds",
  });
  assert.equal(parseWorldLabsKey('{"WORLD_LABS_KEY":"test-secret"}'), "test-secret");
  assert.throws(() => parseWorldLabsKey('{"unexpected":"test-secret"}'), /WORLD_LABS_KEY/);
});
