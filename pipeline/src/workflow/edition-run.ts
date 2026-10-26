import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { buildScenePrompt } from "../art-direction/prompt.js";
import { artDirectionSchema } from "../art-direction/schema.js";
import { selectedEditionSchema } from "../editorial/edition.js";
import { artifactSha256 } from "../editorial/select.js";
import { createInteractionManifest, type InteractionBaker } from "../interactions/run.js";
import { interactionManifestSchema } from "../interactions/schema.js";
import { landmarkArtifactSchema } from "../landmarks/schema.js";
import { detectLandmarks } from "../landmarks/run.js";
import type { LandmarkDetector } from "../landmarks/provider.js";
import type { PanoramaProcessingConfig } from "../panorama/config.js";
import type { PanoramaGenerator } from "../panorama/generator.js";
import { sha256 } from "../panorama/hash.js";
import { runPanorama } from "../panorama/run.js";
import { buildPoleRepairPrompt } from "../panorama/poles.js";
import { createPublicationManifest } from "../publication/create.js";
import type { WorldGenerator } from "../world/provider.js";
import { refreshWorldGeneration, startWorldGeneration } from "../world/run.js";
import {
  generatedWorldManifestSchema,
  worldGenerationRequestSchema,
  type WorldOperationRecord,
} from "../world/schema.js";
import { LocalWorldArtifactStore } from "../world/store.js";
import {
  editionStageNames,
  inspectEditionWorkflowDirectory,
  type EditionStageName,
  type EditionWorkflowInspection,
} from "./edition-inspect.js";
import { workflowStageNames, type WorkflowStageName } from "./inspect.js";
import { runEditorialWorkflow, type WorkflowProviders } from "./run.js";
import { editionReviewSchema } from "./review.js";

export type EditionProviders = WorkflowProviders & {
  interactionBaker: InteractionBaker;
  landmarkDetector: LandmarkDetector;
  panorama: {
    generator: PanoramaGenerator;
    model: string;
    provider: string;
    processingConfig?: PanoramaProcessingConfig;
  };
  localPublishDirectory?: string;
  world: {
    generator: WorldGenerator;
    maxPolls: number;
    model?: string;
    pollIntervalMs: number;
  };
};

export type EditionRunResult = {
  executedStages: EditionStageName[];
  inspection: EditionWorkflowInspection;
};

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function copyExclusiveOrVerify(source: string, destination: string): Promise<void> {
  await writeBytesExclusiveOrVerify(await readFile(source), destination);
}

