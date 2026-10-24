import type { ArtifactStore } from "../storage/artifact-store.js";
import { jobId, jobRoot, jobSchema, type JobRef } from "./job.js";

export async function readJson(store: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await store.read(key);
  if (!bytes) throw new Error(`Missing video artifact: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}
export async function readJob(store: ArtifactStore, ref: JobRef) {
  const job = jobSchema.parse(await readJson(store, `${jobRoot(ref)}/job.json`));
  if (job.editionId !== ref.editionId || jobId(job) !== ref.jobId ||
    job.worldKey !== `editions/${ref.editionId}/world/assets/world.spz`) throw new Error("Video job identity mismatch");
  return job;
}
export function writeJson(store: ArtifactStore, key: string, value: unknown) {
  return store.putImmutable({ key, bytes: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
}
