import { z } from "zod";
import initialSourceConfiguration from "../../config/source-configuration.initial.v1.json" with { type: "json" };
import { createSelectedEdition, selectedEditionSchema } from "../editorial/edition.js";
import { artifactSha256, candidateSetSha256 } from "../editorial/select.js";
import { candidateEvaluationSetSchema, editorialShortlistSchema } from "../editorial/schema.js";
import { parseSourceConfiguration, type SourceConfiguration } from "../sources/config.js";
import { articleEvidenceSchema, candidateSetSchema } from "../sources/schema.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { S3ArtifactStore } from "../storage/s3-artifact-store.js";

const inputSchema = z.object({
  editionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
});

async function readJson(artifacts: ArtifactStore, key: string): Promise<unknown> {
  const bytes = await artifacts.read(key);
  if (!bytes) throw new Error(`Required editorial artifact is missing: ${key}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

export function createFinalizeEditionHandler({
  artifacts,
  configuration,
  now = () => new Date(),
}: {
  artifacts: ArtifactStore;
  configuration: SourceConfiguration;
  now?: () => Date;
}) {
  return async (rawInput: unknown) => {
    const { editionId } = inputSchema.parse(rawInput);
    const root = `editions/${editionId}`;
    const candidates = candidateSetSchema.parse(await readJson(artifacts, `${root}/sources/candidate-set.json`));
    const evaluations = candidateEvaluationSetSchema.parse(await readJson(artifacts, `${root}/editorial/candidate-evaluations.json`));
    const shortlist = editorialShortlistSchema.parse(await readJson(artifacts, `${root}/editorial/shortlist.json`));
    if (evaluations.editionId !== editionId || shortlist.editionId !== editionId ||
        evaluations.candidateSetSha256 !== candidateSetSha256(candidates) ||
        shortlist.candidateSetSha256 !== candidateSetSha256(candidates) ||
        shortlist.evaluationSetSha256 !== artifactSha256(evaluations) ||
        shortlist.sourceConfigurationSha256 !== artifactSha256(configuration)) {
      throw new Error("Editorial inputs do not match this edition or current source policy");
    }
    if (shortlist.selected.length === 0 || shortlist.selected.length > 15) {
      throw new Error("Finalization requires 1–15 shortlisted stories");
    }

    const evidence = await Promise.all(shortlist.selected.map(async ({ storyId }) => {
      const item = articleEvidenceSchema.parse(await readJson(artifacts, `${root}/editorial/article-evidence/${storyId}.json`));
      if (item.storyId !== storyId) throw new Error(`Article evidence does not match ${storyId}`);
      return item;
    }));
    const evidenceById = new Map(evidence.map((item) => [item.storyId, item]));
    const key = `${root}/editorial/selected-edition.json`;
    const existing = await artifacts.read(key);
    if (existing) {
      const edition = selectedEditionSchema.parse(JSON.parse(Buffer.from(existing).toString("utf8")));
      if (edition.editionId !== editionId ||
          edition.inputs.candidateSetSha256 !== candidateSetSha256(candidates) ||
          edition.inputs.evaluationSetSha256 !== artifactSha256(evaluations) ||
          edition.inputs.shortlistSha256 !== artifactSha256(shortlist) ||
          edition.stories.some(({ storyId, articleEvidenceSha256 }) => {
            const item = evidenceById.get(storyId);
            return !item || articleEvidenceSha256 !== artifactSha256(item);
          })) {
        throw new Error("Existing selected edition does not match current editorial inputs");
      }
      return { editionId, key, selectedCount: edition.stories.length, status: "reused" };
    }

    const edition = createSelectedEdition({
      articleEvidence: evidence,
      candidateSet: candidates,
      createdAt: now(),
      evaluations,
      shortlist,
    });
    await artifacts.putImmutable({
      key,
      contentType: "application/json",
      bytes: Buffer.from(`${JSON.stringify(edition, null, 2)}\n`),
      metadata: { editionId },
    });
    return { editionId, key, selectedCount: edition.stories.length, status: "created" };
  };
}

export async function main(event: unknown) {
  const bucket = process.env.ARTIFACT_BUCKET?.trim();
  if (!bucket) throw new Error("Missing required environment variable: ARTIFACT_BUCKET");
  return createFinalizeEditionHandler({
    artifacts: new S3ArtifactStore({ bucket }),
    configuration: parseSourceConfiguration(initialSourceConfiguration),
  })(event);
}
