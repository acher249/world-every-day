import { inflateSync } from "node:zlib";

// Mean screenshot luma must only reject a near-black viewer shell. Valid worlds
// can be intentionally dark, so a higher threshold incorrectly classified them
// as missing renders and encouraged the capture worker to skip ahead.
export const MIN_CAPTURE_LUMA = 12;

/** Reject capture frames that contain only the dark viewer shell and no world. */
export async function hasVisibleWorld(png: Buffer): Promise<boolean> {
  return (await measurePngMeanLuma(png)) >= MIN_CAPTURE_LUMA;
}

export function measurePngMeanLuma(png: Buffer): number {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(signature)) throw new Error("First-frame quality check expected a PNG screenshot");
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const imageData: Buffer[] = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8, dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("Truncated PNG screenshot in first-frame quality check");
    if (type === "IHDR") {
      width = png.readUInt32BE(dataStart); height = png.readUInt32BE(dataStart + 4);
      bitDepth = png[dataStart + 8]!; colorType = png[dataStart + 9]!; interlace = png[dataStart + 12]!;
    } else if (type === "IDAT") imageData.push(png.subarray(dataStart, dataEnd));
    else if (type === "IEND") break;
    offset = dataEnd + 4;
  }
  const bytesPerPixel = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!width || !height || bitDepth !== 8 || !bytesPerPixel || interlace !== 0 || imageData.length === 0) {
    throw new Error("Unsupported PNG format in first-frame quality check");
  }
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(imageData));
  if (filtered.length !== (stride + 1) * height) throw new Error("Invalid PNG pixel data in first-frame quality check");
  let previous = Buffer.alloc(stride), weightedLuma = 0, samples = 0;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1), filter = filtered[rowOffset]!;
    const row = Buffer.from(filtered.subarray(rowOffset + 1, rowOffset + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const left = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0;
      const up = previous[i]!;
      const upperLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG row filter ${filter}`);
      row[i] = (row[i]! + predictor) & 0xff;
    }
    // Measure every pixel so UI controls cannot bias a sparse sample of the scene.
    for (let x = 0; x < width; x++) {
      const i = x * bytesPerPixel;
      weightedLuma += row[i]! * 0.2126 + row[i + 1]! * 0.7152 + row[i + 2]! * 0.0722;
      samples++;
    }
    previous = row;
  }
  return weightedLuma / samples;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left), upDistance = Math.abs(estimate - up), cornerDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= cornerDistance ? left : upDistance <= cornerDistance ? up : upperLeft;
}
