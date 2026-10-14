import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { candidateSetSchema } from "../src/sources/schema.js";
import { createFixtureWorkflowProviders } from "../src/workflow/fixtures.js";
import { runEditorialWorkflow } from "../src/workflow/run.js";

async function temporaryRun(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), "world-every-day-runner-"));
}

test("mock workflow produces a complete resumable editorial artifact chain", async () => {
  const runDirectory = await temporaryRun();
  const first = await runEditorialWorkflow({
    editionId: "demo-2026-10-13",
    providers: await createFixtureWorkflowProviders(),
    runDirectory,
    targetStories: 1,
  });

  assert.deepEqual(first.executedStages, [
    "collection",
    "evaluation",
    "shortlist",
    "article-analysis",
    "final-selection",
    "art-direction",
  ]);
  assert.equal(first.inspection.readyForPanorama, true);
  assert.equal(first.inspection.nextStage, null);

  const resumed = await runEditorialWorkflow({
    editionId: "demo-2026-10-13",
    providers: await createFixtureWorkflowProviders(),
    runDirectory,
    targetStories: 1,
  });
  assert.deepEqual(resumed.executedStages, []);
  assert.equal(resumed.inspection.readyForPanorama, true);
});

test("workflow can stop at a stage and resume from the next artifact", async () => {
  const runDirectory = await temporaryRun();
  const partial = await runEditorialWorkflow({
    editionId: "demo-2026-10-13",
    providers: await createFixtureWorkflowProviders(),
    runDirectory,
    targetStories: 1,
    throughStage: "shortlist",
  });
  assert.deepEqual(partial.executedStages, ["collection", "evaluation", "shortlist"]);
  assert.equal(partial.inspection.nextStage, "article-analysis");

  const resumed = await runEditorialWorkflow({
    editionId: "demo-2026-10-13",
    providers: await createFixtureWorkflowProviders(),
    runDirectory,
    targetStories: 1,
  });
  assert.deepEqual(resumed.executedStages, ["article-analysis", "final-selection", "art-direction"]);
  assert.equal(resumed.inspection.readyForPanorama, true);
});

test("workflow refuses to continue when an upstream artifact changed", async () => {
  const runDirectory = await temporaryRun();
  await runEditorialWorkflow({
    editionId: "demo-2026-10-13",
    providers: await createFixtureWorkflowProviders(),
    runDirectory,
    targetStories: 1,
  });
  const candidatePath = resolve(runDirectory, "sources", "candidate-set.json");
  const candidates = candidateSetSchema.parse(
    JSON.parse(await readFile(candidatePath, "utf8")) as unknown,
  );
  candidates.candidates[0].title = "Changed after downstream artifacts were created";
  await writeFile(candidatePath, `${JSON.stringify(candidates, null, 2)}\n`);

  await assert.rejects(
    runEditorialWorkflow({
      editionId: "demo-2026-10-13",
      providers: await createFixtureWorkflowProviders(),
      runDirectory,
      targetStories: 1,
    }),
    /Cannot resume invalid evaluation artifact/,
  );
});

test("workflow refuses to reuse a run directory for another edition", async () => {
  const runDirectory = await temporaryRun();
  await runEditorialWorkflow({
    editionId: "demo-2026-10-13",
    providers: await createFixtureWorkflowProviders(),
    runDirectory,
    targetStories: 1,
  });

  await assert.rejects(
    runEditorialWorkflow({
      editionId: "demo-2026-10-14",
      providers: await createFixtureWorkflowProviders(),
      runDirectory,
      targetStories: 1,
    }),
    /belongs to edition demo-2026-10-13/i,
  );
});
