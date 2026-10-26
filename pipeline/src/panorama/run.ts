import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import sharp from "sharp";
import {
  DEFAULT_PANORAMA_CONFIG,
  defaultProcessingConfig,
  type PanoramaProcessingConfig,
} from "./config.js";
import type { PanoramaGenerator } from "./generator.js";
import { sha256 } from "./hash.js";
import { createPanoramaAssets, type PoleRepair } from "./process.js";
import { POLE_REPAIR_VERSION } from "./poles.js";
import { buildPanoramaPrompt } from "./prompt.js";
import { panoramaManifestSchema } from "./schema.js";

type RunPanoramaOptions = {
  artDirectionSha256?: string;
  editionId?: string;
  scenePrompt: string;
  model: string;
  outputDirectory: string;
  provider?: string;
  generator: PanoramaGenerator;
  processingConfig?: PanoramaProcessingConfig;
  repairPoles?: PoleRepair;
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
  artDirectionSha256,
  editionId,
  scenePrompt,
  model,
  outputDirectory,
  provider = "google",
  generator,
  processingConfig = defaultProcessingConfig(),
  repairPoles,
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
    processingConfig,
    repairPoles,
  );

  const deliveryBytes = await readFile(artifacts.deliveryPath);

  const manifest = panoramaManifestSchema.parse({
    schemaVersion: 1,
    artifactType: "panorama-manifest",
    editionId,
    createdAt: new Date().toISOString(),
    stage: "panorama-generation",
    inputs: artDirectionSha256 ? { artDirectionSha256 } : undefined,
    provider,
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
        method: "periodic exposure harmonization and cosine feather in linear-light RGB",
        width: processingConfig.seamFeatherWidth,
      },
      poleRepair: artifacts.poleRepair ? {
        method: POLE_REPAIR_VERSION,
        inputSha256: sha256(await readFile(artifacts.poleRepair.inputPath)),
        responseSha256: sha256(await readFile(artifacts.poleRepair.responsePath)),
      } : undefined,
      deliveryResize: {
        width: processingConfig.deliveryWidth,
        height: processingConfig.deliveryHeight,
        kernel: "lanczos3",
        nativeDetail: false,
      },
    },
    metrics: {
      longitudeSeam: artifacts.metrics,
    },
    outputs: {
      delivery8kSha256: sha256(deliveryBytes),
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
      ...(artifacts.poleRepair ? {
        poleRepairInput: artifactPath(outputRoot, artifacts.poleRepair.inputPath),
        poleRepairResponse: artifactPath(outputRoot, artifacts.poleRepair.responsePath),
      } : {}),
    },
  });

  const manifestPath = resolve(outputRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}
