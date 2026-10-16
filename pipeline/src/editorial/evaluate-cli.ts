#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertPathDoesNotExist } from "../files.js";
import { candidateSetSchema } from "../sources/schema.js";
import { EDITORIAL_EVALUATION_PROMPT_VERSION, evaluateCandidateSet } from "./evaluate.js";
import { BedrockCandidateEvaluator, EVALUATION_BATCH_SIZE, MAX_EVALUATION_CANDIDATES } from "./bedrock-evaluator.js";

type Options = {
  candidateSet?: string;
  confirmPaidAnalysis: boolean;
  dryRun: boolean;
  editionId?: string;
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
      if (argument === "--candidate-set") options.candidateSet = value;
      else if (argument === "--edition-id") options.editionId = value;
      else if (argument === "--output") options.output = value;
      else throw new Error(`Unknown argument: ${argument}`);
      index += 1;
    }
  }
  if (!options.candidateSet || !options.editionId || !options.output) {
    throw new Error("--candidate-set, --edition-id, and --output are required");
  }
  if (!options.dryRun && !options.confirmPaidAnalysis) {
    throw new Error("Live candidate evaluation requires --confirm-paid-analysis");
  }
  return options as Required<Options>;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const candidateSet = candidateSetSchema.parse(
    JSON.parse(await readFile(resolve(options.candidateSet), "utf8")) as unknown,
  );
  const output = resolve(options.output);
  if (candidateSet.candidates.length === 0 || candidateSet.candidates.length > MAX_EVALUATION_CANDIDATES) {
    throw new Error(`Candidate evaluation requires between 1 and ${MAX_EVALUATION_CANDIDATES} stories`);
  }

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      paidAnalysisStarted: false,
      candidateCount: candidateSet.candidates.length,
      editionId: options.editionId,
      output,
      promptVersion: EDITORIAL_EVALUATION_PROMPT_VERSION,
      expectedModelRequests: Math.ceil(candidateSet.candidates.length / EVALUATION_BATCH_SIZE),
    }, null, 2));
    return;
  }

  await assertPathDoesNotExist(output, "Candidate-evaluation output");

  const evaluator = new BedrockCandidateEvaluator({ model: process.env.EDITORIAL_MODEL });
  const artifact = await evaluateCandidateSet({
    candidateSet,
    editionId: options.editionId,
    evaluator,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    evaluationCount: artifact.evaluations.length,
    output,
    usage: artifact.producer.usage,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
