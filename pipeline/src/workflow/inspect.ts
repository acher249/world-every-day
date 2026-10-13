import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { artDirectionSchema } from "../art-direction/schema.js";
import { selectedEditionSchema } from "../editorial/edition.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema } from "../editorial/schema.js";
import { artifactSha256, candidateSetSha256 } from "../editorial/select.js";
import { articleEvidenceSchema, candidateSetSchema } from "../sources/schema.js";

export const workflowStageNames = [
  "collection",
  "evaluation",
  "shortlist",
  "article-analysis",
  "final-selection",
  "art-direction",
] as const;

export type WorkflowStageName = typeof workflowStageNames[number];
export type WorkflowStageStatus = "complete" | "missing" | "blocked" | "invalid";

export type WorkflowStageInspection = {
  stage: WorkflowStageName;
  status: WorkflowStageStatus;
  path: string;
  detail: string;
};

export type WorkflowInspection = {
  runDirectory: string;
  readyForPanorama: boolean;
  nextStage: WorkflowStageName | null;
  stages: WorkflowStageInspection[];
};

type ReadResult = { found: true; value: unknown } | { found: false };

async function readJsonIfPresent(path: string): Promise<ReadResult> {
  try {
    return { found: true, value: JSON.parse(await readFile(path, "utf8")) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
    throw error;
  }
}

function blocked(stage: WorkflowStageName, path: string): WorkflowStageInspection {
  return { stage, status: "blocked", path, detail: "A required earlier artifact is not complete" };
}

export async function inspectWorkflowDirectory(runDirectory: string): Promise<WorkflowInspection> {
  const root = resolve(runDirectory);
  const paths = {
    collection: resolve(root, "sources", "candidate-set.json"),
    evaluation: resolve(root, "editorial", "candidate-evaluations.json"),
    shortlist: resolve(root, "editorial", "shortlist.json"),
    articleAnalysis: resolve(root, "sources", "article-evidence"),
    finalSelection: resolve(root, "editorial", "selected-edition.json"),
    artDirection: resolve(root, "art-direction", "art-direction.json"),
  };
  const stages: WorkflowStageInspection[] = [];
  let chainValid = true;

  const candidateInput = await readJsonIfPresent(paths.collection);
  let candidateSet: ReturnType<typeof candidateSetSchema.parse> | undefined;
  if (!candidateInput.found) {
    stages.push({ stage: "collection", status: "missing", path: paths.collection, detail: "Candidate set has not been collected" });
    chainValid = false;
  } else {
    try {
      candidateSet = candidateSetSchema.parse(candidateInput.value);
      stages.push({ stage: "collection", status: "complete", path: paths.collection, detail: `${candidateSet.candidates.length} candidates` });
    } catch (error) {
      stages.push({ stage: "collection", status: "invalid", path: paths.collection, detail: error instanceof Error ? error.message : String(error) });
      chainValid = false;
    }
  }

  const evaluationInput = await readJsonIfPresent(paths.evaluation);
  let evaluations: ReturnType<typeof candidateEvaluationSetSchema.parse> | undefined;
  if (!chainValid) {
    stages.push(blocked("evaluation", paths.evaluation));
  } else if (!evaluationInput.found) {
    stages.push({ stage: "evaluation", status: "missing", path: paths.evaluation, detail: "Candidate evaluations have not been created" });
    chainValid = false;
  } else {
    try {
      evaluations = candidateEvaluationSetSchema.parse(evaluationInput.value);
      if (evaluations.candidateSetSha256 !== candidateSetSha256(candidateSet!)) {
        throw new Error("Candidate evaluations reference a different candidate set");
      }
      stages.push({ stage: "evaluation", status: "complete", path: paths.evaluation, detail: `${evaluations.evaluations.length} evaluations` });
    } catch (error) {
      stages.push({ stage: "evaluation", status: "invalid", path: paths.evaluation, detail: error instanceof Error ? error.message : String(error) });
      chainValid = false;
    }
  }

  const shortlistInput = await readJsonIfPresent(paths.shortlist);
  let shortlist: ReturnType<typeof editorialShortlistSchema.parse> | undefined;
  if (!chainValid) {
    stages.push(blocked("shortlist", paths.shortlist));
  } else if (!shortlistInput.found) {
    stages.push({ stage: "shortlist", status: "missing", path: paths.shortlist, detail: "Editorial shortlist has not been created" });
    chainValid = false;
  } else {
    try {
      shortlist = editorialShortlistSchema.parse(shortlistInput.value);
      if (
        shortlist.candidateSetSha256 !== candidateSetSha256(candidateSet!) ||
        shortlist.evaluationSetSha256 !== artifactSha256(evaluations!) ||
        shortlist.editionId !== evaluations!.editionId
      ) {
        throw new Error("Editorial shortlist does not match its candidate and evaluation inputs");
      }
      stages.push({ stage: "shortlist", status: "complete", path: paths.shortlist, detail: `${shortlist.selected.length} shortlisted stories` });
    } catch (error) {
      stages.push({ stage: "shortlist", status: "invalid", path: paths.shortlist, detail: error instanceof Error ? error.message : String(error) });
      chainValid = false;
    }
  }

  const evidence = new Map<string, ReturnType<typeof articleEvidenceSchema.parse>>();
  if (!chainValid) {
    stages.push(blocked("article-analysis", paths.articleAnalysis));
  } else {
    try {
      const missing: string[] = [];
      for (const { storyId } of shortlist!.selected) {
        const path = resolve(paths.articleAnalysis, `${storyId}.json`);
        const input = await readJsonIfPresent(path);
        if (!input.found) {
          missing.push(storyId);
          continue;
        }
        const artifact = articleEvidenceSchema.parse(input.value);
        const candidate = candidateSet!.candidates.find(({ id }) => id === storyId);
        if (artifact.storyId !== storyId || artifact.source.canonicalUrl !== candidate?.canonicalUrl) {
          throw new Error(`Article evidence does not match shortlisted story ${storyId}`);
        }
        evidence.set(storyId, artifact);
      }
      if (missing.length > 0) {
        stages.push({
          stage: "article-analysis",
          status: "missing",
          path: paths.articleAnalysis,
          detail: `${missing.length} of ${shortlist!.selected.length} shortlisted stories still need analysis`,
        });
        chainValid = false;
      } else {
        stages.push({ stage: "article-analysis", status: "complete", path: paths.articleAnalysis, detail: `${evidence.size} evidence artifacts` });
      }
    } catch (error) {
      stages.push({ stage: "article-analysis", status: "invalid", path: paths.articleAnalysis, detail: error instanceof Error ? error.message : String(error) });
      chainValid = false;
    }
  }

  const selectedInput = await readJsonIfPresent(paths.finalSelection);
  let selectedEdition: ReturnType<typeof selectedEditionSchema.parse> | undefined;
  if (!chainValid) {
    stages.push(blocked("final-selection", paths.finalSelection));
  } else if (!selectedInput.found) {
    stages.push({ stage: "final-selection", status: "missing", path: paths.finalSelection, detail: "Selected edition has not been assembled" });
    chainValid = false;
  } else {
    try {
      selectedEdition = selectedEditionSchema.parse(selectedInput.value);
      if (
        selectedEdition.inputs.candidateSetSha256 !== candidateSetSha256(candidateSet!) ||
        selectedEdition.inputs.evaluationSetSha256 !== artifactSha256(evaluations!) ||
        selectedEdition.inputs.shortlistSha256 !== artifactSha256(shortlist!)
      ) {
        throw new Error("Selected edition does not match its upstream artifacts");
      }
      for (const story of selectedEdition.stories) {
        const article = evidence.get(story.storyId);
        if (!article || story.articleEvidenceSha256 !== artifactSha256(article)) {
          throw new Error(`Selected story does not match article evidence: ${story.storyId}`);
        }
      }
      stages.push({ stage: "final-selection", status: "complete", path: paths.finalSelection, detail: `${selectedEdition.stories.length} final stories` });
    } catch (error) {
      stages.push({ stage: "final-selection", status: "invalid", path: paths.finalSelection, detail: error instanceof Error ? error.message : String(error) });
      chainValid = false;
    }
  }

  const artDirectionInput = await readJsonIfPresent(paths.artDirection);
  if (!chainValid) {
    stages.push(blocked("art-direction", paths.artDirection));
  } else if (!artDirectionInput.found) {
    stages.push({ stage: "art-direction", status: "missing", path: paths.artDirection, detail: "Art direction has not been generated" });
  } else {
    try {
      const artDirection = artDirectionSchema.parse(artDirectionInput.value);
      if (
        artDirection.editionId !== selectedEdition!.editionId ||
        artDirection.inputs?.selectedEditionSha256 !== artifactSha256(selectedEdition!)
      ) {
        throw new Error("Art direction does not match the selected edition");
      }
      stages.push({ stage: "art-direction", status: "complete", path: paths.artDirection, detail: `${artDirection.subjects.length} composed subjects` });
    } catch (error) {
      stages.push({ stage: "art-direction", status: "invalid", path: paths.artDirection, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const next = stages.find(({ status }) => status !== "complete");
  return {
    runDirectory: root,
    readyForPanorama: stages.every(({ status }) => status === "complete"),
    nextStage: next?.stage ?? null,
    stages,
  };
}
