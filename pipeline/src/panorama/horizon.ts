import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { z } from "zod";
import type { ImageReference } from "./generator.js";

export const HORIZON_POLICY_VERSION = "horizon-v1";
export const MAX_PANORAMA_CANDIDATES = 5;
export const horizonAssessmentSchema = z.object({
  sectors: z.array(z.object({
    sector: z.number().int().min(0).max(3),
    visible: z.boolean(),
    horizonY: z.number().min(0).max(1).nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(500),
  }).strict()).length(4).refine((items) => new Set(items.map((item) => item.sector)).size === 4, "Each quadrant must be assessed once"),
  tilted: z.boolean(),
  collageOrSeams: z.boolean(),
  textOrGuides: z.boolean(),
}).strict();
export type HorizonAssessment = z.infer<typeof horizonAssessmentSchema>;
export type HorizonReviewer = (image: Buffer) => Promise<HorizonAssessment>;

export function horizonPasses(input: HorizonAssessment): boolean {
  const assessment = horizonAssessmentSchema.parse(input);
  const visible = assessment.sectors.filter((sector) => sector.visible);
  return !assessment.tilted && !assessment.collageOrSeams && !assessment.textOrGuides && visible.length >= 2 &&
    visible.every((sector) => sector.horizonY !== null && sector.confidence >= 0.8 && Math.abs(sector.horizonY - 0.5) <= 0.03) &&
    assessment.sectors.every((sector) => sector.visible || sector.horizonY === null);
}

/** Assess the exact centered crop, not the disposable overscan canvas. */
export async function horizonPreview(bytes: Buffer): Promise<Buffer> {
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || metadata.height < metadata.width / 2) throw new Error("Invalid panorama dimensions");
  const height = Math.floor(metadata.width / 2);
  return sharp(bytes).extract({ left: 0, top: Math.floor((metadata.height - height) / 2), width: metadata.width, height })
    .resize(1440, 720).png().toBuffer();
}

export async function geometryGuide(): Promise<ImageReference> {
  const lines = Array.from({ length: 13 }, (_, i) => `<path d="M${i * 120} 0V720"/>`).join("") +
    [120, 240, 480, 600].map((y) => `<path d="M0 ${y}H1440"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="720"><path fill="#b8d4e5" d="M0 0h1440v360H0z"/><path fill="#85765b" d="M0 360h1440v360H0z"/><g stroke="white" opacity=".55">${lines}</g><path stroke="red" stroke-width="4" d="M0 360H1440"/></svg>`;
  return { bytes: await sharp(Buffer.from(svg)).png().toBuffer(), mimeType: "image/png" };
}

export async function annotateHorizon(image: Buffer, assessment: HorizonAssessment): Promise<Buffer> {
  const markers = assessment.sectors.filter((item) => item.visible && item.horizonY !== null)
    .map((item) => `<path stroke="#ffbf00" stroke-width="4" d="M${item.sector * 360} ${item.horizonY! * 720}h360"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="720"><path stroke="red" stroke-width="4" d="M0 360H1440"/>${markers}</svg>`;
  return sharp(image).resize(1440, 720).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

export function createHorizonReviewer(apiKey: string, model = "gemini-3.8-flash"): HorizonReviewer {
  const client = new GoogleGenAI({ apiKey });
  return async (image) => {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [
        { text: "Assess this 2:1 equirectangular panorama, not a perspective photograph. For each of four equal-width longitude sectors (0 leftmost through 3 rightmost), locate the geometric distant level horizon, normalized y from 0 top to 1 bottom. An ocean horizon or distant level plain is evidence; nearby shorelines, mountain peaks, trees and buildings are NOT the geometric horizon. If obscured or ambiguous use visible=false, horizonY=null, and explain. Do not assume that the horizon is centered because this is a panorama. Report actual observed coordinates and calibrated confidence. Flag tilt, collage bands/discontinuous seams and visible text/grid/guide marks. Natural terrain changes are not seams. Return only the schema." },
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
