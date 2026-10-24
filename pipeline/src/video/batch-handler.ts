import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import chromium from "@sparticuz/chromium";
import { z } from "zod";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { sha256 } from "../panorama/hash.js";
import { captureUiFrames } from "./capture-ui.js";
import { frameKey, jobRefSchema, jobRoot } from "./job.js";
import { readJob, writeJson } from "./store.js";

export async function main(event: unknown) {
  const input = jobRefSchema.extend({ startFrame: z.number().int().min(0).max(290).multipleOf(10) }).parse(event);
  const bucket = process.env.ARTIFACT_BUCKET!;
  const s3 = new S3Client({});
  const store = new S3ArtifactStore({ bucket, client: s3 });
  const job = await readJob(store, input);
  const publicStore = new S3ArtifactStore({ bucket: process.env.PUBLIC_ASSET_BUCKET!, client: s3 });
  const publicationBytes = await publicStore.read(job.publicationKey);
  if (!publicationBytes || sha256(Buffer.from(publicationBytes)) !== job.publicationSha256) throw new Error("Video publication changed");
  const receiptKey = `${jobRoot(input)}/batches/${input.startFrame}.json`;
  if (await store.read(receiptKey)) return { startFrame: input.startFrame, status: "reused" };
  const directory = await mkdtemp(join(tmpdir(), "world-video-batch-"));
  try {
    const asset = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: job.worldKey }));
    if (!asset.Body || !asset.ContentLength || asset.ContentLength > 512 * 1024 * 1024) throw new Error("Invalid world size");
    const worldPath = join(directory, "world.spz");
    await pipeline(asset.Body as Readable, createWriteStream(worldPath));
    const frames: { index: number; sha256: string; byteLength: number }[] = [];
    await captureUiFrames({ worldPath, publicationBytes, expectedSha256: job.worldSha256, executablePath: await chromium.executablePath(),
      args: chromium.args, frameCount: 10, startFrame: input.startFrame,
      readStatic: async (key) => {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `video-builds/${job.captureBuild}/${key}` }));
        if (!object.Body) throw new Error("Capture build is missing");
        return object.Body.transformToByteArray();
      },
      shouldSkip: async (index) => {
        const bytes = await store.read(frameKey(input, index));
        if (!bytes) return false;
        frames.push({ index, sha256: sha256(Buffer.from(bytes)), byteLength: bytes.byteLength });
        return true;
      },
      onFrame: async (index, bytes) => {
        const stored = await store.putImmutable({ key: frameKey(input, index), bytes, contentType: "image/png" });
        frames.push({ index, sha256: stored.sha256, byteLength: stored.byteLength });
      },
    });
    if (frames.length !== 10) throw new Error("Incomplete video batch");
    await writeJson(store, receiptKey, { jobId: input.jobId, frames });
    return { startFrame: input.startFrame, status: "rendered" };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
