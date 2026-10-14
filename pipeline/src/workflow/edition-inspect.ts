import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { artDirectionSchema } from "../art-direction/schema.js";
import { artifactSha256 } from "../editorial/select.js";
import { interactionManifestSchema } from "../interactions/schema.js";
import { landmarkArtifactSchema } from "../landmarks/schema.js";
import { sha256 } from "../panorama/hash.js";
import { editionPanoramaManifestSchema } from "../panorama/schema.js";
import { publicationManifestSchema } from "../publication/schema.js";
import { generatedWorldManifestSchema } from "../world/schema.js";
import { inspectWorkflowDirectory, workflowStageNames, type WorkflowStageStatus } from "./inspect.js";
import { editionReviewSchema } from "./review.js";

export const editionStageNames = [
  ...workflowStageNames,
  "review",
  "panorama",
  "landmark-detection",
  "world-generation",
  "interaction-baking",
  "publication",
] as const;

export type EditionStageName = typeof editionStageNames[number];

export type EditionStageInspection = {
  stage: EditionStageName;
  status: WorkflowStageStatus;
  path: string;
  detail: string;
};

export type EditionWorkflowInspection = {
  runDirectory: string;
  nextStage: EditionStageName | null;
  readyForPanorama: boolean;
  readyForPublication: boolean;
  stages: EditionStageInspection[];
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

function blocked(stage: EditionStageName, path: string): EditionStageInspection {
  return { stage, status: "blocked", path, detail: "A required earlier artifact is not complete" };
}

function safeArtifactPath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("Artifact paths must be relative");
  const resolved = resolve(root, path);
  if (relative(root, resolved).startsWith("..")) throw new Error("Artifact path escapes its stage directory");
  return resolved;
}

