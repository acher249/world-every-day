import sharp from "sharp";
import { MockInteractionBaker } from "../interactions/run.js";
import type { LandmarkDetector } from "../landmarks/provider.js";
import type { PanoramaGenerator } from "../panorama/generator.js";
import { MockWorldGenerator } from "../world/mock.js";
import { createFixtureWorkflowProviders } from "./fixtures.js";
import type { EditionProviders } from "./edition-run.js";

export class FixturePanoramaGenerator implements PanoramaGenerator {
  async generate(): Promise<Awaited<ReturnType<PanoramaGenerator["generate"]>>> {
    const startedAt = Date.now();
    const bytes = await sharp({
      create: {
        width: 512,
        height: 288,
        channels: 3,
        background: { r: 74, g: 119, b: 104 },
      },
    }).png().toBuffer();
    return {
      bytes,
      mimeType: "image/png",
      elapsedMs: Date.now() - startedAt,
      usage: null,
    };
  }
}

class FixtureLandmarkDetector implements LandmarkDetector {
  readonly id = "fixture";
  readonly model = "fixture-vision-v1";

  async detect({ artDirection }: Parameters<LandmarkDetector["detect"]>[0]) {
    const count = artDirection.subjects.length;
    return {
      landmarks: artDirection.subjects.map((subject, index) => {
        const x = (index + 1) / (count + 1);
        const y = 0.55;
        return {
          storyId: subject.storyId,
          label: subject.subject,
          boundingBox: { xMin: x - 0.04, yMin: y - 0.08, xMax: x + 0.04, yMax: y + 0.08 },
          target: { x, y },
          confidence: 1,
          visibility: "clear" as const,
        };
      }),
      contextMarkers: artDirection.subjects.slice(0, 1).map((subject) => ({
        storyId: subject.storyId,
        label: "Terraced ground",
        explanation: "The terrain carries a secondary detail from this story into the world.",
        boundingBox: { xMin: 0.46, yMin: 0.74, xMax: 0.54, yMax: 0.82 },
        target: { x: 0.5, y: 0.78 },
        confidence: 1,
      })),
    };
  }
}

export async function createFixtureEditionProviders(): Promise<EditionProviders> {
  return {
    ...await createFixtureWorkflowProviders(),
    interactionBaker: new MockInteractionBaker(),
    landmarkDetector: new FixtureLandmarkDetector(),
    panorama: {
      generator: new FixturePanoramaGenerator(),
      model: "fixture-image-v1",
      provider: "fixture",
      processingConfig: {
        sourceWidth: 512,
        sourceHeight: 288,
        deliveryWidth: 1024,
        deliveryHeight: 512,
        seamFeatherWidth: 16,
      },
    },
    world: {
      generator: new MockWorldGenerator({ pollsBeforeCompletion: 1 }),
      maxPolls: 20,
      pollIntervalMs: 0,
    },
  };
}

