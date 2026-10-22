import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { createInteractionManifest, type InteractionBaker } from "../interactions/run.js";
import { interactionManifestSchema } from "../interactions/schema.js";
import { CloudBrowserInteractionBaker } from "../interactions/cloud-browser.js";
import { landmarkArtifactSchema } from "../landmarks/schema.js";
import { sha256 } from "../panorama/hash.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { generatedWorldManifestSchema } from "../world/schema.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
});

async function readJson(artifacts: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await artifacts.read(key);
  if (!bytes) throw new Error(`Required baking artifact is missing: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

export function createCloudInteractionBakingHandler({
  artifacts,
  baker,
  now = () => new Date(),
}: {
  artifacts: ArtifactStore;
  baker: InteractionBaker;
  now?: () => Date;
}) {
  return async (rawInput: unknown) => {
    const { editionId } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const key = `${root}/interactions/interaction-manifest.json`;
    const landmarks = landmarkArtifactSchema.parse(await readJson(artifacts, `${root}/landmarks/landmark-detections.json`));
    const world = generatedWorldManifestSchema.parse(await readJson(artifacts, `${root}/world/generated-world.json`));
    if (landmarks.editionId !== editionId || world.editionId !== editionId ||
        landmarks.sourceImage.sha256 !== world.input.sourceImageSha256 || world.asset.format !== "spz") {
      throw new Error("World and landmark detections are not a matching SPZ edition");
    }
    const existing = await artifacts.read(key);
    if (existing) {
      const manifest = interactionManifestSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      if (baker.algorithmVersion && manifest.algorithmVersion !== baker.algorithmVersion) {
        throw new Error("Existing interactions use an older baking algorithm; explicitly rebake this edition before reusing it");
      }
      if (manifest.editionId !== editionId || manifest.sourceSplatSha256 !== world.asset.sha256 ||
          manifest.sourceImageSha256 !== landmarks.sourceImage.sha256) {
        throw new Error("Existing interactions do not match the world or panorama");
      }
      return { editionId, key, status: "reused" as const };
    }
    const assetBytes = await artifacts.read(world.asset.storageKey);
    if (!assetBytes || assetBytes.length !== world.asset.byteLength ||
        sha256(Buffer.from(assetBytes)) !== world.asset.sha256) {
      throw new Error("World SPZ is missing or has changed");
    }
    const directory = await mkdtemp(join(tmpdir(), "world-bake-"));
    try {
      const path = join(directory, "world.spz");
      await writeFile(path, assetBytes);
      const manifest = await createInteractionManifest({
        baker,
        createdAt: now(),
        landmarks,
        sourceSplatPath: path,
        sourceSplatSha256: world.asset.sha256,
      });
      await artifacts.putImmutable({
        key,
        bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
        contentType: "application/json",
      });
      return { editionId, key, status: "created" as const };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export async function main(event: unknown) {
  const bucket = process.env.ARTIFACT_BUCKET?.trim();
  const siteBucket = process.env.EXPLORER_SITE_BUCKET?.trim();
  if (!bucket) throw new Error("Missing required environment variable: ARTIFACT_BUCKET");
  if (!siteBucket) throw new Error("Missing required environment variable: EXPLORER_SITE_BUCKET");
  const s3 = new S3Client({});
  return createCloudInteractionBakingHandler({
    artifacts: new S3ArtifactStore({ bucket, client: s3 }),
    baker: new CloudBrowserInteractionBaker({ client: s3, siteBucket }),
  })(event);
}