export async function inspectEditionWorkflowDirectory(runDirectory: string): Promise<EditionWorkflowInspection> {
  const root = resolve(runDirectory);
  const editorial = await inspectWorkflowDirectory(root);
  const stages: EditionStageInspection[] = [...editorial.stages];
  const paths = {
    artDirection: resolve(root, "art-direction", "art-direction.json"),
    review: resolve(root, "review", "approval.json"),
    panorama: resolve(root, "panorama", "manifest.json"),
    landmarks: resolve(root, "landmarks", "landmark-detections.json"),
    world: resolve(root, "world"),
    interactions: resolve(root, "interactions", "interaction-manifest.json"),
    publication: resolve(root, "publication", "publication-manifest.json"),
  };

  if (!editorial.readyForPanorama) {
    stages.push(blocked("review", paths.review));
    stages.push(blocked("panorama", paths.panorama));
    stages.push(blocked("landmark-detection", paths.landmarks));
    stages.push(blocked("world-generation", paths.world));
    stages.push(blocked("interaction-baking", paths.interactions));
    stages.push(blocked("publication", paths.publication));
    return {
      runDirectory: root,
      nextStage: stages.find(({ status }) => status !== "complete")?.stage ?? null,
      readyForPanorama: false,
      readyForPublication: false,
      stages,
    };
  }

  const artDirection = artDirectionSchema.parse(JSON.parse(await readFile(paths.artDirection, "utf8")));
  let chainValid = true;
  const selectedEdition = JSON.parse(
    await readFile(resolve(root, "editorial", "selected-edition.json"), "utf8"),
  ) as unknown;
  const reviewInput = await readJsonIfPresent(paths.review);
  if (!reviewInput.found) {
    stages.push({
      stage: "review",
      status: "missing",
      path: paths.review,
      detail: "Edition is waiting for approval before visual generation",
    });
    chainValid = false;
  } else {
    try {
      const review = editionReviewSchema.parse(reviewInput.value);
      if (
        review.editionId !== artDirection.editionId ||
        review.inputs.selectedEditionSha256 !== artifactSha256(selectedEdition) ||
        review.inputs.artDirectionSha256 !== artifactSha256(artDirection)
      ) throw new Error("Review approval does not match the selected edition and art direction");
      stages.push({
        stage: "review",
        status: "complete",
        path: paths.review,
        detail: `Approved by ${review.approvedBy}`,
      });
    } catch (error) {
      stages.push({
        stage: "review",
        status: "invalid",
        path: paths.review,
        detail: error instanceof Error ? error.message : String(error),
      });
      chainValid = false;
    }
  }

  let panorama: ReturnType<typeof editionPanoramaManifestSchema.parse> | undefined;
  const panoramaInput = await readJsonIfPresent(paths.panorama);
  if (!chainValid) stages.push(blocked("panorama", paths.panorama));
  else if (!panoramaInput.found) {
    stages.push({
      stage: "panorama",
      status: "missing",
      path: paths.panorama,
      detail: "Panorama has not been generated",
    });
    chainValid = false;
  } else {
    try {
      panorama = editionPanoramaManifestSchema.parse(panoramaInput.value);
      if (
        panorama.editionId !== artDirection.editionId ||
        panorama.inputs.artDirectionSha256 !== artifactSha256(artDirection)
      ) {
        throw new Error("Panorama does not match the art-direction artifact");
      }
      const deliveryBytes = await readFile(safeArtifactPath(resolve(root, "panorama"), panorama.files.delivery8k));
      if (sha256(deliveryBytes) !== panorama.outputs.delivery8kSha256) {
        throw new Error("Delivery panorama checksum does not match its manifest");
      }
      stages.push({
        stage: "panorama",
        status: "complete",
        path: paths.panorama,
        detail: "Validated delivery panorama",
      });
    } catch (error) {
      stages.push({
        stage: "panorama",
        status: "invalid",
        path: paths.panorama,
        detail: error instanceof Error ? error.message : String(error),
      });
      chainValid = false;
    }
  }

  let landmarks: ReturnType<typeof landmarkArtifactSchema.parse> | undefined;
  const landmarkInput = await readJsonIfPresent(paths.landmarks);
  if (!chainValid) stages.push(blocked("landmark-detection", paths.landmarks));
  else if (!landmarkInput.found) {
    stages.push({
      stage: "landmark-detection",
      status: "missing",
      path: paths.landmarks,
      detail: "Landmarks have not been detected",
    });
    chainValid = false;
  } else {
    try {
      landmarks = landmarkArtifactSchema.parse(landmarkInput.value);
      if (
        landmarks.editionId !== artDirection.editionId ||
        landmarks.sourceImage.sha256 !== panorama!.outputs.delivery8kSha256
      ) {
        throw new Error("Landmark detections do not match the panorama");
      }
      const subjectIds = new Set(artDirection.subjects.map(({ storyId }) => storyId));
      if (
        landmarks.landmarks.length !== subjectIds.size ||
        landmarks.landmarks.some(({ storyId }) => !subjectIds.has(storyId))
      ) throw new Error("Landmark detections do not cover the art-direction subjects");
      stages.push({
        stage: "landmark-detection",
        status: "complete",
        path: paths.landmarks,
        detail: `${landmarks.landmarks.length} landmarks`,
      });
    } catch (error) {
      stages.push({
        stage: "landmark-detection",
        status: "invalid",
        path: paths.landmarks,
        detail: error instanceof Error ? error.message : String(error),
      });
      chainValid = false;
    }
  }

  let world: ReturnType<typeof generatedWorldManifestSchema.parse> | undefined;
  const worldPath = resolve(paths.world, artDirection.editionId, "generated-world.json");
  const worldInput = await readJsonIfPresent(worldPath);
  if (!chainValid) stages.push(blocked("world-generation", worldPath));
  else if (!worldInput.found) {
    stages.push({
      stage: "world-generation",
      status: "missing",
      path: worldPath,
      detail: "World has not been generated",
    });
    chainValid = false;
  } else {
    try {
      world = generatedWorldManifestSchema.parse(worldInput.value);
      if (
        world.editionId !== artDirection.editionId ||
        world.input.sourceImageSha256 !== panorama!.outputs.delivery8kSha256
      ) {
        throw new Error("Generated world does not match the panorama");
      }
      const worldAsset = await readFile(safeArtifactPath(paths.world, world.asset.storageKey));
      if (sha256(worldAsset) !== world.asset.sha256) {
        throw new Error("World asset checksum does not match its manifest");
      }
      stages.push({
        stage: "world-generation",
        status: "complete",
        path: worldPath,
        detail: `${world.asset.format} world asset`,
      });
    } catch (error) {
      stages.push({
        stage: "world-generation",
        status: "invalid",
        path: worldPath,
        detail: error instanceof Error ? error.message : String(error),
      });
      chainValid = false;
    }
  }

  let interactions: ReturnType<typeof interactionManifestSchema.parse> | undefined;
  const interactionInput = await readJsonIfPresent(paths.interactions);
  if (!chainValid) stages.push(blocked("interaction-baking", paths.interactions));
  else if (!interactionInput.found) {
    stages.push({
      stage: "interaction-baking",
      status: "missing",
      path: paths.interactions,
      detail: "Interactions have not been baked",
    });
    chainValid = false;
  } else {
    try {
      interactions = interactionManifestSchema.parse(interactionInput.value);
      if (
        interactions.editionId !== artDirection.editionId ||
        interactions.sourceImageSha256 !== landmarks!.sourceImage.sha256 ||
        interactions.sourceSplatSha256 !== world!.asset.sha256
      ) throw new Error("Interaction mapping does not match its image and world assets");
      stages.push({
        stage: "interaction-baking",
        status: "complete",
        path: paths.interactions,
        detail: `${interactions.anchors.length} world-space anchors`,
      });
    } catch (error) {
      stages.push({
        stage: "interaction-baking",
        status: "invalid",
        path: paths.interactions,
        detail: error instanceof Error ? error.message : String(error),
      });
      chainValid = false;
    }
  }

  const publicationInput = await readJsonIfPresent(paths.publication);
  if (!chainValid) stages.push(blocked("publication", paths.publication));
  else if (!publicationInput.found) {
    stages.push({
      stage: "publication",
      status: "missing",
      path: paths.publication,
      detail: "Publication has not been assembled",
    });
  } else {
    try {
      const publication = publicationManifestSchema.parse(publicationInput.value);
      if (
        publication.edition.id !== artDirection.editionId ||
        publication.world.interactionMapping.sourceSplatSha256 !== interactions!.sourceSplatSha256
      ) throw new Error("Publication does not match the interaction artifact");
      const poster = await readFile(resolve(root, "publication", basename(publication.world.poster.src)));
      if (sha256(poster) !== publication.world.poster.sha256) {
        throw new Error("Publication poster checksum does not match its manifest");
      }
      if (publication.world.splat) {
        const splat = await readFile(
          resolve(root, "publication", basename(publication.world.splat.url)),
        );
        if (sha256(splat) !== publication.world.splat.sha256) {
          throw new Error("Publication world checksum does not match its manifest");
        }
      }
      const anchorIds = new Set(interactions!.anchors.map(({ id }) => id));
      const publicationAnchorIds = new Set([
        ...publication.stories.map(({ id }) => id),
        ...publication.storyEchoes.map(({ id }) => id),
      ]);
      if (
        publicationAnchorIds.size !== anchorIds.size ||
        [...publicationAnchorIds].some((id) => !anchorIds.has(id))
      ) throw new Error("Publication markers do not match the interaction anchors");
      stages.push({
        stage: "publication",
        status: "complete",
        path: paths.publication,
        detail: `${publication.stories.length} published stories`,
      });
    } catch (error) {
      stages.push({
        stage: "publication",
        status: "invalid",
        path: paths.publication,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    runDirectory: root,
    nextStage: stages.find(({ status }) => status !== "complete")?.stage ?? null,
    readyForPanorama: stages.find(({ stage }) => stage === "review")?.status === "complete",
    readyForPublication: stages.every(({ status }) => status === "complete"),
    stages,
  };
}

