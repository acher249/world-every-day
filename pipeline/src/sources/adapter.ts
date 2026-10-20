import type { SourceConfiguration } from "./config.js";
import { FeedSourceAdapter, type SourceAdapter } from "./feed.js";
import { GovUkNewsAdapter } from "./govuk.js";
import type { ResourceFetcher } from "./http.js";

export function createSourceAdapter(
  source: SourceConfiguration["sources"][number],
  fetcher: ResourceFetcher,
): SourceAdapter {
  if (source.publishedAtLookup === "govuk-content-api") {
    return new GovUkNewsAdapter(source, fetcher);
  }
  return new FeedSourceAdapter(source, fetcher);
}
