import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { sha256 } from "../panorama/hash.js";

export type ArtifactWrite = {
  bytes: Uint8Array;
  contentType: string;
  key: string;
  metadata?: Record<string, string>;
};

export type StoredArtifact = {
  byteLength: number;
  contentType: string;
  key: string;
  sha256: string;
};

export interface ArtifactStore {
  putImmutable(artifact: ArtifactWrite): Promise<StoredArtifact>;
  read(key: string): Promise<Uint8Array | null>;
}

export function validateArtifactKey(value: string): string {
  if (
    value.length === 0 ||
    value.length > 1_024 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid artifact key: ${value}`);
  }
  return value;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export class LocalArtifactStore implements ArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async putImmutable(artifact: ArtifactWrite): Promise<StoredArtifact> {
    const key = validateArtifactKey(artifact.key);
    const path = this.#path(key);
    const bytes = Buffer.from(artifact.bytes);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const existing = await readFile(path);
      if (!existing.equals(bytes)) {
        throw new Error(`Refusing to overwrite a different artifact: ${key}`);
      }
    }
    return {
      byteLength: bytes.byteLength,
      contentType: artifact.contentType,
      key,
      sha256: sha256(bytes),
    };
  }

  async read(key: string): Promise<Uint8Array | null> {
    const path = this.#path(validateArtifactKey(key));
    try {
      return await readFile(path);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  #path(key: string): string {
    const path = resolve(this.#root, key);
    if (relative(this.#root, path).startsWith("..")) {
      throw new Error(`Artifact key escapes the store root: ${key}`);
    }
    return path;
  }
}

