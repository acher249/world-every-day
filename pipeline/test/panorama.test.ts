import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { buildPanoramaPrompt } from "../src/panorama/prompt.js";
import { createPanoramaAssets } from "../src/panorama/process.js";

test("buildPanoramaPrompt combines the scene with spherical constraints", () => {
  const prompt = buildPanoramaPrompt("A quiet coastal research garden.");
  assert.match(prompt, /quiet coastal research garden/i);
  assert.match(prompt, /full-sphere equirectangular panorama/i);
  assert.match(prompt, /left and right boundaries/i);
  assert.match(prompt, /2:1 spherical panorama/i);
  assert.match(prompt, /zero pitch and zero\s+roll/i);
  assert.match(prompt, /horizon.*exactly 50%/i);
  assert.match(prompt, /do not place the\s+horizon on a rule-of-thirds line/i);
  assert.match(prompt, /1\.7 meters above the local walking\s+surface/i);
  assert.match(prompt, /every 90-degree quadrant/i);
  assert.match(prompt, /no 90-degree view should contain\s+more than three/i);
  assert.match(prompt, /at most one primary\s+landmark center in any 30-degree interval/i);
  assert.match(prompt, /circulation may be circular, oval,\s+meandering, branching, terraced/i);
  assert.match(prompt, /central orientation zone remains open/i);
  assert.match(prompt, /looking left, right, and behind/i);
  assert.match(prompt, /grounded cinematic realism/i);
  assert.match(prompt, /expansive,\s+inhabitable scale/i);
  assert.ok(
    prompt.indexOf("Projection and camera geometry") <
      prompt.indexOf("A quiet coastal research garden"),
  );
});

test("createPanoramaAssets crops, repairs, and enlarges an ERP", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-panorama-"));
  try {
    const sourcePath = resolve(directory, "source.png");
    const outputDirectory = resolve(directory, "output");
    const width = 160;
    const height = 90;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3;
        pixels[index] = x;
        pixels[index + 1] = y * 2;
        pixels[index + 2] = 90;
      }
    }
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(sourcePath);

    const result = await createPanoramaAssets(sourcePath, outputDirectory, {
      sourceWidth: width,
      sourceHeight: height,
      deliveryWidth: 320,
      deliveryHeight: 160,
      seamFeatherWidth: 4,
    });

    assert.equal(result.cropTop, 5);
    assert.equal(result.nativeWidth, 160);
    assert.equal(result.nativeHeight, 80);
    assert.equal(result.metrics.wrapMeanAbsoluteDifference, 0);
    assert.deepEqual(
      await sharp(result.deliveryPath).metadata().then(({ width, height }) => ({
        width,
        height,
      })),
      { width: 320, height: 160 },
    );
    assert.ok((await readFile(result.repairedPath)).length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createPanoramaAssets rejects unexpected provider dimensions", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "daily-world-panorama-"));
  try {
    const sourcePath = resolve(directory, "source.png");
    await sharp({
      create: {
        width: 100,
        height: 50,
        channels: 3,
        background: "black",
      },
    })
      .png()
      .toFile(sourcePath);

    await assert.rejects(
      createPanoramaAssets(sourcePath, resolve(directory, "output"), {
        sourceWidth: 160,
        sourceHeight: 90,
        deliveryWidth: 320,
        deliveryHeight: 160,
        seamFeatherWidth: 4,
      }),
      /Unexpected source dimensions 100x50/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
