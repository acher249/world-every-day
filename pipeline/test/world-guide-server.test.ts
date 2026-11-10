import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { test } from "node:test";
import { parseWorldGuideConfig, type WorldGuideConfig } from "../src/world-guide/config.js";
import type { WorldGuideContext, WorldGuideResearchResult } from "../src/world-guide/contracts.js";
import type { WorldGuideResearchService } from "../src/world-guide/research.js";
import { createWorldGuideServer } from "../src/world-guide/server.js";

const origin = "http://localhost:3000";
const context: WorldGuideContext = {
  editionId: "edition-today",
  editionDate: "November 1, 2026",
  stories: [{
    id: "new-battery",
    title: "A new battery design",
    summary: "Researchers report a battery design that can store more energy.",
    representation: "A blue storage vessel",
    sources: [{
      title: "Battery research update",
      publisher: "Permitted Publisher",
      url: "https://news.example.test/battery-research",
      kind: "reporting",
    }],
  }],
  selectedStoryId: null,
};
const configured: WorldGuideConfig = {
  enabled: true,
  researchEnabled: false,
  researchConfirmed: false,
  researchModel: "gemini-3.8-flash",
  allowedOrigin: origin,
  port: 8787,
  agentDirectAccessConfirmed: true,
  agentDurationConfirmed: true,
  privacyConfirmed: true,
};

async function startServer(
  config = configured,
  now: () => number = Date.now,
  options: { research?: WorldGuideResearchService } = {},
): Promise<{ server: Server; baseUrl: string }> {
  const server = createWorldGuideServer(config, now, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function headers(requestOrigin: string | null = origin): HeadersInit {
  return {
    ...(requestOrigin ? { Origin: requestOrigin } : {}),
  };
}

test("World Guide config is disabled by default and fails closed when enabled incompletely", () => {
  assert.equal(parseWorldGuideConfig({}).enabled, false);
  assert.throws(() => parseWorldGuideConfig({ WORLD_GUIDE_ENABLED: "true" }), /missing required configuration/);
  assert.throws(() => parseWorldGuideConfig({
    WORLD_GUIDE_ENABLED: "true",
    WORLD_GUIDE_AGENT_DURATION_CONFIRMED: "true",
    WORLD_GUIDE_PRIVACY_CONFIRMED: "true",
  }), /WORLD_GUIDE_AGENT_DIRECT_ACCESS_CONFIRMED/);
  const directAgent = parseWorldGuideConfig({
    WORLD_GUIDE_ENABLED: "true",
    WORLD_GUIDE_AGENT_DIRECT_ACCESS_CONFIRMED: "true",
    WORLD_GUIDE_AGENT_DURATION_CONFIRMED: "true",
    WORLD_GUIDE_PRIVACY_CONFIRMED: "true",
  });
  assert.equal(directAgent.enabled, true);
  assert.equal("elevenLabsApiKey" in directAgent, false);
  assert.equal("elevenLabsAgentId" in directAgent, false);
  assert.throws(() => parseWorldGuideConfig({
    WORLD_GUIDE_ENABLED: "true",
    WORLD_GUIDE_AGENT_DIRECT_ACCESS_CONFIRMED: "true",
    WORLD_GUIDE_AGENT_DURATION_CONFIRMED: "true",
  }), /WORLD_GUIDE_PRIVACY_CONFIRMED/);
  assert.throws(() => parseWorldGuideConfig({
    WORLD_GUIDE_ENABLED: "true",
    WORLD_GUIDE_RESEARCH_ENABLED: "true",
    WORLD_GUIDE_AGENT_DIRECT_ACCESS_CONFIRMED: "true",
    WORLD_GUIDE_AGENT_DURATION_CONFIRMED: "true",
    WORLD_GUIDE_PRIVACY_CONFIRMED: "true",
  }), /GOOGLE_AI_API_KEY.*WORLD_GUIDE_RESEARCH_CONFIRMED/);
  assert.throws(() => parseWorldGuideConfig({
    WORLD_GUIDE_ALLOWED_ORIGIN: "ftp://localhost:3000",
  }), /must use HTTP or HTTPS/);
});

test("health exposes only enabled/disabled state and disabled mode rejects sessions", async () => {
  const disabled = { ...configured, enabled: false };
  const { server, baseUrl } = await startServer(disabled);
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.deepEqual(await health.json(), { status: "disabled" });
    const response = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
    assert.equal(response.status, 503);
  } finally {
    await closeServer(server);
  }
});

test("session creation rejects duplicate story IDs and mismatched selected-story context", async () => {
  const { server, baseUrl } = await startServer(configured);
  try {
    for (const invalidContext of [
      { ...context, stories: [...context.stories, context.stories[0]!] },
      { ...context, selectedStoryId: "missing-story" },
    ]) {
      const response = await fetch(`${baseUrl}/session`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ context: invalidContext }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_world_context" });
    }
  } finally {
    await closeServer(server);
  }
});

test("local leases require the approved browser origin without a UI token", async () => {
  const { server, baseUrl } = await startServer(configured);
  try {
    const deniedOrigin = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: headers("http://attacker.example"),
    });
    assert.equal(deniedOrigin.status, 403);

    const missingOrigin = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: headers(null),
    });
    assert.equal(missingOrigin.status, 403);
  } finally {
    await closeServer(server);
  }
});

