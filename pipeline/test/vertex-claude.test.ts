import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { VertexClaudeClient, readVertexClaudeConfig, vertexClaudeUrl } from "../src/vertex/claude.js";
import { articleAnalyzer, candidateEvaluator, textProvider } from "../src/cloud/text-provider.js";
import { VertexArticleAnalyzer, VertexArtDirectionProvider, VertexCandidateEvaluator } from "../src/vertex/editorial.js";
import { candidateSetSchema } from "../src/sources/schema.js";

const environment = {
  EDITORIAL_PROVIDER: "google-vertex-claude",
  VERTEX_PROJECT_ID: "sample-project",
  VERTEX_PROJECT_NUMBER: "123456789",
  VERTEX_WIF_POOL_ID: "editorial_pool",
  VERTEX_WIF_PROVIDER_ID: "aws_provider",
  VERTEX_SERVICE_ACCOUNT_EMAIL: "editorial@sample-project.iam.gserviceaccount.com",
  VERTEX_LOCATION: "us-east5",
  VERTEX_CLAUDE_MODEL: "claude-haiku-4-5",
} as NodeJS.ProcessEnv;

function clientReturning(value: unknown): VertexClaudeClient {
  return new VertexClaudeClient(readVertexClaudeConfig(environment), {
    auth: { getAccessToken: async () => "test-token" },
    fetcher: (async () => new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(value) }],
      usage: { input_tokens: 20, output_tokens: 10 },
    }), { status: 200 })) as typeof fetch,
  });
}

test("Vertex configuration is explicit and requires all WIF settings", () => {
  const config = readVertexClaudeConfig(environment);
  assert.equal(vertexClaudeUrl(config),
    "https://us-east5-aiplatform.googleapis.com/v1/projects/sample-project/locations/us-east5/publishers/anthropic/models/claude-haiku-4-5:rawPredict");
  assert.throws(() => readVertexClaudeConfig({ ...environment, VERTEX_WIF_POOL_ID: "" }), /poolId/);
  assert.throws(() => readVertexClaudeConfig({ ...environment, VERTEX_CLAUDE_MODEL: "gemini-3.8-flash" }), /model/);
  assert.equal(readVertexClaudeConfig({ ...environment, VERTEX_CLAUDE_MODEL: "claude-haiku-4-5@20251001" }).model,
    "claude-haiku-4-5@20251001");
  assert.equal(textProvider({}), "google-gemini");
});

test("Vertex request uses Google OAuth and does not enable prompt persistence", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = new VertexClaudeClient(readVertexClaudeConfig(environment), {
    auth: { getAccessToken: async () => "test-token" },
    fetcher: (async (url, init) => {
      requests.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "{\"ok\":true}" }],
        usage: { input_tokens: 12, output_tokens: 4 },
      }), { status: 200 });
    }) as typeof fetch,
  });
  const output = await client.completeJson("ephemeral input", 100, 0);
  assert.equal(output.text, '{"ok":true}');
  assert.equal(output.usage?.totalUnits, 16);
  assert.equal(requests.length, 1);
  assert.match(requests[0]!.url, /^https:\/\/us-east5-aiplatform\.googleapis\.com\//);
  const body = JSON.parse(String(requests[0]!.init.body));
  assert.equal(body.messages[0].content[0].text, "ephemeral input");
  assert.equal(body.anthropic_version, "vertex-2023-10-16");
  assert.equal(body.store, undefined);
  assert.equal(body.tools, undefined);
});

test("text provider never silently falls back to a different service", () => {
  assert.equal(candidateEvaluator(environment).provider, "google-vertex-claude");
  assert.equal(articleAnalyzer(environment).provider, "google-vertex-claude");
  assert.throws(() => candidateEvaluator({ ...environment, VERTEX_PROJECT_ID: "" }), /projectId/);
  assert.equal(candidateEvaluator({ EDITORIAL_PROVIDER: "aws-bedrock" }).provider, "aws-bedrock");
});

test("Vertex candidate evaluation checks complete coverage and records usage", async () => {
  const fixture = candidateSetSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
  )));
  const story = fixture.candidates[0];
  const assessment = {
    storyId: story.id,
    eventKey: "farm-trial",
    classification: { topic: "climate", geography: "global", organization: "Example" },
    eligibility: { eligible: true, reasons: [] },
    scores: { credibility: 0.9, constructiveSignificance: 0.8, publicRelevance: 0.7, novelty: 0.6, visualPotential: 0.8 },
    rationales: {
      credibility: "Source is attributable.", constructiveSignificance: "It addresses water use.",
      publicRelevance: "The result could be widely relevant.", novelty: "It is a new trial.",
      visualPotential: "The farm has clear physical subjects.",
    },
  };
  const result = await new VertexCandidateEvaluator(clientReturning({ assessments: [assessment] })).evaluate([story]);
  assert.equal(result.assessments[0].storyId, story.id);
  assert.equal(result.usage?.totalUnits, 30);
  await assert.rejects(new VertexCandidateEvaluator(clientReturning({ assessments: [] })).evaluate([story]), /invalid structured assessments after 2 attempts/);
});

test("Vertex article analysis validates claims and detail shape", async () => {
  const fixture = candidateSetSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
  )));
  const story = fixture.candidates[0];
  const result = await new VertexArticleAnalyzer(clientReturning({
    headline: "Farm trial reduces water use",
    summary: "A field trial reported lower water use.",
    claims: [{ claim: "The trial saved water.", evidence: "The trial saved water." }],
    details: [{ detail: "A red barn", evidence: "A red barn", kind: "object", confidence: 0.9 }],
  })).analyze({ story, articleText: "The trial saved water. A red barn stands nearby." });
  assert.equal(result.claims[0].claim, "The trial saved water.");
  assert.equal(result.usage?.requestCount, 1);
  await assert.rejects(new VertexArticleAnalyzer(clientReturning({ claims: [], details: [{ kind: "invalid" }] }))
    .analyze({ story, articleText: "The trial saved water." }));
});

test("Vertex art direction validates a structured proposal", async () => {
  const story = {
    storyId: "a".repeat(64), role: "anchor" as const, title: "Farm trial reduces water use",
    summary: "A field trial reported lower water use.", topic: "climate", groundedDetails: ["A red barn"],
  };
  const world = {
    title: "A Garden of Practical Discoveries", concept: "A research garden.",
    setting: "A terraced coastal garden.", timeOfDay: "Morning light.",
    atmosphere: "Calm and curious.", palette: ["green", "amber", "cyan"],
    navigation: "A looping path links landmarks.",
  };
  const subject = {
    storyId: story.storyId, subject: "A sculptural red barn", placement: "Along the path",
    scale: "Large landmark", materials: ["wood"], visualCues: ["clear silhouette"],
    groundedDetailIndexes: [0], artisticInterpretation: "The garden is an artistic device.",
  };
  const result = await new VertexArtDirectionProvider(clientReturning({ world, subjects: [subject] })).propose([story]);
  assert.equal(result.proposal.subjects[0].storyId, story.storyId);
  assert.equal(result.usage?.totalUnits, 30);
  await assert.rejects(new VertexArtDirectionProvider(clientReturning({ world, subjects: [{ ...subject, materials: [] }] }))
    .propose([story]));
});
