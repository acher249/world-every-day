import { z } from "zod";

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
    feedUrl: httpsUrlSchema,
    kind: z.enum(["primary", "reporting"]),
    articleAccess: z.enum(["discovery-only", "ephemeral-analysis"]).default("discovery-only"),
    allowedArticleHosts: z.array(hostnameSchema).max(20).default([]),
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
  });
});

export type SourceConfiguration = z.infer<typeof sourceConfigurationSchema>;

export function parseSourceConfiguration(input: unknown): SourceConfiguration {
  return sourceConfigurationSchema.parse(input);
}

