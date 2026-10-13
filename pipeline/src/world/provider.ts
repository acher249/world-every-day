import type {
  WorldAssetFormat,
  WorldGenerationRequest,
} from "./schema.js";

export type ProviderWorldOutput = {
  assetReference: string;
  format: WorldAssetFormat;
  mediaType: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

export type ProviderWorldOperation =
  | { done: false }
  | { done: true; response: ProviderWorldOutput }
  | {
      done: true;
      error: { code: string; message: string; retryable: boolean };
    };

export type DownloadedWorldAsset = {
  bytes: Buffer;
  format: WorldAssetFormat;
  mediaType: string;
};

export type WorldGenerator = {
  readonly adapterVersion: string;
  readonly provider: string;
  submit(
    request: WorldGenerationRequest,
    sourceImagePath: string,
    idempotencyKey: string,
  ): Promise<{ operationId: string }>;
  getOperation(
    operationId: string,
    request: WorldGenerationRequest,
  ): Promise<ProviderWorldOperation>;
  downloadAsset(output: ProviderWorldOutput): Promise<DownloadedWorldAsset>;
};
