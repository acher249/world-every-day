import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { BedrockArticleAnalyzer } from "../src/sources/bedrock-article-analysis.js";
import { candidateSetSchema } from "../src/sources/schema.js";

test("article analysis uses only an Amazon-operated Bedrock model", async () => {
  assert.throws(() => new BedrockArticleAnalyzer({ model: "anthropic.claude-v1" }), /Amazon-operated/);
  const fixture = candidateSetSchema.parse(JSON.parse(await readFile(
    new URL("../fixtures/candidate-set.v1.json", import.meta.url), "utf8",
  )));
  const story = fixture.candidates[0];
  let requestedModel = "";
  let requestedText = "";
  const client = {
    async send(command: ConverseCommand) {
      requestedModel = command.input.modelId ?? "";
      requestedText = command.input.messages?.[0]?.content?.[0]?.text ?? "";
      return {
        output: { message: { content: [{ text: JSON.stringify({
          headline: "Farm trial reduces water use",
          summary: "A farm trial reduced water use.",
          claims: [{ claim: "The trial saved water.", evidence: "The trial saved water." }],
          details: [{ detail: "A red barn", evidence: "A red barn", kind: "object", confidence: 0.9 }],
        }) }] } },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    },
  } as unknown as BedrockRuntimeClient;
  const result = await new BedrockArticleAnalyzer({ client }).analyze({
    story,
    articleText: "The trial saved water. A red barn stands nearby.",
  });
  assert.equal(requestedModel, "amazon.nova-lite-v1:0");
  assert.match(requestedText, /The trial saved water/);
  assert.equal(result.usage?.totalUnits, 150);
  assert.equal(result.claims[0].claim, "The trial saved water.");
});
