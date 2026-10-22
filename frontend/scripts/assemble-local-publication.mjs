#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--edition") options.edition = value;
    else if (argument === "--art-direction") options.artDirection = value;
    else if (argument === "--interactions") options.interactions = value;
    else if (argument === "--poster") options.poster = value;
    else if (argument === "--poster-width") options.posterWidth = Number(value);
    else if (argument === "--poster-height") options.posterHeight = Number(value);
    else if (argument === "--output") options.output = value;
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  for (const required of ["edition", "artDirection", "interactions", "poster", "output"]) {
    if (!options[required]) {
      const flag = required.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      throw new Error(`--${flag} is required`);
    }
  }
  if (!Number.isInteger(options.posterWidth) || !Number.isInteger(options.posterHeight)) {
    throw new Error("--poster-width and --poster-height must be integers");
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function titleCase(value) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const options = parseArguments(process.argv.slice(2));
const [edition, artDirection, interactions, posterBytes] = await Promise.all([
  readFile(resolve(options.edition), "utf8").then(JSON.parse),
  readFile(resolve(options.artDirection), "utf8").then(JSON.parse),
  readFile(resolve(options.interactions), "utf8").then(JSON.parse),
  readFile(resolve(options.poster)),
]);

if (
  artDirection.editionId !== edition.editionId ||
  interactions.editionId !== edition.editionId
) {
  throw new Error("Edition, art-direction, and interaction artifacts must share one editionId");
}

const subjects = new Map(artDirection.subjects.map((subject) => [subject.storyId, subject]));
const anchors = new Map(interactions.anchors.map((anchor) => [anchor.id, anchor]));
if (subjects.size !== artDirection.subjects.length || anchors.size !== interactions.anchors.length) {
  throw new Error("Art-direction subjects and interaction anchors require unique story ids");
}
const tones = ["cyan", "amber", "green"];
const outputPath = resolve(options.output);
const generatedDirectory = resolve("public", "generated");
const posterName = `${edition.editionId}-poster${extname(options.poster).toLowerCase()}`;
await mkdir(generatedDirectory, { recursive: true });
await copyFile(resolve(options.poster), resolve(generatedDirectory, posterName));

const stories = edition.stories.map((story, index) => {
  const subject = subjects.get(story.storyId);
  const anchor = anchors.get(story.storyId);
  if (!subject || !anchor?.worldPosition) {
    throw new Error(`Missing subject or baked hotspot for ${story.storyId}`);
  }
  return {
    id: story.storyId,
    category: titleCase(story.topic),
    title: story.title,
    summary: story.summary,
    representation: subject.subject,
    ...(subject.grounding ? { representationExplanation: subject.grounding.artisticInterpretation } : {}),
    sources: story.sources,
    interaction: {
      imageTarget: anchor.imageTarget,
      worldPosition: anchor.worldPosition,
      screenRegion: {
        x: anchor.imageTarget.x,
        y: anchor.imageTarget.y,
        tone: tones[index % tones.length],
      },
    },
  };
});

const publication = {
  schemaVersion: "1.0.0",
  artifactType: "publication-manifest",
  createdAt: new Date().toISOString(),
  edition: {
    id: edition.editionId,
    slug: edition.editionId,
    sequence: 1,
    status: "staged",
    fictional: false,
    displayDate: new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${edition.editionId.slice(0, 10)}T12:00:00.000Z`)),
    eyebrow: `${stories.length} stories · Staged edition`,
    title: "A World Every Day",
    description: `${stories.length} developments from the previous day gathered into one interactive world.`,
  },
  world: {
    interactionMapping: {
      bakedAt: interactions.createdAt,
      coordinateSystem: "world-space",
      method: "spherical-raycast",
      sourceSplatSha256: interactions.sourceSplatSha256,
    },
    poster: {
      src: `/generated/${posterName}`,
      alt: `The generated panorama for the ${edition.editionId.slice(0, 10)} daily world`,
      width: options.posterWidth,
      height: options.posterHeight,
      sha256: sha256(posterBytes),
    },
    splat: null,
  },
  stories,
};

await writeFile(outputPath, `${JSON.stringify(publication, null, 2)}\n`);
console.log(`Wrote local publication with ${stories.length} baked hotspots to ${outputPath}`);
