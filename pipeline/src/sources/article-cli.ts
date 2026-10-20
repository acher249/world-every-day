#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { editorialShortlistSchema } from "../editorial/schema.js";
import { candidateSetSha256 } from "../editorial/select.js";
import { analyzeArticle } from "./article.js";
import { parseSourceConfiguration } from "./config.js";
import { articleAnalyzer } from "../cloud/text-provider.js";
import { AllowlistedHttpFetcher } from "./http.js";
import { localRequestPacer } from "./pacing.js";
import { articleEvidenceSchema, candidateSetSchema } from "./schema.js";

type Options = {
  candidateSet?: string;
  confirmLiveFetch: boolean;
  confirmPaidAnalysis: boolean;
  dryRun: boolean;
  outputDirectory?: string;
  shortlist?: string;
  sourceConfig?: string;
  storyIds: string[];
};

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = {
    confirmLiveFetch: false,
    confirmPaidAnalysis: false,
    dryRun: false,
    storyIds: [],
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--confirm-live-fetch") options.confirmLiveFetch = true;
    else if (argument === "--confirm-paid-analysis") options.confirmPaidAnalysis = true;
    else {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      if (argument === "--candidate-set") options.candidateSet = value;
      else if (argument === "--shortlist") options.shortlist = value;
      else if (argument === "--source-config") options.sourceConfig = value;
      else if (argument === "--output-dir") options.outputDirectory = value;
      else if (argument === "--story-id") options.storyIds.push(value);
      else throw new Error(`Unknown argument: ${argument}`);
      index += 1;
    }
  }
  if (!options.candidateSet || !options.shortlist || !options.sourceConfig || !options.outputDirectory) {
    throw new Error("--candidate-set, --shortlist, --source-config, and --output-dir are required");
  }
  if (!options.dryRun && (!options.confirmLiveFetch || !options.confirmPaidAnalysis)) {
    throw new Error("Live article analysis requires --confirm-live-fetch and --confirm-paid-analysis");
  }
  return options as Required<Options>;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const candidates = candidateSetSchema.parse(await readJson(options.candidateSet));
  const shortlist = editorialShortlistSchema.parse(await readJson(options.shortlist));
  if (shortlist.candidateSetSha256 !== candidateSetSha256(candidates)) {
    throw new Error("Editorial shortlist does not match the candidate-set checksum");
  }
  const configuration = parseSourceConfiguration(await readJson(options.sourceConfig));
  const shortlistedIds = new Set(shortlist.selected.map(({ storyId }) => storyId));
  const requestedStoryIds = options.storyIds.length > 0
    ? options.storyIds
    : shortlist.selected.map(({ storyId }) => storyId);
  if (requestedStoryIds.length > 15) {
    throw new Error("Article analysis is limited to 15 shortlisted stories per run");
  }
  const requestedIds = new Set(requestedStoryIds);
  if (requestedIds.size !== requestedStoryIds.length) throw new Error("Duplicate --story-id values are not allowed");
  const stories = requestedStoryIds.map((id) => {
    if (!shortlistedIds.has(id)) throw new Error(`Story is not in the editorial shortlist: ${id}`);
    const story = candidates.candidates.find((candidate) => candidate.id === id);
    if (!story) throw new Error(`Candidate story was not found: ${id}`);
    return story;
  });

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      liveFetchStarted: false,
      paidAnalysisStarted: false,
      outputDirectory: resolve(options.outputDirectory),
      stories: stories.map(({ id, publisher, title }) => ({ id, publisher, title })),
    }, null, 2));
    return;
  }

  const analyzer = articleAnalyzer();
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  let completedCount = 0;
  const failures: Array<{ error: string; storyId: string }> = [];

  for (const story of stories) {
    const output = resolve(outputDirectory, `${story.id}.json`);
    try {
      const existing = articleEvidenceSchema.parse(await readJson(output));
      if (existing.storyId !== story.id || existing.source.canonicalUrl !== story.canonicalUrl) {
        throw new Error(`Existing article evidence does not match story ${story.id}`);
      }
      console.log(JSON.stringify({ output, status: "reused", storyId: story.id }));
      completedCount += 1;
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      const source = configuration.sources.find(({ id }) => id === story.source.adapterId);
      if (!source) throw new Error(`Source configuration was not found for ${story.source.adapterId}`);
      if (source.articleAccess !== "ephemeral-analysis") {
        throw new Error(`Source is configured for discovery only: ${story.source.adapterId}`);
      }
      const fetcher = new AllowlistedHttpFetcher({
        allowedHosts: source.allowedArticleHosts,
        pacer: localRequestPacer(source.crawlDelayMs),
      });
      const artifact = await analyzeArticle({
        analyzer,
        fetcher,
        story,
      });
      await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
      completedCount += 1;
      console.log(JSON.stringify({
        claimCount: artifact.editorial.claims.length,
        detailCount: artifact.details.length,
        output,
        status: "created",
        storyId: story.id,
        usage: artifact.extraction.usage,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ error: message.slice(0, 300), storyId: story.id });
      console.error(JSON.stringify({ error: message.slice(0, 300), status: "failed", storyId: story.id }));
    }
  }

  console.log(JSON.stringify({
    completedCount,
    failedCount: failures.length,
    requestedCount: stories.length,
    status: failures.length === 0 ? "complete" : "partial",
  }));
  if (completedCount === 0 && failures.length > 0) {
    throw new Error(`Article analysis failed for all ${failures.length} requested stories`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

