import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const DELIVERY_REVIEW_POLICY_VERSION = "delivery-review-v3-seam-tolerant";

export const seamReviewSchema = z.object({
  status: z.enum(["clear", "tolerable", "blocking", "uncertain"]),
  affectedSectors: z.array(z.number().int().min(0).max(3)).max(4),
  evidence: z.string().min(1).max(800),
}).strict();

export type SeamReview = z.infer<typeof seamReviewSchema>;
export type SeamReviewer = (image: Buffer) => Promise<SeamReview>;

/** Detect positive artifact claims without treating explicit clean/negative wording as a defect. */
export function hasAffirmativeSeamArtifactEvidence(evidence: string): boolean {
  const clauses = evidence.toLowerCase().split(/[.!?;\n]+|,\s*(?=(?:but|however|except|yet|although)\b)|\b(?:but|however|except|yet|although)\b/);
  const artifact = /\b(?:smear(?:ed|ing)?|blur bands?|collage|composit(?:ed|ing)(?: artifact)?|stitch(?:ed|ing)?(?: seams?| boundaries| artifacts)?|discontinu(?:ity|ous)|(?:visible|obvious|clear|present|severe) seams?|seam (?:artifact|issue|is visible|is present)|abrupt(?:ly)? cut)\b/i;
  const negation = /\b(?:no|not|without|none|absent|absence of|lack of|free from|free of|neither)\b/i;
  return clauses.some((clause) => artifact.test(clause) && !negation.test(clause));
}

export function seamReviewPasses(input: SeamReview): boolean {
  const review = seamReviewSchema.parse(input);
  if (review.status === "clear") {
    return review.affectedSectors.length === 0 && !hasAffirmativeSeamArtifactEvidence(review.evidence);
  }
  if (review.status !== "tolerable" || review.affectedSectors.length > 2) return false;
  // Localized wrap and terrain discontinuities are publishable for now. Keep a
  // hard stop for obvious full-width smear bands or unrelated scene panels.
  return !/\b(?:full[- ]width|full[- ]frame|across (?:the )?(?:entire|whole) (?:image|panorama)|broad horizontal (?:smear|blur) band|large unrelated (?:scene|panel)|split[- ]screen|two distinct scenes|unrelated interior panel)\b/i.test(review.evidence);
}

/** A separate visual pass focused on wrap continuity and panorama artifacts. */
export function createSeamReviewer(apiKey: string, model = "gemini-3.8-flash"): SeamReviewer {
  const client = new GoogleGenAI({ apiKey });
  return async (image) => {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [
        { text: "Review this complete 2:1 equirectangular panorama for practical use as a navigable world. Inspect the RIGHT-to-LEFT longitude wrap and all four quarter-width sectors (0 leftmost through 3 rightmost). Use status=clear when the world reads as coherent. Use status=tolerable for a visible but localized mismatch, including a noticeable horizon, terrain, lighting, or color jump at the wrap, or an isolated vertical join; these imperfections are acceptable for publication during this interim review policy. Use status=blocking only for a clearly unusable structural defect, such as a broad horizontal smear/blur band spanning much of the image, large unrelated scene panels, or a split-screen collage that prevents the panorama reading as one place. Natural terrain changes and imperfect edge continuity alone are not blocking. Use status=uncertain only when you cannot assess the image. List affected sectors; for a wrap mismatch, identify sectors 0 and 3. Keep the description concise and image-specific. Return only the schema." },
        { inlineData: { mimeType: "image/png", data: image.toString("base64") } },
      ] }],
      config: {
        responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(seamReviewSchema),
        temperature: 0, maxOutputTokens: 2048,
        httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
      },
    });
    if (!response.text) throw new Error("Panorama seam review returned no assessment");
    return seamReviewSchema.parse(JSON.parse(response.text));
  };
}
