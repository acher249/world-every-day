import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import {
  generatedWorldManifestSchema,
  worldGenerationRequestSchema,
  worldOperationRecordSchema,
  type GeneratedWorldManifest,
  type WorldOperationRecord,
} from "./schema.js";

export type StoredWorldAsset = {
  byteLength: number;
  storageKey: string;
};

export type WorldArtifactStore = {
  loadOperation(editionId: string): Promise<WorldOperationRecord | null>;
  saveOperation(record: WorldOperationRecord): Promise<void>;
  saveWorldAsset(
    editionId: string,
    filename: string,
    bytes: Buffer,
  ): Promise<StoredWorldAsset>;
  saveGeneratedWorld(manifest: GeneratedWorldManifest): Promise<string>;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
  await rename(temporaryPath, path);
}

export class LocalWorldArtifactStore implements WorldArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async loadOperation(editionId: string): Promise<WorldOperationRecord | null> {
    const validatedEditionId = worldGenerationRequestSchema.shape.editionId.parse(editionId);
    const path = this.#operationPath(validatedEditionId);
    try {
      return worldOperationRecordSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async saveOperation(record: WorldOperationRecord): Promise<void> {
    const validated = worldOperationRecordSchema.parse(record);
    await writeJsonAtomically(this.#operationPath(record.editionId), validated);
  }

  async saveWorldAsset(
    editionId: string,
    filename: string,
    bytes: Buffer,
  ): Promise<StoredWorldAsset> {
    const validatedEditionId = worldGenerationRequestSchema.shape.editionId.parse(editionId);
    const safeFilename = basename(filename);
    const path = resolve(this.#editionRoot(validatedEditionId), "assets", safeFilename);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const existing = await readFile(path);
      if (!existing.equals(bytes)) {
        throw new Error(`Refusing to overwrite a different world asset: ${safeFilename}`);
      }
    }
    return {
      byteLength: bytes.byteLength,
      storageKey: this.#relative(path),
    };
  }

  async saveGeneratedWorld(manifest: GeneratedWorldManifest): Promise<string> {
    const validated = generatedWorldManifestSchema.parse(manifest);
    const path = resolve(this.#editionRoot(manifest.editionId), "generated-world.json");
    await writeJsonAtomically(path, validated);
    return this.#relative(path);
  }

  #editionRoot(editionId: string): string {
    return resolve(this.#root, editionId);
  }

  #operationPath(editionId: string): string {
    return resolve(this.#editionRoot(editionId), "world-operation.json");
  }

  #relative(path: string): string {
    return relative(this.#root, path).split("\\").join("/");
  }
}
