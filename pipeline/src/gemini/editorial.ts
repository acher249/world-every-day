import { JsonArticleAnalyzer, JsonArtDirectionProvider, JsonCandidateEvaluator } from "../editorial/json-model.js";
import { GeminiJsonClient } from "./client.js";

export class GeminiCandidateEvaluator extends JsonCandidateEvaluator {
  constructor(client: GeminiJsonClient) { super("google-gemini", client); }
}

export class GeminiArticleAnalyzer extends JsonArticleAnalyzer {
  constructor(client: GeminiJsonClient) { super("google-gemini", client); }
}

export class GeminiArtDirectionProvider extends JsonArtDirectionProvider {
  constructor(client: GeminiJsonClient) { super("google-gemini", client); }
}
