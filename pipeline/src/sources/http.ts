import { isIP } from "node:net";
import { hostnameAllowed } from "./url.js";
import type { RequestPacer } from "./pacing.js";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_AFTER_MS = 5_000;
const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

export type FetchedResource = {
  body: Buffer;
  contentType: string;
  etag?: string;
  lastModified?: string;
  url: string;
};

export type ResourceFetcher = {
  fetch(url: string): Promise<FetchedResource>;
};

export class SourceFetchError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = "SourceFetchError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(value: string | null, attempt: number): number {
  const seconds = value === null ? Number.NaN : Number(value);
  const retryAt = value === null ? Number.NaN : Date.parse(value);
  const requested = Number.isFinite(seconds) ? seconds * 1_000 :
    Number.isFinite(retryAt) ? retryAt - Date.now() : DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1);
  return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, requested));
}

function assertPublicAllowedUrl(value: string, allowedHosts: readonly string[]): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Source fetches must use HTTPS");
  if (url.username || url.password) throw new Error("Source fetches must not use embedded credentials");
  if (!hostnameAllowed(url, allowedHosts)) {
    throw new Error(`Source host is not allowlisted: ${url.hostname}`);
  }
  const ipVersion = isIP(url.hostname);
  if (
    url.hostname === "localhost" ||
    (ipVersion === 4 && PRIVATE_IPV4.some((pattern) => pattern.test(url.hostname))) ||
    (ipVersion === 6 && (url.hostname === "::1" || url.hostname.startsWith("fc") || url.hostname.startsWith("fd") || url.hostname.startsWith("fe80:")))
  ) {
    throw new Error("Private or local source hosts are not allowed");
  }
  return url;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Source response exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      total += bytes.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Source response exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(bytes);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export class AllowlistedHttpFetcher implements ResourceFetcher {
  readonly #allowedHosts: readonly string[];
  readonly #fetch: typeof fetch;
  readonly #maxBytes: number;
  readonly #timeoutMs: number;
  readonly #pacer?: RequestPacer;
  readonly #retryAttempts: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor({
    allowedHosts,
    fetchImpl = globalThis.fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = 15_000,
    pacer,
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: {
    allowedHosts: readonly string[];
    fetchImpl?: typeof fetch;
    maxBytes?: number;
    timeoutMs?: number;
    pacer?: RequestPacer;
    retryAttempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  }) {
    if (allowedHosts.length === 0) throw new Error("At least one source host is required");
    if (!Number.isInteger(retryAttempts) || retryAttempts < 1 || retryAttempts > 5) {
      throw new Error("Source retry attempts must be an integer from 1 to 5");
    }
    this.#allowedHosts = allowedHosts;
    this.#fetch = fetchImpl;
    this.#maxBytes = maxBytes;
    this.#timeoutMs = timeoutMs;
    this.#pacer = pacer;
    this.#retryAttempts = retryAttempts;
    this.#sleep = sleep;
  }

  async fetch(value: string): Promise<FetchedResource> {
    let url = assertPublicAllowedUrl(value, this.#allowedHosts);

    for (let redirect = 0; redirect <= 3; redirect += 1) {
      let redirected = false;
      for (let attempt = 1; attempt <= this.#retryAttempts; attempt += 1) {
        await this.#pacer?.beforeRequest(url);
        let response: Response;
        try {
          response = await this.#fetch(url, {
            headers: {
              Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.9",
              "User-Agent": "A-World-Every-Day/0.1 (+https://github.com/acher249/world-every-day)",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(this.#timeoutMs),
          });
        } catch {
          if (attempt === this.#retryAttempts) {
            throw new SourceFetchError(`Source request failed after ${attempt} attempts`);
          }
          await this.#sleep(Math.min(MAX_RETRY_AFTER_MS, DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1)));
          continue;
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Source redirect did not include a location");
          url = assertPublicAllowedUrl(new URL(location, url).toString(), this.#allowedHosts);
          redirected = true;
          break;
        }
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < this.#retryAttempts) {
            await this.#sleep(retryAfterMs(response.headers.get("retry-after"), attempt));
            continue;
          }
          throw new SourceFetchError(`Source fetch failed with HTTP ${response.status}`, response.status);
        }
        return {
          body: await readBoundedBody(response, this.#maxBytes),
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          etag: response.headers.get("etag") ?? undefined,
          lastModified: response.headers.get("last-modified") ?? undefined,
          url: url.toString(),
        };
      }
      if (!redirected) throw new SourceFetchError("Source request could not be completed");
    }
    throw new Error("Source fetch exceeded the redirect limit");
  }
}

