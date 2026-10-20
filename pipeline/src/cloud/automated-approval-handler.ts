import { z } from "zod";
import { artDirectionSchema } from "../art-direction/schema.js";
import { selectedEditionSchema } from "../editorial/edition.js";
import { artifactSha256 } from "../editorial/select.js";
import { editionPanoramaManifestSchema } from "../panorama/schema.js";
import { publicationManifestSchema } from "../publication/schema.js";
import { publicationReviewSchema } from "../publication/review.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { editionReviewSchema } from "../workflow/review.js";
import { imageReviewSchema } from "../world/image-review.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  stage: z.enum(["edition", "image", "publication"]),
});

export function createAutomatedApprovalHandler({
  artifacts,
  now = () => new Date(),
}: {
  artifacts: ArtifactStore;
  now?: () => Date;
}) {
  return async (rawInput: unknown) => {
    const { editionId, stage } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const read = async (key: string): Promise<unknown> => {
      const bytes = await artifacts.read(key);
      if (!bytes) throw new Error(`Required artifact is missing: ${key}`);
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    };
    const approvedAt = now().toISOString();
    let key: string;
    let approval: unknown;
    if (stage === "edition") {
      const edition = selectedEditionSchema.parse(await read(`${root}/editorial/selected-edition.json`));
      const direction = artDirectionSchema.parse(await read(`${root}/art-direction/art-direction.json`));
      if (edition.editionId !== editionId || direction.editionId !== editionId ||
          direction.inputs?.selectedEditionSha256 !== artifactSha256(edition)) {
        throw new Error("Art direction does not match the selected edition");
      }
      key = `${root}/review/approval.json`;
      approval = editionReviewSchema.parse({
        schemaVersion: "1.0.0", artifactType: "edition-review", editionId,
        approvedAt, approvedBy: "automated-unattended-run",
        inputs: {
          selectedEditionSha256: artifactSha256(edition),
          artDirectionSha256: artifactSha256(direction),
        },
        decision: "approved-for-generation",
      });
    } else if (stage === "image") {
      const direction = artDirectionSchema.parse(await read(`${root}/art-direction/art-direction.json`));
      const panorama = editionPanoramaManifestSchema.parse(await read(`${root}/panorama/manifest.json`));
      if (direction.editionId !== editionId || panorama.editionId !== editionId ||
          panorama.inputs.artDirectionSha256 !== artifactSha256(direction)) {
        throw new Error("Panorama does not match art direction");
      }
      key = `${root}/review/image-approval.json`;
      approval = imageReviewSchema.parse({
        schemaVersion: "1.0.0", artifactType: "image-review", editionId,
        approvedAt, approvedBy: "automated-unattended-run",
        decision: "approved-for-world-generation",
        inputs: {
          artDirectionSha256: artifactSha256(direction),
          panoramaSha256: panorama.outputs.delivery8kSha256,
        },
      });
    } else {
      const publication = publicationManifestSchema.parse(await read(`${root}/publication/publication-manifest.json`));
      if (publication.edition.id !== editionId || publication.edition.status !== "staged") {
        throw new Error("Publication manifest does not match staged edition");
      }
      key = `${root}/review/publication-approval.json`;
      approval = publicationReviewSchema.parse({
        schemaVersion: "1.0.0", artifactType: "publication-review", editionId,
        approvedAt, approvedBy: "automated-unattended-run",
        decision: "approved-for-publication",
        inputs: { publicationSha256: artifactSha256(publication) },
      });
    }
    const existing = await artifacts.read(key);
    if (existing) {
      const previous = JSON.parse(Buffer.from(existing).toString("utf8")) as { inputs?: unknown };
      if (JSON.stringify(previous.inputs) !== JSON.stringify((approval as { inputs: unknown }).inputs)) {
        throw new Error(`Existing automated approval has different inputs: ${key}`);
      }
      return { editionId, stage, key, status: "reused" as const };
    }
    await artifacts.putImmutable({
      key,
      bytes: Buffer.from(`${JSON.stringify(approval, null, 2)}\n`),
      contentType: "application/json",
    });
    return { editionId, stage, key, status: "created" as const };
  };
}

export async function main(event: unknown) {
  const bucket = process.env.ARTIFACT_BUCKET?.trim();
  if (!bucket) throw new Error("Missing required environment variable: ARTIFACT_BUCKET");
  return createAutomatedApprovalHandler({ artifacts: new S3ArtifactStore({ bucket }) })(event);
}
