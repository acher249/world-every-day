import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  ART_DIRECTION_GENERATION_PROMPT_VERSION,
  assignCompositionRoles,
  generateArtDirection,
  type ArtDirectionProvider,
} from "../src/art-direction/generate.js";
import { buildArtDirectionPrompt } from "../src/art-direction/google.js";
import { buildScenePrompt } from "../src/art-direction/prompt.js";
import { selectedEditionSchema } from "../src/editorial/edition.js";

function id(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function edition() {
  const visualScores = [0.2, 0.9, 0.7, 0.5, 0.4, 0.3];
  return selectedEditionSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "selected-edition",
    editionId: "edition-2026-10-13",
    createdAt: "2026-10-13T15:00:00.000Z",
    inputs: {
      candidateSetSha256: "a".repeat(64),
      evaluationSetSha256: "b".repeat(64),
      shortlistSha256: "c".repeat(64),
    },
    targetStories: 6,
    stories: visualScores.map((visualProminenceScore, index) => ({
      storyId: id(`story-${index}`),
      rank: index + 1,
      topic: index % 2 === 0 ? "science" : "climate",
      geography: "global",
      title: `Concrete development ${index + 1}`,
      summary: `A concise factual summary for development ${index + 1}.`,
      editorialScore: 0.9 - index * 0.02,
      visualProminenceScore,
      sources: [{
        title: `Source title ${index + 1}`,
        publisher: "Example Publisher",
        url: `https://news.example.test/story-${index}`,
        publishedAt: "2026-10-13T10:00:00.000Z",
        kind: "primary",
      }],
      claims: [{
        claim: `Supported claim ${index + 1}`,
      }],
      visualDetails: index === 5 ? [] : [{
        detail: `Grounded physical detail ${index + 1}`,
        kind: "object",
        confidence: 0.9,
      }],
      articleEvidenceSha256: id(`evidence-${index}`),
    })),
    excluded: [],
  });
}

function fixtureProvider({ invalidIndex = false } = {}): ArtDirectionProvider {
  return {
    provider: "fixture",
    model: "fixture-v1",
    promptVersion: ART_DIRECTION_GENERATION_PROMPT_VERSION,
    async propose(stories) {
      return {
        proposal: {
          world: {
            title: "A Garden of Practical Discoveries",
            concept: "Six developments become landmarks in one connected research garden.",
            setting: "A terraced coastal garden connected by paths and waterways.",
            timeOfDay: "Clear early morning with long soft shadows.",
            atmosphere: "Curious, constructive, calm, and quietly cinematic.",
            palette: ["glacial cyan", "deep green", "warm amber"],
            navigation: "A looping path links open foreground landmarks to a distant ridge.",
          },
          subjects: stories.map((story, index) => ({
            storyId: story.storyId,
            subject: `A sculptural physical subject for ${story.title}`,
            placement: index < 2 ? "in the open middle ground" : "along the looping path",
            scale: story.role === "anchor" ? "a large primary landmark" : "a smaller readable landmark",
            materials: ["weathered stone", "brushed metal"],
            visualCues: ["strong silhouette", "clear separation"],
            groundedDetailIndexes: story.groundedDetails.length > 0 ? [invalidIndex ? 8 : 0] : [],
            artisticInterpretation: "The connective architecture is an artistic device rather than a reported fact.",
          })),
        },
        usage: { requestCount: 1, unit: "tokens", inputUnits: 500, providerReported: true },
      };
    },
  };
}

test("art-direction generation assigns two anchors, three supporting subjects, and remaining details", async () => {
  const artifact = await generateArtDirection({
    createdAt: new Date("2026-10-13T15:05:00.000Z"),
    edition: edition(),
    provider: fixtureProvider(),
  });

  assert.equal(artifact.subjects.filter(({ role }) => role === "anchor").length, 2);
  assert.equal(artifact.subjects.filter(({ role }) => role === "supporting").length, 3);
  assert.equal(artifact.subjects.filter(({ role }) => role === "detail").length, 1);
  assert.deepEqual(artifact.subjects[0].grounding?.sourceDetails, ["Grounded physical detail 2"]);
  assert.equal(artifact.producer?.usage?.requestCount, 1);
  assert.match(buildScenePrompt(artifact), /Grounded details: Grounded physical detail 2/i);
});

test("art-direction generation rejects invented grounding references", async () => {
  await assert.rejects(
    generateArtDirection({ edition: edition(), provider: fixtureProvider({ invalidIndex: true }) }),
    /Invalid grounded detail index/,
  );
});

test("art-direction prompt distinguishes grounded details from interpretation", async () => {
  let capturedStories: Parameters<ArtDirectionProvider["propose"]>[0] = [];
  const provider = fixtureProvider();
  const capturingProvider: ArtDirectionProvider = {
    ...provider,
    async propose(stories) {
      capturedStories = stories;
      return provider.propose(stories);
    },
  };
  await generateArtDirection({ edition: edition(), provider: capturingProvider });
  const prompt = buildArtDirectionPrompt(capturedStories);

  assert.match(prompt, /never present them as reported facts/i);
  assert.match(prompt, /one continuous setting/i);
  assert.match(prompt, /full 360 degrees/i);
  assert.match(prompt, /avoid flat-frame terms/i);
  assert.match(prompt, /never place multiple story subjects/i);
});

test("art-direction generation requests flexible circulation and separate landmark bays", () => {
  const prompt = buildArtDirectionPrompt(assignCompositionRoles(edition()));
  assert.match(prompt, /loop, oval, meandering trail/i);
  assert.match(prompt, /separate landmark bays/i);
  assert.match(prompt, /do not default every world/i);
  assert.match(prompt, /low-detail ground or open space/i);
});
