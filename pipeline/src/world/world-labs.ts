import { readFile } from "node:fs/promises";
import { retryableWorldFailure } from "./retry-policy.js";

import type {
  DownloadedWorldAsset,
  ProviderWorldOperation,
  ProviderWorldOutput,
  WorldGenerator,
} from "./provider.js";
import type { WorldGenerationRequest } from "./schema.js";

const DEFAULT_API_BASE_URL = "https://api.worldlabs.ai/marble/v1";
const DEFAULT_MODEL = "marble-1.1";
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;

type Fetch = typeof globalThis.fetch;

type WorldLabsGeneratorOptions = {
  apiKey: string;
  apiBaseUrl?: string;
  fetchImpl?: Fetch;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function booleanAt(value: unknown, ...path: string[]): boolean | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return typeof current === "boolean" ? current : undefined;
}

function providerMessage(value: unknown, fallback: string): string {
  return (
    stringAt(value, "error", "message") ??
    stringAt(value, "detail") ??
    stringAt(value, "message") ??
    fallback
  ).slice(0, 1_000);
}

function extensionFor(mediaType: WorldGenerationRequest["sourceImage"]["mediaType"]): string {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "png";
}

function mediaAssetId(value: unknown): string | undefined {
  return (
    stringAt(value, "media_asset", "media_asset_id") ??
    stringAt(value, "media_asset", "id")
  );
}

function operationId(value: unknown): string | undefined {
  return stringAt(value, "operation_id") ?? stringAt(value, "name");
}

function worldId(value: unknown): string | undefined {
  return (
    stringAt(value, "response", "world_id") ??
    stringAt(value, "metadata", "world_id") ??
    stringAt(value, "result", "world", "id")
  );
}

function spzUrls(value: unknown): JsonRecord | undefined {
  const paths = [
    ["response", "assets", "splats", "spz_urls"],
    ["response", "splats", "spz_urls"],
    ["result", "splats", "spz_urls"],
    ["assets", "splats", "spz_urls"],
  ];
  for (const path of paths) {
    let current: unknown = value;
    for (const segment of path) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[segment];
    }
    if (isRecord(current)) return current;
  }
  return undefined;
}

function preferredSpz(value: unknown): { resolution: string; url: string } | undefined {
  const urls = spzUrls(value);
  if (!urls) return undefined;
  for (const resolution of ["full_res", "500k", "100k"]) {
    const url = urls[resolution];
    if (typeof url === "string" && url.length > 0) return { resolution, url };
  }
  for (const [resolution, url] of Object.entries(urls)) {
    if (typeof url === "string" && url.length > 0) return { resolution, url };
  }
  return undefined;
}

function requireHttpsUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  return url.toString();
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: "Provider returned a non-JSON response" };
  }
}

function outputFor(
  operation: unknown,
  world: unknown,
  model: string,
): ProviderWorldOutput | undefined {
  const selected = preferredSpz(operation) ?? preferredSpz(world);
  if (!selected) return undefined;
  return {
    assetReference: requireHttpsUrl(selected.url, "World asset URL"),
    format: "spz",
    mediaType: "application/octet-stream",
    model,
    metadata: {
      resolution: selected.resolution,
      ...(worldId(operation) ? { worldId: worldId(operation) } : {}),
    },
  };
}

export class WorldLabsGenerator implements WorldGenerator {
  readonly adapterVersion = "marble-v1-adapter-v1";
  readonly provider = "world-labs";
  readonly #apiKey: string;
  readonly #apiBaseUrl: string;
  readonly #fetch: Fetch;

  constructor({
    apiKey,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetchImpl = globalThis.fetch,
  }: WorldLabsGeneratorOptions) {
    if (!apiKey.trim()) throw new Error("WORLD_LABS_KEY is required");
    this.#apiKey = apiKey.trim();
    this.#apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.#fetch = fetchImpl;
  }

