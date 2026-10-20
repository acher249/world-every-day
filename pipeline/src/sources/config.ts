import { z } from "zod";
import type { DiscoveredStory } from "./schema.js";
import { canonicalizeSourceUrl } from "./url.js";

const httpsUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS URL without embedded credentials");

const hostnameSchema = z.string().trim().toLowerCase().min(1).max(253).refine(
  (value) => {
    try {
      const url = new URL(`https://${value}/`);
      return url.hostname === value && !url.port && !url.username && !url.password;
    } catch {
      return false;
    }
  },
  "Use a hostname without a scheme, path, port, or credentials",
);

export const sourceConfigurationSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactType: z.literal("source-configuration"),
  sources: z.array(z.object({
    id: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    type: z.enum(["rss", "atom"]),
    publisher: z.string().min(1).max(160),
    publisherGroup: z.string().min(1).max(160).optional(),
    feedUrl: httpsUrlSchema,
    kind: z.enum(["primary", "reporting"]),
    articleAccess: z.enum(["discovery-only", "ephemeral-analysis"]).default("discovery-only"),
    allowedArticleHosts: z.array(hostnameSchema).max(20).default([]),
    upgradeHttpArticleLinksToHttps: z.literal(true).optional(),
    publishedAtLookup: z.literal("govuk-content-api").optional(),
    crawlDelayMs: z.number().int().min(0).max(60_000).default(0),
  })).min(1).max(100),
}).superRefine((configuration, context) => {
  const ids = new Set<string>();
  configuration.sources.forEach((source, index) => {
    if (ids.has(source.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate source id: ${source.id}`,
        path: ["sources", index, "id"],
      });
    }
    ids.add(source.id);
    if (source.publishedAtLookup === "govuk-content-api" &&
        (source.type !== "atom" || new URL(source.feedUrl).hostname !== "www.gov.uk" ||
         !source.allowedArticleHosts.includes("www.gov.uk"))) {
      context.addIssue({
        code: "custom",
        message: "GOV.UK publication-date lookup requires its official Atom feed and article host",
        path: ["sources", index, "publishedAtLookup"],
      });
    }
  });
});

export type SourceConfiguration = z.infer<typeof sourceConfigurationSchema>;

export function parseSourceConfiguration(input: unknown): SourceConfiguration {
  return sourceConfigurationSchema.parse(input);
}

export function assertConfiguredCandidates(
  candidates: DiscoveredStory[],
  configuration: SourceConfiguration,
): void {
  const sources = new Map(configuration.sources.map((source) => [source.id, source]));
  for (const candidate of candidates) {
    const source = sources.get(candidate.source.adapterId);
    if (!source || source.publisher !== candidate.publisher ||
        source.kind !== candidate.source.kind ||
        source.publisherGroup !== candidate.source.publisherGroup ||
        canonicalizeSourceUrl(source.feedUrl) !== candidate.source.feedUrl) {
      throw new Error("Candidate set contains a source outside the current allowlist; start a new edition");
    }
  }
}

