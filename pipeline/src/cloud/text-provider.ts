import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import { BedrockArtDirectionProvider } from "../art-direction/bedrock.js";
import type { ArtDirectionProvider } from "../art-direction/generate.js";
import { BedrockCandidateEvaluator } from "../editorial/bedrock-evaluator.js";
import type { CandidateEvaluator } from "../editorial/evaluate.js";
import { DEFAULT_GEMINI_EDITORIAL_MODEL, GeminiJsonClient } from "../gemini/client.js";
import { GeminiArticleAnalyzer, GeminiArtDirectionProvider, GeminiCandidateEvaluator } from "../gemini/editorial.js";
import { BedrockArticleAnalyzer } from "../sources/bedrock-article-analysis.js";
import type { ArticleAnalyzer } from "../sources/article.js";
import { parseGoogleKey } from "./google-secret.js";

export type TextProvider = "aws-bedrock" | "google-gemini";

export function textProvider(environment: NodeJS.ProcessEnv = process.env): TextProvider {
  return z.enum(["aws-bedrock", "google-gemini"])
    .parse(environment.EDITORIAL_PROVIDER ?? "google-gemini");
}

function geminiClient(environment: NodeJS.ProcessEnv): GeminiJsonClient {
  return new GeminiJsonClient({
    apiKey: environment.GOOGLE_AI_API_KEY ?? "",
    model: environment.GEMINI_EDITORIAL_MODEL?.trim() || DEFAULT_GEMINI_EDITORIAL_MODEL,
  });
}

export async function cloudTextEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  secrets: Pick<SecretsManagerClient, "send"> = new SecretsManagerClient({}),
): Promise<NodeJS.ProcessEnv> {
  if (textProvider(environment) !== "google-gemini") return environment;
  const secretId = environment.GOOGLE_SECRET_NAME?.trim();
  if (!secretId) throw new Error("GOOGLE_SECRET_NAME is required for Gemini editorial analysis");
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!secret.SecretString) throw new Error("Google secret must contain a string value");
  return { ...environment, GOOGLE_AI_API_KEY: parseGoogleKey(secret.SecretString) };
}

export function candidateEvaluator(environment: NodeJS.ProcessEnv = process.env): CandidateEvaluator {
  const provider = textProvider(environment);
  if (provider === "google-gemini") return new GeminiCandidateEvaluator(geminiClient(environment));
  return new BedrockCandidateEvaluator({ model: environment.EDITORIAL_MODEL });
}

export function articleAnalyzer(environment: NodeJS.ProcessEnv = process.env): ArticleAnalyzer {
  const provider = textProvider(environment);
  if (provider === "google-gemini") return new GeminiArticleAnalyzer(geminiClient(environment));
  return new BedrockArticleAnalyzer({ model: environment.ARTICLE_ANALYSIS_MODEL });
}

export function artDirectionProvider(environment: NodeJS.ProcessEnv = process.env): ArtDirectionProvider {
  const provider = textProvider(environment);
  if (provider === "google-gemini") return new GeminiArtDirectionProvider(geminiClient(environment));
  return new BedrockArtDirectionProvider({ model: environment.ART_DIRECTION_MODEL });
}
