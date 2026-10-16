import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { createArtDirectionHandler } from "../src/cloud/art-direction-handler.js";
import type { ArtDirectionProvider } from "../src/art-direction/generate.js";
import { selectedEditionSchema } from "../src/editorial/edition.js";
import { artifactSha256 } from "../src/editorial/select.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";

test("cloud art direction is checksum-bound, immutable, and free on resume", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "world-every-day-cloud-art-"));
  try {
    const artifacts = new LocalArtifactStore(directory);
    const edition = selectedEditionSchema.parse(JSON.parse(await readFile(
      new URL("../fixtures/selected-edition.example.v1.json", import.meta.url), "utf8",
    )));
    const selectedKey = `editions/${edition.editionId}/editorial/selected-edition.json`;
    await artifacts.putImmutable({
      key: selectedKey,
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(edition)),
    });
    let providerCalls = 0;
    const provider: ArtDirectionProvider = {
      provider: "fixture",
      model: "fixture-v1",
      promptVersion: "art-direction-generation-v3",
      async propose(stories) {
        providerCalls += 1;
        return {
          proposal: {
            world: {
              title: "Fields of Discovery",
              concept: "One grounded landscape for a fictional story.",
              setting: "A field and a small red barn.",
              timeOfDay: "Morning",
              atmosphere: "Calm and curious.",
              palette: ["red", "green", "blue"],
              navigation: "A path circles the field.",
            },
            subjects: stories.map(({ storyId }) => ({
              storyId,
              subject: "Soil-moisture sensors in a field",
              placement: "Along the path",
              scale: "Readable landmark",
              materials: ["metal"],
              visualCues: ["blue sensor"],
              groundedDetailIndexes: [],
              artisticInterpretation: "The path links the scene.",
            })),
          },
        };
      },
    };
    const run = createArtDirectionHandler({
      artifacts,
      provider,
      now: () => new Date("2026-10-13T14:37:00.000Z"),
    });
    const first = await run({ editionId: edition.editionId });
    const resumed = await run({ editionId: edition.editionId });
    assert.equal(first.status, "created");
    assert.equal(resumed.status, "reused");
    assert.equal(providerCalls, 1);
    const bytes = await artifacts.read(first.key);
    assert.ok(bytes);
    const direction = JSON.parse(Buffer.from(bytes).toString("utf8"));
    assert.equal(direction.inputs.selectedEditionSha256, artifactSha256(edition));
    assert.equal(direction.subjects[0].storyId, edition.stories[0].storyId);
    await assert.rejects(run({ editionId: "different-edition" }), /Selected edition is required/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
