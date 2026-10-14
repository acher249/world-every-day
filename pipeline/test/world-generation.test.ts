import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { sha256 } from "../src/panorama/hash.js";
import { MockWorldGenerator } from "../src/world/mock.js";
import type { WorldGenerator } from "../src/world/provider.js";
import {
  createWorldIdempotencyKey,
  refreshWorldGeneration,
  startWorldGeneration,
} from "../src/world/run.js";
import {
  generatedWorldManifestSchema,
  worldGenerationRequestSchema,
  type WorldGenerationRequest,
} from "../src/world/schema.js";
import { LocalWorldArtifactStore } from "../src/world/store.js";

function requestFor(bytes: Buffer): WorldGenerationRequest {
  return worldGenerationRequestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "world-generation-request",
    editionId: "test-edition",
    sourceImage: {
      storageKey: "test/source.png",
      sha256: sha256(bytes),
      mediaType: "image/png",
      width: 32,
      height: 16,
    },
    generation: { mode: "image-to-world" },
  });
}

test("world generation persists one submission and resumes through completion", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-operation-"));
  try {
    const sourceBytes = Buffer.from("synthetic source image bytes");
    const sourcePath = resolve(directory, "source.png");
    await writeFile(sourcePath, sourceBytes);
    const request = requestFor(sourceBytes);
    const store = new LocalWorldArtifactStore(resolve(directory, "artifacts"));
    const generator = new MockWorldGenerator({ pollsBeforeCompletion: 1 });

    const submitted = await startWorldGeneration({
      generator,
      request,
      sourceImagePath: sourcePath,
      store,
    });
    const resumed = await startWorldGeneration({
      generator,
      request,
      sourceImagePath: sourcePath,
      store,
    });

    assert.equal(submitted.providerOperationId, resumed.providerOperationId);
    assert.equal(generator.submitCount, 1);
    assert.equal(
      submitted.idempotencyKey,
      createWorldIdempotencyKey(request, generator),
    );

    const running = await refreshWorldGeneration({ generator, request, store });
    assert.equal(running.status, "running");

    const completed = await refreshWorldGeneration({ generator, request, store });
    assert.equal(completed.status, "completed");
    assert.ok(completed.generatedWorldManifest);

    const manifest = generatedWorldManifestSchema.parse(
      JSON.parse(
        await readFile(
          resolve(directory, "artifacts", completed.generatedWorldManifest!),
          "utf8",
        ),
      ),
    );
    assert.equal(manifest.asset.format, "mock");
    assert.equal(manifest.provider, "mock");
    assert.equal(manifest.input.sourceImageSha256, request.sourceImage.sha256);
    assert.equal(
      sha256(
        await readFile(resolve(directory, "artifacts", manifest.asset.storageKey)),
      ),
      manifest.asset.sha256,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mock world operations resume after the provider object is recreated", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-process-resume-"));
  try {
    const sourceBytes = Buffer.from("synthetic source image bytes");
    const sourcePath = resolve(directory, "source.png");
    await writeFile(sourcePath, sourceBytes);
    const request = requestFor(sourceBytes);
    const store = new LocalWorldArtifactStore(resolve(directory, "artifacts"));

    await startWorldGeneration({
      generator: new MockWorldGenerator({ pollsBeforeCompletion: 2 }),
      request,
      sourceImagePath: sourcePath,
      store,
    });
    const completed = await refreshWorldGeneration({
      generator: new MockWorldGenerator({ pollsBeforeCompletion: 2 }),
      request,
      store,
    });

    assert.equal(completed.status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider failures become terminal typed operation records", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-failure-"));
  try {
    const sourceBytes = Buffer.from("synthetic source image bytes");
    const sourcePath = resolve(directory, "source.png");
    await writeFile(sourcePath, sourceBytes);
    const request = requestFor(sourceBytes);
    const store = new LocalWorldArtifactStore(resolve(directory, "artifacts"));
    const generator = new MockWorldGenerator({
      pollsBeforeCompletion: 0,
      terminalError: {
        code: "QUOTA_EXHAUSTED",
        message: "Synthetic provider quota failure",
        retryable: true,
      },
    });

    await startWorldGeneration({
      generator,
      request,
      sourceImagePath: sourcePath,
      store,
    });
    const failed = await refreshWorldGeneration({ generator, request, store });

    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.error, {
      code: "QUOTA_EXHAUSTED",
      message: "Synthetic provider quota failure",
      retryable: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("asset-copy failures resume without a duplicate provider submission", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-resume-"));
  try {
    const sourceBytes = Buffer.from("synthetic source image bytes");
    const sourcePath = resolve(directory, "source.png");
    await writeFile(sourcePath, sourceBytes);
    const request = requestFor(sourceBytes);
    const store = new LocalWorldArtifactStore(resolve(directory, "artifacts"));
    const mock = new MockWorldGenerator({ pollsBeforeCompletion: 0 });
    let failDownload = true;
    const generator: WorldGenerator = {
      adapterVersion: mock.adapterVersion,
      provider: mock.provider,
      submit: (...arguments_) => mock.submit(...arguments_),
      getOperation: (operationId, request) => mock.getOperation(operationId, request),
      downloadAsset: async (output) => {
        if (failDownload) {
          failDownload = false;
          throw new Error("Synthetic download interruption");
        }
        void output;
        return mock.downloadAsset();
      },
    };

    await startWorldGeneration({
      generator,
      request,
      sourceImagePath: sourcePath,
      store,
    });
    await assert.rejects(
      refreshWorldGeneration({ generator, request, store }),
      /Synthetic download interruption/,
    );
    assert.equal((await store.loadOperation(request.editionId))?.status, "provider-succeeded");

    const completed = await refreshWorldGeneration({ generator, request, store });
    assert.equal(completed.status, "completed");
    assert.equal(mock.submitCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source bytes must match the request checksum before submission", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-checksum-"));
  try {
    const expectedBytes = Buffer.from("expected bytes");
    const sourcePath = resolve(directory, "source.png");
    await writeFile(sourcePath, "different bytes");
    const request = requestFor(expectedBytes);
    const store = new LocalWorldArtifactStore(resolve(directory, "artifacts"));
    const generator = new MockWorldGenerator();

    await assert.rejects(
      startWorldGeneration({
        generator,
        request,
        sourceImagePath: sourcePath,
        store,
      }),
      /checksum does not match/,
    );
    assert.equal(generator.submitCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("durable asset copies are idempotent but never overwrite different bytes", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-asset-store-"));
  try {
    const store = new LocalWorldArtifactStore(resolve(directory, "artifacts"));
    const bytes = Buffer.from("stable world bytes");

    const first = await store.saveWorldAsset("test-edition", "world.spz", bytes);
    const repeated = await store.saveWorldAsset("test-edition", "world.spz", bytes);

    assert.deepEqual(repeated, first);
    await assert.rejects(
      store.saveWorldAsset(
        "test-edition",
        "world.spz",
        Buffer.from("different world bytes"),
      ),
      /Refusing to overwrite a different world asset/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
