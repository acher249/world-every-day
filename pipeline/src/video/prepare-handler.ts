import { z } from "zod";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { publicationManifestSchema } from "../publication/schema.js";
import { generatedWorldManifestSchema } from "../world/schema.js";
import { batchInputs, createVideoJob, jobId, jobRoot, videoManifestKey } from "./job.js";
import { readJson, writeJson } from "./store.js";

export function createPrepareVideo(artifacts: ArtifactStore, publicAssets: ArtifactStore, captureBuild: string) {
  return async (event: unknown) => {
    const input = z.object({ editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      publication: z.object({ status: z.literal("published"), key: z.string() }) }).parse(event);
    if (!["publication.json", "publication-public.json"].some((name) => input.publication.key === `generated/editions/${input.editionId}/${name}`)) throw new Error("Unexpected publication path");
    const bytes = await publicAssets.read(input.publication.key);
    if (!bytes) throw new Error("Published edition missing");
    const manifest = publicationManifestSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    const world = generatedWorldManifestSchema.parse(await readJson(artifacts, `editions/${input.editionId}/world/generated-world.json`));
    if (manifest.edition.id !== input.editionId || world.editionId !== input.editionId ||
        manifest.world.splat?.sha256 !== world.asset.sha256 || world.asset.format !== "spz") throw new Error("Published world mismatch");
    const job = createVideoJob(manifest, input.publication.key, bytes, world.asset.storageKey, captureBuild);
    const ref = { editionId: input.editionId, jobId: jobId(job) };
    await writeJson(artifacts, `${jobRoot(ref)}/job.json`, job);
    return { ...ref, batches: batchInputs(ref), complete: Boolean(await artifacts.read(videoManifestKey(ref))) };
  };
}
export async function main(event: unknown) {
  return createPrepareVideo(new S3ArtifactStore({ bucket: process.env.ARTIFACT_BUCKET! }),
    new S3ArtifactStore({ bucket: process.env.PUBLIC_ASSET_BUCKET! }), process.env.VIDEO_CAPTURE_BUILD!)(event);
}
