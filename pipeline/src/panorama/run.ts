import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import sharp from "sharp";
import {
  DEFAULT_PANORAMA_CONFIG,
  defaultProcessingConfig,
} from "./config.js";
import type { PanoramaGenerator } from "./generator.js";
import { sha256 } from "./hash.js";
import { createPanoramaAssets } from "./process.js";
import { buildPanoramaPrompt } from "./prompt.js";

type RunPanoramaOptions = {
  scenePrompt: string;
  model: string;
  outputDirectory: string;
  generator: PanoramaGenerator;
};

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/png") return ".png";
  throw new Error(`Unsupported generated image MIME type: ${mimeType}`);
}

function artifactPath(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

export async function runPanorama({
  scenePrompt,
  model,
  outputDirectory,
  generator,
}: RunPanoramaOptions): Promise<string> {
  const outputRoot = resolve(outputDirectory);
  await mkdir(dirname(outputRoot), { recursive: true });
  await mkdir(outputRoot, { recursive: false });

  const prompt = buildPanoramaPrompt(scenePrompt);
  const generated = await generator.generate(prompt);
  const originalExtension = extensionForMimeType(generated.mimeType);
  const originalPath = resolve(outputRoot, `source-original${originalExtension}`);
  const normalizedPath = resolve(outputRoot, "source.png");
  await writeFile(originalPath, generated.bytes);
  await sharp(generated.bytes).png().toFile(normalizedPath);

  const artifacts = await createPanoramaAssets(
    normalizedPath,
    outputRoot,
    defaultProcessingConfig(),
  );

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    stage: "panorama-generation",
    provider: "google",
    model,
    request: {
      prompt,
      promptSha256: sha256(prompt),
      aspectRatio: DEFAULT_PANORAMA_CONFIG.generation.aspectRatio,
      imageSize: DEFAULT_PANORAMA_CONFIG.generation.imageSize,
      thinkingLevel: DEFAULT_PANORAMA_CONFIG.generation.thinkingLevel,
    },
    response: {
      mimeType: generated.mimeType,
      elapsedMs: generated.elapsedMs,
      usage: generated.usage,
      originalSha256: sha256(generated.bytes),
    },
    transforms: {
      centeredEquirectangularCrop: {
        top: artifacts.cropTop,
        width: artifacts.nativeWidth,
        height: artifacts.nativeHeight,
      },
      longitudeRepair: {
        method: "periodic cosine feather in linear-light RGB",
        width: DEFAULT_PANORAMA_CONFIG.seamFeatherWidth,
      },
      deliveryResize: {
        width: DEFAULT_PANORAMA_CONFIG.delivery.width,
        height: DEFAULT_PANORAMA_CONFIG.delivery.height,
        kernel: "lanczos3",
        nativeDetail: false,
      },
    },
    metrics: {
      longitudeSeam: artifacts.metrics,
    },
    files: {
      original: artifactPath(outputRoot, originalPath),
      normalizedSource: artifactPath(outputRoot, normalizedPath),
      nativeEquirectangular: artifactPath(outputRoot, artifacts.nativePath),
      seamRepairedEquirectangular: artifactPath(
        outputRoot,
        artifacts.repairedPath,
      ),
      delivery8k: artifactPath(outputRoot, artifacts.deliveryPath),
    },
  };

  const manifestPath = resolve(outputRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}
