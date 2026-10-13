import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import type { ProviderUsage } from "../provider-usage.js";
import type { ResourceFetcher } from "./http.js";
import {
  analyzedArticleClaimSchema,
  analyzedVisualDetailSchema,
  articleEvidenceSchema,
  type AnalyzedArticleClaim,
  type AnalyzedVisualDetail,
  type ArticleEvidence,
  type DiscoveredStory,
} from "./schema.js";
import { canonicalizeSourceUrl } from "./url.js";

export const MAX_ARTICLE_ANALYSIS_CHARACTERS = 40_000;

export type ArticleAnalysis = {
  headline: string;
  summary: string;
  claims: AnalyzedArticleClaim[];
  details: AnalyzedVisualDetail[];
  usage?: ProviderUsage;
};

export type ArticleAnalyzer = {
  model: string;
  provider: string;
  analyze(input: { articleText: string; story: DiscoveredStory }): Promise<ArticleAnalysis>;
};

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function extractArticleText(html: string): string {
  const document = parse(html);
  for (const selector of ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form"]) {
    document.querySelectorAll(selector).forEach((element) => element.remove());
  }
  const longestRoot = (selectors: string[]) => document
    .querySelectorAll(selectors.join(", "))
    .sort((left, right) => normalizeText(right.textContent).length - normalizeText(left.textContent).length)[0];
  const root = longestRoot([
    '[itemprop="articleBody"]',
    ".entry-content",
    ".post-content",
    ".article-body",
    ".story-body",
    ".entry",
  ]) ?? longestRoot(["main article", '[role="main"] article', "article"])
    ?? longestRoot(["main", '[role="main"]', "body"])
    ?? document;
  const blocks = root.querySelectorAll("h1, h2, h3, p, li, blockquote")
    .map((element) => normalizeText(element.textContent))
    .filter((value) => value.length >= 20);
  const extracted = blocks.length > 0 ? blocks.join("\n") : normalizeText(root.textContent);
  if (!extracted) throw new Error("No readable article text was found");
  return extracted.slice(0, MAX_ARTICLE_ANALYSIS_CHARACTERS);
}

function evidenceAppearsInArticle(evidence: string, articleText: string): boolean {
  return normalizeText(articleText).toLocaleLowerCase().includes(
    normalizeText(evidence).toLocaleLowerCase(),
  );
}

export async function analyzeArticle({
  analyzer,
  createdAt = new Date(),
  fetchedAt = new Date(),
  fetcher,
  story,
}: {
  analyzer: ArticleAnalyzer;
  createdAt?: Date;
  fetchedAt?: Date;
  fetcher: ResourceFetcher;
  story: DiscoveredStory;
}): Promise<ArticleEvidence> {
  const resource = await fetcher.fetch(story.canonicalUrl);
  if (!resource.contentType.toLowerCase().includes("text/html")) {
    throw new Error(`Expected an HTML article; received ${resource.contentType}`);
  }
  const articleText = extractArticleText(resource.body.toString("utf8"));
  const analysis = await analyzer.analyze({ articleText, story });
  const claims = analysis.claims
    .map((claim) => analyzedArticleClaimSchema.parse(claim))
    .filter((claim) => evidenceAppearsInArticle(claim.evidence, articleText))
    .map(({ claim }) => ({ claim }))
    .slice(0, 6);
  const details = analysis.details
    .map((detail) => analyzedVisualDetailSchema.parse(detail))
    .filter((detail) => evidenceAppearsInArticle(detail.evidence, articleText))
    .map(({ detail, kind, confidence }) => ({ detail, kind, confidence }))
    .slice(0, 6);

  return articleEvidenceSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "article-evidence",
    storyId: story.id,
    createdAt: createdAt.toISOString(),
    source: {
      canonicalUrl: story.canonicalUrl,
      publisher: story.publisher,
      publishedAt: story.publishedAt,
      fetchedAt: fetchedAt.toISOString(),
      retrievedUrl: canonicalizeSourceUrl(resource.url),
      extractedTextSha256: createHash("sha256").update(articleText).digest("hex"),
      extractedCharacterCount: articleText.length,
    },
    extraction: {
      provider: analyzer.provider,
      model: analyzer.model,
      status: claims.length > 0 ? "analyzed" : "insufficient-evidence",
      usage: analysis.usage,
    },
    editorial: {
      headline: analysis.headline,
      summary: analysis.summary,
      claims,
    },
    details,
  });
}

