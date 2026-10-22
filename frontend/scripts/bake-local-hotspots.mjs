#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseArguments(arguments_) {
  const options = {
    browserUrl: "http://127.0.0.1:9222",
    pageUrl: "http://localhost:3000/",
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--browser-url") options.browserUrl = value;
    else if (argument === "--page-url") options.pageUrl = value;
    else if (argument === "--detections") options.detections = value;
    else if (argument === "--splat") options.splat = value;
    else if (argument === "--output") options.output = value;
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (!options.detections || !options.splat || !options.output) {
    throw new Error("--detections, --splat, and --output are required");
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function connect(webSocketUrl) {
  if (typeof WebSocket === "undefined") {
    throw new Error("This local bake utility requires a Node.js runtime with WebSocket support");
  }
  return new Promise((resolveConnection, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let sequence = 0;

    socket.addEventListener("open", () => {
      resolveConnection({
        close: () => socket.close(),
        call(method, params = {}) {
          const id = ++sequence;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCall, rejectCall) => {
            pending.set(id, { resolve: resolveCall, reject: rejectCall });
          });
        },
      });
    });
    socket.addEventListener("error", () => {
      reject(new Error("Could not connect to the browser debugger"));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

const options = parseArguments(process.argv.slice(2));
const pagesResponse = await fetch(`${options.browserUrl}/json/list`);
if (!pagesResponse.ok) {
  throw new Error(`Browser page listing failed with ${pagesResponse.status}`);
}
const pages = await pagesResponse.json();
const page = pages.find((candidate) => candidate.type === "page" && candidate.url === options.pageUrl);
if (!page?.webSocketDebuggerUrl) {
  throw new Error(`Open ${options.pageUrl} in the debug browser before baking hotspots`);
}

const detections = JSON.parse(await readFile(resolve(options.detections), "utf8"));
if (detections.artifactType !== "landmark-detections") {
  throw new Error("--detections must reference a landmark-detections artifact");
}
const splatBytes = await readFile(resolve(options.splat));
const sourceSplatSha256 = sha256(splatBytes);
const targets = [
  ...detections.landmarks.map((landmark) => ({
    id: landmark.storyId,
    boundingBox: landmark.boundingBox,
    x: landmark.target.x,
    y: landmark.target.y,
  })),
  ...(detections.contextMarkers ?? []).map((marker) => ({
    id: marker.id,
    boundingBox: marker.boundingBox,
    x: marker.target.x,
    y: marker.target.y,
  })),
];
if (new Set(targets.map(({ id }) => id)).size !== targets.length) {
  throw new Error("Landmark detections contain duplicate story ids");
}

const client = await connect(page.webSocketDebuggerUrl);
try {
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.reload", { ignoreCache: true });

  let ready = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const result = await client.call("Runtime.evaluate", {
      expression: "typeof globalThis.__WORLD_EVERY_DAY_BAKE__ === 'function'",
      returnByValue: true,
    });
    if (result.result?.value === true) {
      ready = true;
      break;
    }
    await wait(250);
  }
  if (!ready) throw new Error("The Spark.js hotspot baker did not become ready");

  const infoResult = await client.call("Runtime.evaluate", {
    expression: "globalThis.__WORLD_EVERY_DAY_BAKE_INFO__",
    returnByValue: true,
  });
  const bakeInfo = infoResult.result?.value;
  if (bakeInfo?.algorithmVersion !== "surface-grid-v1") {
    throw new Error("The Spark.js baker is outdated; rebuild the explorer before baking hotspots");
  }
  if (bakeInfo?.sourceSplatSha256 !== sourceSplatSha256) {
    throw new Error("The Spark.js hotspot baker loaded a different world asset");
  }

  const result = await client.call("Runtime.evaluate", {
    expression: `globalThis.__WORLD_EVERY_DAY_BAKE__(${JSON.stringify(targets)})`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("The browser hotspot bake failed");
  const anchors = result.result?.value;
  if (!Array.isArray(anchors) || anchors.some((anchor) => !anchor.worldPosition)) {
    const missing = Array.isArray(anchors)
      ? anchors.filter((anchor) => !anchor.worldPosition).map((anchor) => anchor.id)
      : ["unknown"];
    throw new Error(`Raycasting missed landmarks: ${missing.join(", ")}`);
  }

  const artifact = {
    schemaVersion: "1.0.0",
    artifactType: "interaction-manifest",
    editionId: detections.editionId,
    createdAt: new Date().toISOString(),
    method: "spherical-raycast",
    algorithmVersion: "surface-grid-v1",
    sourceImageSha256: detections.sourceImage.sha256,
    sourceSplatSha256,
    anchors,
  };
  await writeFile(resolve(options.output), `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote ${anchors.length} baked interaction anchors to ${resolve(options.output)}`);
} finally {
  client.close();
}
