#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { candidateSetSchema } from "../sources/schema.js";
import { createEditorialShortlist, defaultEditorialSelectionConfiguration } from "./select.js";
import { candidateEvaluationSetSchema, editorialSelectionConfigurationSchema } from "./schema.js";

type Options = {
  candidateSet?: string;
  configuration?: string;
  evaluations?: string;
  output?: string;
};

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--candidate-set") options.candidateSet = value;
    else if (argument === "--configuration") options.configuration = value;
    else if (argument === "--evaluations") options.evaluations = value;
    else if (argument === "--output") options.output = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.candidateSet || !options.evaluations || !options.output) {
    throw new Error("--candidate-set, --evaluations, and --output are required");
  }
  return options as Required<Options>;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const candidateSet = candidateSetSchema.parse(await readJson(options.candidateSet));
  const evaluations = candidateEvaluationSetSchema.parse(await readJson(options.evaluations));
  const configuration = options.configuration
    ? editorialSelectionConfigurationSchema.parse(await readJson(options.configuration))
    : defaultEditorialSelectionConfiguration;
  const artifact = createEditorialShortlist({ candidateSet, configuration, evaluations });
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    excludedCount: artifact.excluded.length,
    output,
    selectedCount: artifact.selected.length,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

