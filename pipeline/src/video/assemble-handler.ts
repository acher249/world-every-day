import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { sha256 } from "../panorama/hash.js";
import { soundtrackWav } from "./music-options.js";
import { frameKey, jobRefSchema, jobRoot, videoManifestKey } from "./job.js";
import { videoManifestSchema } from "./manifest.js";
import { readJob, readJson, writeJson } from "./store.js";

const execute = promisify(execFile);
const batchSchema = z.object({ jobId: z.string(), frames: z.array(z.object({ index: z.number().int(), sha256: z.string(), byteLength: z.number().int() })).length(10) });

export function validateProbe(probe: { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; nb_read_frames?: string }[]; format?: { duration?: string } }, videoCodec: string, audioCodec: string) {
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (video?.codec_name !== videoCodec || audio?.codec_name !== audioCodec || video.width !== 1280 || video.height !== 720 ||
    video.avg_frame_rate !== "30/1" || Number(video.nb_read_frames) !== 300 || Math.abs(Number(probe.format?.duration) - 10) > 0.1 || !Number.isFinite(Number(probe.format?.duration))) {
    throw new Error("Encoded video failed codec, frame count, dimensions, or duration validation");
  }
}

export async function main(event: unknown) {
  const ref = jobRefSchema.parse(event);
  const artifacts = new S3ArtifactStore({ bucket: process.env.ARTIFACT_BUCKET! });
  const publicAssets = new S3ArtifactStore({ bucket: process.env.PUBLIC_ASSET_BUCKET! });
  const job = await readJob(artifacts, ref);
  const existing = await artifacts.read(videoManifestKey(ref));
  if (existing) {
    const saved = videoManifestSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
    if (saved.jobId !== ref.jobId || saved.worldSha256 !== job.worldSha256) throw new Error("Video manifest mismatch");
    return { ...ref, manifestKey: videoManifestKey(ref), status: "ready" };
  }
  const publication = await publicAssets.read(job.publicationKey);
  if (!publication || sha256(Buffer.from(publication)) !== job.publicationSha256) throw new Error("Publication changed during video render");
  const directory = await mkdtemp(join(tmpdir(), "world-video-assemble-"));
  try {
    for (let batch = 0; batch < 30; batch++) {
      const receipt = batchSchema.parse(await readJson(artifacts, `${jobRoot(ref)}/batches/${batch * 10}.json`));
      if (receipt.jobId !== ref.jobId || receipt.frames.some((frame, i) => frame.index !== batch * 10 + i)) throw new Error("Video batch frame ordering mismatch");
      await Promise.all(receipt.frames.map(async (frame) => {
        const bytes = await artifacts.read(frameKey(ref, frame.index));
        if (!bytes || bytes.byteLength !== frame.byteLength || sha256(Buffer.from(bytes)) !== frame.sha256) throw new Error("Video frame missing or changed");
        await writeFile(join(directory, `${String(frame.index).padStart(4, "0")}.png`), bytes);
      }));
    }
    await writeFile(join(directory, "ambient.wav"), soundtrackWav(job.soundtrack));
    const ffmpeg = process.env.VIDEO_FFMPEG ?? "/opt/video/bin/ffmpeg";
    const ffprobe = process.env.VIDEO_FFPROBE ?? "/opt/video/bin/ffprobe";
    const input = ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "30", "-i", join(directory, "%04d.png"), "-i", join(directory, "ambient.wav"),
      "-map", "0:v:0", "-map", "1:a:0", "-frames:v", "300", "-t", "10", "-pix_fmt", "yuv420p", "-threads", "2"];
    const formats = [
      { name: "tour.mp4", video: "h264", audio: "aac", type: "video/mp4", args: ["-c:v", "libopenh264", "-b:v", "5M", "-g", "60", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"] },
      { name: "tour.webm", video: "vp9", audio: "opus", type: "video/webm", args: ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6", "-b:v", "3M", "-c:a", "libopus", "-b:a", "96k"] },
    ];
    const results = [];
    for (const format of formats) {
      const path = join(directory, format.name);
      await execute(ffmpeg, [...input, ...format.args, path], { timeout: 300_000, maxBuffer: 1024 * 1024 });
      const { stdout } = await execute(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", path], { timeout: 60_000 });
      validateProbe(JSON.parse(stdout), format.video, format.audio);
      // Decode the whole video and audio; container metadata alone is not enough.
      await execute(ffmpeg, ["-v", "error", "-xerror", "-i", path, "-f", "null", "-"], { timeout: 60_000 });
      const bytes = await readFile(path);
      if (bytes.length > 50 * 1024 * 1024) throw new Error("Encoded clip exceeds 50 MiB limit");
      results.push(await publicAssets.putImmutable({ key: `generated/editions/${ref.editionId}/video/${ref.jobId}/${format.name}`, bytes, contentType: format.type }));
    }
    const poster = await publicAssets.putImmutable({ key: `generated/editions/${ref.editionId}/video/${ref.jobId}/poster.png`, bytes: await readFile(join(directory, "0000.png")), contentType: "image/png" });
    const manifest = videoManifestSchema.parse({ version: job.version, ...ref, soundtrack: job.soundtrack, captureBuild: job.captureBuild, worldSha256: job.worldSha256, publicationSha256: job.publicationSha256,
      width: 1280, height: 720, fps: 30, frames: 300, durationSeconds: 10, mp4: results[0], webm: results[1], poster });
    await writeJson(publicAssets, `generated/editions/${ref.editionId}/video/${ref.jobId}/manifest.json`, manifest);
    await writeJson(artifacts, videoManifestKey(ref), manifest);
    return { ...ref, manifestKey: videoManifestKey(ref), status: "ready" };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
