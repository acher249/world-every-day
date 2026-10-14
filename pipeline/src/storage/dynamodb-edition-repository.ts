import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  assertEditionTransition,
  editionStateSchema,
  type CurrentPublication,
  type EditionRepository,
  type EditionState,
} from "./edition-repository.js";
import { validateArtifactKey } from "./artifact-store.js";

type DocumentClientLike = Pick<DynamoDBDocumentClient, "send">;

const STATE_SK = "STATE";
const CURRENT_PK = "PUBLICATION";
const CURRENT_SK = "CURRENT";

function editionPk(editionId: string): string {
  return `EDITION#${editionStateSchema.shape.editionId.parse(editionId)}`;
}

function isConditionalFailure(error: unknown): boolean {
  return error instanceof Error && [
    "ConditionalCheckFailedException",
    "TransactionCanceledException",
  ].includes(error.name);
}

function conditionMessage(action: string, editionId: string): Error {
  return new Error(`Could not ${action} edition ${editionId} because its state changed`);
}

function parseEditionItem(item: Record<string, unknown>): EditionState {
  const lock = typeof item.lockOwner === "string" && typeof item.lockExpiresAt === "string"
    ? { owner: item.lockOwner, expiresAt: item.lockExpiresAt }
    : undefined;
  return editionStateSchema.parse({ ...item, lock });
}

export class DynamoDbEditionRepository implements EditionRepository {
  readonly #client: DocumentClientLike;
  readonly #tableName: string;

