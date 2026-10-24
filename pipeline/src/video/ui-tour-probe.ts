import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { selectSoundtrack, soundtrackWav } from "./music-options.js";
import { captureUiFrames } from "./capture-ui.js";

/** Local runner for the same UI capture used by Lambda. No cloud writes or posts. */
async function main() {
  const [site, publicationFile, worldFile, output, chrome] = process.argv.slice(2);
  if (!chrome) throw new Error("Usage: ui-tour-probe.ts <frontend/out> <publication.json> <world.spz> <output-directory> <Chrome executable>");
  const root = resolve(site);
  const publicationBytes = await readFile(publicationFile);
  const publication = JSON.parse(publicationBytes.toString("utf8"));
  await mkdir(output, { recursive: true });
  await captureUiFrames({ publicationBytes, worldPath: worldFile, expectedSha256: publication.world.splat.sha256, executablePath: chrome,
    readStatic: (key) => readFile(join(root, key)),
    onFrame: async (frame, png) => { await writeFile(join(output, `${String(frame).padStart(4, "0")}.png`), png); },
  });
  const soundtrack = selectSoundtrack(publication.edition.id, publication.world.splat.sha256);
  await writeFile(join(output, "ambient.wav"), soundtrackWav(soundtrack));
  await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-framerate", "30", "-i", join(output, "%04d.png"), "-i", join(output, "ambient.wav"),
    "-t", "10", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(output, "ui-tour.mp4")]);
  await writeFile(join(output, "soundtrack.json"), JSON.stringify({ editionId: publication.edition.id, worldSha256: publication.world.splat.sha256, soundtrack }, null, 2));
  console.info(`Video: ${join(output, "ui-tour.mp4")} · ${soundtrack}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "UI tour failed"); process.exitCode = 1; });
