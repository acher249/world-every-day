import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { publicationManifestSchema } from "../src/publication/schema.js";
import type { WorldGenerator } from "../src/world/provider.js";
import { createFixtureEditionProviders } from "../src/workflow/edition-fixtures.js";
import { inspectEditionWorkflowDirectory } from "../src/workflow/edition-inspect.js";
import { runEditionWorkflow } from "../src/workflow/edition-run.js";

const editionId = "demo-2026-10-13";
const clock = () => new Date("2026-10-13T15:00:00.000Z");

async function temporaryRun(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), "world-every-day-edition-"));
}

test("mock edition workflow produces and resumes a complete publication", async () => {
  const runDirectory = await temporaryRun();
  const first = await runEditionWorkflow({
    clock,
    editionId,
    fictional: true,
    providers: await createFixtureEditionProviders(),
    reviewApproval: { approvedBy: "fixture-runner" },
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
    "review",
    "panorama",
    "landmark-detection",
    "world-generation",
    "interaction-baking",
    "publication",
  ]);
  assert.equal(first.inspection.nextStage, null);
  assert.equal(first.inspection.readyForPublication, true);

  const publication = publicationManifestSchema.parse(JSON.parse(
    await readFile(resolve(runDirectory, "publication", "publication-manifest.json"), "utf8"),
  ));
  assert.equal(publication.edition.fictional, true);
  assert.equal(publication.stories.length, 1);
  assert.equal(publication.storyEchoes.length, 1);
  assert.equal(publication.storyEchoes[0].storyId, publication.stories[0].id);
  assert.equal(publication.stories[0].sources.length, 1);
  assert.equal(publication.world.splat, null);
  const artDirection = JSON.parse(await readFile(resolve(runDirectory, "art-direction", "art-direction.json"), "utf8"));
  const subject = artDirection.subjects.find((entry: { storyId: string }) => entry.storyId === publication.stories[0].id);
  assert.equal(publication.stories[0].representationExplanation, subject.grounding?.artisticInterpretation);

  const resumed = await runEditionWorkflow({
    clock,
    editionId,
    fictional: true,
    providers: await createFixtureEditionProviders(),
    reviewApproval: { approvedBy: "fixture-runner" },
    runDirectory,
    targetStories: 1,
  });
  assert.deepEqual(resumed.executedStages, []);
  assert.equal(resumed.inspection.readyForPublication, true);

  await writeFile(
    resolve(runDirectory, "publication", publication.world.poster.src.split("/").at(-1)!),
    "changed",
  );
  const invalid = await inspectEditionWorkflowDirectory(runDirectory);
  assert.equal(invalid.stages.find(({ stage }) => stage === "publication")?.status, "invalid");
  assert.match(
    invalid.stages.find(({ stage }) => stage === "publication")?.detail ?? "",
    /poster checksum/i,
  );
});

test("edition workflow stops after a requested stage and resumes", async () => {
  const runDirectory = await temporaryRun();
  const partial = await runEditionWorkflow({
    clock,
    editionId,
    fictional: true,
    providers: await createFixtureEditionProviders(),
    reviewApproval: { approvedBy: "fixture-runner" },
    runDirectory,
    targetStories: 1,
    throughStage: "panorama",
  });
  assert.equal(partial.executedStages.at(-1), "panorama");
  assert.equal(partial.inspection.nextStage, "landmark-detection");

  const resumed = await runEditionWorkflow({
    clock,
    editionId,
    fictional: true,
    providers: await createFixtureEditionProviders(),
    reviewApproval: { approvedBy: "fixture-runner" },
    runDirectory,
    targetStories: 1,
  });
  assert.deepEqual(resumed.executedStages, [
    "landmark-detection",
    "world-generation",
    "interaction-baking",
    "publication",
  ]);
  assert.equal(resumed.inspection.readyForPublication, true);
});

test("edition workflow pauses for an explicit review approval", async () => {
  const runDirectory = await temporaryRun();
  const paused = await runEditionWorkflow({
    clock,
    editionId,
    fictional: false,
    providers: await createFixtureEditionProviders(),
    runDirectory,
    targetStories: 1,
  });

  assert.equal(paused.executedStages.at(-1), "art-direction");
  assert.equal(paused.inspection.nextStage, "review");
  assert.equal(paused.inspection.readyForPanorama, false);

  const approved = await runEditionWorkflow({
    clock,
    editionId,
    fictional: false,
    providers: await createFixtureEditionProviders(),
    reviewApproval: { approvedBy: "test-reviewer" },
    runDirectory,
    targetStories: 1,
    throughStage: "review",
  });
  assert.deepEqual(approved.executedStages, ["review"]);
  assert.equal(approved.inspection.nextStage, "panorama");
  assert.equal(approved.inspection.readyForPanorama, true);
});

test("publication copies an exact renderable world bundle into the local frontend", async () => {
  const runDirectory = await temporaryRun();
  const localPublishDirectory = resolve(await temporaryRun(), "generated");
  const worldBytes = Buffer.from("synthetic spz bytes");
  const worldGenerator: WorldGenerator = {
    provider: "fixture-spz",
    adapterVersion: "fixture-spz-v1",
    async submit() {
      return { operationId: "fixture-spz-operation" };
    },
    async getOperation() {
      return {
        done: true,
        response: {
          assetReference: "fixture://world.spz",
          format: "spz",
          mediaType: "application/octet-stream",
        },
      };
    },
    async downloadAsset() {
      return {
        bytes: worldBytes,
        format: "spz",
        mediaType: "application/octet-stream",
      };
    },
  };
  const providers = await createFixtureEditionProviders();
  providers.localPublishDirectory = localPublishDirectory;
  providers.world.generator = worldGenerator;

  const result = await runEditionWorkflow({
    clock,
    editionId,
    fictional: true,
    providers,
    reviewApproval: { approvedBy: "fixture-runner" },
    runDirectory,
    targetStories: 1,
  });

  assert.equal(result.inspection.readyForPublication, true);
  const localFiles = await readdir(localPublishDirectory);
  const publicationName = localFiles.find((name) => name.endsWith("-publication.json"));
  assert.ok(publicationName);
  const publication = publicationManifestSchema.parse(JSON.parse(
    await readFile(resolve(localPublishDirectory, publicationName), "utf8"),
  ));
  assert.ok(publication.world.splat);
  assert.equal(
    publication.world.splat.url,
    `/generated/${editionId}-${publication.world.splat.sha256.slice(0, 12)}.spz`,
  );
  assert.deepEqual(
    await readFile(resolve(localPublishDirectory, publication.world.splat.url.split("/").at(-1)!)),
    worldBytes,
  );
});

