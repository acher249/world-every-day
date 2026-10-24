import { z } from "zod";
import { sha256 } from "../panorama/hash.js";
import type { PublicationManifest } from "../publication/schema.js";
import { selectSoundtrack, soundtrackSchema } from "./music-options.js";

export const VIDEO_VERSION = "tour-v3";
export const jobSchema = z.object({
  version: z.literal(VIDEO_VERSION), editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  publicationKey: z.string(), publicationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  worldSha256: z.string().regex(/^[a-f0-9]{64}$/), worldKey: z.string(),
  seed: z.number().int().min(0), startYaw: z.number().finite(),
  soundtrack: soundtrackSchema,
  captureBuild: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.literal(1280), height: z.literal(720), fps: z.literal(30), frameCount: z.literal(300),
  batchSize: z.literal(10),
}).strict();
export type VideoJob = z.infer<typeof jobSchema>;
export const jobRefSchema = z.object({ editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), jobId: z.string().regex(/^[a-f0-9]{64}$/) });
export type JobRef = z.infer<typeof jobRefSchema>;
export const jobRoot = (ref: JobRef) => `video-work/${ref.editionId}/${ref.jobId}`;
export const videoManifestKey = (ref: JobRef) => `videos/${ref.editionId}/${ref.jobId}/manifest.json`;
export const frameKey = (ref: JobRef, index: number) => `${jobRoot(ref)}/frames/${String(index).padStart(4, "0")}.png`;
export const jobId = (job: VideoJob) => sha256(Buffer.from(JSON.stringify(jobSchema.parse(job))));

export function createVideoJob(manifest: PublicationManifest, publicationKey: string, publicationBytes: Uint8Array, worldKey: string, captureBuild: string): VideoJob {
  if (manifest.edition.status !== "published" || manifest.edition.fictional || !manifest.world.splat) throw new Error("Video requires a real published world");
  const seed = Number.parseInt(sha256(Buffer.from(manifest.edition.id)).slice(0, 8), 16);
  const point = manifest.stories[seed % manifest.stories.length].interaction.worldPosition;
  return jobSchema.parse({ version: VIDEO_VERSION, editionId: manifest.edition.id, publicationKey,
    publicationSha256: sha256(Buffer.from(publicationBytes)), worldSha256: manifest.world.splat.sha256, worldKey,
    soundtrack: selectSoundtrack(manifest.edition.id, manifest.world.splat.sha256),
    captureBuild,
    seed, startYaw: Math.atan2(-point.x, -point.z), width: 1280, height: 720, fps: 30, frameCount: 300, batchSize: 10 });
}

export function batchInputs(ref: JobRef) {
  return Array.from({ length: 30 }, (_, batch) => ({ ...ref, startFrame: batch * 10 }));
}

/** Continuous shared timeline: batch boundaries never reset the camera. */
export function cameraPose(job: Pick<VideoJob, "seed" | "startYaw">, frame: number) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= 300) throw new Error("Invalid video frame");
  const t = frame / 30;
  const phase = (job.seed % 10000) / 10000 * Math.PI * 2;
  return {
    yaw: job.startYaw + t * Math.PI / 18 + 0.025 * Math.sin(t * 0.5 + phase),
    pitch: 0.07 * Math.sin(t * 0.4 + phase),
    drift: { x: 0.025 * Math.sin(t * 0.3 + phase), y: 0.008 * (1 + Math.sin(t * 0.3)), z: 0.025 * Math.cos(t * 0.3 + phase) },
  };
}
