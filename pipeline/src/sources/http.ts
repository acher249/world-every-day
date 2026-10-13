import { isIP } from "node:net";
import { hostnameAllowed } from "./url.js";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
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

  constructor({
    allowedHosts,
    fetchImpl = globalThis.fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = 15_000,
  }: {
    allowedHosts: readonly string[];
    fetchImpl?: typeof fetch;
    maxBytes?: number;
    timeoutMs?: number;
  }) {
    if (allowedHosts.length === 0) throw new Error("At least one source host is required");
    this.#allowedHosts = allowedHosts;
    this.#fetch = fetchImpl;
    this.#maxBytes = maxBytes;
    this.#timeoutMs = timeoutMs;
  }

  async fetch(value: string): Promise<FetchedResource> {
    let url = assertPublicAllowedUrl(value, this.#allowedHosts);

    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await this.#fetch(url, {
        headers: {
          Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.9",
          "User-Agent": "A-World-Every-Day/0.1 (+https://github.com/acher249/world-every-day)",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Source redirect did not include a location");
        url = assertPublicAllowedUrl(new URL(location, url).toString(), this.#allowedHosts);
        continue;
      }
      if (!response.ok) throw new Error(`Source fetch failed with HTTP ${response.status}`);
      return {
        body: await readBoundedBody(response, this.#maxBytes),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        url: url.toString(),
      };
    }
    throw new Error("Source fetch exceeded the redirect limit");
  }
}

