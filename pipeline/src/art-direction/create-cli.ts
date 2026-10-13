#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { selectedEditionSchema } from "../editorial/edition.js";
import { assertPathDoesNotExist } from "../files.js";
import { ART_DIRECTION_GENERATION_PROMPT_VERSION, assignCompositionRoles, generateArtDirection } from "./generate.js";
import { GoogleArtDirectionProvider } from "./google.js";

type Options = {
  confirmPaidAnalysis: boolean;
  dryRun: boolean;
  output?: string;
  selectedEdition?: string;
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
      if (argument === "--selected-edition") options.selectedEdition = value;
      else if (argument === "--output") options.output = value;
      else throw new Error(`Unknown argument: ${argument}`);
      index += 1;
    }
  }
  if (!options.selectedEdition || !options.output) {
    throw new Error("--selected-edition and --output are required");
  }
  if (!options.dryRun && !options.confirmPaidAnalysis) {
    throw new Error("Live art-direction generation requires --confirm-paid-analysis");
  }
  return options as Required<Options>;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const edition = selectedEditionSchema.parse(
    JSON.parse(await readFile(resolve(options.selectedEdition), "utf8")) as unknown,
  );
  const output = resolve(options.output);
  const stories = assignCompositionRoles(edition);
  if (stories.length === 0) throw new Error("Art direction requires at least one selected story");

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      paidAnalysisStarted: false,
      editionId: edition.editionId,
      expectedModelRequests: stories.length > 0 ? 1 : 0,
      output,
      promptVersion: ART_DIRECTION_GENERATION_PROMPT_VERSION,
      stories: stories.map(({ role, storyId, title }) => ({ role, storyId, title })),
    }, null, 2));
    return;
  }

  await assertPathDoesNotExist(output, "Art-direction output");

  const provider = new GoogleArtDirectionProvider({
    apiKey: process.env.GOOGLE_AI_API_KEY ?? "",
    model: process.env.ART_DIRECTION_MODEL ?? "",
  });
  const artifact = await generateArtDirection({ edition, provider });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    output,
    subjectCount: artifact.subjects.length,
    usage: artifact.producer?.usage,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
