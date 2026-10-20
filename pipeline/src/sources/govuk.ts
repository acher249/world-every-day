import { createHash } from "node:crypto";
import { z } from "zod";
import type { ResourceFetcher } from "./http.js";
import { parseFeedCandidates, type SourceAdapter, type SourceDiscovery } from "./feed.js";
import { discoveredStorySchema } from "./schema.js";

const contentMetadataSchema = z.object({
  base_path: z.string(),
  document_type: z.string(),
  first_published_at: z.iso.datetime({ offset: true }),
  schema_name: z.string(),
  withdrawn_notice: z.object({ withdrawn_at: z.string().optional() }).optional(),
});

type GovUkFeed = Parameters<typeof parseFeedCandidates>[0]["configuration"];

/** The Atom feed's `updated` date is not its publication date. Verify it via GOV.UK. */
export class GovUkNewsAdapter implements SourceAdapter {
  readonly id: string;
  readonly feedUrl: string;

  constructor(
    private readonly configuration: GovUkFeed,
    private readonly fetcher: ResourceFetcher,
  ) {
    this.id = configuration.id;
    this.feedUrl = configuration.feedUrl;
  }

  async discover(discoveredAt = new Date()): Promise<SourceDiscovery> {
    const feed = await this.fetcher.fetch(this.feedUrl);
    const entries = parseFeedCandidates({
      configuration: this.configuration,
      discoveredAt,
      xml: feed.body.toString("utf8"),
    }).filter(({ canonicalUrl }) => new URL(canonicalUrl).pathname.startsWith("/government/news/"));
    const candidates: SourceDiscovery["candidates"] = [];
    let verified = 0;
    for (const entry of entries.slice(0, 30)) {
      const path = new URL(entry.canonicalUrl).pathname;
      try {
        // The API response is transient. In particular, its article body is not stored.
        const resource = await this.fetcher.fetch(`https://www.gov.uk/api/content${path}`);
        const metadata = contentMetadataSchema.parse(JSON.parse(resource.body.toString("utf8")));
        verified += 1;
        if (metadata.base_path !== path || metadata.schema_name !== "news_article" ||
            !["press_release", "news_story"].includes(metadata.document_type) ||
            metadata.withdrawn_notice?.withdrawn_at) continue;
        candidates.push(discoveredStorySchema.parse({
          ...entry,
          publishedAt: new Date(metadata.first_published_at).toISOString(),
        }));
      } catch {
        // One missing or changed record does not invalidate the whole feed.
      }
    }
    if (entries.length > 0 && verified === 0) {
      throw new Error("GOV.UK publication dates could not be verified");
    }
    return {
      candidates,
      contentSha256: createHash("sha256").update(feed.body).digest("hex"),
      etag: feed.etag,
      lastModified: feed.lastModified,
    };
  }
}
