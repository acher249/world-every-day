import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { z } from "zod";
import { hasAffirmativeSeamArtifactEvidence } from "./seam-review.js";

export const HORIZON_POLICY_VERSION = "horizon-v4-distant-skyline";
export const MAX_PANORAMA_CANDIDATES = 5;
export const MAX_HORIZON_MIDPOINT_DEVIATION = 0.1;
export const horizonAssessmentSchema = z.object({
  sectors: z.array(z.object({
    sector: z.number().int().min(0).max(3),
    visible: z.boolean(),
    horizonY: z.number().min(0).max(1).nullable().describe(
      "Estimated vertical position of the representative far-distance skyline for this sector, averaged across the distant sky-to-terrain boundary; ignore isolated foreground or local peaks.",
    ),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(500),
  }).strict()).length(4).refine((items) => new Set(items.map((item) => item.sector)).size === 4, "Each quadrant must be assessed once"),
  tilted: z.boolean(),
  collageOrSeams: z.boolean(),
  textOrGuides: z.boolean(),
}).strict();
export type HorizonAssessment = z.infer<typeof horizonAssessmentSchema>;
export type HorizonReviewer = (image: Buffer) => Promise<HorizonAssessment>;

export function hasSeamArtifactEvidence(assessment: HorizonAssessment): boolean {
  return assessment.sectors.some((sector) => hasAffirmativeSeamArtifactEvidence(sector.evidence));
}

export function averageVisibleHorizonY(input: HorizonAssessment): number | null {
  const assessment = horizonAssessmentSchema.parse(input);
  const visible = assessment.sectors.filter((sector) => sector.visible && sector.horizonY !== null);
  return visible.length
    ? visible.reduce((sum, sector) => sum + sector.horizonY!, 0) / visible.length
    : null;
}

export function horizonPasses(input: HorizonAssessment): boolean {
  const assessment = horizonAssessmentSchema.parse(input);
  const visible = assessment.sectors.filter((sector) => sector.visible && sector.horizonY !== null);
  const confident = visible.filter((sector) => sector.confidence >= 0.8);
  const averageHorizonY = averageVisibleHorizonY(assessment);
  return !assessment.tilted && !assessment.textOrGuides && visible.length >= 2 &&
    confident.length >= 2 && averageHorizonY !== null &&
    Math.abs(averageHorizonY - 0.5) <= MAX_HORIZON_MIDPOINT_DEVIATION &&
    assessment.sectors.every((sector) => sector.visible || sector.horizonY === null);
}

/** Assess the exact centered crop, not the wider source canvas. */
export async function horizonPreview(bytes: Buffer): Promise<Buffer> {
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || metadata.height < metadata.width / 2) throw new Error("Invalid panorama dimensions");
  const height = Math.floor(metadata.width / 2);
  return sharp(bytes).extract({ left: 0, top: Math.floor((metadata.height - height) / 2), width: metadata.width, height })
    .resize(1440, 720).png().toBuffer();
}

export async function annotateHorizon(image: Buffer, assessment: HorizonAssessment): Promise<Buffer> {
  const markers = assessment.sectors.filter((item) => item.visible && item.horizonY !== null)
    .map((item) => {
      const left = item.sector * 360;
      const observedY = item.horizonY! * 720;
      const centerX = left + 180;
      const arrowStart = observedY < 360 ? observedY + 18 : observedY - 18;
      const arrowEnd = observedY < 360 ? 360 - 18 : 360 + 18;
      return [
        `<path stroke="#ffbf00" stroke-width="5" stroke-dasharray="12 10" d="M${left} ${observedY}h360"/>`,
        `<path stroke="#ffbf00" stroke-width="5" fill="none" marker-end="url(#arrow)" d="M${centerX} ${arrowStart}V${arrowEnd}"/>`,
      ].join("");
    }).join("");
  const reportedSeamSectors = assessment.sectors
    .filter((item) => hasAffirmativeSeamArtifactEvidence(item.evidence))
    .map((item) => item.sector);
  const seamSectors = assessment.collageOrSeams || hasSeamArtifactEvidence(assessment)
    ? (reportedSeamSectors.length ? reportedSeamSectors : [0, 1, 2, 3])
    : [];
  const seamMarks = seamSectors.map((sector) =>
    `<rect x="${sector * 360 + 6}" y="6" width="348" height="708" fill="#ff00d4" fill-opacity="0.08" stroke="#ff00d4" stroke-width="8"/><text x="${sector * 360 + 18}" y="36" fill="#ff00d4" font-size="22" font-family="sans-serif">REVIEW SECTOR ${sector}</text>`
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="720"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="8" refY="6" orient="auto"><path d="M1 1l7 5-7 5" fill="none" stroke="#ffbf00" stroke-width="2"/></marker></defs><path stroke="#ff2020" stroke-width="5" d="M0 360H1440"/>${markers}${seamMarks}</svg>`;
  return sharp(image).resize(1440, 720).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

export function createHorizonReviewer(apiKey: string, model = "gemini-3.8-flash"): HorizonReviewer {
  const client = new GoogleGenAI({ apiKey });
  return async (image) => {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [
        { text: "Assess this 2:1 equirectangular panorama, not a perspective photograph. For each of four equal-width longitude sectors (0 leftmost through 3 rightmost), estimate the representative far-distance visual horizon: the average y position of the distant sky-to-terrain boundary in that sector, normalized from 0 top to 1 bottom. In mountainous scenes, the distant mountain skyline is a valid horizon proxy. Do not use the top of an isolated foreground or local ridge, cliff, tree, or building as the horizon; local peaks may rise above the average horizon and are not a failure. If several far-distance skyline segments are visible, estimate their average vertical level rather than selecting the highest peak. Mark visible=true when that distant boundary can be reasonably estimated, even if terrain interrupts portions of it. Use visible=false and horizonY=null only when the far-distance boundary is genuinely too obscured or ambiguous to estimate. Do not assume that the horizon is centered because this is a panorama. Report calibrated confidence and representative sector coordinates. Flag camera roll/tilt, collage bands, discontinuities, horizontal smearing, overlaid blur bands, compositing artifacts, and visible text/grid/guide marks. If your sector evidence describes any such artifact, collageOrSeams MUST be true. Natural terrain changes and skyline variation are not seams. Return only the schema." },
        { inlineData: { mimeType: "image/png", data: image.toString("base64") } },
      ] }],
      config: {
        responseMimeType: "application/json", responseJsonSchema: z.toJSONSchema(horizonAssessmentSchema),
        temperature: 0, maxOutputTokens: 4096,
        httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
      },
    });
    if (!response.text) throw new Error("Horizon review returned no assessment");
    return horizonAssessmentSchema.parse(JSON.parse(response.text));
  };
}
