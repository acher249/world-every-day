#!/usr/bin/env node

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

import { sha256 } from "../panorama/hash.js";
import { refreshWorldGeneration, startWorldGeneration } from "./run.js";
import {
  worldGenerationRequestSchema,
  type WorldGenerationRequest,
  type WorldOperationRecord,
} from "./schema.js";
import { LocalWorldArtifactStore } from "./store.js";
import { worldLabsGeneratorFromEnvironment } from "./world-labs.js";

type Options = {
  confirmPaidGeneration: boolean;
  dryRun: boolean;
  editionId?: string;
  maxPolls: number;
  model: string;
  outputDirectory?: string;
  pollSeconds: number;
  prompt?: string;
  sourceImage?: string;
};

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = {
    confirmPaidGeneration: false,
    dryRun: false,
    maxPolls: 120,
    model: process.env.WORLD_LABS_MODEL?.trim() || "marble-1.1",
    pollSeconds: 10,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--confirm-paid-generation") {
      options.confirmPaidGeneration = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--edition-id") options.editionId = value;
    else if (argument === "--source-image") options.sourceImage = value;
    else if (argument === "--output-dir") options.outputDirectory = value;
    else if (argument === "--model") options.model = value;
    else if (argument === "--prompt") options.prompt = value;
    else if (argument === "--max-polls") {
      options.maxPolls = positiveInteger(value, "--max-polls");
    } else if (argument === "--poll-seconds") {
      options.pollSeconds = positiveInteger(value, "--poll-seconds");
    } else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (!options.editionId || !options.sourceImage || !options.outputDirectory) {
    throw new Error(
      "--edition-id, --source-image, and --output-dir are required",
    );
  }
  if (!options.dryRun && !options.confirmPaidGeneration) {
    throw new Error(
      "Live World Labs generation requires --confirm-paid-generation",
    );
  }
  return options as Required<Options>;
}

async function buildRequest(options: Required<Options>): Promise<{
  request: WorldGenerationRequest;
  sourceImagePath: string;
}> {
  const sourceImagePath = resolve(options.sourceImage);
  const bytes = await readFile(sourceImagePath);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("Could not read source-image metadata");
  }
  if (metadata.width !== metadata.height * 2) {
    throw new Error("World Labs panorama input must use an exact 2:1 aspect ratio");
  }
  const mediaTypes = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  } as const;
  const mediaType = mediaTypes[metadata.format as keyof typeof mediaTypes];
  if (!mediaType) {
    throw new Error(`Unsupported source-image format: ${metadata.format}`);
  }
  return {
    sourceImagePath,
    request: worldGenerationRequestSchema.parse({
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
      generation: {
        mode: "image-to-world",
        model: options.model,
        prompt:
          options.prompt ||
          "Preserve the panorama as one coherent, navigable environment with distinct landmarks.",
      },
    }),
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const { request, sourceImagePath } = await buildRequest(options);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          paidRequestStarted: false,
          provider: "world-labs",
          request,
        },
        null,
        2,
      ),
    );
    return;
  }

  const store = new LocalWorldArtifactStore(resolve(options.outputDirectory));
  const generator = worldLabsGeneratorFromEnvironment();
  let operation: WorldOperationRecord = await startWorldGeneration({
    generator,
    request,
    sourceImagePath,
    store,
  });
  console.log(
    JSON.stringify({
      editionId: request.editionId,
      providerOperationId: operation.providerOperationId,
      status: operation.status,
    }),
  );

  for (
    let poll = 0;
    poll < options.maxPolls &&
    operation.status !== "completed" &&
    operation.status !== "failed";
    poll += 1
  ) {
    if (poll > 0) await wait(options.pollSeconds * 1_000);
    operation = await refreshWorldGeneration({ generator, request, store });
    console.log(
      JSON.stringify({
        editionId: request.editionId,
        providerOperationId: operation.providerOperationId,
        status: operation.status,
      }),
    );
  }

  if (operation.status === "failed") {
    throw new Error(operation.error?.message ?? "World generation failed");
  }
  if (operation.status !== "completed") {
    throw new Error(
      `World generation is still running after ${options.maxPolls} polls; rerun the same command to resume`,
    );
  }
  console.log(
    JSON.stringify({
      status: "complete",
      generatedWorldManifest: operation.generatedWorldManifest,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
