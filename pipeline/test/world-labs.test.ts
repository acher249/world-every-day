import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { sha256 } from "../src/panorama/hash.js";
import type { WorldGenerationRequest } from "../src/world/schema.js";
import { worldGenerationRequestSchema } from "../src/world/schema.js";
import { WorldLabsGenerator } from "../src/world/world-labs.js";

function requestFor(bytes: Buffer): WorldGenerationRequest {
  return worldGenerationRequestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "world-generation-request",
    editionId: "test-edition",
    sourceImage: {
      storageKey: "source.png",
      sha256: sha256(bytes),
      mediaType: "image/png",
      width: 64,
      height: 32,
    },
    generation: {
      mode: "image-to-world",
      model: "marble-1.0",
      prompt: "Keep the landmarks distinct.",
    },
  });
}

test("World Labs adapter uploads a panorama and submits an idempotent image world", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-labs-adapter-"));
  try {
    const source = Buffer.from("panorama bytes");
    const sourcePath = resolve(directory, "source.png");
    await writeFile(sourcePath, source);
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input).endsWith("media-assets:prepare_upload")) {
        return Response.json({
          media_asset: { media_asset_id: "media-123" },
          upload_info: {
            upload_url: "https://uploads.example.test/source",
            upload_method: "PUT",
            required_headers: { "x-upload-token": "token" },
          },
        });
      }
      if (String(input) === "https://uploads.example.test/source") {
        return new Response(null, { status: 200 });
      }
      if (String(input).endsWith("worlds:generate")) {
        return Response.json({ operation_id: "operation-123" });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    };
    const generator = new WorldLabsGenerator({
      apiKey: "test-key",
      apiBaseUrl: "https://provider.example.test/marble/v1",
      fetchImpl,
    });

    const submitted = await generator.submit(
      requestFor(source),
      sourcePath,
      "a".repeat(64),
    );

    assert.deepEqual(submitted, { operationId: "operation-123" });
    assert.equal(calls.length, 3);
    const upload = calls[1];
    assert.equal(upload.init?.method, "PUT");
    assert.deepEqual(upload.init?.body, source);
    const generation = calls[2];
    assert.equal(new Headers(generation.init?.headers).get("Idempotency-Key"), "a".repeat(64));
    assert.deepEqual(JSON.parse(String(generation.init?.body)), {
      display_name: "test-edition",
      world_prompt: {
        type: "image",
        image_prompt: { source: "media_asset", media_asset_id: "media-123" },
        is_pano: true,
        text_prompt: "Keep the landmarks distinct.",
      },
      model: "marble-1.0",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("World Labs adapter prefers the full-resolution SPZ and downloads it", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/operations/operation-123")) {
      return Response.json({
        done: true,
        error: null,
        metadata: { world_id: "world-123" },
        response: {
          splats: {
            spz_urls: {
              "500k": "https://cdn.example.test/500k.spz",
              full_res: "https://cdn.example.test/full.spz",
            },
          },
        },
      });
    }
    if (url === "https://cdn.example.test/full.spz") {
      return new Response(Buffer.from("spz bytes"), {
        status: 200,
        headers: { "content-length": "9" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const generator = new WorldLabsGenerator({
    apiKey: "test-key",
    apiBaseUrl: "https://provider.example.test/marble/v1",
    fetchImpl,
  });

  const operation = await generator.getOperation(
    "operation-123",
    requestFor(Buffer.from("unused")),
  );
  assert.equal(operation.done, true);
  assert.ok(operation.done && "response" in operation);
  if (!operation.done || !("response" in operation)) return;
  assert.equal(operation.response.assetReference, "https://cdn.example.test/full.spz");
  assert.deepEqual(operation.response.metadata, {
    resolution: "full_res",
    worldId: "world-123",
  });

  const downloaded = await generator.downloadAsset(operation.response);
  assert.equal(downloaded.bytes.toString(), "spz bytes");
  assert.equal(downloaded.format, "spz");
});

test("World Labs adapter resolves assets from world details when needed", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/operations/operation-123")) {
      return Response.json({ done: true, response: { world_id: "world-123" } });
    }
    if (url.endsWith("/worlds/world-123")) {
      return Response.json({
        assets: {
          splats: { spz_urls: { "500k": "https://cdn.example.test/500k.spz" } },
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const generator = new WorldLabsGenerator({
    apiKey: "test-key",
    apiBaseUrl: "https://provider.example.test/marble/v1",
    fetchImpl,
  });

  const operation = await generator.getOperation(
    "operation-123",
    requestFor(Buffer.from("unused")),
  );

  assert.equal(operation.done, true);
  assert.ok(operation.done && "response" in operation);
  if (!operation.done || !("response" in operation)) return;
  assert.equal(operation.response.assetReference, "https://cdn.example.test/500k.spz");
  assert.equal(calls.length, 2);
});

test("World Labs adapter treats throttling as an unfinished operation", async () => {
  const generator = new WorldLabsGenerator({
    apiKey: "test-key",
    apiBaseUrl: "https://provider.example.test/marble/v1",
    fetchImpl: async () => new Response(null, { status: 503 }),
  });

  assert.deepEqual(
    await generator.getOperation(
      "operation-123",
      requestFor(Buffer.from("unused")),
    ),
    { done: false },
  );
});

test("World Labs adapter rejects non-HTTPS asset URLs", async () => {
  const generator = new WorldLabsGenerator({
    apiKey: "test-key",
    apiBaseUrl: "https://provider.example.test/marble/v1",
    fetchImpl: async () =>
      Response.json({
        done: true,
        response: {
          splats: { spz_urls: { full_res: "http://cdn.example.test/world.spz" } },
        },
      }),
  });

  await assert.rejects(
    generator.getOperation("operation-123", requestFor(Buffer.from("unused"))),
    /must use HTTPS/,
  );
});
