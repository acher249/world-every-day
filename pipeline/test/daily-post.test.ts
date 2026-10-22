import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createDailyPostHandler, composeDailyPost, type DailyPostDependencies } from "../src/social/daily-post.js";
import { authorization, createXClient } from "../src/social/x-client.js";
import { publicationManifestSchema } from "../src/publication/schema.js";

const fixture = JSON.parse(await readFile(new URL("../../frontend/data/fixtures/demo-publication.v1.json", import.meta.url), "utf8"));
fixture.edition.status = "published";
fixture.edition.fictional = false;
fixture.world.splat = { url: "/world.spz", format: "spz", sha256: fixture.world.interactionMapping.sourceSplatSha256 };
for (const story of fixture.stories) story.sources = [{ title: "Source", publisher: "Example", url: "https://example.com/story", publishedAt: "2026-01-01T00:00:00Z", kind: "primary" }];
const manifest = publicationManifestSchema.parse(fixture);
const event = { editionId: manifest.edition.id, publication: { status: "published", key: "publication.json" } };

function setup(overrides: Partial<DailyPostDependencies> = {}) {
  let claimed = false;
  const posts: string[] = [];
  const receipts: string[] = [];
  const deps: DailyPostDependencies = {
    enabled: true, origin: "https://explore.example.com", projectOrigin: "https://example.com", expectedAccountId: "123",
    verifyPublication: async () => manifest, accountId: async () => "123",
    claim: async () => { if (claimed) return false; claimed = true; return true; },
    post: async (text) => { posts.push(text); return "456"; },
    receipt: async (_, id) => { receipts.push(id); }, ...overrides,
  };
  return { run: createDailyPostHandler(deps), posts, receipts };
}

test("daily post verifies publication, sends once, and records the X post ID", async () => {
  const { run, posts, receipts } = setup();
  assert.deepEqual(await run(event), { status: "posted", postId: "456" });
  assert.deepEqual(await run(event), { status: "already-attempted" });
  assert.equal(posts.length, 1);
  assert.deepEqual(receipts, ["456"]);
  assert.ok(posts[0].includes(`?edition=${manifest.edition.id}`));
});

test("disabled integration makes no external calls; previews are rejected", async () => {
  const { run, posts } = setup({ enabled: false, verifyPublication: async () => { throw Error("unexpected"); } });
  assert.deepEqual(await run(event), { status: "disabled" });
  await assert.rejects(run({ ...event, publication: { ...event.publication, status: "preview-published" } }));
  assert.equal(posts.length, 0);
});

test("wrong account, missing public edition, and fictional worlds cannot post", async () => {
  for (const overrides of [
    { accountId: async () => "999" },
    { verifyPublication: async () => { throw Error("not public"); } },
    { verifyPublication: async () => ({ ...manifest, edition: { ...manifest.edition, fictional: true } }) },
  ]) {
    const { run, posts } = setup(overrides);
    await assert.rejects(run(event));
    assert.equal(posts.length, 0);
  }
});

test("concurrent invocations cannot both send", async () => {
  const { run, posts } = setup();
  await Promise.all([run(event), run(event)]);
  assert.equal(posts.length, 1);
});

test("timeouts and failed receipt writes leave a claim, preventing blind retry", async () => {
  for (const overrides of [
    { post: async () => { throw Error("timeout"); } },
    { receipt: async () => { throw Error("storage failure"); } },
  ]) {
    const { run } = setup(overrides);
    await assert.rejects(run(event));
    assert.deepEqual(await run(event), { status: "already-attempted" });
  }
});

test("copy fits conservative X length budget even with non-Latin titles", () => {
  const copy = structuredClone(manifest);
  copy.stories.forEach((story) => { story.title = "界".repeat(180); });
  const text = composeDailyPost(copy, "https://explore.example.com", "https://example.com");
  const weighted = Array.from(text.replace(/https:\/\/\S+/g, "x".repeat(23)))
    .reduce((sum, char) => sum + (char.codePointAt(0)! < 128 ? 1 : 2), 0);
  assert.ok(weighted <= 280);
  assert.ok(text.startsWith(`${manifest.edition.displayDate}\n\nToday’s World: `));
  assert.ok(text.endsWith("\n\nLearn more: https://example.com/"));
});

const keys = { X_API_KEY: "example", X_API_KEY_SECRET: "secret", X_ACCESS_TOKEN: "token", X_ACCESS_TOKEN_SECRET: "token-secret" };
test("OAuth signing matches the published OAuth 1.0 photo-request test vector", () => {
  const header = authorization("GET", "http://photos.example.net/photos?file=vacation.jpg&size=original", {
    X_API_KEY: "dpf43f3p2l4k3l03", X_API_KEY_SECRET: "kd94hf93k423kf44",
    X_ACCESS_TOKEN: "nnch734d00sl2jdk", X_ACCESS_TOKEN_SECRET: "pfkkdhi9sl3r4s00",
  }, "kllo9940pd9333jh", "1191242096");
  assert.ok(header.includes('oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"'));
});
test("OAuth signing is deterministic and changes with method and query", () => {
  const sign = (method: string, url: string) => authorization(method, url, keys, "nonce", "123");
  assert.equal(sign("GET", "https://api.x.com/2/users/me"), sign("GET", "https://api.x.com/2/users/me"));
  assert.notEqual(sign("GET", "https://api.x.com/2/users/me"), sign("POST", "https://api.x.com/2/users/me"));
  assert.notEqual(sign("GET", "https://api.x.com/2/users/me"), sign("GET", "https://api.x.com/2/users/me?a=1"));
});

test("X errors do not leak response bodies, and POST has no retry", async () => {
  let calls = 0;
  const client = createXClient(keys, (async () => { calls++; return new Response("private provider details", { status: 403 }); }) as typeof fetch);
  await assert.rejects(client.post("test"), { message: "X request failed (403)" });
  assert.equal(calls, 1);
});
