#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { sha256 } from "../panorama/hash.js";
import { MockWorldGenerator } from "./mock.js";
import { refreshWorldGeneration, startWorldGeneration } from "./run.js";
import {
  worldGenerationRequestSchema,
  type WorldOperationRecord,
} from "./schema.js";
import { LocalWorldArtifactStore } from "./store.js";

type Options = {
  editionId?: string;
  outputDirectory?: string;
  sourceImage?: string;
};

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--edition-id") options.editionId = value;
    else if (argument === "--source-image") options.sourceImage = value;
    else if (argument === "--output-dir") options.outputDirectory = value;
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (!options.editionId || !options.sourceImage || !options.outputDirectory) {
    throw new Error(
      "--edition-id, --source-image, and --output-dir are required",
    );
  }
  return options as Required<Options>;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const sourceImagePath = resolve(options.sourceImage);
  const bytes = await readFile(sourceImagePath);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("Could not read source-image metadata");
  }

  const mediaTypes = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  } as const;
  const mediaType = mediaTypes[metadata.format as keyof typeof mediaTypes];
  if (!mediaType) throw new Error(`Unsupported source-image format: ${metadata.format}`);

  const request = worldGenerationRequestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "world-generation-request",
    editionId: options.editionId,
    sourceImage: {
      storageKey: options.sourceImage,
      sha256: sha256(bytes),
      mediaType,
      width: metadata.width,
      height: metadata.height,
    },
    generation: { mode: "image-to-world" },
  });
  const store = new LocalWorldArtifactStore(resolve(options.outputDirectory));
  const generator = new MockWorldGenerator({ pollsBeforeCompletion: 1 });

  let operation: WorldOperationRecord = await startWorldGeneration({
    generator,
    request,
    sourceImagePath,
    store,
  });
  for (
    let poll = 0;
    poll < 10 && operation.status !== "completed" && operation.status !== "failed";
    poll += 1
  ) {
    operation = await refreshWorldGeneration({ generator, request, store });
  }
  if (operation.status !== "completed" && operation.status !== "failed") {
    throw new Error("Mock world operation did not finish within 10 polls");
  }

  console.log(JSON.stringify(operation, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
