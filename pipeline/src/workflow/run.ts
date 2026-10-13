import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ArtDirectionProvider } from "../art-direction/generate.js";
import { generateArtDirection } from "../art-direction/generate.js";
import { selectedEditionSchema, createSelectedEdition } from "../editorial/edition.js";
import type { CandidateEvaluator } from "../editorial/evaluate.js";
import { evaluateCandidateSet } from "../editorial/evaluate.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema } from "../editorial/schema.js";
import { createEditorialShortlist } from "../editorial/select.js";
import type { ArticleAnalyzer } from "../sources/article.js";
import { analyzeArticle } from "../sources/article.js";
import type { ResourceFetcher } from "../sources/http.js";
import {
  articleEvidenceSchema,
  candidateSetSchema,
  type ArticleEvidence,
  type CandidateSet,
  type DiscoveredStory,
} from "../sources/schema.js";
import {
  inspectWorkflowDirectory,
  workflowStageNames,
  type WorkflowInspection,
  type WorkflowStageName,
} from "./inspect.js";

export type WorkflowProviders = {
  collect(): Promise<CandidateSet>;
  candidateEvaluator: CandidateEvaluator;
  articleAnalyzer: ArticleAnalyzer;
  articleFetcher(story: DiscoveredStory): ResourceFetcher;
  artDirectionProvider: ArtDirectionProvider;
};

export type WorkflowRunResult = {
  executedStages: WorkflowStageName[];
  inspection: WorkflowInspection;
};

type WorkflowPaths = ReturnType<typeof workflowPaths>;

function workflowPaths(runDirectory: string) {
  const root = resolve(runDirectory);
  return {
    root,
    candidateSet: resolve(root, "sources", "candidate-set.json"),
    evaluations: resolve(root, "editorial", "candidate-evaluations.json"),
    shortlist: resolve(root, "editorial", "shortlist.json"),
    evidenceDirectory: resolve(root, "sources", "article-evidence"),
    selectedEdition: resolve(root, "editorial", "selected-edition.json"),
    artDirection: resolve(root, "art-direction", "art-direction.json"),
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function readEvidence(paths: WorkflowPaths, storyIds: string[]): Promise<ArticleEvidence[]> {
  const evidence: ArticleEvidence[] = [];
  for (const storyId of storyIds) {
    evidence.push(articleEvidenceSchema.parse(
      await readJson(resolve(paths.evidenceDirectory, `${storyId}.json`)),
    ));
  }
  return evidence;
}

async function runStage({
  clock,
  editionId,
  paths,
  providers,
  stage,
  targetStories,
}: {
  clock: () => Date;
  editionId: string;
  paths: WorkflowPaths;
  providers: WorkflowProviders;
  stage: WorkflowStageName;
  targetStories: number;
}): Promise<void> {
  if (stage === "collection") {
    await writeJsonExclusive(paths.candidateSet, candidateSetSchema.parse(await providers.collect()));
    return;
  }

  const candidateSet = candidateSetSchema.parse(await readJson(paths.candidateSet));
  if (stage === "evaluation") {
    await writeJsonExclusive(paths.evaluations, await evaluateCandidateSet({
      candidateSet,
      createdAt: clock(),
      editionId,
      evaluator: providers.candidateEvaluator,
    }));
    return;
  }

  const evaluations = candidateEvaluationSetSchema.parse(await readJson(paths.evaluations));
  if (stage === "shortlist") {
    await writeJsonExclusive(paths.shortlist, createEditorialShortlist({
      candidateSet,
      createdAt: clock(),
      evaluations,
    }));
    return;
  }

  const shortlist = editorialShortlistSchema.parse(await readJson(paths.shortlist));
  if (stage === "article-analysis") {
    await mkdir(paths.evidenceDirectory, { recursive: true });
    for (const { storyId } of shortlist.selected) {
      const output = resolve(paths.evidenceDirectory, `${storyId}.json`);
      try {
        const existing = articleEvidenceSchema.parse(await readJson(output));
        const candidate = candidateSet.candidates.find(({ id }) => id === storyId);
        if (existing.storyId !== storyId || existing.source.canonicalUrl !== candidate?.canonicalUrl) {
          throw new Error(`Existing article evidence does not match story ${storyId}`);
        }
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const story = candidateSet.candidates.find(({ id }) => id === storyId);
      if (!story) throw new Error(`Shortlisted candidate was not found: ${storyId}`);
      const artifact = await analyzeArticle({
        analyzer: providers.articleAnalyzer,
        createdAt: clock(),
        fetchedAt: clock(),
        fetcher: providers.articleFetcher(story),
        story,
      });
      await writeJsonExclusive(output, artifact);
    }
    return;
  }

  const evidence = await readEvidence(paths, shortlist.selected.map(({ storyId }) => storyId));
  if (stage === "final-selection") {
    await writeJsonExclusive(paths.selectedEdition, createSelectedEdition({
      articleEvidence: evidence,
      candidateSet,
      createdAt: clock(),
      evaluations,
      shortlist,
      targetStories,
    }));
    return;
  }

  const edition = selectedEditionSchema.parse(await readJson(paths.selectedEdition));
  await writeJsonExclusive(paths.artDirection, await generateArtDirection({
    createdAt: clock(),
    edition,
    provider: providers.artDirectionProvider,
  }));
}

export async function runEditorialWorkflow({
  clock = () => new Date(),
  editionId,
  providers,
  runDirectory,
  targetStories = 10,
  throughStage = "art-direction",
}: {
  clock?: () => Date;
  editionId: string;
  providers: WorkflowProviders;
  runDirectory: string;
  targetStories?: number;
  throughStage?: WorkflowStageName;
}): Promise<WorkflowRunResult> {
  if (!Number.isInteger(targetStories) || targetStories < 1 || targetStories > 10) {
    throw new Error("Target stories must be an integer between 1 and 10");
  }
  const throughIndex = workflowStageNames.indexOf(throughStage);
  const paths = workflowPaths(runDirectory);
  const executedStages: WorkflowStageName[] = [];

  while (true) {
    const inspection = await inspectWorkflowDirectory(paths.root);
    const nextStage = inspection.nextStage;
    if (!nextStage || workflowStageNames.indexOf(nextStage) > throughIndex) {
      return { executedStages, inspection };
    }
    const nextInspection = inspection.stages.find(({ stage }) => stage === nextStage)!;
    if (nextInspection.status === "invalid") {
      throw new Error(`Cannot resume invalid ${nextStage} artifact: ${nextInspection.detail}`);
    }
    await runStage({ clock, editionId, paths, providers, stage: nextStage, targetStories });
    executedStages.push(nextStage);
    if (nextStage === throughStage) {
      return {
        executedStages,
        inspection: await inspectWorkflowDirectory(paths.root),
      };
    }
  }
}
