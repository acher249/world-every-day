import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

export const xOAuth2CredentialsSchema = z.object({
  X_CLIENT_ID: z.string().min(1),
  X_CLIENT_SECRET: z.string().min(1),
  X_OAUTH2_ACCESS_TOKEN: z.string().min(1),
  X_REFRESH_TOKEN: z.string().min(1),
});
export type OAuth2Credentials = z.infer<typeof xOAuth2CredentialsSchema>;
const oauth1CredentialsSchema = z.object({
  X_API_KEY: z.string().min(1),
  X_API_KEY_SECRET: z.string().min(1),
  X_ACCESS_TOKEN: z.string().min(1),
  X_ACCESS_TOKEN_SECRET: z.string().min(1),
});
export const xCredentialsSchema = z.union([xOAuth2CredentialsSchema, oauth1CredentialsSchema]);
type Credentials = z.infer<typeof oauth1CredentialsSchema>;
export class XRequestError extends Error {
  constructor(readonly status: number) {
    super(`X request failed (${status})`);
    this.name = "XRequestError";
  }
}
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,
  (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

// JSON request bodies are not included in OAuth 1.0a's signature parameters.
export function authorization(method: string, url: string, keys: Credentials,
  nonce = randomBytes(16).toString("hex"), timestamp = String(Math.floor(Date.now() / 1000))) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.X_API_KEY, oauth_token: keys.X_ACCESS_TOKEN,
    oauth_nonce: nonce, oauth_timestamp: timestamp,
    oauth_signature_method: "HMAC-SHA1", oauth_version: "1.0",
  };
  const parsed = new URL(url);
  const parameters = [...parsed.searchParams, ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join("&");
  const base = [method.toUpperCase(), `${parsed.origin}${parsed.pathname}`, parameters].map(encode).join("&");
  oauth.oauth_signature = createHmac("sha1", `${encode(keys.X_API_KEY_SECRET)}&${encode(keys.X_ACCESS_TOKEN_SECRET)}`)
    .update(base).digest("base64");
  return `OAuth ${Object.entries(oauth).sort().map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(", ")}`;
}

export function createXClient(keys: z.infer<typeof xCredentialsSchema>, request: typeof fetch = fetch,
  persist?: (credentials: OAuth2Credentials) => Promise<void>) {
  let credentials = keys;
  async function refresh() {
    if (!("X_CLIENT_ID" in credentials) || !persist) throw new Error("X OAuth refresh requires durable credential storage");
    const response = await request("https://api.x.com/2/oauth2/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${encode(credentials.X_CLIENT_ID)}:${encode(credentials.X_CLIENT_SECRET)}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.X_REFRESH_TOKEN }).toString(),
    });
    if (!response.ok) throw new XRequestError(response.status);
    const parsed = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1),
      token_type: z.string().refine((value) => value.toLowerCase() === "bearer") }).safeParse(await response.json());
    if (!parsed.success) throw new Error("X refresh response was invalid");
    const updated = { ...credentials, X_OAUTH2_ACCESS_TOKEN: parsed.data.access_token, X_REFRESH_TOKEN: parsed.data.refresh_token };
    // Persist the rotated pair before doing anything with it. Never retry a refresh blindly.
    await persist(updated);
    credentials = updated;
  }
  async function call(path: string, text?: string, mediaId?: string) {
    const method = text === undefined ? "GET" : "POST";
    const url = `https://api.x.com/2/${path}`;
    const response = await request(url, {
      method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: "X_CLIENT_ID" in credentials
        ? `Bearer ${credentials.X_OAUTH2_ACCESS_TOKEN}` : authorization(method, url, credentials), "Content-Type": "application/json" },
      ...(text === undefined ? {} : { body: JSON.stringify({ text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }) }),
    });
    // Do not include provider response bodies or credentials in execution logs.
    if (!response.ok) throw new XRequestError(response.status);
    return z.object({ data: z.object({ id: z.string().regex(/^\d+$/) }) }).parse(await response.json()).data.id;
  }
  return {
    async uploadVideo(bytes: Uint8Array): Promise<{ id: string; expiresAt: string }> {
      if (!("X_CLIENT_ID" in credentials)) throw new Error("Video upload requires OAuth 2.0 credentials with media.write scope");
      if (bytes.byteLength < 1 || bytes.byteLength > 50 * 1024 * 1024) throw new Error("Video upload must be between 1 byte and 50 MiB");
      const upload = async (path: string, body?: BodyInit, json = false) => {
        if (!("X_CLIENT_ID" in credentials)) throw new Error("OAuth 2.0 required");
        const response = await request(`https://api.x.com/2/${path}`, {
          method: body === undefined && path.includes("?") ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${credentials.X_OAUTH2_ACCESS_TOKEN}`, ...(json ? { "Content-Type": "application/json" } : {}) },
          ...(body === undefined ? {} : { body }),
        });
        if (!response.ok) throw new XRequestError(response.status);
        if (response.status === 204) return {};
        const text = await response.text();
        return text ? JSON.parse(text) as unknown : {};
      };
      const uploadStarted = Date.now();
      const initialized = z.object({ data: z.object({ id: z.string().regex(/^\d+$/), expires_after_secs: z.number().positive() }) }).parse(
        await upload("media/upload/initialize", JSON.stringify({ media_type: "video/mp4", total_bytes: bytes.byteLength, media_category: "tweet_video" }), true));
      const id = initialized.data.id;
      for (let offset = 0, segment = 0; offset < bytes.byteLength; offset += 4 * 1024 * 1024, segment++) {
        const form = new FormData();
        form.set("segment_index", String(segment));
        form.set("media", new Blob([Uint8Array.from(bytes.subarray(offset, offset + 4 * 1024 * 1024))], { type: "video/mp4" }), "segment.mp4");
        await upload(`media/upload/${id}/append`, form);
      }
      const resultSchema = z.object({ data: z.object({ processing_info: z.object({
        state: z.enum(["pending", "in_progress", "succeeded", "failed"]), check_after_secs: z.number().nonnegative().optional(),
      }).optional() }) });
      let result = resultSchema.parse(await upload(`media/upload/${id}/finalize`));
      const deadline = Date.now() + 180_000;
      while (result.data.processing_info && result.data.processing_info.state !== "succeeded") {
        if (result.data.processing_info.state === "failed") throw new Error("X video processing failed");
        const delay = Math.max(1, result.data.processing_info.check_after_secs ?? 1) * 1000;
        if (Date.now() + delay > deadline) throw new Error("X video processing exceeded deadline");
        await new Promise((resolve) => setTimeout(resolve, delay));
        result = resultSchema.parse(await upload(`media/upload?command=STATUS&media_id=${id}`));
      }
      return { id, expiresAt: new Date(uploadStarted + initialized.data.expires_after_secs * 1000).toISOString() };
    },
    async accountId() {
      try { return await call("users/me"); }
      catch (error) {
        if (!(error instanceof XRequestError) || error.status !== 401 || !("X_CLIENT_ID" in credentials)) throw error;
        await refresh();
        return call("users/me");
      }
    },
    // Posting is intentionally never retried, even on 401: callers verify the account first.
    post: (text: string, mediaId?: string) => call("tweets", text, mediaId),
  };
}
