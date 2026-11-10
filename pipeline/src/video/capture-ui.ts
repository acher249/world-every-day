import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";
import { publicationManifestSchema } from "../publication/schema.js";
import { measurePngMeanLuma, MIN_CAPTURE_LUMA } from "./frame-quality.js";

// Preselect and finish focusing the first story before frame zero. The same
// offset applies to every batch, preserving one continuous 30 fps timeline.
const CAPTURE_START_OFFSET_FRAMES = 75;
const CAPTURE_PRIME_FRAME = 30;

/** Replay cheap UI/camera steps from a shared timeline; render one batch. */
export async function captureUiFrames({ publicationBytes, worldPath: sourceWorldPath, expectedSha256, executablePath, args = [], readStatic,
  startFrame = 0, frameCount = 300, shouldSkip, onFrame, onRejectedFrame, headless = true,
}: {
  publicationBytes: Uint8Array; worldPath: string; expectedSha256: string; executablePath: string; args?: string[];
  readStatic(key: string): Promise<Uint8Array>; startFrame?: number; frameCount?: number; headless?: boolean;
  onRejectedFrame?(frame: number, png: Buffer, meanLuma: number): Promise<void>;
  shouldSkip?(frame: number): Promise<boolean>; onFrame(frame: number, png: Buffer): Promise<void>;
}) {
  if (!Number.isInteger(startFrame) || !Number.isInteger(frameCount) || startFrame < 0 || frameCount < 1 || startFrame + frameCount > 300) throw new Error("Invalid UI capture frame range");
  const started = performance.now();
  const publication = publicationManifestSchema.parse(JSON.parse(Buffer.from(publicationBytes).toString("utf8")));
  const world = await readFile(sourceWorldPath);
  if (world.length > 512 * 1024 * 1024 || createHash("sha256").update(world).digest("hex") !== expectedSha256 || publication.world.splat?.sha256 !== expectedSha256) throw new Error("World checksum or size mismatch");
  const seed = Number.parseInt(createHash("sha256").update(publication.edition.id).digest("hex").slice(0, 8), 16);
  const manifestPath = `/generated/editions/${publication.edition.id}/publication.json`;
  const worldPath = new URL(publication.world.splat.url, "http://localhost").pathname;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      response.setHeader("Content-Security-Policy", "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; frame-src 'none'");
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === worldPath) { response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": world.length }).end(world); return; }
      if (path === manifestPath) { response.writeHead(200, { "Content-Type": "application/json" }).end(publicationBytes); return; }
      if (path === "/generated/current.json") {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          schemaVersion: "1.0.0", editionId: publication.edition.id, publicationUrl: manifestPath,
          publishedAt: publication.createdAt,
          publicationSha256: createHash("sha256").update(publicationBytes).digest("hex"),
        })); return;
      }
      if (path !== "/" && !path.startsWith("/_next/static/") && !/^\/capture\/fonts\/[A-Za-z0-9-]+\.ttf$/.test(path)) { response.writeHead(404).end(); return; }
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw new Error("Invalid path");
      const mime: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf" };
      const bytes = await readStatic(file);
      response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = (server.address() as { port: number }).port;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath, args: [...args, "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost"], headless, defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, protocolTimeout: 180_000 });
    const page = await browser.newPage();
    // CSP and DNS isolation keep capture local without intercepting Spark's worker fetches.
    page.on("pageerror", (error) => console.error(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`capture browser: ${message.text()}`);
    });
    // tsx preserves function names through this helper when serializing callbacks.
    await page.evaluateOnNewDocument("window.__name = (target) => target;");
    await page.evaluateOnNewDocument((seed) => {
      localStorage.setItem("aworldeveryday:welcome-complete", "1");
      const runtime = window as unknown as { __WORLD_OFFLINE_TOUR__: { seed: number }; __TOUR_CLOCK__: { advance(ms: number): void; freezeAnimations(): void } };
      runtime.__WORLD_OFFLINE_TOUR__ = { seed };
      const nativeNow = performance.now.bind(performance), nativeDate = Date.now, nativeRaf = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
      let active = false, time = 0, next = 1;
      const queue = new Map<number, FrameRequestCallback>();
      const animationStarts = new WeakMap<Animation, number>();
      Object.defineProperty(performance, "now", { value: () => active ? time : nativeNow() });
      Date.now = () => active ? 1_700_000_000_000 + time : nativeDate();
      window.requestAnimationFrame = (callback) => { if (!active) return nativeRaf(callback); const id = next++; queue.set(id, callback); return id; };
      window.cancelAnimationFrame = (id) => { if (active) queue.delete(id); else nativeCancel(id); };
      runtime.__TOUR_CLOCK__ = { advance(ms) {
        active = true; time = ms;
        const callbacks = [...queue.values()]; queue.clear();
        callbacks.forEach((callback) => callback(time));
      }, freezeAnimations() {
        for (const animation of document.getAnimations()) {
          if (!animationStarts.has(animation)) animationStarts.set(animation, time);
          animation.pause();
          const elapsed = time - animationStarts.get(animation)!;
          const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
          animation.currentTime = Math.min(elapsed, end);
          if (Number.isFinite(end) && elapsed >= end) animation.finish();
        }
      } };
    }, seed);
    await page.goto(`http://127.0.0.1:${port}/?edition=${publication.edition.id}`, { waitUntil: "networkidle0" });
    // Do not depend on Chromium scheduling animation frames while the viewer loads.
    try {
      await page.waitForFunction("window.__WORLD_OFFLINE_TOUR__?.render", { timeout: 180_000, polling: 100 });
    } catch (error) {
      console.error("Capture initialization state", await page.evaluate(() => ({
        text: document.body.innerText.slice(0, 1500),
        hook: Boolean((window as unknown as { __WORLD_OFFLINE_TOUR__?: unknown }).__WORLD_OFFLINE_TOUR__),
      })));
      throw error;
    }
    // Lambda has no system serif or symbol fonts. Bundle licensed local fallbacks
    // for capture only; normal visitors retain the site's system-font styling.
    await page.addStyleTag({ content: `
      @font-face { font-family: Georgia; src: url('/capture/fonts/NotoSerif.ttf'); font-weight: 100 900; }
      @font-face { font-family: 'Capture Symbols'; src: url('/capture/fonts/NotoSansSymbols.ttf'); font-weight: 100 900; unicode-range: U+2190-21FF, U+2300-23FF; }
      @font-face { font-family: 'Capture Symbols'; src: url('/capture/fonts/NotoSansSymbols2.ttf'); unicode-range: U+2700-27BF; }
      body, .story-cycle-hint kbd { font-family: 'Open Sans', Arial, Helvetica, 'Capture Symbols', sans-serif; }
    ` });
    await page.evaluate(async () => {
      await Promise.all([document.fonts.load('16px Georgia'), document.fonts.load('16px "Capture Symbols"', '←→⌄✦')]);
      await document.fonts.ready;
    });
    // Start at a fresh clock epoch after initial UI entrance animations settle.
    await new Promise((done) => setTimeout(done, 1200));
    // Each Lambda batch starts a fresh Chromium page. Prime the viewer at the
    // start of the deterministic timeline so React can remove its loading
    // overlay and Radix can compile/warm its render pipeline before frame 0 is
    // recorded. Without this, the first frame of every batch can capture the
    // loading screen while the world itself is still readying for display.
    await page.evaluate(async (offsetFrames) => {
      const runtime = window as unknown as {
        __WORLD_OFFLINE_TOUR__: { step(): void; render(): Promise<void> };
        __TOUR_CLOCK__: { advance(ms: number): void; freezeAnimations(): void };
      };
      runtime.__TOUR_CLOCK__.advance(offsetFrames * 1000 / 30);
      runtime.__WORLD_OFFLINE_TOUR__.step();
      await runtime.__WORLD_OFFLINE_TOUR__.render();
    }, CAPTURE_PRIME_FRAME);
    await page.waitForFunction(
      `(() => {
        const world = document.querySelector('.spark-world');
        const loading = document.querySelector('.spark-loading');
        return world?.dataset.viewerState === 'ready' &&
          loading?.dataset.visible === 'false' &&
          getComputedStyle(loading).visibility === 'hidden' &&
          Number(getComputedStyle(loading).opacity) < 0.01;
      })()`,
      { timeout: 30_000, polling: 50 },
    );
    // Force a real first Radix draw before resetting the deterministic tour to
    // the capture start. Fresh capture batches otherwise race the viewer's GPU initialization
    // even after React reports ready. Frames 0–10 are warm-up only; the final
    // reset keeps the recorded timeline unchanged.
    for (let timelineFrame = CAPTURE_PRIME_FRAME; timelineFrame <= CAPTURE_START_OFFSET_FRAMES; timelineFrame++) {
      await page.evaluate((timelineFrame) => {
        const runtime = window as unknown as { __TOUR_CLOCK__: { advance(ms: number): void; freezeAnimations(): void }; __WORLD_OFFLINE_TOUR__: { step(): void } };
        runtime.__TOUR_CLOCK__.advance(timelineFrame * 1000 / 30);
        if (timelineFrame === 30) window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        runtime.__WORLD_OFFLINE_TOUR__.step();
        runtime.__TOUR_CLOCK__.freezeAnimations();
      }, timelineFrame);
      await page.evaluate(() => new Promise((done) => setTimeout(done, 0)));
      await page.evaluate(() => (window as unknown as { __WORLD_OFFLINE_TOUR__: { render(): Promise<void> } }).__WORLD_OFFLINE_TOUR__.render());
    }
    await page.evaluate((offsetFrames) => {
      const runtime = window as unknown as { __TOUR_CLOCK__: { advance(ms: number): void; freezeAnimations(): void }; __WORLD_OFFLINE_TOUR__: { step(): void } };
      runtime.__TOUR_CLOCK__.advance(offsetFrames * 1000 / 30);
      runtime.__WORLD_OFFLINE_TOUR__.step();
      runtime.__TOUR_CLOCK__.freezeAnimations();
    }, CAPTURE_START_OFFSET_FRAMES);
    await page.evaluate(() => (window as unknown as { __WORLD_OFFLINE_TOUR__: { render(): Promise<void> } }).__WORLD_OFFLINE_TOUR__.render());
    for (let frame = 0; frame < startFrame + frameCount; frame++) {
      const timelineFrame = frame + CAPTURE_START_OFFSET_FRAMES;
      await page.evaluate((timelineFrame) => {
        const runtime = window as unknown as { __TOUR_CLOCK__: { advance(ms: number): void; freezeAnimations(): void } };
        runtime.__TOUR_CLOCK__.advance(timelineFrame * 1000 / 30);
        if ([105, 165, 225, 285].includes(timelineFrame)) window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      }, timelineFrame);
      // Let React commit the actual panel/selection changes before stepping the viewer.
      await page.evaluate(() => new Promise((done) => setTimeout(done, 0)));
      await page.evaluate(() => {
        const runtime = window as unknown as { __WORLD_OFFLINE_TOUR__: { step(): void }; __TOUR_CLOCK__: { freezeAnimations(): void } };
        runtime.__WORLD_OFFLINE_TOUR__.step();
        runtime.__TOUR_CLOCK__.freezeAnimations();
      });
      if (frame < startFrame) {
        continue;
      }
      if (await shouldSkip?.(frame)) continue;
      const render = () => page.evaluate(() => (window as unknown as { __WORLD_OFFLINE_TOUR__: { render(): Promise<void> } }).__WORLD_OFFLINE_TOUR__.render());
      await render();
      let png = Buffer.from(await page.screenshot({ type: "png" }));
      // A fresh Chromium process can report the viewer ready before Radix has
      // completed its first visible splat draw. Never encode that transient
      // black canvas as a real video frame. Retry the same deterministic frame
      // while the renderer warms up, then fail the batch if it stays blank.
      if (frame === startFrame) {
        let brightness = await measurePngMeanLuma(png);
        if (brightness < MIN_CAPTURE_LUMA) {
          // Retry only this frame for up to four seconds. Never advance or
          // rewind the deterministic tour clock to find a brighter image:
          // doing so duplicates future frames and creates visible jumps at
          // Lambda batch boundaries.
          for (let attempt = 1; attempt <= 8 && brightness < MIN_CAPTURE_LUMA; attempt++) {
            await new Promise((done) => setTimeout(done, 500));
            await render();
            png = Buffer.from(await page.screenshot({ type: "png" }));
            brightness = await measurePngMeanLuma(png);
          }
          if (brightness < MIN_CAPTURE_LUMA) {
            await onRejectedFrame?.(frame, png, brightness);
            throw new Error(`Radix viewer produced a near-black first frame (mean luma ${brightness.toFixed(1)}) for batch starting at frame ${startFrame}`);
          }
        }
      }
      await onFrame(frame, png);
      console.info(JSON.stringify({ frame, elapsedMs: Math.round(performance.now() - started) }));
    }
    return { frameCount, elapsedMs: performance.now() - started };
  } finally {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  }
}
