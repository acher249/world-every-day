import sharp, { type OutputInfo } from "sharp";

type Pole = "zenith" | "nadir";
type Pixels = { data: Buffer; info: OutputInfo };
export const POLE_REPAIR_VERSION = "masked-dual-pole-color-matched-v1";

const EXPOSURE_BAND_FRACTION = 0.01;
const EXPOSURE_VERTICAL_SMOOTHING_FRACTION = 0.005;
const TANGENT_PATCH_SIZE = 2048;
const TANGENT_FOV_DEGREES = 110;
const POLE_REPAIR_SHEET_WIDTH = 4096;
const POLE_REPAIR_SHEET_HEIGHT = 2304;
const POLE_REPAIR_SHEET_PADDING = (POLE_REPAIR_SHEET_HEIGHT - TANGENT_PATCH_SIZE) / 2;
const POLE_MASK_DEGREES = 36;
const POLE_REPAIR_SOLID_DEGREES = 30;
const POLE_REPAIR_FEATHER_END_DEGREES = 44;
const POLE_COLOR_MATCH_INNER_DEGREES = POLE_MASK_DEGREES + 2;
const POLE_COLOR_MATCH_OUTER_DEGREES = 50;
const POLE_COLOR_MATCH_MIN_GAIN = 0.67;
const POLE_COLOR_MATCH_MAX_GAIN = 1.5;
const POLE_COLOR_MATCH_MAX_OFFSET = 0.2;
const POLE_CONVERGENCE_SOLID_DEGREES = 0.5;
const POLE_CONVERGENCE_FEATHER_END_DEGREES = 3;
const POLE_MASK_COLOR = { r: 255, g: 0, b: 255 };

const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, value) => {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
});

