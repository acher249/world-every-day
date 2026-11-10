import { createHmac } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import initialSourceConfiguration from "../../config/source-configuration.initial.v1.json" with { type: "json" };
import { GeminiJsonClient } from "../gemini/client.js";
import { parseGoogleKey } from "../cloud/google-secret.js";
import { parseSourceConfiguration } from "../sources/config.js";
import { createWorldGuideResearchService } from "./research.js";
import {
  createHostedWorldGuideHandler,
  type HostedWorldGuideLease,
  type HostedWorldGuideEvent,
} from "./hosted-handler.js";
import { worldGuideContextSchema } from "./contracts.js";
import { readWorldGuideBudget } from "./budget.js";

const budget = readWorldGuideBudget();

const tableName = process.env.WORLD_GUIDE_TABLE?.trim() ?? "";
const enabledParameter = process.env.WORLD_GUIDE_ENABLED_PARAMETER?.trim() ?? "";
const researchParameter = process.env.WORLD_GUIDE_RESEARCH_PARAMETER?.trim() ?? "";
const elevenLabsSecretName = process.env.ELEVENLABS_SECRET_NAME?.trim() ?? "";
const googleSecretName = process.env.GOOGLE_SECRET_NAME?.trim() ?? "";
const agentId = process.env.WORLD_GUIDE_AGENT_ID?.trim() ?? "";
const allowedOrigin = process.env.WORLD_GUIDE_ALLOWED_ORIGIN?.trim() ?? "";
const researchModel = process.env.WORLD_GUIDE_RESEARCH_MODEL?.trim() || "gemini-3.8-flash";

const database = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const secrets = new SecretsManagerClient({});
const parameters = new SSMClient({});

let cachedCredentials: { apiKey: string; expiresAt: number } | undefined;
let cachedFlags: { enabled: boolean; researchEnabled: boolean; expiresAt: number } | undefined;
let cachedResearch: ReturnType<typeof createWorldGuideResearchService> | undefined;

async function readCredentials() {
  if (cachedCredentials && cachedCredentials.expiresAt > Date.now()) return cachedCredentials;
  if (!elevenLabsSecretName) throw new Error("World Guide credential secret is not configured");
  const response = await secrets.send(new GetSecretValueCommand({ SecretId: elevenLabsSecretName }));
  if (!response.SecretString) throw new Error("World Guide credential secret has no string value");
  let value: unknown;
  try {
    value = JSON.parse(response.SecretString) as unknown;
  } catch {
    throw new Error("World Guide credential secret must be a JSON object");
  }
  if (typeof value !== "object" || value === null || !("apiKey" in value) || typeof value.apiKey !== "string" || !value.apiKey.trim()) {
    throw new Error("World Guide credential secret is missing apiKey");
  }
  cachedCredentials = { apiKey: value.apiKey.trim(), expiresAt: Date.now() + 60_000 };
  return cachedCredentials;
}

async function readFlags() {
  if (cachedFlags && cachedFlags.expiresAt > Date.now()) return cachedFlags;
  if (!enabledParameter || !researchParameter) return { enabled: false, researchEnabled: false, expiresAt: Date.now() + 3_000 };
  try {
    const [enabled, research] = await Promise.all([
      parameters.send(new GetParameterCommand({ Name: enabledParameter, WithDecryption: false })),
      parameters.send(new GetParameterCommand({ Name: researchParameter, WithDecryption: false })),
    ]);
    cachedFlags = {
      enabled: enabled.Parameter?.Value === "true",
      researchEnabled: research.Parameter?.Value === "true",
      expiresAt: Date.now() + 3_000,
    };
    return cachedFlags;
  } catch {
    cachedFlags = { enabled: false, researchEnabled: false, expiresAt: Date.now() + 1_000 };
    return cachedFlags;
  }
}

function ipHash(sourceIp: string, day: string, key: string) {
  return createHmac("sha256", key).update(`${day}:${sourceIp}`).digest("hex");
}

function cancellationReasons(error: unknown) {
  if (!error || typeof error !== "object" || !("CancellationReasons" in error)) return [];
  const reasons = error.CancellationReasons;
  return Array.isArray(reasons) ? reasons as Array<{ Code?: string }> : [];
}

async function createLease(
  lease: HostedWorldGuideLease,
  sourceIp: string,
  dailyLimit: number,
  perIpLimit: number,
) {
  const credentials = await readCredentials();
  if (!budget.configured) return "daily_limit_reached" as const;
  const day = new Date().toISOString().slice(0, 10);
  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;
  try {
    await database.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: { PK: `LIMIT#BUDGET#${day}`, SK: "COUNT" },
            UpdateExpression: "SET #ttl = if_not_exists(#ttl, :expiresAt) ADD reservedCents :reservation",
            ConditionExpression: "attribute_not_exists(reservedCents) OR reservedCents <= :remaining",
            ExpressionAttributeNames: { "#ttl": "ttl" },
            ExpressionAttributeValues: {
              ":expiresAt": expiresAt, ":reservation": budget.sessionCents,
              ":remaining": budget.dailyCents - budget.sessionCents,
            },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: { PK: `LIMIT#SESSION#${day}`, SK: "COUNT" },
            UpdateExpression: "SET #ttl = if_not_exists(#ttl, :expiresAt) ADD #count :one",
            ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
            ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
            ExpressionAttributeValues: { ":expiresAt": expiresAt, ":one": 1, ":limit": dailyLimit },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: { PK: `LIMIT#IP#${day}#${ipHash(sourceIp, day, credentials.apiKey)}`, SK: "COUNT" },
            UpdateExpression: "SET #ttl = if_not_exists(#ttl, :expiresAt) ADD #count :one",
            ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
            ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
            ExpressionAttributeValues: { ":expiresAt": expiresAt, ":one": 1, ":limit": perIpLimit },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              PK: `SESSION#${lease.sessionId}`,
              SK: "LEASE",
              sessionId: lease.sessionId,
              context: lease.context,
              researchCount: 0,
              expiresAt: lease.expiresAt,
              ttl: lease.expiresAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
    }));
    return true;
  } catch (error) {
    const reasons = cancellationReasons(error);
    if (reasons[0]?.Code === "ConditionalCheckFailed") return "daily_limit_reached" as const;
    if (reasons.some(({ Code }) => Code === "ConditionalCheckFailed")) return false;
    throw error;
  }
}

