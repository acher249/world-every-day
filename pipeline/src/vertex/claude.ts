import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { providerUsageSchema, type ProviderUsage } from "../provider-usage.js";

const configurationSchema = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),
  projectNumber: z.string().regex(/^\d+$/),
  poolId: z.string().regex(/^[a-z][a-z0-9_-]{3,31}$/),
  providerId: z.string().regex(/^[a-z][a-z0-9_-]{3,31}$/),
  serviceAccountEmail: z.string().regex(/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/),
  location: z.string().regex(/^[a-z]+-[a-z]+\d$/),
  model: z.string().regex(/^claude-[a-z0-9-]+(?:@\d{8})?$/),
});

export type VertexClaudeConfig = z.infer<typeof configurationSchema>;
type Completion = { text: string; usage?: ProviderUsage };

export function readVertexClaudeConfig(environment: NodeJS.ProcessEnv = process.env): VertexClaudeConfig {
  return configurationSchema.parse({
    projectId: environment.VERTEX_PROJECT_ID,
    projectNumber: environment.VERTEX_PROJECT_NUMBER,
    poolId: environment.VERTEX_WIF_POOL_ID,
    providerId: environment.VERTEX_WIF_PROVIDER_ID,
    serviceAccountEmail: environment.VERTEX_SERVICE_ACCOUNT_EMAIL,
    location: environment.VERTEX_LOCATION,
    model: environment.VERTEX_CLAUDE_MODEL,
  });
}

export function vertexClaudeUrl(config: VertexClaudeConfig): string {
  const parsed = configurationSchema.parse(config);
  return `https://${parsed.location}-aiplatform.googleapis.com/v1/projects/${parsed.projectId}/locations/${parsed.location}/publishers/anthropic/models/${parsed.model}:rawPredict`;
}

function federatedGoogleAuth(config: VertexClaudeConfig): GoogleAuth {
  const audience = `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
  return new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    credentials: {
      type: "external_account",
      audience,
      subject_token_type: "urn:ietf:params:aws:token-type:aws4_request",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
      credential_source: {
        environment_id: "aws1",
        regional_cred_verification_url: "https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15",
      },
    },
  });
}

export class VertexClaudeClient {
  readonly config: VertexClaudeConfig;
  readonly model: string;
  readonly #auth: Pick<GoogleAuth, "getAccessToken">;
  readonly #fetch: typeof fetch;

  constructor(config: VertexClaudeConfig, options: {
    auth?: Pick<GoogleAuth, "getAccessToken">;
    fetcher?: typeof fetch;
  } = {}) {
    this.config = configurationSchema.parse(config);
    this.model = this.config.model;
    this.#auth = options.auth ?? federatedGoogleAuth(this.config);
    this.#fetch = options.fetcher ?? fetch;
  }

  async completeJson(prompt: string, maxTokens: number, temperature: number): Promise<Completion> {
    const token = await this.#auth.getAccessToken();
    if (!token) throw new Error("Vertex workload identity did not return an access token");
    const response = await this.#fetch(vertexClaudeUrl(this.config), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        anthropic_version: "vertex-2023-10-16",
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`Vertex Claude request failed (${response.status}); check model access, WIF and region`);
    }
    const payload = z.object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
      usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
    }).parse(await response.json());
    const text = payload.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
    if (!text) throw new Error("Vertex Claude returned no text response");
    return {
      text,
      usage: providerUsageSchema.parse({
        requestCount: 1,
        unit: "tokens",
        inputUnits: payload.usage?.input_tokens,
        outputUnits: payload.usage?.output_tokens,
        totalUnits: payload.usage ? payload.usage.input_tokens + payload.usage.output_tokens : undefined,
        providerReported: payload.usage !== undefined,
      }),
    };
  }
}
