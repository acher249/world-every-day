import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";
import puppeteer from "puppeteer-core";
import { cameraPose, type VideoJob } from "./job.js";

export function captureStaticKey(path: string): string | null {
  if (path === "/capture/") return "capture/index.html";
  if (/^\/_next\/static\/[a-zA-Z0-9_./-]+$/.test(path) && !path.includes("..")) return path.slice(1);
  return null;
}

/** Identical local/cloud capture, with bounded frames and one-frame backpressure. */
export async function captureFrames({ worldPath, expectedSha256, executablePath, args = [], readStatic,
  frameCount = 1, startFrame = 0, job, shouldSkip, onFrame,
}: {
  worldPath: string; expectedSha256?: string; executablePath: string; args?: string[];
  readStatic(key: string): Promise<Uint8Array>;
  frameCount?: number;
  startFrame?: number;
  job?: VideoJob;
  shouldSkip?(index: number): Promise<boolean>;
  onFrame(index: number, png: Buffer): Promise<void>;
}) {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 300) throw new Error("Capture requires 1–300 frames");
  if (!Number.isInteger(startFrame) || startFrame < 0 || startFrame + frameCount > 300) throw new Error("Invalid capture frame range");
  const started = performance.now();
  const metadata = await stat(worldPath);
  if (metadata.size < 2 || metadata.size > 512 * 1024 * 1024) throw new Error("World must be 2 bytes–512 MiB");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(worldPath)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  if (expectedSha256 && expectedSha256 !== sha256) throw new Error("World checksum mismatch");
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/generated/probe.spz") {
        response.writeHead(200, { "content-type": "application/octet-stream", "content-length": metadata.size });
        createReadStream(worldPath).on("error", () => response.destroy()).pipe(response);
        return;
      }
      const key = captureStaticKey(path);
      if (!key) { response.writeHead(404).end(); return; }
      const mime: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2" };
      const bytes = await readStatic(key);
      response.writeHead(200, { "content-type": mime[extname(key)] ?? "application/octet-stream" }).end(Buffer.from(bytes));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true,
      args: [...args, "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost"], protocolTimeout: 180_000,
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(String(error)));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await page.goto(`${origin}/capture/?splat=/generated/probe.spz&sha256=${sha256}`, { timeout: 60_000, waitUntil: "domcontentloaded" });
    await page.waitForFunction("window.__WORLD_CAPTURE__ || window.__WORLD_CAPTURE_ERROR__", { timeout: 180_000 });
    const info = await page.evaluate(() => {
      const runtime = window as unknown as { __WORLD_CAPTURE_ERROR__?: string;
        __WORLD_CAPTURE__?: { info: { sha256: string; version: string; initializationMs: number; width: number; height: number } } };
      if (runtime.__WORLD_CAPTURE_ERROR__) throw new Error(runtime.__WORLD_CAPTURE_ERROR__);
      return runtime.__WORLD_CAPTURE__!.info;
    });
    if (info.sha256 !== sha256 || info.version !== "frame-probe-v1") throw new Error("Capture build or checksum mismatch");
    const renderTimes: number[] = [];
    for (let index = startFrame; index < startFrame + frameCount; index++) {
      if (await shouldSkip?.(index)) continue;
      // Fixed 30 fps time: offline rendering speed never changes camera motion.
      const frame = await page.evaluate(async (pose) => {
        const runtime = window as unknown as { __WORLD_CAPTURE__: {
          renderFrame(value: { yaw: number; pitch: number; drift?: { x: number; y: number; z: number } }): Promise<{ png: string; renderMs: number }> } };
        return runtime.__WORLD_CAPTURE__.renderFrame(pose);
      }, job ? cameraPose(job, index) : { yaw: index / 30 * Math.PI / 18, pitch: 0 });
      renderTimes.push(frame.renderMs);
      await onFrame(index, Buffer.from(frame.png.split(",")[1], "base64"));
    }
    return { ...info, frameCount, renderTimes, elapsedMs: performance.now() - started };
  } finally {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
}
