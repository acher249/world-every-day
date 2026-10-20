import { JsonArticleAnalyzer, JsonArtDirectionProvider, JsonCandidateEvaluator } from "../editorial/json-model.js";
import { VertexClaudeClient } from "./claude.js";

export class VertexCandidateEvaluator extends JsonCandidateEvaluator {
  constructor(client: VertexClaudeClient) { super("google-vertex-claude", client); }
}

export class VertexArticleAnalyzer extends JsonArticleAnalyzer {
  constructor(client: VertexClaudeClient) { super("google-vertex-claude", client); }
}

export class VertexArtDirectionProvider extends JsonArtDirectionProvider {
  constructor(client: VertexClaudeClient) { super("google-vertex-claude", client); }
}
