import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStoryLibrary, type LibrarySnapshot } from "../src/editorial/story-library.js";
import { createEditorialShortlist, candidateSetSha256, defaultEditorialSelectionConfiguration } from "../src/editorial/select.js";
import { candidateSetSchema } from "../src/sources/schema.js";
import { candidateEvaluationSetSchema } from "../src/editorial/schema.js";
import { parseSourceConfiguration } from "../src/sources/config.js";
import { LocalArtifactStore } from "../src/storage/artifact-store.js";
import { createCollectCandidatesHandler } from "../src/cloud/collect-candidates-handler.js";
import { createEditorialShortlistHandler } from "../src/cloud/editorial-shortlist-handler.js";
const candidates = candidateSetSchema.parse(JSON.parse(await readFile(new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8")));
const evaluations = candidateEvaluationSetSchema.parse(JSON.parse(await readFile(new URL("../fixtures/candidate-evaluations.v1.json", import.meta.url), "utf8")));
const candidate = candidates.candidates[0], evaluation = evaluations.evaluations[0];
const configuration = parseSourceConfiguration({ schemaVersion: "1.0.0", artifactType: "source-configuration", sources: [{
  id: candidate.source.adapterId, type: "rss", publisher: candidate.publisher, feedUrl: candidate.source.feedUrl,
  kind: candidate.source.kind, articleAccess: "ephemeral-analysis", allowedArticleHosts: ["news.example.test"],
}] });
const producer = { type: "fixture" as const, provider: "fixture", model: "fixture", promptVersion: "v1" };
test("library retains unused eligible stories, expires old stories and excludes removed sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "story-library-"));
  try {
    const artifacts = new LocalArtifactStore(dir), editionId = "daily-2026-10-13";
    for (const [key, value] of [["sources/candidate-set.json", candidates], ["editorial/candidate-evaluations.json", { ...evaluations, editionId, candidateSetSha256: candidateSetSha256(candidates) }]] as const) {
      await artifacts.putImmutable({ key: `editions/${editionId}/${key}`, bytes: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
    }
    const options = { artifacts, publicAssets: artifacts, listEditions: async () => [editionId], configuration };
    assert.equal((await createStoryLibrary(options).load(new Date("2026-10-14T14:30:00Z"), "daily-2026-10-14")).entries.length, 1);
    assert.equal((await createStoryLibrary(options).load(new Date("2026-10-29T14:30:00Z"), "daily-2026-10-29")).entries.length, 0);
    assert.equal((await createStoryLibrary({ ...options, configuration: { ...configuration, sources: [{ ...configuration.sources[0], articleAccess: "discovery-only" }] } }).load(new Date("2026-10-14T14:30:00Z"), "daily-2026-10-14")).entries.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("newest unused stories win over higher scores; previously published events are excluded", () => {
  const fresh = { ...candidate, id: "a".repeat(64), canonicalUrl: "https://news.example.test/new", publishedAt: "2026-10-13T12:00:00Z" };
  const set = { ...candidates, candidates: [candidate, fresh] };
  const newer = { ...evaluation, storyId: fresh.id, eventKey: "new-event", scores: { ...evaluation.scores, novelty: 0, constructiveSignificance: 0.5 } };
  const assessed = { ...evaluations, candidateSetSha256: candidateSetSha256(set), evaluations: [evaluation, newer] };
  const args = { candidateSet: set, evaluations: assessed, newestFirst: true, configuration: { ...defaultEditorialSelectionConfiguration, targetStories: 1 } };
  assert.equal(createEditorialShortlist(args).selected[0].storyId, fresh.id);
  assert.equal(createEditorialShortlist({ ...args, usedEventKeys: new Set(["new-event"]) }).selected[0].storyId, candidate.id);
});
test("empty feeds use one cached story; retries do not refetch or re-evaluate; used stories cannot return", async () => {
  const dir = await mkdtemp(join(tmpdir(), "story-library-cloud-"));
  try {
    const artifacts = new LocalArtifactStore(dir);
    const snapshot: LibrarySnapshot = { version: 1, entries: [{ candidate, evaluation, producer, editionId: "daily-2026-10-13" }], usedUrls: [], usedEventKeys: [] };
    let loads = 0, fetches = 0;
    const input = { editionId: "daily-2026-10-14", windowStart: "2026-10-13T14:30:00.000Z", windowEnd: "2026-10-14T14:30:00.000Z" };
    const collect = createCollectCandidatesHandler({ artifacts, configuration, library: { async load() { loads++; return snapshot; } },
      fetcherForSource: () => ({ async fetch() { fetches++; throw new Error("offline"); } }) });
    assert.equal((await collect(input)).candidateCount, 1);
    await collect(input); assert.equal(loads, 1); assert.equal(fetches, 1);
    const editorial = createEditorialShortlistHandler({ artifacts, sourceConfiguration: configuration,
      evaluator: { ...producer, async evaluate() { throw new Error("Unexpected paid call"); } } });
    assert.equal((await editorial(input)).selectedCount, 1);
    assert.equal((await editorial(input)).selectedCount, 1);
    const blocked = createCollectCandidatesHandler({ artifacts, configuration, library: { async load() { return { ...snapshot, usedUrls: [candidate.canonicalUrl] }; } }, fetcherForSource: () => ({ async fetch() { throw new Error("offline"); } }) });
    await assert.rejects(blocked({ ...input, editionId: "daily-2026-10-14-used" }), /No candidate stories/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("public history consumes URLs and event aliases, while other eligible stories stay available", async () => {
  const dir = await mkdtemp(join(tmpdir(), "story-library-published-"));
  try {
    const artifacts = new LocalArtifactStore(dir);
    const editionId = "daily-2026-10-13";
    const alias = { ...candidate, id: "b".repeat(64), canonicalUrl: "https://news.example.test/alias" };
    const set = { ...candidates, candidates: [candidate, alias] };
    const assessed = { ...evaluations, editionId, candidateSetSha256: candidateSetSha256(set), evaluations: [evaluation, { ...evaluation, storyId: alias.id }] };
    const manifest = JSON.parse(await readFile(new URL("../../frontend/data/fixtures/demo-publication.v1.json", import.meta.url), "utf8"));
    manifest.stories[0].sources = [{ title: candidate.title, publisher: candidate.publisher, url: candidate.canonicalUrl, publishedAt: candidate.publishedAt, kind: "primary" }];
    const publicationBytes = Buffer.from(JSON.stringify(manifest));
    const { sha256 } = await import("../src/panorama/hash.js");
    const values = [
      [`editions/${editionId}/sources/candidate-set.json`, set],
      [`editions/${editionId}/editorial/candidate-evaluations.json`, assessed],
      ["generated/editions/published/publication.json", manifest],
      ["generated/current.json", { schemaVersion: "1.0.0", editionId: "published", publicationUrl: "/generated/editions/published/publication.json", publicationSha256: sha256(publicationBytes), publishedAt: "2026-10-13T16:00:00Z" }],
    ] as const;
    for (const [key, value] of values) await artifacts.putImmutable({ key, contentType: "application/json", bytes: Buffer.from(JSON.stringify(value)) });
    const snapshot = await createStoryLibrary({ artifacts, publicAssets: artifacts, configuration, listEditions: async () => [editionId] }).load(new Date("2026-10-14T14:30:00Z"), "daily-2026-10-14");
    assert.equal(snapshot.entries.length, 0);
    assert.ok(snapshot.usedUrls.includes(candidate.canonicalUrl));
    assert.ok(snapshot.usedEventKeys.includes(evaluation.eventKey));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("72-hour discovery admits a two-day-old story but not a four-day-old story", async () => {
  const dir = await mkdtemp(join(tmpdir(), "story-library-lookback-"));
  try {
    const artifacts = new LocalArtifactStore(dir);
    const collect = createCollectCandidatesHandler({ artifacts, configuration,
      library: { async load() { return { version: 1, entries: [], usedUrls: [], usedEventKeys: [] }; } },
      fetcherForSource: () => ({ async fetch() { return { body: Buffer.from(`<rss><channel>
        <item><title>Recent research</title><link>https://news.example.test/recent</link><pubDate>Mon, 12 Oct 2026 12:00:00 GMT</pubDate></item>
        <item><title>Older research</title><link>https://news.example.test/older</link><pubDate>Sat, 10 Oct 2026 12:00:00 GMT</pubDate></item>
        </channel></rss>`), contentType: "application/rss+xml", url: candidate.source.feedUrl }; } }) });
    const input = { editionId: "daily-2026-10-14", windowStart: "2026-10-13T14:30:00.000Z", windowEnd: "2026-10-14T14:30:00.000Z" };
    const result = await collect(input);
    assert.equal(result.candidateCount, 1);
    const saved = candidateSetSchema.parse(JSON.parse(Buffer.from((await artifacts.read(result.key))!).toString()));
    assert.equal(saved.candidates[0].title, "Recent research");
    assert.equal(saved.collectionWindow?.start, input.windowStart);
    assert.equal(saved.window.start, "2026-10-11T14:30:00.000Z");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
