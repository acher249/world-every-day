import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";
import { announcementRecordPrefix, createDailyPostHandler } from "../social/daily-post.js";
import { createXClient, xCredentialsSchema, XRequestError } from "../social/x-client.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { z } from "zod";
import { sha256 } from "../panorama/hash.js";
import { videoManifestSchema } from "../video/manifest.js";
import { jobRefSchema, videoManifestKey } from "../video/job.js";

async function sendDailyPost(event: unknown) {
  if (process.env.X_POSTING_ENABLED !== "true") return { status: "disabled" };
  const recordPrefix = announcementRecordPrefix(event);
  if (recordPrefix.includes("/announcements/") && process.env.X_REQUIRE_VIDEO !== "true") {
    throw new Error("Video announcements require the video-enabled delivery stage");
  }
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
    ...(process.env.X_REQUIRE_VIDEO === "true" ? {
      async prepareMedia(editionId: string) {
        const { video } = z.object({ video: jobRefSchema.extend({ status: z.literal("ready") }) }).parse(event);
        if (video.editionId !== editionId) throw new Error("Video edition mismatch");
        const bytes = await store.read(videoManifestKey(video));
        if (!bytes) throw new Error("Completed video manifest missing");
        const manifest = videoManifestSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
        if (manifest.jobId !== video.jobId || manifest.editionId !== editionId ||
            manifest.mp4.key !== `generated/editions/${editionId}/video/${video.jobId}/tour.mp4`) throw new Error("Video identity mismatch");
        const publicStore = new S3ArtifactStore({ bucket: process.env.PUBLIC_ASSET_BUCKET!, client: s3 });
        const input = z.object({ publication: z.object({ key: z.string() }) }).parse(event);
        const publication = await publicStore.read(input.publication.key);
        if (!publication || sha256(Buffer.from(publication)) !== manifest.publicationSha256) throw new Error("Video publication changed");
        const mediaKey = `social/x/${editionId}/media-${manifest.mp4.sha256}.json`;
        const old = await store.read(mediaKey);
        if (old) {
          const saved = z.object({ id: z.string().regex(/^\d+$/), expiresAt: z.iso.datetime() }).parse(JSON.parse(Buffer.from(old).toString("utf8")));
          if (Date.parse(saved.expiresAt) > Date.now() + 300_000) return saved.id;
        }
        const mp4 = await publicStore.read(manifest.mp4.key);
        if (!mp4 || mp4.byteLength !== manifest.mp4.byteLength || sha256(Buffer.from(mp4)) !== manifest.mp4.sha256) throw new Error("Video bytes changed");
        const uploaded = await client.uploadVideo(mp4);
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: mediaKey, Body: JSON.stringify(uploaded), ContentType: "application/json" }));
        return uploaded.id;
      },
    } : {}),
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
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${recordPrefix}/attempt.json`,
          IfNoneMatch: "*", ContentType: "application/json",
          Body: JSON.stringify({ attemptId: randomUUID(), attemptedAt: new Date().toISOString(), text }) }));
        return true;
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) return false;
        throw error;
      }
    },
    async receipt(editionId, postId) {
      await store.putImmutable({ key: `${recordPrefix}/receipt.json`, contentType: "application/json",
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

/** Serialize token rotation even where account quotas prevent reserved concurrency. */
export async function main(event: unknown) {
  if (process.env.X_POSTING_ENABLED !== "true") return { status: "disabled" };
  const s3 = new S3Client({});
  const Bucket = process.env.ARTIFACT_BUCKET!;
  const Key = "social/x/worker-lock.json";
  let etag: string | undefined;
  try {
    const old = await s3.send(new GetObjectCommand({ Bucket, Key }));
    const value = z.object({ expiresAt: z.number() }).parse(JSON.parse(await old.Body!.transformToString()));
    if (value.expiresAt > Date.now()) throw new Error("X worker already active; retry after it finishes");
    etag = old.ETag;
    if (!etag) throw new Error("X lock has no ETag");
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
  }
  const lock = await s3.send(new PutObjectCommand({ Bucket, Key,
    ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }), ContentType: "application/json",
    Body: JSON.stringify({ owner: randomUUID(), expiresAt: Date.now() + 15 * 60_000 }) }));
  try { return await sendDailyPost(event); }
  finally { if (lock.ETag) await s3.send(new DeleteObjectCommand({ Bucket, Key, IfMatch: lock.ETag })); }
}
