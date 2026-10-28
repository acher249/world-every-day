import type { ArtDirection } from "../art-direction/schema.js";
import type { LandmarkDetectionResponse } from "./schema.js";

export type LandmarkDetectionInput = {
  imageBytes: Buffer;
  mimeType: string;
  artDirection: ArtDirection;
  retryInstructions?: string;
};

export interface LandmarkDetector {
  readonly id: string;
  readonly model: string;
  detect(input: LandmarkDetectionInput): Promise<LandmarkDetectionResponse>;
}
