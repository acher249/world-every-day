import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { candidateEvaluationSchema, candidateEvaluationSetSchema } from "./schema.js";
import { candidateSetSha256, defaultEditorialSelectionConfiguration } from "./select.js";
import { candidateSetSchema, discoveredStorySchema } from "../sources/schema.js";
import { assertConfiguredCandidates, type SourceConfiguration } from "../sources/config.js";
import { canonicalizeSourceUrl } from "../sources/url.js";
import { currentEditionPointerSchema, unpublishedCurrentSchema } from "../publication/review.js";
import { publicationManifestSchema } from "../publication/schema.js";
import { sha256 } from "../panorama/hash.js";
import type { ArtifactStore } from "../storage/artifact-store.js";

export const STORY_LIBRARY_DAYS = 14;
export const STORY_LIBRARY_LIMIT = 50;
export const librarySnapshotSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.object({
    candidate: discoveredStorySchema,
    evaluation: candidateEvaluationSchema,
    producer: candidateEvaluationSetSchema.shape.producer,
    editionId: z.string(),
  })),
  usedUrls: z.array(z.string()),
  usedEventKeys: z.array(z.string()),
});
export type LibrarySnapshot = z.infer<typeof librarySnapshotSchema>;
export type StoryLibrary = { load(end: Date, editionId: string): Promise<LibrarySnapshot> };

export function isApprovedLibraryCandidate(candidate: z.infer<typeof discoveredStorySchema>, configuration: SourceConfiguration): boolean {
  try { assertConfiguredCandidates([candidate], configuration); } catch { return false; }
  const source = configuration.sources.find(({ id }) => id === candidate.source.adapterId);
  const host = new URL(candidate.canonicalUrl).hostname;
  return source?.articleAccess === "ephemeral-analysis" && source.allowedArticleHosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/** Existing immutable edition artifacts are the library; no article bodies or new database. */
export function createStoryLibrary({ artifacts, publicAssets, listEditions, configuration }: {
  artifacts: ArtifactStore;
  publicAssets: ArtifactStore;
  listEditions: () => Promise<string[]>;
  configuration: SourceConfiguration;
}): StoryLibrary {
  return { async load(end, currentEditionId) {
    const oldest = end.getTime() - STORY_LIBRARY_DAYS * 86_400_000;
    const pointerBytes = await publicAssets.read("generated/current.json");
    const usedUrls = new Set<string>();
    if (pointerBytes) {
      const raw = JSON.parse(Buffer.from(pointerBytes).toString("utf8"));
      if (!unpublishedCurrentSchema.safeParse(raw).success) {
        const pointer = currentEditionPointerSchema.parse(raw);
        // Public history is the source of truth: staged/failed editions are not consumed.
        for (const item of [pointer, ...(pointer.pastWorlds ?? [])]) {
          const bytes = await publicAssets.read(item.publicationUrl.replace(/^\//, ""));
          if (!bytes || sha256(Buffer.from(bytes)) !== item.publicationSha256) throw new Error("Story library publication history is missing or changed");
          const manifest = publicationManifestSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
          for (const story of manifest.stories) for (const source of story.sources) usedUrls.add(canonicalizeSourceUrl(source.url));
        }
      }
    }
    const entries = new Map<string, LibrarySnapshot["entries"][number]>();
    const usedEventKeys = new Set<string>();
    const ids = (await listEditions()).filter((id) => {
      const date = id.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      return id !== currentEditionId && date && Date.parse(`${date}T23:59:59Z`) >= oldest && Date.parse(date) <= end.getTime();
    }).sort();
    for (const editionId of ids) {
      const [candidateBytes, evaluationBytes] = await Promise.all([
        artifacts.read(`editions/${editionId}/sources/candidate-set.json`),
        artifacts.read(`editions/${editionId}/editorial/candidate-evaluations.json`),
      ]);
      if (!candidateBytes || !evaluationBytes) continue;
      const candidates = candidateSetSchema.parse(JSON.parse(Buffer.from(candidateBytes).toString("utf8")));
      const evaluations = candidateEvaluationSetSchema.parse(JSON.parse(Buffer.from(evaluationBytes).toString("utf8")));
      if (evaluations.candidateSetSha256 !== candidateSetSha256(candidates)) throw new Error(`Story library checksum mismatch: ${editionId}`);
      if (Date.parse(evaluations.createdAt) > end.getTime()) continue;
      const byId = new Map(candidates.candidates.map((c) => [c.id, c]));
      for (const evaluation of evaluations.evaluations) {
        const candidate = byId.get(evaluation.storyId);
        if (!candidate) continue;
        if (usedUrls.has(candidate.canonicalUrl)) usedEventKeys.add(evaluation.eventKey);
        const published = Date.parse(candidate.publishedAt);
        if (published < oldest || published >= end.getTime() || !isApprovedLibraryCandidate(candidate, configuration) ||
            !evaluation.eligibility.eligible || evaluation.scores.credibility < defaultEditorialSelectionConfiguration.minimumCredibility) continue;
        entries.set(candidate.id, { candidate, evaluation, producer: evaluations.producer, editionId });
      }
    }
    return librarySnapshotSchema.parse({ version: 1,
      entries: [...entries.values()].filter(({ candidate, evaluation }) => !usedUrls.has(candidate.canonicalUrl) && !usedEventKeys.has(evaluation.eventKey))
        .sort((a, b) => b.candidate.publishedAt.localeCompare(a.candidate.publishedAt) || a.candidate.id.localeCompare(b.candidate.id)).slice(0, STORY_LIBRARY_LIMIT),
      usedUrls: [...usedUrls].sort(), usedEventKeys: [...usedEventKeys].sort(),
    });
  } };
}

export async function listS3Editions(client: S3Client, bucket: string): Promise<string[]> {
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "editions/", Delimiter: "/", ContinuationToken: token }));
    for (const item of page.CommonPrefixes ?? []) if (item.Prefix) ids.push(item.Prefix.split("/")[1]);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return ids;
}
