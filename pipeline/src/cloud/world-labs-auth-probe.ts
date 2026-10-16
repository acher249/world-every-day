import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

const inputSchema = z.object({ confirmReadOnlyProbe: z.literal(true) });
const LIST_WORLDS_URL = "https://api.worldlabs.ai/marble/v1/worlds:list";

export function parseWorldLabsKey(secret: string): string {
  let key = secret.trim();
  if (key.startsWith("{")) {
    const parsed: unknown = JSON.parse(key);
    if (!parsed || typeof parsed !== "object" || !("WORLD_LABS_KEY" in parsed) ||
        typeof parsed.WORLD_LABS_KEY !== "string") {
      throw new Error("World Labs secret JSON must contain WORLD_LABS_KEY");
    }
    key = parsed.WORLD_LABS_KEY.trim();
  }
  if (!key) throw new Error("World Labs secret is empty");
  return key;
}

export function createWorldLabsAuthProbe({
  fetchImpl = globalThis.fetch,
  readSecret,
}: {
  fetchImpl?: typeof globalThis.fetch;
  readSecret: () => Promise<string>;
}) {
  return async (rawInput: unknown) => {
    inputSchema.parse(rawInput);
    const key = parseWorldLabsKey(await readSecret());
    let response: Response;
    try {
      response = await fetchImpl(LIST_WORLDS_URL, {
        method: "POST",
        headers: { "WLT-Api-Key": key, "Content-Type": "application/json" },
        body: "{}",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("World Labs authentication probe could not reach the API");
    }
    await response.body?.cancel();
    return {
      authenticated: response.ok,
      httpStatus: response.status,
      operation: "list-worlds",
    };
  };
}

export async function main(event: unknown) {
  const secretId = process.env.WORLD_LABS_SECRET_NAME?.trim();
  if (!secretId) throw new Error("Missing required environment variable: WORLD_LABS_SECRET_NAME");
  const secrets = new SecretsManagerClient({});
  return createWorldLabsAuthProbe({
    async readSecret() {
      const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      if (!response.SecretString) throw new Error("World Labs secret must contain a string value");
      return response.SecretString;
    },
  })(event);
}
