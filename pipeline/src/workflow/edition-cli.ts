#!/usr/bin/env node

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSourceConfiguration } from "../sources/config.js";
import { candidateSetSchema } from "../sources/schema.js";
import {
  editionStageNames,
  inspectEditionWorkflowDirectory,
  type EditionStageName,
} from "./edition-inspect.js";
import { createFixtureEditionProviders } from "./edition-fixtures.js";
import { createLiveEditionProviders } from "./live-providers.js";
import { runEditionWorkflow } from "./edition-run.js";

type Mode = "live" | "mock";

type Options = {
  approveReview: boolean;
  browserUrl: string;
  confirmEditorialAnalysis: boolean;
  confirmLandmarkAnalysis: boolean;
  confirmLiveFetch: boolean;
  confirmPanoramaGeneration: boolean;
  confirmWorldGeneration: boolean;
  date?: string;
  dryRun: boolean;
  frontendDirectory: string;
  frontendUrl: string;
  mode: Mode;
  reviewer?: string;
  runDirectory?: string;
  sourceConfig: string;
  throughStage: EditionStageName;
  windowEnd?: string;
  windowStart?: string;
};

const booleanFlags = new Set([
  "--approve-review",
  "--confirm-editorial-analysis",
  "--confirm-landmark-analysis",
  "--confirm-live-fetch",
  "--confirm-panorama-generation",
  "--confirm-world-generation",
  "--dry-run",
]);

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = {
    approveReview: false,
    browserUrl: "http://127.0.0.1:9222",
    confirmEditorialAnalysis: false,
    confirmLandmarkAnalysis: false,
    confirmLiveFetch: false,
    confirmPanoramaGeneration: false,
    confirmWorldGeneration: false,
    dryRun: false,
    frontendDirectory: fileURLToPath(new URL("../../../frontend", import.meta.url)),
    frontendUrl: "http://localhost:3000/bake",
    mode: "mock",
    sourceConfig: "./config/source-configuration.initial.v1.json",
    throughStage: "publication",
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (booleanFlags.has(argument)) {
      if (argument === "--approve-review") options.approveReview = true;
      else if (argument === "--confirm-editorial-analysis") options.confirmEditorialAnalysis = true;
      else if (argument === "--confirm-landmark-analysis") options.confirmLandmarkAnalysis = true;
      else if (argument === "--confirm-live-fetch") options.confirmLiveFetch = true;
      else if (argument === "--confirm-panorama-generation") options.confirmPanoramaGeneration = true;
      else if (argument === "--confirm-world-generation") options.confirmWorldGeneration = true;
      else options.dryRun = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--browser-url") options.browserUrl = value;
    else if (argument === "--date") options.date = value;
    else if (argument === "--frontend-dir") options.frontendDirectory = value;
    else if (argument === "--frontend-url") options.frontendUrl = value;
    else if (argument === "--mode") {
      if (value !== "mock" && value !== "live") throw new Error("--mode must be mock or live");
      options.mode = value;
    } else if (argument === "--reviewer") options.reviewer = value;
    else if (argument === "--run-dir") options.runDirectory = value;
    else if (argument === "--source-config") options.sourceConfig = value;
    else if (argument === "--through" || argument === "--stop-after") {
      if (!editionStageNames.includes(value as EditionStageName)) {
        throw new Error(`Unknown edition stage: ${value}`);
      }
      options.throughStage = value as EditionStageName;
    } else if (argument === "--window-end") options.windowEnd = value;
    else if (argument === "--window-start") options.windowStart = value;
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (!options.date || !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error("--date is required in YYYY-MM-DD format");
  }
  if (!options.runDirectory) throw new Error("--run-dir is required");
  if (options.approveReview && !options.reviewer?.trim()) {
    throw new Error("--approve-review requires --reviewer");
  }
  return options as Required<Options>;
}

function parseDate(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${name} must be an ISO-8601 date-time`);
  return date;
}

async function liveWindow(options: Required<Options>, runDirectory: string) {
  if (Boolean(options.windowStart) !== Boolean(options.windowEnd)) {
    throw new Error("Live mode requires both --window-start and --window-end");
  }
  if (options.windowStart && options.windowEnd) {
    const start = parseDate(options.windowStart, "--window-start");
    const end = parseDate(options.windowEnd, "--window-end");
    if (start >= end) throw new Error("Collection window start must precede its end");
    return { start, end };
  }
  try {
    const candidateSet = candidateSetSchema.parse(JSON.parse(
      await readFile(resolve(runDirectory, "sources", "candidate-set.json"), "utf8"),
    ));
    return {
      start: new Date(candidateSet.window.start),
      end: new Date(candidateSet.window.end),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error("Live mode requires --window-start and --window-end for a new run");
  }
}

function stageWillRun(
  stage: EditionStageName,
  nextStage: EditionStageName | null,
  throughStage: EditionStageName,
): boolean {
  if (!nextStage) return false;
  const index = editionStageNames.indexOf(stage);
  return index >= editionStageNames.indexOf(nextStage) &&
    index <= editionStageNames.indexOf(throughStage);
}

function assertLiveConfirmations({
  effectiveThroughStage,
  inspection,
  options,
}: {
  effectiveThroughStage: EditionStageName;
  inspection: Awaited<ReturnType<typeof inspectEditionWorkflowDirectory>>;
  options: Required<Options>;
}) {
  const willRun = (stage: EditionStageName) =>
    stageWillRun(stage, inspection.nextStage, effectiveThroughStage);
  if ((willRun("collection") || willRun("article-analysis")) && !options.confirmLiveFetch) {
    throw new Error("Live source retrieval requires --confirm-live-fetch");
  }
  if (
    (willRun("evaluation") || willRun("article-analysis") || willRun("art-direction")) &&
    !options.confirmEditorialAnalysis
  ) throw new Error("Live editorial model calls require --confirm-editorial-analysis");
  if (willRun("panorama") && !options.confirmPanoramaGeneration) {
    throw new Error("Live panorama generation requires --confirm-panorama-generation");
  }
  if (willRun("landmark-detection") && !options.confirmLandmarkAnalysis) {
    throw new Error("Live landmark analysis requires --confirm-landmark-analysis");
  }
  if (willRun("world-generation") && !options.confirmWorldGeneration) {
    throw new Error("Live World Labs generation requires --confirm-world-generation");
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const runDirectory = resolve(options.runDirectory);
  const editionId = options.mode === "mock" ? `demo-${options.date}` : options.date;
  const inspection = await inspectEditionWorkflowDirectory(runDirectory);
  if (options.approveReview && inspection.nextStage !== "review") {
    throw new Error("Review can be approved only after the workflow is waiting at the review stage");
  }
  const effectiveThroughStage =
    options.mode === "live" &&
    !options.approveReview &&
    stageWillRun("review", inspection.nextStage, options.throughStage)
      ? "review"
      : options.throughStage;
  const liveConfiguration = options.mode === "live"
    ? {
      sourceConfiguration: parseSourceConfiguration(JSON.parse(
        await readFile(resolve(options.sourceConfig), "utf8"),
      )),
      window: await liveWindow(options, runDirectory),
    }
    : undefined;

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      editionId,
      liveFetchStarted: false,
      mode: options.mode,
      nextStage: inspection.nextStage,
      paidRequestStarted: false,
      runDirectory,
      ...(liveConfiguration ? {
        eligibleSources: liveConfiguration.sourceConfiguration.sources.filter(
          ({ articleAccess }) => articleAccess === "ephemeral-analysis",
        ).length,
        window: {
          start: liveConfiguration.window.start.toISOString(),
          end: liveConfiguration.window.end.toISOString(),
        },
      } : {}),
      throughStage: effectiveThroughStage,
    }, null, 2));
    return;
  }

  if (options.mode === "live") {
    assertLiveConfirmations({ effectiveThroughStage, inspection, options });
  }

  const providers = options.mode === "mock"
    ? await createFixtureEditionProviders()
    : createLiveEditionProviders({
      browserUrl: options.browserUrl,
      frontendDirectory: resolve(options.frontendDirectory),
      frontendUrl: options.frontendUrl,
      sourceConfiguration: liveConfiguration!.sourceConfiguration,
      window: liveConfiguration!.window,
    });
  const result = await runEditionWorkflow({
    editionId,
    fictional: options.mode === "mock",
    providers,
    reviewApproval: options.mode === "mock"
      ? { approvedBy: "fixture-runner" }
      : options.approveReview
        ? { approvedBy: options.reviewer }
        : undefined,
    runDirectory,
    targetStories: options.mode === "mock" ? 1 : 10,
    throughStage: effectiveThroughStage,
  });
  console.log(JSON.stringify({
    editionId,
    executedStages: result.executedStages,
    ...(result.inspection.nextStage === "review" ? {
      review: {
        artDirection: resolve(runDirectory, "art-direction", "art-direction.json"),
        generationPlan: {
          landmarkAnalysisRequests: 1,
          panoramaGenerations: 1,
          worldGenerations: 1,
        },
        selectedEdition: resolve(runDirectory, "editorial", "selected-edition.json"),
      },
    } : {}),
    mode: options.mode,
    nextStage: result.inspection.nextStage,
    readyForPublication: result.inspection.readyForPublication,
    reviewRequired: result.inspection.nextStage === "review",
    runDirectory,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
