import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { captureFrames } from "./capture-browser.js";

/** Local proof runner. No cloud writes, posting, or generation calls. */
async function main() {
  const [siteDirectory, worldPath, outputPath, chromePath] = process.argv.slice(2);
  if (!siteDirectory || !worldPath || !outputPath || !chromePath) {
    throw new Error("Usage: frame-probe.ts <frontend/out> <world.spz> <output.png> <Chrome executable>");
  }
  const root = resolve(siteDirectory);
  const result = await captureFrames({ worldPath, executablePath: chromePath,
    readStatic: (key) => readFile(resolve(root, key)),
    onFrame: async (_index, png) => { await writeFile(outputPath, png); },
  });
  console.info(JSON.stringify({ ...result, outputPath }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Frame probe failed"); process.exitCode = 1; });
