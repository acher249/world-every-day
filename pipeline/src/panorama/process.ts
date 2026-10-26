import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { PanoramaProcessingConfig } from "./config.js";
import { harmonizePeriodicExposure, extractPolePatch, createMaskedPoleRepairSheet, extractRepairedPoleSheet, compositePolePatch, stabilizePoleConvergence } from "./poles.js";

export type PoleRepair = (sheet: Buffer) => Promise<Buffer>;

export type SeamMetrics = {
  wrapMeanAbsoluteDifference: number;
  leftFeatherBoundaryDifference: number;
  rightFeatherBoundaryDifference: number;
};

export type PanoramaArtifacts = {
  nativePath: string;
  repairedPath: string;
  deliveryPath: string;
  cropTop: number;
  nativeWidth: number;
  nativeHeight: number;
  metrics: SeamMetrics;
  poleRepair?: { inputPath: string; responsePath: string };
};

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const encoded =
    value <= 0.0031308
      ? value * 12.92
      : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

async function featherLongitudeBoundary(
  inputPath: string,
  outputPath: string,
  featherWidth: number,
): Promise<void> {
  const { data, info } = await sharp(inputPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!Number.isInteger(featherWidth) || featherWidth <= 0) {
    throw new Error("Seam feather width must be a positive integer");
  }
  if (featherWidth * 2 >= width) {
    throw new Error("Seam feather width is too large for the panorama");
  }

  const output = Buffer.from(data);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * channels;
    for (let distance = 0; distance < featherWidth; distance += 1) {
      const leftX = distance;
      const rightX = width - 1 - distance;
      const strength = 0.5 * (1 + Math.cos((Math.PI * distance) / featherWidth));
      for (let channel = 0; channel < Math.min(3, channels); channel += 1) {
        const leftIndex = rowOffset + leftX * channels + channel;
        const rightIndex = rowOffset + rightX * channels + channel;
        const leftLinear = srgbToLinear(data[leftIndex]);
        const rightLinear = srgbToLinear(data[rightIndex]);
        const midpoint = (leftLinear + rightLinear) / 2;
        output[leftIndex] = linearToSrgb(
          leftLinear * (1 - strength) + midpoint * strength,
        );
        output[rightIndex] = linearToSrgb(
          rightLinear * (1 - strength) + midpoint * strength,
        );
      }
    }
  }

  await sharp(output, { raw: info }).png().toFile(outputPath);
}

async function measureSeam(
  inputPath: string,
  featherWidth: number,
): Promise<SeamMetrics> {
  const { data, info } = await sharp(inputPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const columnDifference = (first: number, second: number): number => {
    let difference = 0;
    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width * channels;
      for (let channel = 0; channel < Math.min(3, channels); channel += 1) {
        difference += Math.abs(
          data[rowOffset + first * channels + channel] -
            data[rowOffset + second * channels + channel],
        );
      }
    }
    return difference / (height * Math.min(3, channels));
  };

  return {
    wrapMeanAbsoluteDifference: columnDifference(width - 1, 0),
    leftFeatherBoundaryDifference: columnDifference(
      featherWidth - 1,
      featherWidth,
    ),
    rightFeatherBoundaryDifference: columnDifference(
      width - featherWidth - 1,
      width - featherWidth,
    ),
  };
}

export async function createPanoramaAssets(
  sourcePath: string,
  outputDirectory: string,
  config: PanoramaProcessingConfig,
  repairPoles?: PoleRepair,
): Promise<PanoramaArtifacts> {
  if (config.deliveryWidth !== config.deliveryHeight * 2) {
    throw new Error("Delivery dimensions must use a 2:1 equirectangular ratio");
  }
  if (config.sourceWidth % 2 !== 0) {
    throw new Error("Source width must be even");
  }

  const metadata = await sharp(sourcePath).metadata();
  if (
    metadata.width !== config.sourceWidth ||
    metadata.height !== config.sourceHeight
  ) {
    throw new Error(
      `Unexpected source dimensions ${metadata.width ?? "?"}x${metadata.height ?? "?"}; ` +
        `expected ${config.sourceWidth}x${config.sourceHeight}`,
    );
  }

  const nativeWidth = config.sourceWidth;
  const nativeHeight = nativeWidth / 2;
  if (nativeHeight > config.sourceHeight) {
    throw new Error("Source image does not contain enough height for a 2:1 crop");
  }
  const cropTop = Math.floor((config.sourceHeight - nativeHeight) / 2);

  await mkdir(outputDirectory, { recursive: true });
  const nativePath = resolve(outputDirectory, "equirectangular-native.png");
  const repairedPath = resolve(
    outputDirectory,
    "equirectangular-seam-repaired.png",
  );
  const deliveryPath = resolve(
    outputDirectory,
    `equirectangular-${config.deliveryWidth}x${config.deliveryHeight}.png`,
  );

  await sharp(sourcePath)
    .extract({
      left: 0,
      top: cropTop,
      width: nativeWidth,
      height: nativeHeight,
    })
    .png()
    .toFile(nativePath);

  const harmonizedPath = resolve(outputDirectory, "equirectangular-exposure-balanced.png");
  await writeFile(harmonizedPath, await harmonizePeriodicExposure(await readFile(nativePath)));
  await featherLongitudeBoundary(
    harmonizedPath,
    repairedPath,
    config.seamFeatherWidth,
  );

  let poleRepair: PanoramaArtifacts["poleRepair"];
  if (repairPoles) {
    let panorama = await readFile(repairedPath);
    const zenith = await extractPolePatch(panorama, "zenith");
    const nadir = await extractPolePatch(panorama, "nadir");
    const sheet = await createMaskedPoleRepairSheet(zenith, nadir);
    const response = await repairPoles(sheet);
    const patches = await extractRepairedPoleSheet(response);
    panorama = await compositePolePatch(panorama, patches.zenith, "zenith");
    panorama = await compositePolePatch(panorama, patches.nadir, "nadir");
    panorama = await stabilizePoleConvergence(panorama);
    await writeFile(repairedPath, panorama);
    await featherLongitudeBoundary(repairedPath, repairedPath, config.seamFeatherWidth);
    poleRepair = { inputPath: resolve(outputDirectory, "pole-repair-input.png"), responsePath: resolve(outputDirectory, "pole-repair-response.png") };
    await writeFile(poleRepair.inputPath, sheet);
    await sharp(response).png().toFile(poleRepair.responsePath);
  }

  await sharp(repairedPath)
    .resize({
      width: config.deliveryWidth,
      height: config.deliveryHeight,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toFile(deliveryPath);

  return {
    nativePath,
    repairedPath,
    deliveryPath,
    cropTop,
    nativeWidth,
    nativeHeight,
    poleRepair,
    metrics: await measureSeam(repairedPath, config.seamFeatherWidth),
  };
}