async function writeBytesExclusiveOrVerify(
  bytes: Uint8Array,
  destination: string,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(destination, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const destinationBytes = await readFile(destination);
    if (!destinationBytes.equals(bytes)) {
      throw new Error(`Refusing to overwrite a different local publication asset: ${destination}`);
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function runGenerationStage({
  clock,
  editionId,
  fictional,
  providers,
  reviewApproval,
  root,
  stage,
}: {
  clock: () => Date;
  editionId: string;
  fictional: boolean;
  providers: EditionProviders;
  reviewApproval?: { approvedBy: string };
  root: string;
  stage: Exclude<EditionStageName, WorkflowStageName>;
}): Promise<void> {
  const artDirectionPath = resolve(root, "art-direction", "art-direction.json");
  const panoramaDirectory = resolve(root, "panorama");
  const panoramaManifestPath = resolve(panoramaDirectory, "manifest.json");
  const artDirection = artDirectionSchema.parse(await readJson(artDirectionPath));

  if (stage === "review") {
    if (!reviewApproval) return;
    const edition = selectedEditionSchema.parse(
      await readJson(resolve(root, "editorial", "selected-edition.json")),
    );
    const approval = editionReviewSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "edition-review",
      editionId,
      approvedAt: clock().toISOString(),
      approvedBy: reviewApproval.approvedBy,
      inputs: {
        selectedEditionSha256: artifactSha256(edition),
        artDirectionSha256: artifactSha256(artDirection),
      },
      decision: "approved-for-generation",
    });
    await writeJsonExclusive(resolve(root, "review", "approval.json"), approval);
    return;
  }

  if (stage === "panorama") {
    const stagingDirectory = resolve(root, `.panorama-staging-${process.pid}-${Date.now()}`);
    await runPanorama({
      artDirectionSha256: artifactSha256(artDirection),
      editionId,
      generator: providers.panorama.generator,
      model: providers.panorama.model,
      outputDirectory: stagingDirectory,
      processingConfig: providers.panorama.processingConfig,
      provider: providers.panorama.provider,
      scenePrompt: buildScenePrompt(artDirection),
      repairPoles: fictional ? undefined : async (sheet) => (await providers.panorama.generator.generate(
        buildPoleRepairPrompt(buildScenePrompt(artDirection)), { bytes: sheet, mimeType: "image/png" },
      )).bytes,
    });
    await rename(stagingDirectory, panoramaDirectory);
    return;
  }

  const panoramaManifest = await readJson(panoramaManifestPath) as {
    files: { delivery8k: string };
  };
  const panoramaPath = resolve(panoramaDirectory, panoramaManifest.files.delivery8k);
  const panoramaBytes = await readFile(panoramaPath);

  if (stage === "landmark-detection") {
    const analysisImageBytes = await sharp(panoramaBytes)
      .resize(2048, 1024, { fit: "fill" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    const artifact = await detectLandmarks({
      artDirection,
      createdAt: clock(),
      detector: providers.landmarkDetector,
      editionId,
      imageBytes: analysisImageBytes,
      mimeType: "image/jpeg",
      sourceImageBytes: panoramaBytes,
    });
    await writeJsonExclusive(resolve(root, "landmarks", "landmark-detections.json"), artifact);
    return;
  }

  if (stage === "world-generation") {
    const metadata = await sharp(panoramaBytes).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Could not read panorama dimensions");
    const request = worldGenerationRequestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "world-generation-request",
      editionId,
      sourceImage: {
        storageKey: panoramaPath,
        sha256: sha256(panoramaBytes),
        mediaType: "image/png",
        width: metadata.width,
        height: metadata.height,
      },
      generation: {
        mode: "image-to-world",
        model: providers.world.model,
      },
    });
    const store = new LocalWorldArtifactStore(resolve(root, "world"));
    let operation: WorldOperationRecord = await startWorldGeneration({
      generator: providers.world.generator,
      now: clock,
      request,
      sourceImagePath: panoramaPath,
      store,
    });
    for (
      let poll = 0;
      poll < providers.world.maxPolls &&
      operation.status !== "completed" &&
      operation.status !== "failed";
      poll += 1
    ) {
      if (poll > 0 && providers.world.pollIntervalMs > 0) {
        await wait(providers.world.pollIntervalMs);
      }
      operation = await refreshWorldGeneration({
        generator: providers.world.generator,
        now: clock,
        request,
        store,
      });
    }
    if (operation.status === "failed") throw new Error(operation.error?.message ?? "World generation failed");
    if (operation.status !== "completed") {
      throw new Error(
        `World generation did not complete within ${providers.world.maxPolls} polls`,
      );
    }
    return;
  }

  const landmarks = landmarkArtifactSchema.parse(
    await readJson(resolve(root, "landmarks", "landmark-detections.json")),
  );
  const world = generatedWorldManifestSchema.parse(
    await readJson(resolve(root, "world", editionId, "generated-world.json")),
  );

  if (stage === "interaction-baking") {
    const sourceSplatPath = resolve(root, "world", world.asset.storageKey);
    const interactions = await createInteractionManifest({
      baker: providers.interactionBaker,
      createdAt: clock(),
      landmarks,
      sourceSplatPath,
      sourceSplatSha256: world.asset.sha256,
    });
    await writeJsonExclusive(resolve(root, "interactions", "interaction-manifest.json"), interactions);
    return;
  }

  const edition = selectedEditionSchema.parse(
    await readJson(resolve(root, "editorial", "selected-edition.json")),
  );
  const interactions = interactionManifestSchema.parse(
    await readJson(resolve(root, "interactions", "interaction-manifest.json")),
  );
  const panoramaSha256 = sha256(panoramaBytes);
  const posterName = `${editionId}-${panoramaSha256.slice(0, 12)}-poster.png`;
  const publicationDirectory = resolve(root, "publication");
  await mkdir(publicationDirectory, { recursive: true });
  const posterPath = resolve(publicationDirectory, posterName);
  await copyExclusiveOrVerify(panoramaPath, posterPath);
  const publishableWorld = world.asset.format === "mock" ? null : {
    source: resolve(root, "world", world.asset.storageKey),
    filename: `${editionId}-${world.asset.sha256.slice(0, 12)}.${world.asset.format}`,
  };
  if (publishableWorld) {
    await copyExclusiveOrVerify(
      publishableWorld.source,
      resolve(publicationDirectory, publishableWorld.filename),
    );
  }
  const metadata = await sharp(panoramaBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Could not read poster dimensions");
  const publication = createPublicationManifest({
    artDirection,
    createdAt: clock(),
    edition,
    fictional,
    interactions,
    landmarks,
    poster: {
      src: `/generated/${posterName}`,
      width: metadata.width,
      height: metadata.height,
      sha256: panoramaSha256,
    },
    splat: publishableWorld ? {
      url: `/generated/${publishableWorld.filename}`,
      format: world.asset.format as "spz" | "ply" | "sog" | "splat" | "ksplat",
      sha256: world.asset.sha256,
    } : null,
  });
  const manifestPath = resolve(publicationDirectory, "publication-manifest.json");
  const publicationBytes = Buffer.from(`${JSON.stringify(publication, null, 2)}\n`);
  if (providers.localPublishDirectory) {
    const localDirectory = resolve(providers.localPublishDirectory);
    await copyExclusiveOrVerify(posterPath, resolve(localDirectory, posterName));
    if (publishableWorld) {
      await copyExclusiveOrVerify(
        publishableWorld.source,
        resolve(localDirectory, publishableWorld.filename),
      );
    }
    await writeBytesExclusiveOrVerify(
      publicationBytes,
      resolve(
        localDirectory,
        `${editionId}-${sha256(publicationBytes).slice(0, 12)}-publication.json`,
      ),
    );
  }
  await writeBytesExclusiveOrVerify(publicationBytes, manifestPath);
}

export async function runEditionWorkflow({
  clock = () => new Date(),
  editionId,
  fictional,
  providers,
  reviewApproval,
  runDirectory,
  targetStories = 10,
  throughStage = "publication",
}: {
  clock?: () => Date;
  editionId: string;
  fictional: boolean;
  providers: EditionProviders;
  reviewApproval?: { approvedBy: string };
  runDirectory: string;
  targetStories?: number;
  throughStage?: EditionStageName;
}): Promise<EditionRunResult> {
  const root = resolve(runDirectory);
  const throughIndex = editionStageNames.indexOf(throughStage);
  if (throughIndex < 0) throw new Error(`Unknown edition stage: ${throughStage}`);
  if (!Number.isInteger(providers.world.maxPolls) || providers.world.maxPolls < 1) {
    throw new Error("World max polls must be a positive integer");
  }
  if (!Number.isInteger(providers.world.pollIntervalMs) || providers.world.pollIntervalMs < 0) {
    throw new Error("World poll interval must be a nonnegative integer");
  }
  const executedStages: EditionStageName[] = [];
  const editorialTarget = workflowStageNames.includes(throughStage as WorkflowStageName)
    ? throughStage as WorkflowStageName
    : "art-direction";
  const editorial = await runEditorialWorkflow({
    clock,
    editionId,
    providers,
    runDirectory: root,
    targetStories,
    throughStage: editorialTarget,
  });
  executedStages.push(...editorial.executedStages);
  if (throughIndex <= editionStageNames.indexOf("art-direction")) {
    return { executedStages, inspection: await inspectEditionWorkflowDirectory(root) };
  }

  while (true) {
    const inspection = await inspectEditionWorkflowDirectory(root);
    const nextStage = inspection.nextStage;
    if (!nextStage || editionStageNames.indexOf(nextStage) > throughIndex) {
      return { executedStages, inspection };
    }
    const stageInspection = inspection.stages.find(({ stage }) => stage === nextStage)!;
    if (stageInspection.status === "invalid") {
      throw new Error(`Cannot resume invalid ${nextStage} artifact: ${stageInspection.detail}`);
    }
    if (workflowStageNames.includes(nextStage as WorkflowStageName)) {
      throw new Error(`Editorial workflow stopped before ${nextStage}`);
    }
    if (nextStage === "review" && !reviewApproval) {
      return { executedStages, inspection };
    }
    await runGenerationStage({
      clock,
      editionId,
      fictional,
      providers,
      reviewApproval,
      root,
      stage: nextStage as Exclude<EditionStageName, WorkflowStageName>,
    });
    executedStages.push(nextStage);
    if (nextStage === throughStage) {
      return { executedStages, inspection: await inspectEditionWorkflowDirectory(root) };
    }
  }
}

