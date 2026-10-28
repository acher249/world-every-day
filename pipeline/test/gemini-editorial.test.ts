import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { cloudTextEnvironment, articleAnalyzer, candidateEvaluator, artDirectionProvider, textProvider } from "../src/cloud/text-provider.js";
import { GeminiJsonClient } from "../src/gemini/client.js";
import { GeminiArticleAnalyzer, GeminiArtDirectionProvider, GeminiCandidateEvaluator } from "../src/gemini/editorial.js";
import { candidateSetSchema } from "../src/sources/schema.js";

const environment = {
  EDITORIAL_PROVIDER: "google-gemini",
  GEMINI_EDITORIAL_MODEL: "gemini-3.8-flash",
  GOOGLE_AI_API_KEY: "test-key",
} as NodeJS.ProcessEnv;

test("editorial provider defaults to Gemini and rejects unsupported routes without fallback", async () => {
  assert.equal(textProvider({}), "google-gemini");
  assert.equal(textProvider({ EDITORIAL_PROVIDER: "aws-bedrock" }), "aws-bedrock");
  const invalid = { EDITORIAL_PROVIDER: "unsupported" };
  for (const factory of [candidateEvaluator, articleAnalyzer, artDirectionProvider]) {
    assert.throws(() => factory(invalid));
  }
  let secretReads = 0;
  const secrets = { send: async () => { secretReads += 1; return {}; } } as never;
  await assert.rejects(cloudTextEnvironment(invalid, secrets));
  const bedrock = { EDITORIAL_PROVIDER: "aws-bedrock" };
  assert.equal(await cloudTextEnvironment(bedrock, secrets), bedrock);
  assert.equal(secretReads, 0);
});

function clientReturning(value: unknown, requests?: unknown[]): GeminiJsonClient {
  return new GeminiJsonClient({ apiKey: "test-key", model: "gemini-3.8-flash" }, {
    client: {
      async generateContent(input: unknown) {
        requests?.push(input);
        return {
          text: JSON.stringify(value),
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
        };
      },
    } as unknown as Pick<GoogleGenAI["models"], "generateContent">,
  });
}

test("Gemini requires a server-only key and validates its model", () => {
  assert.equal(candidateEvaluator(environment).provider, "google-gemini");
  assert.equal(articleAnalyzer(environment).provider, "google-gemini");
  assert.equal(artDirectionProvider(environment).provider, "google-gemini");
  assert.throws(() => candidateEvaluator({ ...environment, GOOGLE_AI_API_KEY: "" }), /GOOGLE_AI_API_KEY/);
  assert.throws(() => candidateEvaluator({ ...environment, GEMINI_EDITORIAL_MODEL: "claude-haiku" }), /Gemini model ID/);
});

test("Gemini JSON requests use bounded output and do not enable tools or caching", async () => {
  const requests: unknown[] = [];
  const result = await clientReturning({ ok: true }, requests).completeJson("ephemeral input", 300, 0);
  assert.equal(result.text, '{"ok":true}');
  assert.equal(result.usage?.totalUnits, 30);
  assert.deepEqual(requests, [{
    model: "gemini-3.8-flash",
    contents: "ephemeral input",
    config: {
      maxOutputTokens: 300,
      temperature: 0,
      responseMimeType: "application/json",
      httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
    },
  }]);
});

test("Gemini maps provider 5xx responses to a retryable pipeline error", async () => {
  const client = new GeminiJsonClient({ apiKey: "test-key", model: "gemini-3.8-flash" }, {
    client: {
      async generateContent() { throw Object.assign(new Error("provider detail"), { status: 503 }); },
    } as unknown as Pick<GoogleGenAI["models"], "generateContent">,
  });
  await assert.rejects(client.completeJson("input", 100, 0), (error: unknown) =>
    error instanceof Error && error.name === "EditorialProviderTransientError" && !error.message.includes("provider detail"));
});

test("Gemini candidate evaluation supplies a structural response schema and validates exact coverage locally", async () => {
  const requests: unknown[] = [];
  const fixture = candidateSetSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
  )));
  await new GeminiCandidateEvaluator(clientReturning({ assessments: [
    {
      storyId: fixture.candidates[0]!.id,
      eventKey: "farm-trial",
      classification: { topic: "climate", geography: "global", organization: "Example" },
      eligibility: { eligible: true, reasons: [] },
      scores: { credibility: 0.9, constructiveSignificance: 0.8, publicRelevance: 0.7, novelty: 0.6, visualPotential: 0.8 },
      rationales: { credibility: "Clear source.", constructiveSignificance: "Useful progress.", publicRelevance: "Broad relevance.", novelty: "New result.", visualPotential: "Visible subject." },
    },
  ] }, requests)).evaluate([fixture.candidates[0]!]);
  const config = (requests[0] as { config: Record<string, unknown> }).config;
  const responseSchema = config.responseSchema as { properties: { assessments: { type: string; items: { required: string[]; properties: Record<string, unknown> } } } };
  assert.equal(responseSchema.properties.assessments.type, "array");
  assert.ok(responseSchema.properties.assessments.items.required.includes("storyId"));
  assert.equal("minItems" in responseSchema.properties.assessments, false);
  assert.equal("minimum" in (responseSchema.properties.assessments.items.properties.scores as object), false);
});