test("returns a short-lived local lease and allows explicit session end", async () => {
  const { server, baseUrl } = await startServer(configured);
  try {
    const response = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
    assert.equal(response.status, 200);
    const result = await response.json() as {
      sessionId: string;
      localLeaseExpiresInSeconds: number;
    };
    assert.equal(result.localLeaseExpiresInSeconds, 180);
    assert.equal("signedUrl" in result, false);

    const end = await fetch(`${baseUrl}/session/end`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: result.sessionId }),
    });
    assert.deepEqual(await end.json(), { ended: true });
  } finally {
    await closeServer(server);
  }
});

test("limits concurrent sessions and expires stale leases", async () => {
  let now = 1000;
  const { server, baseUrl } = await startServer(configured, () => now);
  try {
    const first = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
    const firstResult = await first.json() as { sessionId: string };
    const blocked = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
    assert.equal(blocked.status, 429);

    now += 16 * 60 * 1000;
    const second = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
    assert.equal(second.status, 200);
    const endedExpired = await fetch(`${baseUrl}/session/end`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: firstResult.sessionId }),
    });
    assert.equal(endedExpired.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("limits session requests to five per minute", async () => {
  let now = 1000;
  const { server, baseUrl } = await startServer(configured, () => now);
  try {
    for (let i = 0; i < 5; i += 1) {
      const response = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
      assert.equal(response.status, 200);
      const result = await response.json() as { sessionId: string };
      const ended = await fetch(`${baseUrl}/session/end`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      assert.equal(ended.status, 200);
    }
    const limited = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "rate_limited" });

    now += 61 * 1000;
    const afterWindow = await fetch(`${baseUrl}/session`, { method: "POST", headers: headers() });
    assert.equal(afterWindow.status, 200);
  } finally {
    await closeServer(server);
  }
});

test("research stays bound to the authenticated session's edition and story IDs", async () => {
  let researchCalls = 0;
  const researchResult: WorldGuideResearchResult = {
    answer: "The report describes increased storage capacity.",
    retrievedAt: new Date().toISOString(),
    citations: [{
      storyId: "new-battery",
      title: "Battery research update",
      publisher: "Permitted Publisher",
      url: "https://news.example.test/battery-research",
    }],
  };
  const research: WorldGuideResearchService = {
    async research(input, activeContext) {
      researchCalls += 1;
      assert.equal(input.editionId, activeContext.editionId);
      assert.deepEqual(input.storyIds, ["new-battery"]);
      return researchResult;
    },
  };
  const researchConfig = {
    ...configured,
    researchEnabled: true,
    researchConfirmed: true,
    googleAiApiKey: "test-google-key",
  };
  const { server, baseUrl } = await startServer(researchConfig, Date.now, { research });
  try {
    const sessionResponse = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });
    const session = await sessionResponse.json() as { sessionId: string };
    assert.equal(sessionResponse.status, 200);

    const stale = await fetch(`${baseUrl}/research`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        editionId: "old-edition",
        storyIds: ["new-battery"],
        question: "What did the report say?",
      }),
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: "stale_edition" });

    const invented = await fetch(`${baseUrl}/research`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        editionId: context.editionId,
        storyIds: ["invented-story"],
        question: "What did the report say?",
      }),
    });
    assert.equal(invented.status, 404);
    assert.deepEqual(await invented.json(), { error: "unknown_story" });

    const accepted = await fetch(`${baseUrl}/research`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        editionId: context.editionId,
        storyIds: ["new-battery"],
        question: "What did the report say?",
      }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual((await accepted.json() as { result: unknown }).result, researchResult);
    assert.equal(researchCalls, 1);
  } finally {
    await closeServer(server);
  }
});

test("research route remains disabled without an injected provider", async () => {
  const { server, baseUrl } = await startServer(configured);
  try {
    const sessionResponse = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });
    const session = await sessionResponse.json() as { sessionId: string };
    const response = await fetch(`${baseUrl}/research`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        editionId: context.editionId,
        storyIds: ["new-battery"],
        question: "What did the report say?",
      }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "research_disabled" });
  } finally {
    await closeServer(server);
  }
});
