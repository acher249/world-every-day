import assert from "node:assert/strict";
import { test } from "node:test";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AllowlistedHttpFetcher } from "../src/sources/http.js";
import { DynamoDbRequestPacer, MemoryRequestPacer } from "../src/sources/pacing.js";

test("local pacing spaces concurrent requests to the same host", async () => {
  const times: number[] = [];
  const fetcher = new AllowlistedHttpFetcher({
    allowedHosts: ["journals.example.test"],
    pacer: new MemoryRequestPacer(25),
    fetchImpl: async () => {
      times.push(Date.now());
      return new Response("ok", { status: 200 });
    },
  });
  await Promise.all([
    fetcher.fetch("https://journals.example.test/one"),
    fetcher.fetch("https://journals.example.test/two"),
  ]);
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 20);
});

test("cloud pacing reserves a conditional, host-specific DynamoDB slot", async () => {
  const commands: unknown[] = [];
  const pacer = new DynamoDbRequestPacer({
    tableName: "editions",
    delayMs: 30_000,
    client: {
      send: async (command: unknown) => {
        commands.push(command);
        if (command instanceof GetCommand) throw new Error("Unexpected read");
        return {};
      },
    } as never,
  });
  await pacer.beforeRequest(new URL("https://journals.plos.org/plosone/feed/rss"));
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof UpdateCommand);
  const input = (commands[0] as UpdateCommand).input;
  assert.deepEqual(input.Key, { PK: "SOURCE_HOST#journals.plos.org", SK: "REQUEST_PACE" });
  assert.match(input.ConditionExpression ?? "", /nextAllowedAt <= :now/);
  assert.equal(Number(input.ExpressionAttributeValues?.[":next"]) - Number(input.ExpressionAttributeValues?.[":now"]), 30_000);
});

test("cloud pacing waits and retries when another worker owns the host slot", async () => {
  let updates = 0;
  let reads = 0;
  const pacer = new DynamoDbRequestPacer({
    tableName: "editions",
    delayMs: 30_000,
    client: {
      send: async (command: unknown) => {
        if (command instanceof UpdateCommand) {
          updates += 1;
          if (updates === 1) {
            const error = new Error("busy");
            error.name = "ConditionalCheckFailedException";
            throw error;
          }
          return {};
        }
        assert.ok(command instanceof GetCommand);
        reads += 1;
        return { Item: { nextAllowedAt: Date.now() + 1 } };
      },
    } as never,
  });
  await pacer.beforeRequest(new URL("https://journals.plos.org/article"));
  assert.equal(updates, 2);
  assert.equal(reads, 1);
});
