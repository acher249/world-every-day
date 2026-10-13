#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { articleEvidenceSchema, candidateSetSchema, type ArticleEvidence } from "../sources/schema.js";
import { createSelectedEdition } from "./edition.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema } from "./schema.js";

type Options = {
  candidateSet?: string;
  evaluations?: string;
  evidenceDirectory?: string;
  output?: string;
  shortlist?: string;
  targetStories: number;
};

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = { targetStories: 10 };
  for (let index = 0; index < arguments_.length; index += 2) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--candidate-set") options.candidateSet = value;
    else if (argument === "--evaluations") options.evaluations = value;
    else if (argument === "--evidence-dir") options.evidenceDirectory = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--shortlist") options.shortlist = value;
    else if (argument === "--target-stories") options.targetStories = Number(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.candidateSet || !options.evaluations || !options.evidenceDirectory || !options.output || !options.shortlist) {
    throw new Error("--candidate-set, --evaluations, --evidence-dir, --shortlist, and --output are required");
  }
  return options as Required<Options>;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function readAvailableEvidence(directory: string, storyIds: string[]): Promise<ArticleEvidence[]> {
  const artifacts: ArticleEvidence[] = [];
  for (const storyId of storyIds) {
    try {
      artifacts.push(articleEvidenceSchema.parse(await readJson(resolve(directory, `${storyId}.json`))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return artifacts;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const candidateSet = candidateSetSchema.parse(await readJson(options.candidateSet));
  const evaluations = candidateEvaluationSetSchema.parse(await readJson(options.evaluations));
  const shortlist = editorialShortlistSchema.parse(await readJson(options.shortlist));
  const articleEvidence = await readAvailableEvidence(
    resolve(options.evidenceDirectory),
    shortlist.selected.map(({ storyId }) => storyId),
  );
  const artifact = createSelectedEdition({
    articleEvidence,
    candidateSet,
    evaluations,
    shortlist,
    targetStories: options.targetStories,
  });
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    excludedCount: artifact.excluded.length,
    output,
    selectedCount: artifact.stories.length,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
