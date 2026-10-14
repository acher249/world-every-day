import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { InteractionBaker } from "./run.js";
import { interactionAnchorSchema, type InteractionAnchor } from "./schema.js";

type CdpResponse = {
  id?: number;
  error?: { message?: string };
  result?: Record<string, unknown>;
};

type CdpClient = {
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
};

function assertLocalHttpUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) throw new Error(`${label} must use a local HTTP URL`);
  return url;
}

function connect(webSocketUrl: string): Promise<CdpClient> {
  if (typeof WebSocket === "undefined") {
    throw new Error("Browser interaction baking requires Node.js WebSocket support");
  }
  return new Promise((resolveConnection, rejectConnection) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map<number, {
      reject(error: Error): void;
      resolve(value: Record<string, unknown>): void;
    }>();
    let sequence = 0;
    let opened = false;

    socket.addEventListener("open", () => {
      opened = true;
      resolveConnection({
        close: () => socket.close(),
        call(method, params = {}) {
          const id = ++sequence;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCall, rejectCall) => {
            pending.set(id, { reject: rejectCall, resolve: resolveCall });
          });
        },
      });
    });
    socket.addEventListener("error", () => {
      if (!opened) rejectConnection(new Error("Could not connect to the browser debugger"));
    });
    socket.addEventListener("close", () => {
      for (const request of pending.values()) {
        request.reject(new Error("Browser debugger disconnected"));
      }
      pending.clear();
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message ?? "Browser command failed"));
      else request.resolve(message.result ?? {});
    });
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function assertSpz(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(2);
    await handle.read(header, 0, header.length, 0);
    if (header[0] !== 0x1f || header[1] !== 0x8b) {
      throw new Error("Browser interaction baking requires an SPZ asset with a gzip header");
    }
  } finally {
    await handle.close();
  }
}

async function copyExclusiveOrVerify(source: string, destination: string): Promise<void> {
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const [sourceBytes, destinationBytes] = await Promise.all([
      readFile(source),
      readFile(destination),
    ]);
    if (!sourceBytes.equals(destinationBytes)) {
      throw new Error("Refusing to overwrite a different frontend world asset");
    }
  }
}

function evaluationValue(response: Record<string, unknown>): unknown {
  const result = response.result;
  if (!result || typeof result !== "object" || !("value" in result)) return undefined;
  return (result as { value?: unknown }).value;
}

export class BrowserInteractionBaker implements InteractionBaker {
  readonly method = "spherical-raycast" as const;
  readonly #browserUrl: URL;
  readonly #frontendDirectory: string;
  readonly #pageUrl: URL;

  constructor({
    browserUrl,
    frontendDirectory,
    pageUrl,
  }: {
    browserUrl: string;
    frontendDirectory: string;
    pageUrl: string;
  }) {
    this.#browserUrl = assertLocalHttpUrl(browserUrl, "Browser debugger URL");
    this.#pageUrl = assertLocalHttpUrl(pageUrl, "Frontend bake URL");
    this.#frontendDirectory = resolve(frontendDirectory);
  }

  async bake({
    landmarks,
    sourceSplatPath,
    sourceSplatSha256,
  }: Parameters<InteractionBaker["bake"]>[0]): Promise<InteractionAnchor[]> {
    await assertSpz(sourceSplatPath);
    const filename = `${landmarks.editionId}-${sourceSplatSha256.slice(0, 12)}.spz`;
    const generatedDirectory = resolve(this.#frontendDirectory, "public", "generated");
    await mkdir(generatedDirectory, { recursive: true });
    await copyExclusiveOrVerify(sourceSplatPath, resolve(generatedDirectory, filename));

    const publicUrl = `/generated/${filename}`;
    const targetUrl = new URL(this.#pageUrl);
    targetUrl.searchParams.set("splat", publicUrl);
    targetUrl.searchParams.set("sha256", sourceSplatSha256);

    const pagesResponse = await fetch(new URL("/json/list", this.#browserUrl), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!pagesResponse.ok) {
      throw new Error(`Browser page listing failed with HTTP ${pagesResponse.status}`);
    }
    const pages = await pagesResponse.json() as Array<{
      type?: string;
      url?: string;
      webSocketDebuggerUrl?: string;
    }>;
    const page = pages.find((candidate) => {
      if (candidate.type !== "page" || !candidate.url) return false;
      try {
        const candidateUrl = new URL(candidate.url);
        return candidateUrl.origin === targetUrl.origin &&
          candidateUrl.pathname === this.#pageUrl.pathname;
      } catch {
        return false;
      }
    });
    if (!page?.webSocketDebuggerUrl) {
      throw new Error(`Open ${this.#pageUrl.origin} in the debug browser before baking interactions`);
    }

    const client = await connect(page.webSocketDebuggerUrl);
    try {
      await client.call("Page.enable");
      await client.call("Runtime.enable");
      await client.call("Page.navigate", { url: targetUrl.toString() });

      let ready = false;
      for (let attempt = 0; attempt < 360; attempt += 1) {
        const response = await client.call("Runtime.evaluate", {
          expression:
            "typeof globalThis.__WORLD_EVERY_DAY_BAKE__ === 'function' && " +
            "typeof globalThis.__WORLD_EVERY_DAY_BAKE_INFO__ === 'object'",
          returnByValue: true,
        });
        if (evaluationValue(response) === true) {
          ready = true;
          break;
        }
        await wait(250);
      }
      if (!ready) throw new Error("Spark.js interaction baker did not become ready");

      const infoResponse = await client.call("Runtime.evaluate", {
        expression: "globalThis.__WORLD_EVERY_DAY_BAKE_INFO__",
        returnByValue: true,
      });
      const info = evaluationValue(infoResponse) as {
        sourceSplatSha256?: string;
        splatUrl?: string;
      } | undefined;
      if (
        info?.sourceSplatSha256 !== sourceSplatSha256 ||
        info.splatUrl !== publicUrl
      ) throw new Error("Spark.js baker loaded a different world asset");

      const targets = [
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
      const bakeResponse = await client.call("Runtime.evaluate", {
        expression: `globalThis.__WORLD_EVERY_DAY_BAKE__(${JSON.stringify(targets)})`,
        returnByValue: true,
      });
      const anchors = evaluationValue(bakeResponse);
      if (!Array.isArray(anchors)) throw new Error("Spark.js baker returned no anchors");
      const missing = anchors.filter((anchor) => !anchor?.worldPosition);
      if (missing.length > 0) {
        throw new Error(
          `Raycasting missed landmarks: ${missing.map((anchor) => anchor.id).join(", ")}`,
        );
      }
      return interactionAnchorSchema.array().parse(anchors);
    } finally {
      client.close();
    }
  }
}

