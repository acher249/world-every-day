#!/usr/bin/env node

import { copyFile, mkdir, open, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

function parseArguments(arguments_) {
  const options = { name: "world.spz" };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--source") options.source = value;
    else if (argument === "--name") options.name = value;
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (!options.source) throw new Error("--source is required");
  if (basename(options.name) !== options.name || extname(options.name) !== ".spz") {
    throw new Error("--name must be a plain filename ending in .spz");
  }
  return options;
}

async function assertSpz(path) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(2);
    await handle.read(header, 0, header.length, 0);
    if (header[0] !== 0x1f || header[1] !== 0x8b) {
      throw new Error("Source does not have the gzip header expected for SPZ");
    }
  } finally {
    await handle.close();
  }
}

const options = parseArguments(process.argv.slice(2));
const source = resolve(options.source);
const sourceStats = await stat(source);
if (!sourceStats.isFile() || sourceStats.size === 0) {
  throw new Error("Source SPZ must be a non-empty file");
}
await assertSpz(source);

const generatedDirectory = resolve("public", "generated");
const destination = resolve(generatedDirectory, options.name);
await mkdir(generatedDirectory, { recursive: true });
await copyFile(source, destination);

console.log(
  JSON.stringify(
    {
      copied: true,
      byteLength: sourceStats.size,
      publicUrl: `/generated/${options.name}`,
    },
    null,
    2,
  ),
);
