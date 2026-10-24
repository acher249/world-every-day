import { z } from "zod";
import { soundtrackSchema } from "./music-options.js";
const asset = z.object({ key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive() });
const fields = z.object({
  editionId: z.string(), jobId: z.string().regex(/^[a-f0-9]{64}$/),
  worldSha256: z.string().regex(/^[a-f0-9]{64}$/), publicationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.literal(1280), height: z.literal(720), fps: z.literal(30), frames: z.literal(300), durationSeconds: z.literal(10),
  mp4: asset, webm: asset, poster: asset,
});
export const videoManifestSchema = z.discriminatedUnion("version", [
  fields.extend({ version: z.literal("tour-v1") }),
  fields.extend({ version: z.literal("tour-v2"), soundtrack: soundtrackSchema }),
  fields.extend({ version: z.literal("tour-v3"), soundtrack: soundtrackSchema, captureBuild: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
