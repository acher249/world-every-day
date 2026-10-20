import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { parse } from "node-html-parser";
import { candidateSetSchema, discoveredStorySchema, type CandidateSet, type DiscoveredStory } from "./schema.js";
import type { ResourceFetcher } from "./http.js";
import { canonicalizeSourceUrl, hostnameAllowed } from "./url.js";

export const MAX_COLLECTED_CANDIDATES = 100;

type FeedConfiguration = {
  id: string;
  feedUrl: string;
  kind: "primary" | "reporting";
  publisher: string;
  publisherGroup?: string;
  allowedArticleHosts?: readonly string[];
  upgradeHttpArticleLinksToHttps?: true;
};

type FeedEntry = Record<string, unknown>;

export type SourceDiscovery = {
  candidates: DiscoveredStory[];
  contentSha256: string;
  etag?: string;
  lastModified?: string;
};

export type SourceAdapter = {
  readonly id: string;
  readonly feedUrl: string;
  discover(discoveredAt?: Date): Promise<SourceDiscovery>;
};

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseTagValue: false,
  textNodeName: "#text",
  trimValues: true,
});

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function record(value: unknown): FeedEntry | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as FeedEntry
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || undefined;
  const item = record(value);
  return item ? text(item["#text"]) : undefined;
}

function feedLink(entry: FeedEntry): string | undefined {
  const links = arrayOf(entry.link);
  for (const link of links) {
    if (typeof link === "string") return link;
    const item = record(link);
    if (!item) continue;
    const relation = text(item["@_rel"]);
    const href = text(item["@_href"]);
    if (href && (!relation || relation === "alternate")) return href;
    const nodeText = text(item);
    if (nodeText) return nodeText;
  }
  return undefined;
}

function plainText(value: unknown): string | undefined {
  const html = text(value);
  if (!html) return undefined;
  const normalized = parse(html).textContent.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 1_000) : undefined;
}

function parseDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function entryId(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function articleUrl(link: string, configuration: FeedConfiguration): string {
  const url = new URL(link);
  if (url.protocol === "http:" && configuration.upgradeHttpArticleLinksToHttps === true) {
    if (!configuration.allowedArticleHosts?.length || !hostnameAllowed(url, configuration.allowedArticleHosts) ||
        url.username || url.password || url.port) {
      throw new Error("Cannot upgrade an untrusted feed article URL");
    }
    url.protocol = "https:";
    return canonicalizeSourceUrl(url.toString());
  }
  return canonicalizeSourceUrl(link);
}

export function parseFeedCandidates({
  configuration,
  discoveredAt,
  xml,
}: {
  configuration: FeedConfiguration;
  discoveredAt: Date;
  xml: string;
}): DiscoveredStory[] {
  const document = record(parser.parse(xml));
  const rssChannel = record(record(document?.rss)?.channel);
  const atomFeed = record(document?.feed);
  const entries = rssChannel
    ? arrayOf(rssChannel.item)
    : atomFeed
      ? arrayOf(atomFeed.entry)
      : [];

  return entries.flatMap((rawEntry) => {
    const entry = record(rawEntry);
    if (!entry) return [];
    const link = feedLink(entry);
    const title = plainText(entry.title);
    const publishedAt = parseDate(entry.pubDate ?? entry.publishDate ?? entry.published ?? entry.updated ?? entry["dc:date"]);
    if (!link || !title || !publishedAt) return [];
    let canonicalUrl: string;
    try {
      canonicalUrl = articleUrl(link, configuration);
      if (configuration.allowedArticleHosts &&
          !hostnameAllowed(new URL(canonicalUrl), configuration.allowedArticleHosts)) return [];
    } catch {
      return [];
    }

    return [discoveredStorySchema.parse({
      id: entryId(canonicalUrl),
      canonicalUrl,
      title,
      publisher: configuration.publisher,
      publishedAt,
      discoveredAt: discoveredAt.toISOString(),
      source: {
        adapterId: configuration.id,
        feedUrl: canonicalizeSourceUrl(configuration.feedUrl),
        entryId: text(entry.guid ?? entry.id),
        kind: configuration.kind,
        publisherGroup: configuration.publisherGroup,
      },
    })];
  });
}

export class FeedSourceAdapter {
  readonly configuration: FeedConfiguration;
  readonly #fetcher: ResourceFetcher;

  constructor(configuration: FeedConfiguration, fetcher: ResourceFetcher) {
    this.configuration = configuration;
    this.#fetcher = fetcher;
  }

  get id(): string {
    return this.configuration.id;
  }

  get feedUrl(): string {
    return canonicalizeSourceUrl(this.configuration.feedUrl);
  }

  async discover(discoveredAt = new Date()): Promise<SourceDiscovery> {
    const resource = await this.#fetcher.fetch(this.configuration.feedUrl);
    return {
      candidates: parseFeedCandidates({
        configuration: this.configuration,
        discoveredAt,
        xml: resource.body.toString("utf8"),
      }),
      contentSha256: createHash("sha256").update(resource.body).digest("hex"),
      etag: resource.etag,
      lastModified: resource.lastModified,
    };
  }
}

export async function collectCandidateSet({
  adapters,
  createdAt = new Date(),
  window,
}: {
  adapters: readonly SourceAdapter[];
  createdAt?: Date;
  window: { start: Date; end: Date };
}): Promise<CandidateSet> {
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.discover(createdAt)));
  const byUrl = new Map<string, DiscoveredStory>();
  for (const result of results) {
    if (result.status === "rejected") continue;
    for (const candidate of result.value.candidates) {
      const published = new Date(candidate.publishedAt);
      if (published < window.start || published >= window.end) continue;
      const existing = byUrl.get(candidate.canonicalUrl);
      if (!existing || candidate.source.kind === "primary") byUrl.set(candidate.canonicalUrl, candidate);
    }
  }

  const discovered = [...byUrl.values()].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  // Keep evaluation bounded without letting one high-volume publisher crowd out
  // the rest. Source-run counts still report the untrimmed discovery result.
  const byPublisher = new Map<string, DiscoveredStory[]>();
  for (const story of discovered) {
    const publisherGroup = story.source.publisherGroup ?? story.publisher;
    const group = byPublisher.get(publisherGroup) ?? [];
    group.push(story);
    byPublisher.set(publisherGroup, group);
  }
  const admitted: DiscoveredStory[] = [];
  while (admitted.length < MAX_COLLECTED_CANDIDATES && byPublisher.size > 0) {
    for (const [publisher, group] of byPublisher) {
      const next = group.shift();
      if (next) admitted.push(next);
      if (group.length === 0) byPublisher.delete(publisher);
      if (admitted.length === MAX_COLLECTED_CANDIDATES) break;
    }
  }

  return candidateSetSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "candidate-set",
    createdAt: createdAt.toISOString(),
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    sourceRuns: results.map((result, index) => {
      const adapter = adapters[index];
      if (result.status === "rejected") {
        const message = result.reason instanceof Error ? result.reason.message : "Unknown source failure";
        return {
          adapterId: adapter.id,
          feedUrl: adapter.feedUrl,
          status: "failed" as const,
          candidateCount: 0,
          error: message.slice(0, 300),
        };
      }
      return {
        adapterId: adapter.id,
        feedUrl: adapter.feedUrl,
        status: "succeeded" as const,
        candidateCount: result.value.candidates.length,
        contentSha256: result.value.contentSha256,
        etag: result.value.etag,
        lastModified: result.value.lastModified,
      };
    }),
    omittedCandidateCount: discovered.length > admitted.length ? discovered.length - admitted.length : undefined,
    candidates: admitted.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)),
  });
}

