import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { artDirectionSchema } from "../art-direction/schema.js";
import { selectedEditionSchema } from "../editorial/edition.js";
import { artifactSha256 } from "../editorial/select.js";
import { interactionManifestSchema } from "../interactions/schema.js";
import { landmarkArtifactSchema } from "../landmarks/schema.js";
import { sha256 } from "../panorama/hash.js";
import { editionPanoramaManifestSchema } from "../panorama/schema.js";
import { createPublicationManifest } from "../publication/create.js";
import { currentEditionPointerSchema, publicationReviewSchema, unpublishedCurrentSchema } from "../publication/review.js";
import { publicationManifestSchema } from "../publication/schema.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { generatedWorldManifestSchema } from "../world/schema.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  mode: z.enum(["stage", "publish", "preview"]),
  confirmPublish: z.literal(true).optional(),
  confirmPublishPreview: z.literal(true).optional(),
});

export type CurrentPointerStore = {
  advance(pointer: z.infer<typeof currentEditionPointerSchema>): Promise<void>;
};

export function nextCurrentPointer(
  previous: z.infer<typeof currentEditionPointerSchema> | null,
  next: z.infer<typeof currentEditionPointerSchema>,
): z.infer<typeof currentEditionPointerSchema> {
  if (!previous) return currentEditionPointerSchema.parse(next);
  if (previous.editionId === next.editionId) {
    if (previous.publicationSha256 !== next.publicationSha256) {
      throw new Error("Current edition already points to different publication bytes");
    }
    return previous;
  }
  const previousDate = previous.editionId.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const nextDate = next.editionId.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (previousDate && nextDate && nextDate < previousDate) {
    throw new Error("Refusing to move the current edition backward in time");
  }
  const { pastWorlds: olderWorlds = [], ...previousWorld } = previous;
  return currentEditionPointerSchema.parse({
    ...next,
    pastWorlds: [previousWorld, ...olderWorlds],
  });
}

