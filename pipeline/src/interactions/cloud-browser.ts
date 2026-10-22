import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import chromium from "@sparticuz/chromium";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import puppeteer from "puppeteer-core";
import type { InteractionBaker } from "./run.js";
import { interactionAnchorSchema } from "./schema.js";

const MAX_SPLAT_BYTES = 512 * 1024 * 1024;

function browserTargets(landmarks: Parameters<InteractionBaker["bake"]>[0]["landmarks"]) {
  return [
    ...landmarks.landmarks.map((landmark) => ({
      boundingBox: landmark.boundingBox,
      id: landmark.storyId,
      x: landmark.target.x,
      y: landmark.target.y,
    })),
    ...landmarks.contextMarkers.map((marker) => ({
      boundingBox: marker.boundingBox,
      id: marker.id,
      x: marker.target.x,
      y: marker.target.y,
    })),
  ];
}

function siteKey(pathname: string): string | null {
  if (pathname === "/bake" || pathname === "/bake/") return "bake/index.html";
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/images/")) {
    const key = pathname.slice(1);
    return key.includes("..") ? null : key;
  }
  return null;
}

export class CloudBrowserInteractionBaker implements InteractionBaker {
  readonly method = "spherical-raycast" as const;
  readonly algorithmVersion = "surface-grid-v1";
  readonly #client: S3Client;
  readonly #siteBucket: string;

  constructor({ client = new S3Client({}), siteBucket }: { client?: S3Client; siteBucket: string }) {
    if (!siteBucket.trim()) throw new Error("EXPLORER_SITE_BUCKET is required");
    this.#client = client;
    this.#siteBucket = siteBucket;
  }

