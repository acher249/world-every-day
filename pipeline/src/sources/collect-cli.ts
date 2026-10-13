#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseSourceConfiguration } from "./config.js";
import { collectCandidateSet, FeedSourceAdapter } from "./feed.js";
import { AllowlistedHttpFetcher } from "./http.js";

type Options = {
  config?: string;
  confirmLiveFetch: boolean;
  dryRun: boolean;
  output?: string;
  windowEnd?: string;
  windowStart?: string;
};

function parseDate(value: string | undefined, name: string): Date {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.valueOf())) throw new Error(`${name} must be an ISO-8601 date-time`);
  return date;
}

function parseArguments(arguments_: string[]): Required<Options> {
  const options: Options = { confirmLiveFetch: false, dryRun: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--confirm-live-fetch") {
      options.confirmLiveFetch = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--config") options.config = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--window-start") options.windowStart = value;
    else if (argument === "--window-end") options.windowEnd = value;
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (!options.config || !options.output || !options.windowStart || !options.windowEnd) {
    throw new Error("--config, --output, --window-start, and --window-end are required");
  }
  if (!options.dryRun && !options.confirmLiveFetch) {
    throw new Error("Live source collection requires --confirm-live-fetch");
  }
  return options as Required<Options>;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const configuration = parseSourceConfiguration(
    JSON.parse(await readFile(resolve(options.config), "utf8")),
  );
  const window = {
    start: parseDate(options.windowStart, "--window-start"),
    end: parseDate(options.windowEnd, "--window-end"),
  };
  if (window.start >= window.end) throw new Error("Collection window start must precede its end");

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      liveFetchStarted: false,
      output: resolve(options.output),
      sourceCount: configuration.sources.length,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
    }, null, 2));
    return;
  }

  const adapters = configuration.sources.map((source) => {
    const feedHost = new URL(source.feedUrl).hostname;
    const fetcher = new AllowlistedHttpFetcher({
      allowedHosts: [feedHost, ...source.allowedArticleHosts],
    });
    return new FeedSourceAdapter({
      id: source.id,
      feedUrl: source.feedUrl,
      kind: source.kind,
      publisher: source.publisher,
    }, fetcher);
  });
  const artifact = await collectCandidateSet({ adapters, window });
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    candidateCount: artifact.candidates.length,
    failedSourceCount: artifact.sourceRuns.filter(({ status }) => status === "failed").length,
    output,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

