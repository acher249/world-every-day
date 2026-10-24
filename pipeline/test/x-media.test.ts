import assert from "node:assert/strict";
import { test } from "node:test";
import { createXClient } from "../src/social/x-client.js";

const keys = { X_CLIENT_ID: "example", X_CLIENT_SECRET: "example", X_OAUTH2_ACCESS_TOKEN: "example", X_REFRESH_TOKEN: "example" };
test("video upload initializes, chunks, finalizes and attaches processed media", async () => {
  const paths: string[] = [];
  const client = createXClient(keys, async (url, options) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path.endsWith("initialize")) {
      assert.equal(JSON.parse(String(options?.body)).media_category, "tweet_video");
      return Response.json({ data: { id: "123", expires_after_secs: 86400 } });
    }
    if (path.endsWith("append")) {
      assert(options?.body instanceof FormData);
      assert.equal(options.body.get("segment_index"), "0");
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("finalize")) return Response.json({ data: { processing_info: { state: "succeeded" } } });
    assert.deepEqual(JSON.parse(String(options?.body)).media, { media_ids: ["123"] });
    return Response.json({ data: { id: "456" } });
  });
  const media = await client.uploadVideo(new Uint8Array([1, 2, 3]));
  assert.equal(media.id, "123");
  assert(Date.parse(media.expiresAt) > Date.now());
  await client.post("Example", media.id);
  assert.deepEqual(paths, ["/2/media/upload/initialize", "/2/media/upload/123/append", "/2/media/upload/123/finalize", "/2/tweets"]);
});
test("failed X processing cannot produce a ready media ID", async () => {
  const client = createXClient(keys, async (url) => {
    if (String(url).endsWith("initialize")) return Response.json({ data: { id: "123", expires_after_secs: 86400 } });
    if (String(url).endsWith("append")) return new Response(null, { status: 204 });
    return Response.json({ data: { processing_info: { state: "failed" } } });
  });
  await assert.rejects(client.uploadVideo(new Uint8Array([1])), /processing failed/);
});
