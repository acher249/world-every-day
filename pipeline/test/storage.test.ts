import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { LocalArtifactStore, validateArtifactKey } from "../src/storage/artifact-store.js";
import { DynamoDbEditionRepository } from "../src/storage/dynamodb-edition-repository.js";
import { S3ArtifactStore } from "../src/storage/s3-artifact-store.js";
import { assertEditionTransition } from "../src/storage/edition-repository.js";
import { sha256 } from "../src/panorama/hash.js";

test("artifact keys reject traversal and ambiguous paths", () => {
  for (const key of ["", "/absolute", "../escape", "a/../b", "a//b", "a\\b", "trailing/"]) {
    assert.throws(() => validateArtifactKey(key), /Invalid artifact key/);
  }
  assert.equal(validateArtifactKey("editions/2026-10-14/world.spz"), "editions/2026-10-14/world.spz");
});

test("local artifact storage is immutable and idempotent", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-artifacts-"));
  try {
    const store = new LocalArtifactStore(directory);
    const artifact = {
      key: "editions/test/manifest.json",
      bytes: Buffer.from("stable"),
      contentType: "application/json",
    };
    const first = await store.putImmutable(artifact);
    const repeated = await store.putImmutable(artifact);
    assert.deepEqual(repeated, first);
    assert.equal(Buffer.from((await store.read(artifact.key))!).toString(), "stable");
    assert.equal(await store.read("editions/test/missing.json"), null);
    await assert.rejects(
      store.putImmutable({ ...artifact, bytes: Buffer.from("different") }),
      /Refusing to overwrite/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("S3 artifact storage uses conditional immutable writes", async () => {
  const commands: unknown[] = [];
  const store = new S3ArtifactStore({
    bucket: "artifact-bucket",
    prefix: "private",
    client: {
      send: async (command: unknown) => {
        commands.push(command);
        if (command instanceof PutObjectCommand) return {};
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) } };
        }
        throw new Error("Unexpected command");
      },
    } as never,
  });
  const stored = await store.putImmutable({
    bytes: Uint8Array.from([1, 2, 3]),
    contentType: "application/octet-stream",
    key: "edition/world.spz",
  });
  assert.equal(stored.key, "edition/world.spz");
  const put = commands[0] as PutObjectCommand;
  assert.equal(put.input.IfNoneMatch, "*");
  assert.equal(put.input.Metadata?.sha256, stored.sha256);
  assert.deepEqual(await store.read("edition/world.spz"), Uint8Array.from([1, 2, 3]));
});

test("S3 retries accept identical existing artifacts and reject different ones", async () => {
  const bytes = Buffer.from("same");
  const digest = sha256(bytes);
  let contentType = "text/plain";
  const store = new S3ArtifactStore({
    bucket: "artifact-bucket",
    client: {
      send: async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          const error = new Error("exists");
          error.name = "PreconditionFailed";
          throw error;
        }
        if (command instanceof HeadObjectCommand) {
          return { ContentLength: bytes.byteLength, ContentType: contentType, Metadata: { sha256: digest } };
        }
        throw new Error("Unexpected command");
      },
    } as never,
  });
  await store.putImmutable({ key: "x", bytes, contentType: "text/plain" });
  contentType = "image/png";
  await assert.rejects(
    store.putImmutable({ key: "x", bytes, contentType: "text/plain" }),
    /Refusing to overwrite/,
  );
});

test("DynamoDB edition repository uses conditional writes and atomic publication", async () => {
  const commands: unknown[] = [];
  const now = new Date("2026-10-14T15:00:00.000Z");
  const draft = {
    editionId: "edition-2026-10-14",
    status: "DRAFT",
    revision: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const repository = new DynamoDbEditionRepository({
    tableName: "editions",
    client: {
      send: async (command: unknown) => {
        commands.push(command);
        if (command instanceof PutCommand) return {};
        if (command instanceof UpdateCommand) {
          if (command.input.UpdateExpression?.includes("REMOVE lockOwner")) {
            return { Attributes: { ...draft, revision: 2 } };
          }
          if (command.input.ExpressionAttributeValues?.[":owner"]) {
            return { Attributes: {
              ...draft,
              revision: 1,
              lockOwner: "worker-1",
              lockExpiresAt: "2026-10-14T15:05:00.000Z",
            } };
          }
          if (command.input.ExpressionAttributeValues?.[":failed"]) {
            return { Attributes: {
              ...draft,
              status: "FAILED",
              revision: 2,
              failure: command.input.ExpressionAttributeValues[":failure"],
            } };
          }
          return { Attributes: { ...draft, status: "COLLECTED", revision: 2 } };
        }
        if (command instanceof TransactWriteCommand) return {};
        if (command instanceof GetCommand) return { Item: undefined };
        throw new Error("Unexpected command");
      },
    } as never,
  });
  await repository.createDraft(draft.editionId, now);
  const locked = await repository.acquireLock({
    editionId: draft.editionId,
    owner: "worker-1",
    now,
    expiresAt: new Date("2026-10-14T15:05:00.000Z"),
  });
  assert.deepEqual(locked.lock, {
    owner: "worker-1",
    expiresAt: "2026-10-14T15:05:00.000Z",
  });
  const unlocked = await repository.releaseLock({
    editionId: draft.editionId,
    owner: "worker-1",
    now,
  });
  assert.equal(unlocked.lock, undefined);
  await repository.transition({
    editionId: draft.editionId,
    expected: "DRAFT",
    next: "COLLECTED",
    now,
  });
  await repository.publish({
    editionId: draft.editionId,
    manifestKey: "public/edition/manifest.json",
    now,
  });
  assert.ok(commands[0] instanceof PutCommand);
  assert.match((commands[1] as UpdateCommand).input.ConditionExpression!, /lockExpiresAt/);
  assert.match((commands[2] as UpdateCommand).input.UpdateExpression!, /REMOVE lockOwner/);
  assert.equal((commands[3] as UpdateCommand).input.ExpressionAttributeValues?.[":expected"], "DRAFT");
  assert.equal((commands[4] as TransactWriteCommand).input.TransactItems?.length, 2);
});

test("edition state transitions follow the declared workflow", () => {
  assert.doesNotThrow(() => assertEditionTransition("DRAFT", "COLLECTED"));
  assert.throws(
    () => assertEditionTransition("DRAFT", "PUBLISHED"),
    /Invalid edition transition/,
  );
  assert.throws(
    () => assertEditionTransition("PUBLISHED", "FAILED"),
    /Invalid edition transition/,
  );
  assert.throws(
    () => assertEditionTransition("WORLD_GENERATING", "FAILED"),
    /Invalid edition transition/,
  );
});

test("edition failures retain a bounded stage and message", async () => {
  const now = new Date("2026-10-14T15:00:00.000Z");
  const repository = new DynamoDbEditionRepository({
    tableName: "editions",
    client: {
      send: async (command: unknown) => {
        assert.ok(command instanceof UpdateCommand);
        assert.match(command.input.ConditionExpression!, /lockOwner = :owner/);
        return { Attributes: {
          editionId: "edition-2026-10-14",
          status: "FAILED",
          revision: 4,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          failure: command.input.ExpressionAttributeValues?.[":failure"],
        } };
      },
    } as never,
  });
  const failed = await repository.fail({
    editionId: "edition-2026-10-14",
    stage: "world-generation",
    message: "Provider timed out",
    now,
    owner: "worker-1",
  });
  assert.deepEqual(failed.failure, {
    stage: "world-generation",
    message: "Provider timed out",
  });
});

