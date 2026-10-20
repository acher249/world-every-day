import { z } from "zod";
import { generateArtDirection, type ArtDirectionProvider } from "../art-direction/generate.js";
import { artDirectionSchema } from "../art-direction/schema.js";
import { selectedEditionSchema } from "../editorial/edition.js";
import { artifactSha256 } from "../editorial/select.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { artDirectionProvider, cloudTextEnvironment } from "./text-provider.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createArtDirectionHandler({
  artifacts,
  provider,
  now = () => new Date(),
}: {
  artifacts: ArtifactStore;
  provider: ArtDirectionProvider;
  now?: () => Date;
}) {
  return async (rawInput: unknown) => {
    const { editionId } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const selectedBytes = await artifacts.read(`${root}/editorial/selected-edition.json`);
    if (!selectedBytes) throw new Error("Selected edition is required before art direction");
    const edition = selectedEditionSchema.parse(JSON.parse(Buffer.from(selectedBytes).toString("utf8")));
    if (edition.editionId !== editionId || edition.stories.length === 0) {
      throw new Error("Selected edition does not match this run or has no stories");
    }
    const key = `${root}/art-direction/art-direction.json`;
    const existing = await artifacts.read(key);
    if (existing) {
      const direction = artDirectionSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      if (direction.editionId !== editionId ||
          direction.inputs?.selectedEditionSha256 !== artifactSha256(edition) ||
          direction.producer?.provider !== provider.provider ||
          direction.producer.model !== provider.model ||
          direction.producer.promptVersion !== provider.promptVersion) {
        throw new Error("Existing art direction does not match this edition or provider; start a new edition");
      }
      return { editionId, key, status: "reused", subjectCount: direction.subjects.length };
    }
    const direction = await generateArtDirection({ createdAt: now(), edition, provider });
    await artifacts.putImmutable({
      key,
      contentType: "application/json",
      bytes: Buffer.from(`${JSON.stringify(direction, null, 2)}\n`),
      metadata: { editionId },
    });
    return { editionId, key, status: "created", subjectCount: direction.subjects.length };
  };
}

export async function main(event: unknown) {
  const provider = artDirectionProvider(await cloudTextEnvironment());
  return createArtDirectionHandler({
    artifacts: new S3ArtifactStore({ bucket: requiredEnvironment("ARTIFACT_BUCKET") }),
    provider,
  })(event);
}
