#!/usr/bin/env node

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildScenePrompt } from "../art-direction/prompt.js";
import { parseArtDirection } from "../art-direction/schema.js";
import { artifactSha256 } from "../editorial/select.js";
import { buildPanoramaPrompt } from "./prompt.js";
import { sha256 } from "./hash.js";
import { NanoBananaGenerator } from "./generator.js";
import { runPanorama } from "./run.js";

type CliOptions = {
  artDirectionFile?: string;
  confirmPaidGeneration: boolean;
  dryRun: boolean;
  scenePromptFile?: string;
  outputDirectory?: string;
};

function parseArguments(arguments_: string[]): CliOptions {
  const options: CliOptions = { confirmPaidGeneration: false, dryRun: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--confirm-paid-generation") {
      options.confirmPaidGeneration = true;
      continue;
    }
    if (argument === "--art-direction-file") {
      options.artDirectionFile = arguments_[index + 1];
      index += 1;
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
  if (Boolean(options.scenePromptFile) === Boolean(options.artDirectionFile)) {
    throw new Error(
      "Provide exactly one of --scene-prompt-file or --art-direction-file",
    );
  }
  if (!options.dryRun && !options.confirmPaidGeneration) {
    throw new Error("Live panorama generation requires --confirm-paid-generation");
  }
  return options;
}

async function readScenePrompt(options: CliOptions): Promise<{
  editionId?: string;
  artDirectionSha256?: string;
  inputType: "art-direction" | "scene-prompt";
  promptVersion?: string;
  scenePrompt: string;
}> {
  if (options.artDirectionFile) {
    const input = JSON.parse(
      await readFile(resolve(options.artDirectionFile), "utf8"),
    ) as unknown;
    const artDirection = parseArtDirection(input);
    return {
      editionId: artDirection.editionId,
      artDirectionSha256: artifactSha256(artDirection),
      inputType: "art-direction",
      promptVersion: artDirection.promptVersion,
      scenePrompt: buildScenePrompt(artDirection),
    };
  }

  return {
    inputType: "scene-prompt",
    scenePrompt: await readFile(resolve(options.scenePromptFile!), "utf8"),
  };
}

function defaultOutputDirectory(): string {
  const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return resolve("artifacts", "panorama", runId);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const promptInput = await readScenePrompt(options);
  const model = process.env.NANO_BANANA_MODEL?.trim() || "gemini-nano-banana-2.1";
  const prompt = buildPanoramaPrompt(promptInput.scenePrompt);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          paidRequestStarted: false,
          editionId: promptInput.editionId,
          inputType: promptInput.inputType,
          model,
          promptVersion: promptInput.promptVersion,
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
    artDirectionSha256: promptInput.artDirectionSha256,
    editionId: promptInput.editionId,
    scenePrompt: promptInput.scenePrompt,
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