  async bake({ landmarks, sourceSplatPath, sourceSplatSha256 }: Parameters<InteractionBaker["bake"]>[0]) {
    const metadata = await stat(sourceSplatPath);
    if (metadata.size < 2 || metadata.size > MAX_SPLAT_BYTES) {
      throw new Error("Cloud browser baker requires an SPZ asset between 2 bytes and 512 MiB");
    }
    const handle = await open(sourceSplatPath, "r");
    const header = Buffer.alloc(2);
    try {
      await handle.read(header, 0, 2, 0);
    } finally {
      await handle.close();
    }
    if (header[0] !== 0x1f || header[1] !== 0x8b) throw new Error("World asset is not an SPZ gzip file");
    const filename = `${landmarks.editionId}-${sourceSplatSha256.slice(0, 12)}.spz`;
    const splatPath = `/generated/${filename}`;
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== "GET" || !request.url) {
          response.writeHead(405).end();
          return;
        }
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        if (pathname === splatPath) {
          console.info("Bake asset requested", metadata.size);
          response.writeHead(200, {
            "content-length": metadata.size,
            "content-type": "application/octet-stream",
            "cache-control": "no-store",
          });
          createReadStream(sourceSplatPath)
            .on("end", () => console.info("Bake asset delivered"))
            .pipe(response);
          return;
        }
        const key = siteKey(pathname);
        if (!key) {
          response.writeHead(404).end();
          return;
        }
        const object = await this.#client.send(new GetObjectCommand({ Bucket: this.#siteBucket, Key: key }));
        if (!object.Body) throw new Error(`Explorer site file is empty: ${key}`);
        const bytes = await object.Body.transformToByteArray();
        response.writeHead(200, {
          "content-length": bytes.length,
          "content-type": object.ContentType ?? (key.endsWith(".html") ? "text/html" : "application/octet-stream"),
          "cache-control": "no-store",
        }).end(Buffer.from(bytes));
      } catch {
        response.writeHead(502).end();
      }
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
      browser = await puppeteer.launch({
        args: [...chromium.args, "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost"],
        executablePath: await chromium.executablePath(),
        headless: true,
        protocolTimeout: 600_000,
        defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      });
      const page = await browser.newPage();
      page.on("workercreated", (worker) => {
        console.info("Bake worker created:", worker.url().slice(0, 120));
        worker.on("console", (message) => console.info("Bake worker console:", message.text().slice(0, 300)));
        worker.on("error", (error) => console.error("Bake worker error:", error.message.slice(0, 300)));
      });
      page.on("workerdestroyed", (worker) => console.info("Bake worker destroyed:", worker.url().slice(0, 120)));
      page.on("console", (message) => {
        const value = message.text();
        if (value.startsWith("bake:")) console.info(value.slice(0, 160));
        else if (message.type() === "error") console.warn("Bake browser console error:", value.slice(0, 300));
      });
      page.on("pageerror", (error) => console.error(
        "Bake page error:",
        (error instanceof Error ? error.message : String(error)).slice(0, 300),
      ));
      page.on("requestfailed", (request) => {
        if (request.url().startsWith(`${origin}/`)) {
          console.warn("Bake request failed:", new URL(request.url()).pathname, request.failure()?.errorText);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 400 && response.url().startsWith(`${origin}/`)) {
          console.warn("Bake response failed:", response.status(), new URL(response.url()).pathname);
        }
      });
      // Puppeteer interception can suspend fetches made by Spark.js workers
      // without surfacing them as page requests. The isolated bake page only
      // serves our static build and the private splat through this loopback server.
      const target = new URL("/bake/", origin);
      target.searchParams.set("splat", splatPath);
      target.searchParams.set("sha256", sourceSplatSha256);
      await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
      try {
        await page.waitForFunction(
          () => {
            const runtime = globalThis as typeof globalThis & {
              __WORLD_EVERY_DAY_BAKE__?: unknown;
              __WORLD_EVERY_DAY_BAKE_ERROR__?: string;
            };
            return typeof runtime.__WORLD_EVERY_DAY_BAKE__ === "function" || Boolean(runtime.__WORLD_EVERY_DAY_BAKE_ERROR__);
          },
          { timeout: 60_000 },
        );
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new Error("Spark.js interaction baker did not initialize within 60 seconds; inspect worker and asset-loading logs", { cause: error });
        }
        throw error;
      }
      const result = await page.evaluate(({ targets, expectedSha256, expectedSplatPath, expectedAlgorithm }) => {
        const runtime = globalThis as typeof globalThis & {
          __WORLD_EVERY_DAY_BAKE_ERROR__?: string;
          __WORLD_EVERY_DAY_BAKE_INFO__?: { algorithmVersion?: string; sourceSplatSha256?: string; splatUrl?: string };
          __WORLD_EVERY_DAY_BAKE__?: (values: typeof targets) => unknown;
        };
        if (runtime.__WORLD_EVERY_DAY_BAKE_ERROR__) {
          throw new Error(`Spark.js baker failed to initialize: ${runtime.__WORLD_EVERY_DAY_BAKE_ERROR__}`);
        }
        if (runtime.__WORLD_EVERY_DAY_BAKE_INFO__?.algorithmVersion !== expectedAlgorithm) {
          throw new Error("Spark.js baker is outdated; deploy the rebuilt explorer before baking interactions");
        }
        if (runtime.__WORLD_EVERY_DAY_BAKE_INFO__?.sourceSplatSha256 !== expectedSha256 ||
            runtime.__WORLD_EVERY_DAY_BAKE_INFO__?.splatUrl !== expectedSplatPath ||
            !runtime.__WORLD_EVERY_DAY_BAKE__) {
          throw new Error("Spark.js baker loaded a different world asset");
        }
        return runtime.__WORLD_EVERY_DAY_BAKE__(targets);
      }, {
        targets: browserTargets(landmarks),
        expectedSha256: sourceSplatSha256,
        expectedSplatPath: splatPath,
        expectedAlgorithm: this.algorithmVersion,
      });
      if (!Array.isArray(result)) throw new Error("Spark.js baker returned no anchors");
      const missing = result.filter((anchor) => !anchor?.worldPosition);
      if (missing.length) throw new Error(`Raycasting missed landmarks: ${missing.map((anchor) => anchor.id).join(", ")}`);
      return interactionAnchorSchema.array().parse(result);
    } finally {
      await browser?.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }
}