function linearToSrgb(value: number) {
  const encoded = value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

function smoothCosine(value: number) {
  return 0.5 * (1 + Math.cos(Math.PI * value));
}

function readBilinear(data: Buffer, width: number, height: number, channels: number, x: number, y: number, channel: number) {
  const wrappedX = ((x % width) + width) % width;
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(wrappedX);
  const y0 = Math.floor(clampedY);
  const x1 = (x0 + 1) % width;
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = wrappedX - x0;
  const ty = clampedY - y0;
  const top = data[(y0 * width + x0) * channels + channel] * (1 - tx)
    + data[(y0 * width + x1) * channels + channel] * tx;
  const bottom = data[(y1 * width + x0) * channels + channel] * (1 - tx)
    + data[(y1 * width + x1) * channels + channel] * tx;
  return top * (1 - ty) + bottom * ty;
}

function srgbSampleToLinear(value: number) {
  const floor = Math.floor(value);
  const ceil = Math.min(255, floor + 1);
  return SRGB_TO_LINEAR[floor]
    + (SRGB_TO_LINEAR[ceil] - SRGB_TO_LINEAR[floor]) * (value - floor);
}

function quantileSorted(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const position = (values.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.min(values.length - 1, lower + 1);
  const fraction = position - lower;
  return values[lower] * (1 - fraction) + values[upper] * fraction;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function estimatePolePatchColorTransform(base: Pixels, patch: Pixels, pole: Pole, tangent: number) {
  const baseSamples: number[][] = [[], [], []];
  const patchSamples: number[][] = [[], [], []];
  const half = patch.info.width / 2;
  const isZenith = pole === "zenith";
  const xStep = Math.max(1, Math.ceil(base.info.width / 256));
  const yStep = Math.max(1, Math.ceil(base.info.height / 128));

  for (let y = 0; y < base.info.height; y += yStep) {
    const latitude = Math.PI / 2 - ((y + 0.5) / base.info.height) * Math.PI;
    const angleDegrees = isZenith
      ? (Math.PI / 2 - latitude) * 180 / Math.PI
      : (Math.PI / 2 + latitude) * 180 / Math.PI;
    if (
      angleDegrees < POLE_COLOR_MATCH_INNER_DEGREES
      || angleDegrees > POLE_COLOR_MATCH_OUTER_DEGREES
    ) continue;

    const cosLatitude = Math.cos(latitude);
    const forward = isZenith ? Math.sin(latitude) : -Math.sin(latitude);
    if (forward <= 0) continue;

    for (let x = 0; x < base.info.width; x += xStep) {
      const longitude = ((x + 0.5) / base.info.width - 0.5) * 2 * Math.PI;
      const patchX = (((cosLatitude * Math.sin(longitude) / forward) / tangent + 1) * half) - 0.5;
      const patchY = (((-cosLatitude * Math.cos(longitude) / forward) / tangent + 1) * half) - 0.5;
      if (
        patchX < 0
        || patchX >= patch.info.width - 1
        || patchY < 0
        || patchY >= patch.info.height - 1
      ) continue;

      const baseIndex = (y * base.info.width + x) * base.info.channels;
      for (let channel = 0; channel < 3; channel += 1) {
        baseSamples[channel].push(SRGB_TO_LINEAR[base.data[baseIndex + channel]]);
        patchSamples[channel].push(srgbSampleToLinear(readBilinear(
          patch.data,
          patch.info.width,
          patch.info.height,
          patch.info.channels,
          patchX,
          patchY,
          channel,
        )));
      }
    }
  }

  return baseSamples.map((baseChannel, channel) => {
    const patchChannel = patchSamples[channel];
    if (baseChannel.length < 64 || patchChannel.length !== baseChannel.length) {
      return { gain: 1, offset: 0 };
    }
    baseChannel.sort((a, b) => a - b);
    patchChannel.sort((a, b) => a - b);
    const baseMedian = quantileSorted(baseChannel, 0.5);
    const patchMedian = quantileSorted(patchChannel, 0.5);
    const baseRange = quantileSorted(baseChannel, 0.9) - quantileSorted(baseChannel, 0.1);
    const patchRange = quantileSorted(patchChannel, 0.9) - quantileSorted(patchChannel, 0.1);
    const gain = clamp(
      patchRange > 0.01 ? baseRange / patchRange : 1,
      POLE_COLOR_MATCH_MIN_GAIN,
      POLE_COLOR_MATCH_MAX_GAIN,
    );
    const offset = clamp(
      baseMedian - patchMedian * gain,
      -POLE_COLOR_MATCH_MAX_OFFSET,
      POLE_COLOR_MATCH_MAX_OFFSET,
    );
    return { gain, offset };
  });
}

export function buildPoleRepairPrompt(prompt: string) {
  return `Use case: precise-object-edit
Asset type: masked zenith and nadir repair sheet for a photorealistic 360-degree panorama
Scene description: ${prompt.trim()}

Image 1 is a 16:9 two-panel repair sheet with thin black letterbox bars. The left square panel is a rectilinear view looking straight up at the exact zenith. The right square panel is a rectilinear view looking straight down at the exact nadir. In each panel, the solid magenta circle is an explicit inpainting mask. Replace every magenta pixel completely; no magenta may remain. Preserve the exact canvas, panel positions, camera directions, perspective, exposure, color, and all unmasked pixels so both repaired squares can be extracted at their original coordinates.

In the left zenith panel, continue the surrounding sky, clouds, canopy, ceiling, or overhead scene naturally through the mask. Remove wedges, duplicated or collapsed objects, radial pinches, vortices, rosettes, and false vanishing points. The exact center is directly above the camera.

In the right nadir panel, the exact center is immediately beneath the camera, never a forward-looking horizon. If a floor, ground, path, platform, or bridge enters the repair region, continue that supporting surface naturally beneath the camera and through the mask with consistent local scale and perspective. If the camera is legitimately above open air, water, or sky, continue that field smoothly without a radial burst. Remove repeated motifs, collapsed geometry, starbursts, rosettes, vortices, and false vanishing points.

Do not merge the two panels, move their boundary, crop, zoom, rotate, relight, add labels, add text, add logos, add watermarks, or introduce a circular pattern, fisheye effect, starburst, or radial seam. Output the same 16:9 two-panel repair sheet.`;
}

export async function harmonizePeriodicExposure(imageBuffer: Buffer) {
  const { data, info } = await sharp(imageBuffer)
    .toColourspace("srgb").removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.from(data);
  const comparedChannels = Math.min(3, info.channels);
  const bandWidth = Math.max(8, Math.round(info.width * EXPOSURE_BAND_FRACTION));
  const smoothingRadius = Math.max(
    1,
    Math.round(info.height * EXPOSURE_VERTICAL_SMOOTHING_FRACTION),
  );
  const bandCenterCorrection = (info.width - 1) / (info.width - bandWidth);
  const rowDeltas = new Float64Array(info.height * comparedChannels);

  for (let y = 0; y < info.height; y += 1) {
    const row = y * info.width * info.channels;
    for (let channel = 0; channel < comparedChannels; channel += 1) {
      let leftTotal = 0;
      let rightTotal = 0;
      for (let x = 0; x < bandWidth; x += 1) {
        leftTotal += data[row + x * info.channels + channel];
        rightTotal += data[row + (info.width - bandWidth + x) * info.channels + channel];
      }
      rowDeltas[y * comparedChannels + channel] = (rightTotal - leftTotal) / bandWidth;
    }
  }

  const prefixSums = Array.from(
    { length: comparedChannels },
    () => new Float64Array(info.height + 1),
  );
  for (let channel = 0; channel < comparedChannels; channel += 1) {
    for (let y = 0; y < info.height; y += 1) {
      prefixSums[channel][y + 1] = prefixSums[channel][y]
        + rowDeltas[y * comparedChannels + channel];
    }
  }

  for (let y = 0; y < info.height; y += 1) {
    const startY = Math.max(0, y - smoothingRadius);
    const endY = Math.min(info.height, y + smoothingRadius + 1);
    const sampleCount = endY - startY;
    const smoothedDeltas = prefixSums.map(
      (prefix) => ((prefix[endY] - prefix[startY]) / sampleCount) * bandCenterCorrection,
    );
    const row = y * info.width * info.channels;

    for (let x = 0; x < info.width; x += 1) {
      const longitudeRamp = 0.5 - x / (info.width - 1);
      const pixel = row + x * info.channels;
      for (let channel = 0; channel < comparedChannels; channel += 1) {
        output[pixel + channel] = Math.max(
          0,
          Math.min(255, Math.round(data[pixel + channel] + smoothedDeltas[channel] * longitudeRamp)),
        );
      }
    }
  }

  return sharp(output, { raw: info }).png().toBuffer();
}

export async function extractPolePatch(imageBuffer: Buffer, pole: Pole, size = TANGENT_PATCH_SIZE) {
  const { data, info } = await sharp(imageBuffer)
    .toColourspace("srgb").removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.allocUnsafe(size * size * 3);
  const half = size / 2;
  const tangent = Math.tan((TANGENT_FOV_DEGREES * Math.PI) / 360);
  const poleSign = pole === "zenith" ? 1 : -1;

  for (let py = 0; py < size; py += 1) {
    const normalizedY = ((py + 0.5 - half) / half) * tangent;
    for (let px = 0; px < size; px += 1) {
      const normalizedX = ((px + 0.5 - half) / half) * tangent;
      const inverseLength = 1 / Math.hypot(normalizedX, 1, normalizedY);
      const worldX = normalizedX * inverseLength;
      const worldY = poleSign * inverseLength;
      const worldZ = -normalizedY * inverseLength;
      const longitude = Math.atan2(worldX, worldZ);
      const latitude = Math.asin(worldY);
      const sourceX = (longitude / (2 * Math.PI) + 0.5) * info.width - 0.5;
      const sourceY = (0.5 - latitude / Math.PI) * info.height - 0.5;
      const outputIndex = (py * size + px) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        output[outputIndex + channel] = Math.round(
          readBilinear(data, info.width, info.height, info.channels, sourceX, sourceY, channel),
        );
      }
    }
  }

  return sharp(output, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}

export async function createMaskedPoleRepairSheet(zenithPatch: Buffer, nadirPatch: Buffer) {
  const mask = Buffer.allocUnsafe(TANGENT_PATCH_SIZE * TANGENT_PATCH_SIZE * 4);
  const half = TANGENT_PATCH_SIZE / 2;
  const tangent = Math.tan((TANGENT_FOV_DEGREES * Math.PI) / 360);

  for (let y = 0; y < TANGENT_PATCH_SIZE; y += 1) {
    const normalizedY = ((y + 0.5 - half) / half) * tangent;
    for (let x = 0; x < TANGENT_PATCH_SIZE; x += 1) {
      const normalizedX = ((x + 0.5 - half) / half) * tangent;
      const angleDegrees = Math.atan(Math.hypot(normalizedX, normalizedY)) * 180 / Math.PI;
      const index = (y * TANGENT_PATCH_SIZE + x) * 4;
      mask[index] = POLE_MASK_COLOR.r;
      mask[index + 1] = POLE_MASK_COLOR.g;
      mask[index + 2] = POLE_MASK_COLOR.b;
      mask[index + 3] = angleDegrees <= POLE_MASK_DEGREES ? 255 : 0;
    }
  }

  const maskPng = await sharp(mask, {
    raw: { width: TANGENT_PATCH_SIZE, height: TANGENT_PATCH_SIZE, channels: 4 },
  }).png().toBuffer();
  const [maskedZenith, maskedNadir] = await Promise.all([
    sharp(zenithPatch)
      .toColourspace("srgb").removeAlpha()
      .resize(TANGENT_PATCH_SIZE, TANGENT_PATCH_SIZE, { fit: "fill" })
      .composite([{ input: maskPng }])
      .png()
      .toBuffer(),
    sharp(nadirPatch)
      .toColourspace("srgb").removeAlpha()
      .resize(TANGENT_PATCH_SIZE, TANGENT_PATCH_SIZE, { fit: "fill" })
      .composite([{ input: maskPng }])
      .png()
      .toBuffer(),
  ]);

  return sharp({
    create: {
      width: POLE_REPAIR_SHEET_WIDTH,
      height: POLE_REPAIR_SHEET_HEIGHT,
      channels: 3,
      background: { r: 9, g: 9, b: 11 },
    },
  })
    .composite([
      { input: maskedZenith, left: 0, top: POLE_REPAIR_SHEET_PADDING },
      { input: maskedNadir, left: TANGENT_PATCH_SIZE, top: POLE_REPAIR_SHEET_PADDING },
    ])
    .png()
    .toBuffer();
}

export async function extractRepairedPoleSheet(sheetBuffer: Buffer) {
  const metadata = await sharp(sheetBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Image provider returned a pole repair sheet without valid dimensions");
  }
  if (Math.abs(metadata.width / metadata.height - 16 / 9) > 0.05) {
    throw new Error("Pole repair must preserve the 16:9 two-panel layout");
  }
  const preview = await sharp(sheetBuffer).resize(128, 72).toColourspace("srgb").removeAlpha().raw().toBuffer();
  let maskPixels = 0;
  for (let i = 0; i < preview.length; i += 3) {
    if (preview[i] > 235 && preview[i + 1] < 25 && preview[i + 2] > 235) maskPixels++;
  }
  if (maskPixels > 128 * 72 * 0.01) throw new Error("Pole repair left the magenta mask unfilled");

  const panelSize = Math.min(Math.floor(metadata.width / 2), metadata.height);
  const top = Math.max(0, Math.floor((metadata.height - panelSize) / 2));
  const rightLeft = metadata.width - panelSize;
  const [zenith, nadir] = await Promise.all([
    sharp(sheetBuffer)
      .extract({ left: 0, top, width: panelSize, height: panelSize })
      .png()
      .toBuffer(),
    sharp(sheetBuffer)
      .extract({ left: rightLeft, top, width: panelSize, height: panelSize })
      .png()
      .toBuffer(),
  ]);

  return { zenith, nadir };
}

export async function compositePolePatch(
  imageBuffer: Buffer,
  patchBuffer: Buffer,
  pole: Pole,
  solidDegrees = POLE_REPAIR_SOLID_DEGREES,
  featherEndDegrees = POLE_REPAIR_FEATHER_END_DEGREES,
) {
  const [base, patch] = await Promise.all([
    sharp(imageBuffer).toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(patchBuffer)
      .toColourspace("srgb").removeAlpha()
      .resize({
        width: TANGENT_PATCH_SIZE,
        height: TANGENT_PATCH_SIZE,
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      })
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  const output = Buffer.from(base.data);
  const tangent = Math.tan((TANGENT_FOV_DEGREES * Math.PI) / 360);
  const half = TANGENT_PATCH_SIZE / 2;
  const isZenith = pole === "zenith";
  const colorTransform = estimatePolePatchColorTransform(base, patch, pole, tangent);

  for (let y = 0; y < base.info.height; y += 1) {
    const latitude = Math.PI / 2 - ((y + 0.5) / base.info.height) * Math.PI;
    const angleDegrees = isZenith
      ? (Math.PI / 2 - latitude) * 180 / Math.PI
      : (Math.PI / 2 + latitude) * 180 / Math.PI;
    if (angleDegrees >= featherEndDegrees) continue;

    const alpha = angleDegrees <= solidDegrees
      ? 1
      : smoothCosine((angleDegrees - solidDegrees) / (featherEndDegrees - solidDegrees));
    const cosLatitude = Math.cos(latitude);
    const forward = isZenith ? Math.sin(latitude) : -Math.sin(latitude);
    if (forward <= 0) continue;

    for (let x = 0; x < base.info.width; x += 1) {
      const longitude = ((x + 0.5) / base.info.width - 0.5) * 2 * Math.PI;
      const worldX = cosLatitude * Math.sin(longitude);
      const worldZ = cosLatitude * Math.cos(longitude);
      const normalizedX = worldX / forward;
      const normalizedY = -worldZ / forward;
      const patchX = ((normalizedX / tangent + 1) * half) - 0.5;
      const patchY = ((normalizedY / tangent + 1) * half) - 0.5;
      if (patchX < 0 || patchX >= TANGENT_PATCH_SIZE - 1 || patchY < 0 || patchY >= TANGENT_PATCH_SIZE - 1) {
        continue;
      }

      const baseIndex = (y * base.info.width + x) * base.info.channels;
      for (let channel = 0; channel < 3; channel += 1) {
        const patchValue = readBilinear(
          patch.data,
          patch.info.width,
          patch.info.height,
          patch.info.channels,
          patchX,
          patchY,
          channel,
        );
        const baseLinear = SRGB_TO_LINEAR[base.data[baseIndex + channel]];
        const patchLinear = clamp(
          srgbSampleToLinear(patchValue) * colorTransform[channel].gain
            + colorTransform[channel].offset,
          0,
          1,
        );
        output[baseIndex + channel] = linearToSrgb(
          baseLinear * (1 - alpha) + patchLinear * alpha,
        );
      }
    }
  }

  return sharp(output, { raw: base.info }).png().toBuffer();
}

export async function stabilizePoleConvergence(
  imageBuffer: Buffer,
  solidDegrees = POLE_CONVERGENCE_SOLID_DEGREES,
  featherEndDegrees = POLE_CONVERGENCE_FEATHER_END_DEGREES,
) {
  const { data, info } = await sharp(imageBuffer)
    .toColourspace("srgb").removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.from(data);
  const comparedChannels = Math.min(3, info.channels);

  for (let y = 0; y < info.height; y += 1) {
    const distanceFromPoleDegrees = (
      Math.min(y + 0.5, info.height - y - 0.5) / info.height
    ) * 180;
    if (distanceFromPoleDegrees >= featherEndDegrees) continue;

    const strength = distanceFromPoleDegrees <= solidDegrees
      ? 1
      : smoothCosine(
        (distanceFromPoleDegrees - solidDegrees) / (featherEndDegrees - solidDegrees),
      );
    const row = y * info.width * info.channels;
    const meanLinear = new Float64Array(comparedChannels);

    for (let x = 0; x < info.width; x += 1) {
      const pixel = row + x * info.channels;
      for (let channel = 0; channel < comparedChannels; channel += 1) {
        meanLinear[channel] += SRGB_TO_LINEAR[data[pixel + channel]];
      }
    }
    for (let channel = 0; channel < comparedChannels; channel += 1) {
      meanLinear[channel] /= info.width;
    }

    for (let x = 0; x < info.width; x += 1) {
      const pixel = row + x * info.channels;
      for (let channel = 0; channel < comparedChannels; channel += 1) {
        output[pixel + channel] = linearToSrgb(
          SRGB_TO_LINEAR[data[pixel + channel]] * (1 - strength)
            + meanLinear[channel] * strength,
        );
      }
    }
  }

  return sharp(output, { raw: info }).png().toBuffer();
}
