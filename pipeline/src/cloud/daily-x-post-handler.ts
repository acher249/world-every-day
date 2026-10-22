import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";
import { createDailyPostHandler } from "../social/daily-post.js";
import { createXClient, xCredentialsSchema, XRequestError } from "../social/x-client.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";

export async function main(event: unknown) {
  if (process.env.X_POSTING_ENABLED !== "true") return { status: "disabled" };
  const bucket = process.env.ARTIFACT_BUCKET!;
  const origin = process.env.EXPLORER_ORIGIN!;
  if (new URL(origin).protocol !== "https:") throw new Error("HTTPS explorer origin required");
  const s3 = new S3Client({});
  const store = new S3ArtifactStore({ bucket, client: s3 });
  const secrets = new SecretsManagerClient({});
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.X_SECRET_NAME }));
  let parsedSecret: unknown;
  try { parsedSecret = JSON.parse(secret.SecretString ?? "{}"); }
  catch { throw new Error("X secret must be a JSON object"); }
  const credentials = xCredentialsSchema.safeParse(parsedSecret);
  if (!credentials.success) throw new Error("X secret requires a complete OAuth 2.0 or OAuth 1.0a credential set");
  const client = createXClient(credentials.data, fetch, async (updated) => {
    await secrets.send(new PutSecretValueCommand({ SecretId: process.env.X_SECRET_NAME, SecretString: JSON.stringify(updated) }));
  });
  const handler = createDailyPostHandler({
    enabled: true, origin, projectOrigin: process.env.PROJECT_ORIGIN!, expectedAccountId: process.env.X_EXPECTED_ACCOUNT_ID ?? "",
    ...client,
    async verifyPublication(editionId, key) {
      if (key !== `generated/editions/${editionId}/publication.json` &&
          key !== `generated/editions/${editionId}/publication-public.json`) throw new Error("Unexpected publication key");
      const publicStore = new S3ArtifactStore({ bucket: process.env.PUBLIC_ASSET_BUCKET!, client: s3 });
      const stored = await publicStore.read(key);
      const response = await fetch(new URL(`/${key}`, origin), { redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok || !stored || !Buffer.from(await response.arrayBuffer()).equals(Buffer.from(stored))) {
        throw new Error("Public edition is not available or does not match publication");
      }
      const manifest = JSON.parse(Buffer.from(stored).toString("utf8"));
      for (const path of ["/", manifest.world.poster.src, manifest.world.splat?.url]) {
        const url = new URL(path, origin);
        if (url.origin !== new URL(origin).origin) throw new Error("Public asset must use explorer origin");
        const check = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!check.ok) throw new Error("Public explorer or world asset is unavailable");
      }
      return manifest;
    },
    async claim(editionId, text) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `social/x/${editionId}/attempt.json`,
          IfNoneMatch: "*", ContentType: "application/json",
          Body: JSON.stringify({ attemptId: randomUUID(), attemptedAt: new Date().toISOString(), text }) }));
        return true;
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) return false;
        throw error;
      }
    },
    async receipt(editionId, postId) {
      await store.putImmutable({ key: `social/x/${editionId}/receipt.json`, contentType: "application/json",
        bytes: Buffer.from(JSON.stringify({ editionId, postId })) });
      if (!/^\d{1,30}$/.test(postId)) throw new Error("Invalid X post ID");
      await s3.send(new PutObjectCommand({
        Bucket: process.env.PUBLIC_ASSET_BUCKET!, Key: "generated/social/latest.json",
        ContentType: "application/json", CacheControl: "no-store",
        Body: JSON.stringify({ schemaVersion: "1.0.0", editionId, postId }),
      }));
    },
  });
  try { return await handler(event); }
  catch (error) {
    // Preserve only our own sanitized HTTP status, never a provider response body.
    const status = error instanceof XRequestError ? ` (X HTTP ${error.status})` : "";
    throw new Error(`Daily X post failed${status}; inspect social/x attempt and receipt before retrying`);
  }
}
