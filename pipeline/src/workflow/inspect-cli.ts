#!/usr/bin/env node

import { inspectWorkflowDirectory } from "./inspect.js";

function parseRunDirectory(arguments_: string[]): string {
  if (arguments_.length !== 2 || arguments_[0] !== "--run-dir" || !arguments_[1]) {
    throw new Error("--run-dir is required");
  }
  return arguments_[1];
}

async function main(): Promise<void> {
  const inspection = await inspectWorkflowDirectory(parseRunDirectory(process.argv.slice(2)));
  console.log(JSON.stringify(inspection, null, 2));
  if (inspection.stages.some(({ status }) => status === "invalid")) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