async function readJson(artifacts: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await artifacts.read(key);
  if (!bytes) throw new Error(`Required publication artifact is missing: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

function requireBytes(bytes: Uint8Array | null, digest: string, label: string): Buffer {
  if (!bytes || sha256(Buffer.from(bytes)) !== digest) throw new Error(`${label} is missing or has changed`);
  return Buffer.from(bytes);
}

export function createCloudPublicationHandler({
  artifacts,
  publicAssets,
  current,
  now = () => new Date(),
}: {
  artifacts: ArtifactStore;
  publicAssets: ArtifactStore;
  current: CurrentPointerStore;
  now?: () => Date;
}) {
  return async (rawInput: unknown) => {
    const { editionId, mode, confirmPublish, confirmPublishPreview } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const stagedKey = `${root}/publication/publication-manifest.json`;
    const publicRoot = `generated/editions/${editionId}`;
    if (mode === "stage") {
      const existing = await artifacts.read(stagedKey);
      if (existing) {
        const manifest = publicationManifestSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
        if (manifest.edition.id !== editionId || manifest.edition.status !== "staged") {
          throw new Error("Existing staged publication belongs to another edition or status");
        }
        return { editionId, key: stagedKey, status: "reused" as const };
      }
      const edition = selectedEditionSchema.parse(await readJson(artifacts, `${root}/editorial/selected-edition.json`));
      const direction = artDirectionSchema.parse(await readJson(artifacts, `${root}/art-direction/art-direction.json`));
      const panorama = editionPanoramaManifestSchema.parse(await readJson(artifacts, `${root}/panorama/manifest.json`));
      const landmarks = landmarkArtifactSchema.parse(await readJson(artifacts, `${root}/landmarks/landmark-detections.json`));
      const interactions = interactionManifestSchema.parse(await readJson(artifacts, `${root}/interactions/interaction-manifest.json`));
      const world = generatedWorldManifestSchema.parse(await readJson(artifacts, `${root}/world/generated-world.json`));
      if (edition.editionId !== editionId || direction.editionId !== editionId ||
          panorama.editionId !== editionId || landmarks.editionId !== editionId ||
          interactions.editionId !== editionId || world.editionId !== editionId ||
          direction.inputs?.selectedEditionSha256 !== artifactSha256(edition) ||
          panorama.inputs.artDirectionSha256 !== artifactSha256(direction) ||
          landmarks.sourceImage.sha256 !== panorama.outputs.delivery8kSha256 ||
          world.input.sourceImageSha256 !== panorama.outputs.delivery8kSha256 ||
          interactions.sourceImageSha256 !== panorama.outputs.delivery8kSha256 ||
          interactions.sourceSplatSha256 !== world.asset.sha256 || world.asset.format !== "spz") {
        throw new Error("Publication inputs are stale or belong to different editions");
      }
      const manifest = createPublicationManifest({
        artDirection: direction,
        createdAt: now(),
        edition,
        fictional: false,
        interactions,
        landmarks,
        poster: {
          src: `/${publicRoot}/poster.png`,
          width: panorama.transforms.deliveryResize.width,
          height: panorama.transforms.deliveryResize.height,
          sha256: panorama.outputs.delivery8kSha256,
        },
        splat: {
          url: `/${publicRoot}/world.spz`,
          format: "spz",
          sha256: world.asset.sha256,
        },
      });
      await artifacts.putImmutable({
        key: stagedKey,
        bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
        contentType: "application/json",
      });
      return { editionId, key: stagedKey, status: "created" as const };
    }

    if (mode === "publish" && confirmPublish !== true) {
      throw new Error("Public publication requires confirmPublish: true");
    }
    if (mode === "preview" && (confirmPublishPreview !== true || !editionId.endsWith("-test"))) {
      throw new Error("Public test preview requires confirmPublishPreview: true and a -test edition ID");
    }
    const staged = publicationManifestSchema.parse(await readJson(artifacts, stagedKey));
    const review = publicationReviewSchema.parse(await readJson(artifacts, `${root}/review/publication-approval.json`));
    if (staged.edition.id !== editionId || staged.edition.status !== "staged" ||
        review.editionId !== editionId || review.inputs.publicationSha256 !== artifactSha256(staged)) {
      throw new Error("Publication approval does not match the staged edition");
    }
    if (mode === "publish" && review.decision !== "approved-for-publication") {
      throw new Error("Current-edition publication requires an explicit publication approval");
    }
    const panorama = editionPanoramaManifestSchema.parse(await readJson(artifacts, `${root}/panorama/manifest.json`));
    const world = generatedWorldManifestSchema.parse(await readJson(artifacts, `${root}/world/generated-world.json`));
    if (panorama.outputs.delivery8kSha256 !== staged.world.poster.sha256 ||
        world.asset.sha256 !== staged.world.splat?.sha256 || world.asset.format !== "spz") {
      throw new Error("Staged publication assets no longer match their source manifests");
    }
    const poster = requireBytes(
      await artifacts.read(`${root}/panorama/${panorama.files.delivery8k}`),
      staged.world.poster.sha256,
      "Approved poster",
    );
    const splat = requireBytes(await artifacts.read(world.asset.storageKey), world.asset.sha256, "Approved world");
    await publicAssets.putImmutable({ key: `${publicRoot}/poster.png`, bytes: poster, contentType: "image/png" });
    await publicAssets.putImmutable({ key: `${publicRoot}/world.spz`, bytes: splat, contentType: "application/octet-stream" });
    const published = publicationManifestSchema.parse({
      ...staged,
      edition: {
        ...staged.edition,
        status: "published",
        eyebrow: mode === "preview"
          ? `${staged.stories.length} ${staged.stories.length === 1 ? "story" : "stories"} · Technical test`
          : `${staged.stories.length} ${staged.stories.length === 1 ? "story" : "stories"} · Published edition`,
      },
    });
    const publicationBytes = Buffer.from(`${JSON.stringify(published, null, 2)}\n`);
    // A test preview already owns publication.json immutably. Keep its direct
    // link intact when the same reviewed edition is promoted to today's world.
    const publicationKey = mode === "publish" && editionId.endsWith("-test")
      ? `${publicRoot}/publication-public.json`
      : `${publicRoot}/publication.json`;
    await publicAssets.putImmutable({
      key: publicationKey,
      bytes: publicationBytes,
      contentType: "application/json",
    });
    if (mode === "publish") {
      await current.advance(currentEditionPointerSchema.parse({
        schemaVersion: "1.0.0",
        editionId,
        publicationUrl: `/${publicationKey}`,
        publicationSha256: sha256(publicationBytes),
        publishedAt: now().toISOString(),
      }));
    }
    return {
      editionId,
      key: publicationKey,
      status: mode === "preview" ? "preview-published" as const : "published" as const,
    };
  };
}

export async function main(event: unknown) {
  const bucket = process.env.ARTIFACT_BUCKET?.trim();
  const publicBucket = process.env.PUBLIC_ASSET_BUCKET?.trim();
  if (!bucket) throw new Error("Missing required environment variable: ARTIFACT_BUCKET");
  if (!publicBucket) throw new Error("Missing required environment variable: PUBLIC_ASSET_BUCKET");
  const s3 = new S3Client({});
  return createCloudPublicationHandler({
    artifacts: new S3ArtifactStore({ bucket, client: s3 }),
    publicAssets: new S3ArtifactStore({ bucket: publicBucket, client: s3 }),
    current: {
      async advance(pointer) {
        const key = "generated/current.json";
        let previousEtag: string | undefined;
        let previous: z.infer<typeof currentEditionPointerSchema> | null = null;
        try {
          const response = await s3.send(new GetObjectCommand({ Bucket: publicBucket, Key: key }));
          if (!response.Body || !response.ETag) throw new Error("Current-edition pointer is incomplete");
          const currentPayload: unknown = JSON.parse(await response.Body.transformToString());
          const unpublished = unpublishedCurrentSchema.safeParse(currentPayload).success;
          if (!unpublished) {
            previous = currentEditionPointerSchema.parse(currentPayload);
          }
          previousEtag = response.ETag;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "NoSuchKey") throw error;
        }
        const updated = nextCurrentPointer(previous, pointer);
        if (updated === previous) return;
        await s3.send(new PutObjectCommand({
          Bucket: publicBucket,
          Key: key,
          Body: Buffer.from(`${JSON.stringify(updated, null, 2)}\n`),
          CacheControl: "no-store, max-age=0",
          ContentType: "application/json",
          ...(previousEtag ? { IfMatch: previousEtag } : { IfNoneMatch: "*" }),
        }));
      },
    },
  })(event);
}
