import { z } from "zod";

export const providerUsageSchema = z.object({
  requestCount: z.number().int().positive(),
  unit: z.literal("tokens"),
  inputUnits: z.number().int().nonnegative().optional(),
  outputUnits: z.number().int().nonnegative().optional(),
  totalUnits: z.number().int().nonnegative().optional(),
  providerReported: z.boolean(),
});

export type ProviderUsage = z.infer<typeof providerUsageSchema>;
