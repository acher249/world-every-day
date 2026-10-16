import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { z } from "zod";
import { artDirectionSchema } from "../art-direction/schema.js";
import { artifactSha256 } from "../editorial/select.js";
import { GoogleLandmarkDetector } from "../landmarks/google.js";
import type { LandmarkDetector } from "../landmarks/provider.js";
import { detectLandmarks } from "../landmarks/run.js";
import { landmarkArtifactSchema } from "../landmarks/schema.js";
import { sha256 } from "../panorama/hash.js";
import { editionPanoramaManifestSchema } from "../panorama/schema.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";
import { parseGoogleKey } from "./google-secret.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  confirmPaidLandmarks: z.literal(true),
});

type ClaimStore = { claimOnce(key: string, bytes: Uint8Array): Promise<boolean> };

async function readJson(artifacts: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await artifacts.read(key);
  if (!bytes) throw new Error(`Required landmark artifact is missing: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createCloudLandmarkHandler({
  artifacts,
  claims,
  detector,
  now = () => new Date(),
}: {
  artifacts: ArtifactStore;
  claims: ClaimStore;
  detector: LandmarkDetector;
  now?: () => Date;
}) {
  return async (rawInput: unknown) => {
    const { editionId } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const manifestKey = `${root}/landmarks/landmark-detections.json`;
    const panorama = editionPanoramaManifestSchema.parse(await readJson(artifacts, `${root}/panorama/manifest.json`));
    const direction = artDirectionSchema.parse(await readJson(artifacts, `${root}/art-direction/art-direction.json`));
    if (panorama.editionId !== editionId || direction.editionId !== editionId ||
        panorama.inputs.artDirectionSha256 !== artifactSha256(direction)) {
      throw new Error("Panorama and art direction do not match the landmark edition");
    }
    const sourceBytes = await artifacts.read(`${root}/panorama/${panorama.files.delivery8k}`);
    if (!sourceBytes || sha256(Buffer.from(sourceBytes)) !== panorama.outputs.delivery8kSha256) {
      throw new Error("Landmark panorama is missing or has changed");
    }
    const existing = await artifacts.read(manifestKey);
    if (existing) {
      const artifact = landmarkArtifactSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      if (artifact.editionId !== editionId || artifact.sourceImage.sha256 !== panorama.outputs.delivery8kSha256 ||
          artifact.provider.id !== detector.id || artifact.provider.model !== detector.model) {
        throw new Error("Existing landmark detections do not match the panorama or detector");
      }
      return { editionId, key: manifestKey, status: "reused" as const };
    }
    const analysisBytes = await sharp(Buffer.from(sourceBytes))
      .resize(2048, 1024, { fit: "fill" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    const claimed = await claims.claimOnce(
      `${root}/landmarks/detection-attempt.json`,
      Buffer.from(`${JSON.stringify({
        editionId,
        panoramaSha256: panorama.outputs.delivery8kSha256,
        detector: { id: detector.id, model: detector.model },
      })}\n`),
    );
    if (!claimed) throw new Error("A paid landmark-detection attempt already exists; inspect it before retrying");
    const artifact = await detectLandmarks({
      editionId,
      imageBytes: analysisBytes,
      mimeType: "image/jpeg",
      sourceImageBytes: Buffer.from(sourceBytes),
      artDirection: direction,
      detector,
      createdAt: now(),
    });
    await artifacts.putImmutable({
      key: `${root}/landmarks/analysis-image.jpg`,
      bytes: analysisBytes,
      contentType: "image/jpeg",
    });
    await artifacts.putImmutable({
      key: manifestKey,
      bytes: Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`),
      contentType: "application/json",
    });
    return { editionId, key: manifestKey, status: "created" as const };
  };
}

export async function main(event: unknown) {
  const bucket = requiredEnvironment("ARTIFACT_BUCKET");
  const secretId = requiredEnvironment("GOOGLE_SECRET_NAME");
  const model = requiredEnvironment("LANDMARK_VISION_MODEL");
  const secrets = new SecretsManagerClient({});
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!secret.SecretString) throw new Error("Google secret must contain a string value");
  const s3 = new S3Client({});
  return createCloudLandmarkHandler({
    artifacts: new S3ArtifactStore({ bucket, client: s3 }),
    claims: {
      async claimOnce(key, bytes) {
        try {
          await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: "application/json",
            IfNoneMatch: "*",
          }));
          return true;
        } catch (error) {
          if (error instanceof Error && error.name === "PreconditionFailed") return false;
          throw error;
        }
      },
    },
    detector: new GoogleLandmarkDetector({ apiKey: parseGoogleKey(secret.SecretString), model }),
  })(event);
}
