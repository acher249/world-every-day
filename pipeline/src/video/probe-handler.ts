import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import chromium from "@sparticuz/chromium";
import { z } from "zod";
import { captureFrames } from "./capture-browser.js";
import { generatedWorldManifestSchema } from "../world/schema.js";

export const probeInputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  frameCount: z.number().int().min(1).max(300).default(1),
}).strict();

/** Manually invoked, private diagnostic only; cannot publish worlds or X posts. */
export async function main(event: unknown, context: { awsRequestId: string }) {
  const { editionId, frameCount } = probeInputSchema.parse(event);
  const artifactBucket = process.env.ARTIFACT_BUCKET;
  const probeBucket = process.env.PROBE_BUCKET;
  if (!artifactBucket || !probeBucket) throw new Error("ARTIFACT_BUCKET and PROBE_BUCKET are required");
  const s3 = new S3Client({});
  const started = performance.now();
  const manifestObject = await s3.send(new GetObjectCommand({ Bucket: artifactBucket, Key: `editions/${editionId}/world/generated-world.json` }));
  const world = generatedWorldManifestSchema.parse(JSON.parse(await manifestObject.Body!.transformToString()));
  if (world.editionId !== editionId || world.asset.format !== "spz" ||
      world.asset.storageKey !== `editions/${editionId}/world/assets/world.spz` || world.asset.byteLength > 512 * 1024 * 1024) {
    throw new Error("Invalid capture world manifest");
  }
  const directory = await mkdtemp(join(tmpdir(), "world-video-probe-"));
  try {
    const asset = await s3.send(new GetObjectCommand({ Bucket: artifactBucket, Key: world.asset.storageKey }));
    if (!asset.Body || asset.ContentLength !== world.asset.byteLength) throw new Error("World size mismatch");
    const worldPath = join(directory, "world.spz");
    await pipeline(asset.Body as Readable, createWriteStream(worldPath));
    const downloadMs = performance.now() - started;
    const prefix = `probes/${editionId}/${context.awsRequestId}`;
    const result = await captureFrames({ worldPath, expectedSha256: world.asset.sha256,
      executablePath: await chromium.executablePath(), args: chromium.args, frameCount,
      readStatic: async (key) => {
        const object = await s3.send(new GetObjectCommand({ Bucket: probeBucket, Key: `site/${key}` }));
        if (!object.Body) throw new Error("Missing capture build file");
        return object.Body.transformToByteArray();
      },
      onFrame: async (index, png) => {
        // Keep representative frames only; this benchmark is not an archive video.
        if (index !== 0 && index !== frameCount - 1) return;
        await s3.send(new PutObjectCommand({ Bucket: probeBucket, Key: `${prefix}/frame-${index}.png`, Body: png, ContentType: "image/png" }));
      },
    });
    const report = { editionId, ...result, downloadMs, totalMs: performance.now() - started, prefix,
      memoryMb: Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) };
    await s3.send(new PutObjectCommand({ Bucket: probeBucket, Key: `${prefix}/report.json`, Body: JSON.stringify(report), ContentType: "application/json" }));
    console.info("Capture benchmark", JSON.stringify(report));
    return report;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
