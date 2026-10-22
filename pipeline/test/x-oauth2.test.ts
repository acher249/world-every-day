import assert from "node:assert/strict";
import { test } from "node:test";
import { createXClient } from "../src/social/x-client.js";

const credentials = { X_CLIENT_ID: "client", X_CLIENT_SECRET: "secret", X_OAUTH2_ACCESS_TOKEN: "old-access", X_REFRESH_TOKEN: "old-refresh" };
test("OAuth 2.0 refreshes expired credentials and persists rotation before account recheck", async () => {
  let step = 0;
  let persisted = false;
  const client = createXClient(credentials, (async (url, init) => {
    step++;
    if (step === 1) return new Response("", { status: 401 });
    if (step === 2) {
      assert.equal(url, "https://api.x.com/2/oauth2/token");
      assert.equal(new URLSearchParams(String(init?.body)).get("grant_type"), "refresh_token");
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", token_type: "bearer" });
    }
    assert.ok(persisted);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new-access");
    return Response.json({ data: { id: "123" } });
  }) as typeof fetch, async (updated) => {
    assert.equal(updated.X_REFRESH_TOKEN, "new-refresh");
    persisted = true;
  });
  assert.equal(await client.accountId(), "123");
  assert.equal(await client.post("test"), "123");
  assert.equal(step, 4);
});

test("OAuth 2.0 will not use rotated tokens when durable storage fails", async () => {
  let calls = 0;
  const client = createXClient(credentials, (async () => ++calls === 1
    ? new Response("", { status: 401 })
    : Response.json({ access_token: "new", refresh_token: "rotated", token_type: "bearer" })) as typeof fetch,
  async () => { throw new Error("storage failed"); });
  await assert.rejects(client.accountId(), /storage failed/);
  assert.equal(calls, 2);
});

test("OAuth 2.0 does not refresh or retry failed posts", async () => {
  let calls = 0;
  const client = createXClient(credentials, (async () => { calls++; return new Response("", { status: 401 }); }) as typeof fetch);
  await assert.rejects(client.post("test"), /401/);
  assert.equal(calls, 1);
});