  async submit(
    request: WorldGenerationRequest,
    sourceImagePath: string,
    idempotencyKey: string,
  ): Promise<{ operationId: string }> {
    const bytes = await readFile(sourceImagePath);
    const extension = extensionFor(request.sourceImage.mediaType);
    const prepared = await this.#request("/media-assets:prepare_upload", {
      method: "POST",
      headers: this.#headers({
        "Content-Type": "application/json",
        "Idempotency-Key": `${idempotencyKey}-upload`,
      }),
      body: JSON.stringify({
        file_name: `${request.editionId}.${extension}`,
        kind: "image",
        extension,
      }),
    });
    const assetId = mediaAssetId(prepared);
    const uploadUrl = stringAt(prepared, "upload_info", "upload_url");
    if (!assetId || !uploadUrl) {
      throw new Error("World Labs did not return media asset upload details");
    }
    const uploadMethod = stringAt(prepared, "upload_info", "upload_method") ?? "PUT";
    let requiredHeaders: JsonRecord = {};
    if (
      isRecord(prepared) &&
      isRecord(prepared.upload_info) &&
      isRecord(prepared.upload_info.required_headers)
    ) {
      requiredHeaders = prepared.upload_info.required_headers;
    }
    const uploadResponse = await this.#fetch(requireHttpsUrl(uploadUrl, "Upload URL"), {
      method: uploadMethod,
      headers: {
        "Content-Type": request.sourceImage.mediaType,
        ...Object.fromEntries(
          Object.entries(requiredHeaders).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
      },
      body: bytes,
    });
    if (!uploadResponse.ok) {
      throw new Error(`World Labs media upload failed with HTTP ${uploadResponse.status}`);
    }

    const model = request.generation.model ?? DEFAULT_MODEL;
    const submitted = await this.#request("/worlds:generate", {
      method: "POST",
      headers: this.#headers({
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      }),
      body: JSON.stringify({
        display_name: request.editionId,
        world_prompt: {
          type: "image",
          image_prompt: {
            source: "media_asset",
            media_asset_id: assetId,
          },
          is_pano: true,
          text_prompt:
            request.generation.prompt ??
            "Preserve the supplied panorama as one coherent, navigable environment.",
        },
        model,
      }),
    });
    const id = operationId(submitted);
    if (!id) throw new Error("World Labs did not return an operation ID");
    return { operationId: id };
  }

  async getOperation(
    operationIdValue: string,
    request: WorldGenerationRequest,
  ): Promise<ProviderWorldOperation> {
    const response = await this.#fetch(
      `${this.#apiBaseUrl}/operations/${encodeURIComponent(operationIdValue)}`,
      { headers: this.#headers() },
    );
    if (retryableStatus(response.status)) return { done: false };
    const operation = await responseJson(response);
    if (!response.ok) {
      return {
        done: true,
        error: {
          code: `WORLD_LABS_HTTP_${response.status}`,
          message: providerMessage(operation, "World Labs operation request failed"),
          retryable: false,
        },
      };
    }
    if (booleanAt(operation, "done") !== true) return { done: false };
    if (
      isRecord(operation) &&
      operation.error !== undefined &&
      operation.error !== null
    ) {
      const rawCode = isRecord(operation.error) ? operation.error.code : undefined;
      const error = {
        code: typeof rawCode === "number" ? String(rawCode) :
          stringAt(operation, "error", "code") ?? "WORLD_LABS_GENERATION_FAILED",
        message: providerMessage(operation, "World Labs generation failed"),
      };
      return { done: true, error: { ...error, retryable: retryableWorldFailure(error) } };
    }

    const model = request.generation.model ?? DEFAULT_MODEL;
    const directOutput = outputFor(operation, undefined, model);
    if (directOutput) return { done: true, response: directOutput };

    const id = worldId(operation);
    if (!id) {
      return {
        done: true,
        error: {
          code: "WORLD_LABS_MISSING_WORLD",
          message: "World Labs completed without a world ID or SPZ asset",
          retryable: false,
        },
      };
    }
    const worldResponse = await this.#fetch(
      `${this.#apiBaseUrl}/worlds/${encodeURIComponent(id)}`,
      { headers: this.#headers() },
    );
    if (retryableStatus(worldResponse.status)) return { done: false };
    const world = await responseJson(worldResponse);
    if (!worldResponse.ok) {
      return {
        done: true,
        error: {
          code: `WORLD_LABS_WORLD_HTTP_${worldResponse.status}`,
          message: providerMessage(world, "World Labs world lookup failed"),
          retryable: false,
        },
      };
    }
    const output = outputFor(operation, world, model);
    if (!output) {
      return {
        done: true,
        error: {
          code: "WORLD_LABS_MISSING_SPZ",
          message: "World Labs completed without a downloadable SPZ asset",
          retryable: false,
        },
      };
    }
    return { done: true, response: output };
  }

  async downloadAsset(output: ProviderWorldOutput): Promise<DownloadedWorldAsset> {
    const url = requireHttpsUrl(output.assetReference, "World asset URL");
    const response = await this.#fetch(url);
    if (!response.ok) {
      throw new Error(`World Labs asset download failed with HTTP ${response.status}`);
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_ASSET_BYTES) {
      throw new Error("World Labs asset exceeds the 1 GiB download limit");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      throw new Error("World Labs asset exceeds the 1 GiB download limit");
    }
    return { bytes, format: "spz", mediaType: "application/octet-stream" };
  }

  #headers(additional: Record<string, string> = {}): Record<string, string> {
    return { "WLT-Api-Key": this.#apiKey, ...additional };
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.#fetch(`${this.#apiBaseUrl}${path}`, init);
    const body = await responseJson(response);
    if (!response.ok) {
      throw new Error(
        `World Labs request failed with HTTP ${response.status}: ${providerMessage(body, "Unknown provider error")}`,
      );
    }
    return body;
  }
}

export function worldLabsGeneratorFromEnvironment(): WorldLabsGenerator {
  return new WorldLabsGenerator({ apiKey: process.env.WORLD_LABS_KEY ?? "" });
}