async function dailyAllowanceAvailable() {
  if (!budget.configured) return false;
  const day = new Date().toISOString().slice(0, 10);
  const result = await database.send(new GetCommand({
    TableName: tableName, Key: { PK: `LIMIT#BUDGET#${day}`, SK: "COUNT" }, ConsistentRead: true,
  }));
  const reserved = result.Item?.reservedCents ?? 0;
  return Number.isSafeInteger(reserved) && reserved >= 0 && reserved <= budget.dailyCents - budget.sessionCents;
}

async function findLease(sessionId: string): Promise<HostedWorldGuideLease | null> {
  const result = await database.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: "LEASE" },
    ConsistentRead: true,
  }));
  const item = result.Item;
  if (!item || typeof item.expiresAt !== "number" || typeof item.researchCount !== "number") return null;
  return {
    sessionId,
    expiresAt: item.expiresAt,
    context: worldGuideContextSchema.parse(item.context),
    researchCount: item.researchCount,
  };
}

async function reserveResearch(sessionId: string, day: string, dailyLimit: number, nowSeconds: number) {
  const ttl = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;
  try {
    await database.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: { PK: `LIMIT#RESEARCH#${day}`, SK: "COUNT" },
            UpdateExpression: "SET #ttl = if_not_exists(#ttl, :expiresAt) ADD #count :one",
            ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
            ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
            ExpressionAttributeValues: { ":expiresAt": ttl, ":one": 1, ":limit": dailyLimit },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: { PK: `SESSION#${sessionId}`, SK: "LEASE" },
            UpdateExpression: "ADD #researchCount :one",
            ConditionExpression: "attribute_exists(PK) AND expiresAt > :now AND (attribute_not_exists(#researchCount) OR #researchCount < :max)",
            ExpressionAttributeNames: { "#researchCount": "researchCount" },
            ExpressionAttributeValues: { ":one": 1, ":now": nowSeconds, ":max": 4 },
          },
        },
      ],
    }));
    return await findLease(sessionId);
  } catch (error) {
    const reasons = cancellationReasons(error);
    if (reasons.some(({ Code }) => Code === "ConditionalCheckFailed")) return null;
    throw error;
  }
}

async function deleteLease(sessionId: string) {
  await database.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: "LEASE" },
  }));
}

async function getConversationToken() {
  if (!/^agent_[A-Za-z0-9]+$/.test(agentId)) throw new Error("World Guide agent ID is not configured");
  const { apiKey } = await readCredentials();
  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/token");
  url.searchParams.set("agent_id", agentId);
  const response = await fetch(url, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("ElevenLabs conversation token request failed");
  const body = await response.json() as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) throw new Error("ElevenLabs did not return a conversation token");
  return body.token;
}

async function getResearchService() {
  if (cachedResearch) return cachedResearch;
  if (!googleSecretName) return undefined;
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: googleSecretName }));
  if (!secret.SecretString) return undefined;
  const apiKey = parseGoogleKey(secret.SecretString);
  cachedResearch = createWorldGuideResearchService({
    sourceConfiguration: parseSourceConfiguration(initialSourceConfiguration),
    maxSources: 2,
    fetchTimeoutMs: 4_000,
    maxModelAttempts: 1,
    client: new GeminiJsonClient({ apiKey, model: researchModel, timeoutMs: 12_000 }),
  });
  return cachedResearch;
}

const handler = createHostedWorldGuideHandler({
  allowedOrigin,
  dailySessionLimit: 25,
  perIpDailySessionLimit: 5,
  dailyResearchLimit: 20,
}, {
  isEnabled: async () => {
    if (!budget.configured || !(await readFlags()).enabled || !/^agent_[A-Za-z0-9]+$/.test(agentId)) return false;
    try {
      await readCredentials();
      return true;
    } catch {
      return false;
    }
  },
  isResearchEnabled: async () => (await readFlags()).researchEnabled,
  dailyAllowanceAvailable,
  createLease,
  findLease,
  reserveResearch,
  deleteLease,
  getConversationToken,
  getResearchService,
});

export async function main(event: HostedWorldGuideEvent) {
  if (!tableName || !allowedOrigin) {
    return {
      statusCode: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "world_guide_unavailable" }),
    };
  }
  return handler(event);
}
