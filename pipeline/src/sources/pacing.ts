import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export type RequestPacer = { beforeRequest(url: URL): Promise<void> };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Process-local pacing for local runs. Cloud workers use the shared DynamoDB pacer. */
export class MemoryRequestPacer implements RequestPacer {
  readonly #nextAt = new Map<string, number>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #delayMs: number;

  constructor(delayMs: number) {
    this.#delayMs = delayMs;
  }

  async beforeRequest(url: URL): Promise<void> {
    const host = url.hostname;
    const previous = this.#tails.get(host) ?? Promise.resolve();
    const turn = previous.catch(() => {}).then(async () => {
      await wait(Math.max(0, (this.#nextAt.get(host) ?? 0) - Date.now()));
      this.#nextAt.set(host, Date.now() + this.#delayMs);
    });
    this.#tails.set(host, turn);
    await turn;
  }
}

const localPacers = new Map<number, MemoryRequestPacer>();

export function localRequestPacer(delayMs: number): RequestPacer | undefined {
  if (!delayMs) return undefined;
  let pacer = localPacers.get(delayMs);
  if (!pacer) {
    pacer = new MemoryRequestPacer(delayMs);
    localPacers.set(delayMs, pacer);
  }
  return pacer;
}

type DocumentClientLike = Pick<DynamoDBDocumentClient, "send">;

/** Atomically reserves a host-wide request slot across Lambda invocations and editions. */
export class DynamoDbRequestPacer implements RequestPacer {
  readonly #client: DocumentClientLike;
  readonly #tableName: string;
  readonly #delayMs: number;

  constructor({ client, delayMs, tableName }: {
    client?: DocumentClientLike;
    delayMs: number;
    tableName: string;
  }) {
    if (!tableName.trim() || !Number.isInteger(delayMs) || delayMs < 1 || delayMs > 60_000) {
      throw new Error("A table and a 1–60000 ms crawl delay are required");
    }
    this.#client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
    this.#tableName = tableName;
    this.#delayMs = delayMs;
  }

  async beforeRequest(url: URL): Promise<void> {
    const key = { PK: `SOURCE_HOST#${url.hostname}`, SK: "REQUEST_PACE" };
    // Ten PLOS feeds share a 30-second host delay, so the final reservation can
    // take roughly 270 seconds even when every request succeeds.
    const deadline = Date.now() + 360_000;
    while (Date.now() < deadline) {
      const now = Date.now();
      try {
        await this.#client.send(new UpdateCommand({
          TableName: this.#tableName,
          Key: key,
          UpdateExpression: "SET nextAllowedAt = :next",
          ConditionExpression: "attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now",
          ExpressionAttributeValues: { ":next": now + this.#delayMs, ":now": now },
        }));
        return;
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
      }
      const current = await this.#client.send(new GetCommand({
        TableName: this.#tableName,
        Key: key,
        ConsistentRead: true,
      }));
      const nextAt = Number(current.Item?.nextAllowedAt);
      if (!Number.isFinite(nextAt)) throw new Error("Source pacing state is invalid");
      await wait(Math.min(Math.max(250, nextAt - Date.now()), 30_000));
    }
    throw new Error(`Timed out waiting for the ${url.hostname} crawl delay`);
  }
}
