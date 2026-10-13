import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ART_DIRECTION_GENERATION_PROMPT_VERSION, generateArtDirection, type ArtDirectionProvider } from "../src/art-direction/generate.js";
import { createSelectedEdition } from "../src/editorial/edition.js";
import { candidateEvaluationSetSchema } from "../src/editorial/schema.js";
import { createEditorialShortlist } from "../src/editorial/select.js";
import { articleEvidenceSchema, candidateSetSchema } from "../src/sources/schema.js";
import { inspectWorkflowDirectory } from "../src/workflow/inspect.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function artProvider(): ArtDirectionProvider {
  return {
    provider: "fixture",
    model: "fixture-v1",
    promptVersion: ART_DIRECTION_GENERATION_PROMPT_VERSION,
    async propose(stories) {
      return {
        proposal: {
          world: {
            title: "A Field of Careful Change",
            concept: "A fictional agricultural development becomes one explorable landscape.",
            setting: "A terraced field surrounding a red barn and irrigation garden.",
            timeOfDay: "Clear early morning.",
            atmosphere: "Calm, curious, constructive, and quietly cinematic.",
            palette: ["barn red", "leaf green", "sensor blue"],
            navigation: "A single path loops through the field and around the central landmark.",
          },
          subjects: stories.map((story) => ({
            storyId: story.storyId,
            subject: "Blue soil sensors arranged beside a weathered red barn",
            placement: "in the open middle ground",
            scale: "a large readable anchor",
            materials: ["painted metal", "weathered timber"],
            visualCues: ["blue sensors", "red barn silhouette"],
            groundedDetailIndexes: [0],
            artisticInterpretation: "The looping irrigation garden is an artistic connective device.",
          })),
        },
      };
    },
  };
}

async function completeRun(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "world-every-day-workflow-"));
  const candidates = candidateSetSchema.parse(await fixture("candidate-set.v1.json"));
  const evaluations = candidateEvaluationSetSchema.parse(await fixture("candidate-evaluations.v1.json"));
  const shortlist = createEditorialShortlist({
    candidateSet: candidates,
    createdAt: new Date("2026-10-13T14:32:00.000Z"),
    evaluations,
  });
  const candidate = candidates.candidates[0];
  const evidence = articleEvidenceSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "article-evidence",
    storyId: candidate.id,
    createdAt: "2026-10-13T14:35:00.000Z",
    source: {
      canonicalUrl: candidate.canonicalUrl,
      publisher: candidate.publisher,
      publishedAt: candidate.publishedAt,
      fetchedAt: "2026-10-13T14:34:00.000Z",
      retrievedUrl: candidate.canonicalUrl,
      extractedTextSha256: "a".repeat(64),
      extractedCharacterCount: 500,
    },
    extraction: { provider: "fixture", model: "fixture-v1", status: "analyzed" },
    editorial: {
      headline: "Farm trial reduces irrigation water use",
      summary: "A fictional field trial tested a system intended to reduce agricultural water use.",
      claims: [{
        claim: "The fictional trial used blue soil-moisture sensors.",
      }],
    },
    details: [{
      detail: "Blue soil-moisture sensors beneath young tomato plants",
      kind: "instrument",
      confidence: 0.96,
    }],
  });
  const selected = createSelectedEdition({
    articleEvidence: [evidence],
    candidateSet: candidates,
    createdAt: new Date("2026-10-13T14:36:00.000Z"),
    evaluations,
    shortlist,
    targetStories: 1,
  });
  const artDirection = await generateArtDirection({
    createdAt: new Date("2026-10-13T14:37:00.000Z"),
    edition: selected,
    provider: artProvider(),
  });

  await writeJson(resolve(root, "sources", "candidate-set.json"), candidates);
  await writeJson(resolve(root, "editorial", "candidate-evaluations.json"), evaluations);
  await writeJson(resolve(root, "editorial", "shortlist.json"), shortlist);
  await writeJson(resolve(root, "sources", "article-evidence", `${candidate.id}.json`), evidence);
  await writeJson(resolve(root, "editorial", "selected-edition.json"), selected);
  await writeJson(resolve(root, "art-direction", "art-direction.json"), artDirection);
  return root;
}

test("workflow inspection identifies the first missing stage without mutating the run", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "world-every-day-workflow-empty-"));
  const inspection = await inspectWorkflowDirectory(root);

  assert.equal(inspection.nextStage, "collection");
  assert.equal(inspection.readyForPanorama, false);
  assert.equal(inspection.stages[0].status, "missing");
  assert.ok(inspection.stages.slice(1).every(({ status }) => status === "blocked"));
});

test("workflow inspection verifies a complete editorial-to-art-direction chain", async () => {
  const root = await completeRun();
  const inspection = await inspectWorkflowDirectory(root);

  assert.equal(inspection.nextStage, null);
  assert.equal(inspection.readyForPanorama, true);
  assert.ok(inspection.stages.every(({ status }) => status === "complete"));
});

test("workflow inspection detects stale downstream artifacts", async () => {
  const root = await completeRun();
  const path = resolve(root, "sources", "candidate-set.json");
  const candidates = candidateSetSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  candidates.candidates[0].title = "Changed upstream title";
  await writeJson(path, candidates);

  const inspection = await inspectWorkflowDirectory(root);

  assert.equal(inspection.nextStage, "evaluation");
  assert.equal(inspection.stages[1].status, "invalid");
  assert.match(inspection.stages[1].detail, /different candidate set/i);
});