  constructor(options: {
    client?: DocumentClientLike;
    clientConfig?: DynamoDBClientConfig;
    tableName: string;
  }) {
    if (!options.tableName.trim()) throw new Error("DynamoDB edition table is required");
    this.#client = options.client ?? DynamoDBDocumentClient.from(
      new DynamoDBClient(options.clientConfig ?? {}),
      { marshallOptions: { removeUndefinedValues: true } },
    );
    this.#tableName = options.tableName;
  }

  async createDraft(editionId: string, createdAt: Date): Promise<EditionState> {
    const timestamp = createdAt.toISOString();
    const state = editionStateSchema.parse({
      editionId,
      status: "DRAFT",
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    try {
      await this.#client.send(new PutCommand({
        TableName: this.#tableName,
        Item: { PK: editionPk(editionId), SK: STATE_SK, ...state },
        ConditionExpression: "attribute_not_exists(PK)",
      }));
      return state;
    } catch (error) {
      if (isConditionalFailure(error)) throw conditionMessage("create", editionId);
      throw error;
    }
  }

  async get(editionId: string): Promise<EditionState | null> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.#tableName,
      Key: { PK: editionPk(editionId), SK: STATE_SK },
      ConsistentRead: true,
    }));
    return response.Item ? parseEditionItem(response.Item) : null;
  }

  async acquireLock({
    editionId,
    expiresAt,
    now,
    owner,
  }: Parameters<EditionRepository["acquireLock"]>[0]): Promise<EditionState> {
    if (!owner.trim()) throw new Error("Edition lock owner is required");
    if (expiresAt.getTime() <= now.getTime()) {
      throw new Error("Edition lock expiration must be in the future");
    }
    try {
      const response = await this.#client.send(new UpdateCommand({
        TableName: this.#tableName,
        Key: { PK: editionPk(editionId), SK: STATE_SK },
        UpdateExpression:
          "SET lockOwner = :owner, lockExpiresAt = :expiresAt, updatedAt = :now ADD revision :one",
        ConditionExpression:
          "attribute_exists(PK) AND (attribute_not_exists(lockExpiresAt) OR lockExpiresAt < :now OR lockOwner = :owner)",
        ExpressionAttributeValues: {
          ":owner": owner,
          ":expiresAt": expiresAt.toISOString(),
          ":now": now.toISOString(),
          ":one": 1,
        },
        ReturnValues: "ALL_NEW",
      }));
      if (!response.Attributes) throw new Error("DynamoDB returned no locked edition state");
      return parseEditionItem(response.Attributes);
    } catch (error) {
      if (isConditionalFailure(error)) throw conditionMessage("lock", editionId);
      throw error;
    }
  }

  async transition({
    editionId,
    expected,
    next,
    now,
  }: Parameters<EditionRepository["transition"]>[0]): Promise<EditionState> {
    assertEditionTransition(expected, next);
    try {
      const response = await this.#client.send(new UpdateCommand({
        TableName: this.#tableName,
        Key: { PK: editionPk(editionId), SK: STATE_SK },
        UpdateExpression: "SET #status = :next, updatedAt = :now ADD revision :one",
        ConditionExpression: "#status = :expected",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":expected": expected,
          ":next": next,
          ":now": now.toISOString(),
          ":one": 1,
        },
        ReturnValues: "ALL_NEW",
      }));
      if (!response.Attributes) throw new Error("DynamoDB returned no transitioned edition state");
      return parseEditionItem(response.Attributes);
    } catch (error) {
      if (isConditionalFailure(error)) throw conditionMessage("transition", editionId);
      throw error;
    }
  }

  async releaseLock({
    editionId,
    now,
    owner,
  }: Parameters<EditionRepository["releaseLock"]>[0]): Promise<EditionState> {
    try {
      const response = await this.#client.send(new UpdateCommand({
        TableName: this.#tableName,
        Key: { PK: editionPk(editionId), SK: STATE_SK },
        UpdateExpression:
          "SET updatedAt = :now REMOVE lockOwner, lockExpiresAt ADD revision :one",
        ConditionExpression: "lockOwner = :owner",
        ExpressionAttributeValues: {
          ":owner": owner,
          ":now": now.toISOString(),
          ":one": 1,
        },
        ReturnValues: "ALL_NEW",
      }));
      if (!response.Attributes) throw new Error("DynamoDB returned no unlocked edition state");
      return parseEditionItem(response.Attributes);
    } catch (error) {
      if (isConditionalFailure(error)) throw conditionMessage("unlock", editionId);
      throw error;
    }
  }

  async fail({
    editionId,
    message,
    now,
    owner,
    stage,
  }: Parameters<EditionRepository["fail"]>[0]): Promise<EditionState> {
    const failure = editionStateSchema.shape.failure.unwrap().parse({ stage, message });
    try {
      const response = await this.#client.send(new UpdateCommand({
        TableName: this.#tableName,
        Key: { PK: editionPk(editionId), SK: STATE_SK },
        UpdateExpression:
          "SET #status = :failed, updatedAt = :now, failure = :failure REMOVE lockOwner, lockExpiresAt ADD revision :one",
        ConditionExpression:
          "attribute_exists(PK) AND lockOwner = :owner AND #status <> :failed AND #status <> :published",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":published": "PUBLISHED",
          ":failure": failure,
          ":now": now.toISOString(),
          ":one": 1,
          ":owner": owner,
        },
        ReturnValues: "ALL_NEW",
      }));
      if (!response.Attributes) throw new Error("DynamoDB returned no failed edition state");
      return parseEditionItem(response.Attributes);
    } catch (error) {
      if (isConditionalFailure(error)) throw conditionMessage("fail", editionId);
      throw error;
    }
  }

  async publish({
    editionId,
    manifestKey,
    now,
  }: Parameters<EditionRepository["publish"]>[0]): Promise<CurrentPublication> {
    const publishedAt = now.toISOString();
    const safeManifestKey = validateArtifactKey(manifestKey);
    try {
      await this.#client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.#tableName,
              Key: { PK: editionPk(editionId), SK: STATE_SK },
              UpdateExpression:
                "SET #status = :published, updatedAt = :now, publicationManifestKey = :manifest ADD revision :one",
              ConditionExpression: "#status = :approved",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":approved": "QA_APPROVED",
                ":published": "PUBLISHED",
                ":now": publishedAt,
                ":manifest": safeManifestKey,
                ":one": 1,
              },
            },
          },
          {
            Put: {
              TableName: this.#tableName,
              Item: {
                PK: CURRENT_PK,
                SK: CURRENT_SK,
                editionId,
                manifestKey: safeManifestKey,
                publishedAt,
              },
              ConditionExpression:
                "attribute_not_exists(PK) OR publishedAt < :publishedAt",
              ExpressionAttributeValues: {
                ":publishedAt": publishedAt,
              },
            },
          },
        ],
      }));
      return { editionId, manifestKey: safeManifestKey, publishedAt };
    } catch (error) {
      if (isConditionalFailure(error)) {
        const [state, current] = await Promise.all([
          this.get(editionId),
          this.getCurrentPublication(),
        ]);
        if (
          state?.status === "PUBLISHED" &&
          state.publicationManifestKey === safeManifestKey &&
          current?.editionId === editionId &&
          current.manifestKey === safeManifestKey
        ) return current;
        throw conditionMessage("publish", editionId);
      }
      throw error;
    }
  }

  async getCurrentPublication(): Promise<CurrentPublication | null> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.#tableName,
      Key: { PK: CURRENT_PK, SK: CURRENT_SK },
      ConsistentRead: true,
    }));
    if (!response.Item) return null;
    const { editionId, manifestKey, publishedAt } = response.Item;
    if (
      typeof editionId !== "string" ||
      typeof manifestKey !== "string" ||
      typeof publishedAt !== "string"
    ) throw new Error("Current-publication record is invalid");
    return { editionId, manifestKey, publishedAt };
  }
}

