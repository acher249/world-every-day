#!/usr/bin/env node

import { resolve } from "node:path";
import { createFixtureWorkflowProviders } from "./fixtures.js";
import { workflowStageNames, type WorkflowStageName } from "./inspect.js";
import { runEditorialWorkflow } from "./run.js";

type Options = {
  runDirectory?: string;
  throughStage: WorkflowStageName;
};

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = { throughStage: "art-direction" };
  for (let index = 0; index < arguments_.length; index += 2) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--run-dir") options.runDirectory = value;
    else if (argument === "--through") {
      if (!workflowStageNames.includes(value as WorkflowStageName)) {
        throw new Error(`Unknown workflow stage: ${value}`);
      }
      options.throughStage = value as WorkflowStageName;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.runDirectory) throw new Error("--run-dir is required");
  return options as Required<Options>;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const result = await runEditorialWorkflow({
    editionId: "demo-2026-10-13",
    providers: await createFixtureWorkflowProviders(),
    runDirectory: resolve(options.runDirectory),
    targetStories: 1,
    throughStage: options.throughStage,
  });
  console.log(JSON.stringify({
    executedStages: result.executedStages,
    nextStage: result.inspection.nextStage,
    readyForPanorama: result.inspection.readyForPanorama,
    runDirectory: result.inspection.runDirectory,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
