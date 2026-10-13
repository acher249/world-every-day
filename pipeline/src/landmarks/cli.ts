#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertPathDoesNotExist } from "../files.js";
import sharp from "sharp";
import { parseArtDirection } from "../art-direction/schema.js";
import { GoogleLandmarkDetector } from "./google.js";
import { buildLandmarkDetectionPrompt } from "./prompt.js";
import { detectLandmarks } from "./run.js";

type Options = {
  artDirectionFile?: string;
  confirmPaidAnalysis: boolean;
  dryRun: boolean;
  image?: string;
  output?: string;
};

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = { confirmPaidAnalysis: false, dryRun: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--confirm-paid-analysis") options.confirmPaidAnalysis = true;
    else {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      if (argument === "--image") options.image = value;
      else if (argument === "--art-direction-file") options.artDirectionFile = value;
      else if (argument === "--output") options.output = value;
      else throw new Error(`Unknown argument: ${argument}`);
      index += 1;
    }
  }
  if (!options.image || !options.artDirectionFile || !options.output) {
    throw new Error("--image, --art-direction-file, and --output are required");
  }
  if (!options.dryRun && !options.confirmPaidAnalysis) {
    throw new Error("Live landmark detection requires --confirm-paid-analysis");
  }
  return options as Required<Options>;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const imagePath = resolve(options.image);
  const outputPath = resolve(options.output);
  const artDirection = parseArtDirection(JSON.parse(
    await readFile(resolve(options.artDirectionFile), "utf8"),
  ));
  const imageBytes = await readFile(imagePath);
  const metadata = await sharp(imageBytes).metadata();
  const mimeTypes = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
  const mimeType = metadata.format
    ? mimeTypes[metadata.format as keyof typeof mimeTypes]
    : undefined;
  if (!mimeType) throw new Error(`Unsupported source-image format: ${metadata.format ?? "unknown"}`);

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      editionId: artDirection.editionId,
      imagePath,
      outputPath,
      prompt: buildLandmarkDetectionPrompt(artDirection),
      storyCount: artDirection.subjects.length,
    }, null, 2));
    return;
  }

  await assertPathDoesNotExist(outputPath, "Landmark output");

  const detector = new GoogleLandmarkDetector({
    apiKey: process.env.GOOGLE_AI_API_KEY ?? "",
    model: process.env.LANDMARK_VISION_MODEL ?? "",
  });
  const artifact = await detectLandmarks({
    editionId: artDirection.editionId,
    imageBytes,
    mimeType,
    artDirection,
    detector,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote landmark detections to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
