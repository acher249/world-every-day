import type { DiscoveredStory } from "./schema.js";

export function buildArticleAnalysisPrompt(story: DiscoveredStory, articleText: string): string {
  return [
    "Analyze this article for a cited daily world edition using only the supplied article text.",
    "Return only a JSON object with headline, summary, claims, and details fields. Claims are objects with claim and evidence strings. Details are objects with detail, evidence, kind, and confidence fields.",
    "Write a clear, factual headline that states the concrete development. Write a concise original summary without copying article prose.",
    "Extract two to four central factual claims. For every claim, copy one exact evidence passage of at most 240 characters from the article. Do not invent, infer beyond the text, or reproduce long passages.",
    "Also extract up to four concrete visual details directly tied to the reported development, not incidental examples, background context, or unrelated scenes mentioned in the article. Write each detail in your own concise words; do not copy article prose into the detail field. Prefer specific objects, materials, colors, settings, species, and instruments. For every detail, copy one exact evidence passage of at most 240 characters into the temporary evidence field.",
    "Each detail kind must be object, material, color, setting, species, instrument, or other. Every visual-detail confidence must be a decimal number from 0 to 1 inclusive.",
    "Visual details may be empty when none are useful. Never turn an abstract result into a reported physical object. Do not include people or faces as visual subjects.",
    `Discovery title: ${story.title}`,
    `Publisher: ${story.publisher}`,
    `Article text:\n${articleText}`,
  ].join("\n\n");
}

export function boundEphemeralEvidence(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.evidence !== "string") return value;
  return {
    ...record,
    evidence: record.evidence.replace(/\s+/g, " ").trim().slice(0, 320).trimEnd(),
  };
}
