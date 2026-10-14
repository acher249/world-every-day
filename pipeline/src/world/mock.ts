import type {
  DownloadedWorldAsset,
  ProviderWorldOperation,
  WorldGenerator,
} from "./provider.js";
import type { WorldGenerationRequest } from "./schema.js";

type MockWorldGeneratorOptions = {
  assetBytes?: Buffer;
  pollsBeforeCompletion?: number;
  terminalError?: { code: string; message: string; retryable: boolean };
};

export class MockWorldGenerator implements WorldGenerator {
  readonly adapterVersion = "mock-v1";
  readonly provider = "mock";
  readonly #assetBytes: Buffer;
  readonly #pollsBeforeCompletion: number;
  readonly #terminalError?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  readonly #operations = new Map<string, { polls: number }>();
  readonly #operationByIdempotencyKey = new Map<string, string>();

  submitCount = 0;

  constructor({
    assetBytes = Buffer.from("synthetic mock world asset\n"),
    pollsBeforeCompletion = 1,
    terminalError,
  }: MockWorldGeneratorOptions = {}) {
    this.#assetBytes = assetBytes;
    this.#pollsBeforeCompletion = pollsBeforeCompletion;
    this.#terminalError = terminalError;
  }

  async submit(
    _request: WorldGenerationRequest,
    _sourceImagePath: string,
    idempotencyKey: string,
  ): Promise<{ operationId: string }> {
    const existing = this.#operationByIdempotencyKey.get(idempotencyKey);
    if (existing) return { operationId: existing };

    this.submitCount += 1;
    const operationId = `mock-operation-${idempotencyKey.slice(0, 16)}`;
    this.#operationByIdempotencyKey.set(idempotencyKey, operationId);
    this.#operations.set(operationId, { polls: 0 });
    return { operationId };
  }

  async getOperation(
    operationId: string,
    _request: WorldGenerationRequest,
  ): Promise<ProviderWorldOperation> {
    let operation = this.#operations.get(operationId);
    if (!operation && /^mock-operation-[a-f0-9]{16}$/.test(operationId)) {
      operation = { polls: this.#pollsBeforeCompletion };
      this.#operations.set(operationId, operation);
    }
    if (!operation) {
      return {
        done: true,
        error: {
          code: "OPERATION_NOT_FOUND",
          message: `Unknown mock operation: ${operationId}`,
          retryable: false,
        },
      };
    }

    if (operation.polls < this.#pollsBeforeCompletion) {
      operation.polls += 1;
      return { done: false };
    }

    if (this.#terminalError) {
      return { done: true, error: this.#terminalError };
    }

    return {
      done: true,
      response: {
        assetReference: `mock://${operationId}/world`,
        format: "mock",
        mediaType: "application/x-world-every-day-mock",
        model: "mock-world-model-v1",
        metadata: { synthetic: true },
      },
    };
  }

  async downloadAsset(): Promise<DownloadedWorldAsset> {
    return {
      bytes: this.#assetBytes,
      format: "mock",
      mediaType: "application/x-world-every-day-mock",
    };
  }
}
