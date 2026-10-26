import { z } from "zod";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { PanoramaGenerator } from "./generator.js";
import { sha256 } from "./hash.js";
import { buildPoleRepairPrompt, POLE_REPAIR_VERSION } from "./poles.js";

const receiptSchema = z.object({
  version: z.literal(POLE_REPAIR_VERSION),
  model: z.string(), inputSha256: z.string(), promptSha256: z.string(),
  responseSha256: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  elapsedMs: z.number().nonnegative(), usage: z.unknown(),
});

/** Checkpoint the second paid call independently of panorama generation and processing. */
export function createPoleRepair({ artifacts, claims, generator, editionId, model, scenePrompt }: {
  artifacts: ArtifactStore; claims: { claimOnce(key: string, bytes: Uint8Array): Promise<boolean> }; generator: PanoramaGenerator;
  editionId: string; model: string; scenePrompt: string;
}) {
  const root = `editions/${editionId}/panorama/pole-repair`;
  const prompt = buildPoleRepairPrompt(scenePrompt);
  return async (sheet: Buffer): Promise<Buffer> => {
    const inputs = { version: POLE_REPAIR_VERSION, model, inputSha256: sha256(sheet), promptSha256: sha256(prompt) };
    const saved = await artifacts.read(`${root}/receipt.json`);
    if (saved) {
      const receipt = receiptSchema.parse(JSON.parse(Buffer.from(saved).toString("utf8")));
      for (const key of ["version", "model", "inputSha256", "promptSha256"] as const) {
        if (receipt[key] !== inputs[key]) throw new Error("Saved pole repair does not match current inputs");
      }
      const response = await artifacts.read(`${root}/response`);
      if (!response || sha256(Buffer.from(response)) !== receipt.responseSha256) throw new Error("Saved pole repair is missing or changed");
      return Buffer.from(response);
    }
    await artifacts.putImmutable({ key: `${root}/input.png`, contentType: "image/png", bytes: sheet });
    if (!await claims.claimOnce(`${root}/attempt.json`, Buffer.from(JSON.stringify(inputs)))) {
      throw new Error("A paid pole-repair attempt already exists; inspect it before retrying");
    }
    const result = await generator.generate(prompt, { bytes: sheet, mimeType: "image/png" });
    if (!result.bytes.length || result.bytes.length > 64 * 1024 * 1024) throw new Error("Pole repair returned an empty or oversized image");
    const receipt = receiptSchema.parse({ ...inputs, responseSha256: sha256(result.bytes), mimeType: result.mimeType, elapsedMs: result.elapsedMs, usage: result.usage });
    await artifacts.putImmutable({ key: `${root}/response`, contentType: receipt.mimeType, bytes: result.bytes });
    await artifacts.putImmutable({ key: `${root}/receipt.json`, contentType: "application/json", bytes: Buffer.from(JSON.stringify(receipt, null, 2)) });
    return result.bytes;
  };
}
