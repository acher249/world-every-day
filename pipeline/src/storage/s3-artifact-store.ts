import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { sha256 } from "../panorama/hash.js";
import {
  validateArtifactKey,
  type ArtifactStore,
  type ArtifactWrite,
  type StoredArtifact,
} from "./artifact-store.js";

type S3ClientLike = Pick<S3Client, "send">;

function isPreconditionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const metadata = "$metadata" in error
    ? (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata
    : undefined;
  return error.name === "PreconditionFailed" || metadata?.httpStatusCode === 412;
}

function prefixKey(prefix: string, key: string): string {
  return prefix ? `${prefix}/${key}` : key;
}

export class S3ArtifactStore implements ArtifactStore {
  readonly #bucket: string;
  readonly #client: S3ClientLike;
  readonly #prefix: string;

  constructor(options: {
    bucket: string;
    client?: S3ClientLike;
    clientConfig?: S3ClientConfig;
    prefix?: string;
  }) {
    if (!options.bucket.trim()) throw new Error("S3 artifact bucket is required");
    this.#bucket = options.bucket;
    this.#client = options.client ?? new S3Client(options.clientConfig ?? {});
    this.#prefix = options.prefix ? validateArtifactKey(options.prefix) : "";
  }

  async putImmutable(artifact: ArtifactWrite): Promise<StoredArtifact> {
    const key = validateArtifactKey(artifact.key);
    const bytes = Buffer.from(artifact.bytes);
    const digest = sha256(bytes);
    const storageKey = prefixKey(this.#prefix, key);
    const stored: StoredArtifact = {
      byteLength: bytes.byteLength,
      contentType: artifact.contentType,
      key,
      sha256: digest,
    };
    try {
      await this.#client.send(new PutObjectCommand({
        Bucket: this.#bucket,
        Key: storageKey,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: artifact.contentType,
        ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"),
        IfNoneMatch: "*",
        Metadata: {
          ...artifact.metadata,
          sha256: digest,
        },
      }));
      return stored;
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error;
      const existing = await this.#client.send(new HeadObjectCommand({
        Bucket: this.#bucket,
        Key: storageKey,
      }));
      if (
        existing.ContentLength !== bytes.byteLength ||
        existing.ContentType !== artifact.contentType ||
        existing.Metadata?.sha256 !== digest
      ) {
        throw new Error(`Refusing to overwrite a different S3 artifact: ${storageKey}`);
      }
      return stored;
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    const storageKey = prefixKey(this.#prefix, validateArtifactKey(key));
    try {
      const response = await this.#client.send(new GetObjectCommand({
        Bucket: this.#bucket,
        Key: storageKey,
      }));
      if (!response.Body) throw new Error(`S3 artifact has no body: ${storageKey}`);
      return response.Body.transformToByteArray();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "NoSuchKey" ||
          ("$metadata" in error &&
            (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode === 404))
      ) return null;
      throw error;
    }
  }
}