test("cloud editorial key is read from Secrets Manager only for Gemini", async () => {
  const secrets = { send: async () => ({ SecretString: '{"GOOGLE_AI_API_KEY":"test-key"}' }) } as never;
  const result = await cloudTextEnvironment({ EDITORIAL_PROVIDER: "google-gemini", GOOGLE_SECRET_NAME: "test-secret" }, secrets);
  assert.equal(result.GOOGLE_AI_API_KEY, "test-key");
  assert.equal((await cloudTextEnvironment({ EDITORIAL_PROVIDER: "aws-bedrock" }, secrets)).GOOGLE_AI_API_KEY, undefined);
  await assert.rejects(cloudTextEnvironment({ EDITORIAL_PROVIDER: "google-gemini" }, secrets), /GOOGLE_SECRET_NAME/);
});

test("Gemini editorial adapters validate assessments, article evidence and art direction", async () => {
  const fixture = candidateSetSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
  )));
  const story = fixture.candidates[0]!;
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
  const evaluated = await new GeminiCandidateEvaluator(clientReturning({ assessments: [assessment] })).evaluate([story]);
  assert.equal(evaluated.assessments[0]?.storyId, story.id);
  assert.equal(evaluated.usage?.totalUnits, 30);
  await assert.rejects(new GeminiCandidateEvaluator(clientReturning({ assessments: [] })).evaluate([story]), /invalid structured assessments after 3 attempts/);

  let attempts = 0;
  const recovered = await new GeminiCandidateEvaluator(new GeminiJsonClient({
    apiKey: "test-key", model: "gemini-3.8-flash",
  }, {
    client: {
      async generateContent() {
        attempts += 1;
        return {
          text: attempts === 1 ? '{"assessments":' : JSON.stringify({ assessments: [assessment] }),
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
        };
      },
    } as unknown as Pick<GoogleGenAI["models"], "generateContent">,
  })).evaluate([story]);
  assert.equal(attempts, 2);
  assert.equal(recovered.assessments[0]?.storyId, story.id);
  assert.equal(recovered.usage?.requestCount, 2);
  assert.equal(recovered.usage?.totalUnits, 60);

  const analyzed = await new GeminiArticleAnalyzer(clientReturning({
    headline: "Farm trial reduces water use",
    summary: "A field trial reported lower water use.",
    claims: [{ claim: "The trial saved water.", evidence: "The trial saved water." }],
    details: [{ detail: "A red barn", evidence: "A red barn", kind: "object", confidence: 0.9 }],
  })).analyze({ story, articleText: "The trial saved water. A red barn stands nearby." });
  assert.equal(analyzed.claims[0]?.claim, "The trial saved water.");

  const articleRequests: { config?: { maxOutputTokens?: number } }[] = [];
  let articleAttempts = 0;
  const retryingAnalyzer = new GeminiArticleAnalyzer(new GeminiJsonClient({
    apiKey: "test-key", model: "gemini-3.8-flash",
  }, {
    client: {
      async generateContent(input: { config?: { maxOutputTokens?: number } }) {
        articleRequests.push(input);
        articleAttempts += 1;
        return {
          text: JSON.stringify({
            headline: "Farm trial reduces water use",
            summary: "A field trial reported lower water use.",
            claims: [{ claim: "The trial saved water.", evidence: "The trial saved water." }],
            details: [{ detail: "A red barn", evidence: "A red barn", kind: "object", confidence: articleAttempts === 1 ? "high" : 0.9 }],
          }),
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
        };
      },
    } as unknown as Pick<GoogleGenAI["models"], "generateContent">,
  }));
  const retried = await retryingAnalyzer.analyze({ story, articleText: "The trial saved water. A red barn stands nearby." });
  assert.equal(articleAttempts, 2);
  assert.equal(articleRequests[1]?.config?.maxOutputTokens, 3600);
  assert.equal(retried.usage?.requestCount, 2);
  assert.equal(retried.usage?.totalUnits, 60);
  await assert.rejects(
    new GeminiArticleAnalyzer(clientReturning({ claims: [], details: [{ confidence: "high" }] })).analyze({ story, articleText: "A red barn stands nearby." }),
    /invalid structured evidence after 2 attempts/,
  );

  const subjectStory = {
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
    storyId: subjectStory.storyId, subject: "A sculptural red barn", placement: "Along the path",
    scale: "Large landmark", materials: ["wood"], visualCues: ["clear silhouette"],
    groundedDetailIndexes: [0], artisticInterpretation: "The garden is an artistic device.",
  };
  const direction = await new GeminiArtDirectionProvider(clientReturning({ world, subjects: [subject] })).propose([subjectStory]);
  assert.equal(direction.proposal.subjects[0]?.storyId, subjectStory.storyId);

  let directionAttempts = 0;
  const retryingDirection = new GeminiArtDirectionProvider(new GeminiJsonClient({
    apiKey: "test-key", model: "gemini-3.8-flash",
  }, {
    client: {
      async generateContent() {
        directionAttempts += 1;
        return {
          text: JSON.stringify({
            world,
            subjects: [{ ...subject, artisticInterpretation: directionAttempts === 1 ? "x".repeat(301) : "A garden is an artistic device." }],
          }),
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
        };
      },
    } as unknown as Pick<GoogleGenAI["models"], "generateContent">,
  }));
  const recoveredDirection = await retryingDirection.propose([subjectStory]);
  assert.equal(directionAttempts, 2);
  assert.equal(recoveredDirection.usage?.requestCount, 2);
  assert.equal(recoveredDirection.usage?.totalUnits, 60);
  await assert.rejects(
    new GeminiArtDirectionProvider(clientReturning({ world, subjects: [{ ...subject, artisticInterpretation: "x".repeat(301) }] })).propose([subjectStory]),
    /invalid structured proposal after 2 attempts/,
  );
});
