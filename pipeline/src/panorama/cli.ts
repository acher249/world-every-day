#!/usr/bin/env node

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPanoramaPrompt } from "./prompt.js";
import { sha256 } from "./hash.js";
import { NanoBananaGenerator } from "./generator.js";
import { runPanorama } from "./run.js";

type CliOptions = {
  dryRun: boolean;
  scenePromptFile?: string;
  outputDirectory?: string;
};

function parseArguments(arguments_: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--scene-prompt-file") {
      options.scenePromptFile = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--output-dir") {
      options.outputDirectory = arguments_[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.scenePromptFile) {
    throw new Error("--scene-prompt-file is required");
  }
  return options;
}

function defaultOutputDirectory(): string {
  const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return resolve("artifacts", "panorama", runId);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const scenePrompt = await readFile(resolve(options.scenePromptFile!), "utf8");
  const model = process.env.NANO_BANANA_MODEL?.trim() || "gemini-nano-banana-2.1";
  const prompt = buildPanoramaPrompt(scenePrompt);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          paidRequestStarted: false,
          model,
          promptSha256: sha256(prompt),
        },
        null,
        2,
      ),
    );
    return;
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is required for panorama generation");
  }
  const outputDirectory = resolve(options.outputDirectory ?? defaultOutputDirectory());
  const generator = new NanoBananaGenerator({ apiKey, model });
  const manifestPath = await runPanorama({
    scenePrompt,
    model,
    outputDirectory,
    generator,
  });
  console.log(JSON.stringify({ status: "complete", manifestPath }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
