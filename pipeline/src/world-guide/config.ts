import { z } from "zod";

const envSchema = z.object({
  WORLD_GUIDE_ENABLED: z.enum(["true", "false"]).default("false"),
  WORLD_GUIDE_RESEARCH_ENABLED: z.enum(["true", "false"]).default("false"),
  WORLD_GUIDE_RESEARCH_CONFIRMED: z.enum(["true", "false"]).default("false"),
  GOOGLE_AI_API_KEY: z.string().optional(),
  WORLD_GUIDE_RESEARCH_MODEL: z.string().default("gemini-3.8-flash"),
  WORLD_GUIDE_ALLOWED_ORIGIN: z.string().url().default("http://localhost:3000"),
  WORLD_GUIDE_PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  WORLD_GUIDE_AGENT_DIRECT_ACCESS_CONFIRMED: z.enum(["true", "false"]).default("false"),
  WORLD_GUIDE_AGENT_DURATION_CONFIRMED: z.enum(["true", "false"]).default("false"),
  WORLD_GUIDE_PRIVACY_CONFIRMED: z.enum(["true", "false"]).default("false"),
});

export type WorldGuideConfig = {
  enabled: boolean;
  researchEnabled: boolean;
  researchConfirmed: boolean;
  googleAiApiKey?: string;
  researchModel: string;
  allowedOrigin: string;
  port: number;
  agentDirectAccessConfirmed: boolean;
  agentDurationConfirmed: boolean;
  privacyConfirmed: boolean;
};

export function parseWorldGuideConfig(environment: NodeJS.ProcessEnv = process.env): WorldGuideConfig {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid World Guide configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  const values = parsed.data;
  const allowedOrigin = new URL(values.WORLD_GUIDE_ALLOWED_ORIGIN);
  if (!["http:", "https:"].includes(allowedOrigin.protocol)) {
    throw new Error("WORLD_GUIDE_ALLOWED_ORIGIN must use HTTP or HTTPS");
  }
  const config: WorldGuideConfig = {
    enabled: values.WORLD_GUIDE_ENABLED === "true",
    researchEnabled: values.WORLD_GUIDE_RESEARCH_ENABLED === "true",
    researchConfirmed: values.WORLD_GUIDE_RESEARCH_CONFIRMED === "true",
    ...(values.GOOGLE_AI_API_KEY?.trim() ? { googleAiApiKey: values.GOOGLE_AI_API_KEY.trim() } : {}),
    researchModel: values.WORLD_GUIDE_RESEARCH_MODEL.trim(),
    allowedOrigin: allowedOrigin.origin,
    port: values.WORLD_GUIDE_PORT,
    agentDirectAccessConfirmed: values.WORLD_GUIDE_AGENT_DIRECT_ACCESS_CONFIRMED === "true",
    agentDurationConfirmed: values.WORLD_GUIDE_AGENT_DURATION_CONFIRMED === "true",
    privacyConfirmed: values.WORLD_GUIDE_PRIVACY_CONFIRMED === "true",
  };

  if (!/^gemini-[a-z0-9.-]+$/.test(config.researchModel)) {
    throw new Error("WORLD_GUIDE_RESEARCH_MODEL must be a Gemini model ID");
  }
  if (config.researchEnabled) {
    const missing = [
      !config.enabled && "WORLD_GUIDE_ENABLED=true",
      !config.googleAiApiKey && "GOOGLE_AI_API_KEY",
      !config.researchConfirmed && "WORLD_GUIDE_RESEARCH_CONFIRMED=true",
    ].filter(Boolean);
    if (missing.length) throw new Error(`World Guide research is enabled but missing required configuration: ${missing.join(", ")}`);
  }

  if (config.enabled) {
    const missing = [
      !config.agentDirectAccessConfirmed && "WORLD_GUIDE_AGENT_DIRECT_ACCESS_CONFIRMED",
      !config.agentDurationConfirmed && "WORLD_GUIDE_AGENT_DURATION_CONFIRMED",
      !config.privacyConfirmed && "WORLD_GUIDE_PRIVACY_CONFIRMED",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(`World Guide is enabled but missing required configuration: ${missing.join(", ")}`);
    }
  }

  return config;
}
