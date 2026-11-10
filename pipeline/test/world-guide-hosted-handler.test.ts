import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorldGuideContext } from "../src/world-guide/contracts.js";
import {
  createHostedWorldGuideHandler,
  type HostedWorldGuideLease,
} from "../src/world-guide/hosted-handler.js";

const origin = "https://explore.example.test";
const context: WorldGuideContext = {
  editionId: "edition-today",
  editionDate: "November 4, 2026",
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

function createHarness() {
  let enabled = true;
  let allowanceAvailable = true;
  const leases = new Map<string, HostedWorldGuideLease>();
  const handler = createHostedWorldGuideHandler({
    allowedOrigin: origin,
    dailySessionLimit: 25,
    perIpDailySessionLimit: 5,
    dailyResearchLimit: 20,
  }, {
    async isEnabled() { return enabled; },
    async isResearchEnabled() { return false; },
    async dailyAllowanceAvailable() { return allowanceAvailable; },
    async createLease(lease) {
      if (!allowanceAvailable) return "daily_limit_reached";
      leases.set(lease.sessionId, lease); return true;
    },
    async findLease(id) { return leases.get(id) ?? null; },
    async reserveResearch(id) { return leases.get(id) ?? null; },
    async deleteLease(id) { leases.delete(id); },
    async getConversationToken() { return "short-lived-test-token"; },
    now: () => Date.UTC(2026, 10, 4),
  });
  return {
    handler,
    setEnabled(value: boolean) { enabled = value; },
    exhaustAllowance() { allowanceAvailable = false; },
    leases,
  };
}

function event(path: string, httpMethod: string, body?: unknown, sourceIp = "203.0.113.5") {
  return {
    path,
    httpMethod,
    headers: { Origin: origin },
    requestContext: { identity: { sourceIp } },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

test("hosted status fails closed and publishes no provider details", async () => {
  const harness = createHarness();
  harness.setEnabled(false);
  const result = await harness.handler({ ...event("/prod/status", "GET"), resource: "/status" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { enabled: false, researchEnabled: false, dailyLimitReached: false });
  assert.equal(result.headers["Cache-Control"], "no-store");
});

test("daily allowance exhaustion blocks new tokens but permits existing lease cleanup", async () => {
  const harness = createHarness();
  const created = await harness.handler(event("/session", "POST", { context }));
  const { sessionId } = JSON.parse(created.body);
  harness.exhaustAllowance();
  const status = JSON.parse((await harness.handler(event("/status", "GET"))).body);
  assert.equal(status.enabled, true); // Do not terminate already-reserved conversations.
  assert.equal(status.dailyLimitReached, true);
  const denied = await harness.handler(event("/session", "POST", { context }));
  assert.equal(denied.statusCode, 429);
  assert.equal(JSON.parse(denied.body).error, "daily_limit_reached");
  assert.equal(harness.leases.size, 1);
  assert.equal((await harness.handler(event("/session/end", "POST", { sessionId }))).statusCode, 200);
});

test("hosted sessions issue only a short-lived token and persist bounded context", async () => {
  const harness = createHarness();
  const result = await harness.handler(event("/session", "POST", { context }));
  assert.equal(result.statusCode, 200);
  const response = JSON.parse(result.body) as Record<string, unknown>;
  assert.equal(response.conversationToken, "short-lived-test-token");
  assert.equal(response.leaseExpiresInSeconds, 900);
  assert.equal(typeof response.sessionId, "string");
  assert.equal("apiKey" in response, false);
  const stored = harness.leases.get(response.sessionId as string);
  assert.deepEqual(stored?.context, context);
});

test("origin checks are exact and invalid contexts never reach token issuance", async () => {
  const harness = createHarness();
  const denied = await harness.handler({
    ...event("/session", "POST", { context }),
    headers: { Origin: "https://evil.example.test" },
  });
  assert.equal(denied.statusCode, 403);
  const invalid = await harness.handler(event("/session", "POST", { context: { ...context, selectedStoryId: "unknown" } }));
  assert.equal(invalid.statusCode, 400);
  const extraField = await harness.handler(event("/session", "POST", { context, unrecognized: true }));
  assert.equal(extraField.statusCode, 400);
  const invalidLeaseId = await harness.handler(event("/session/end", "POST", { sessionId: "not-a-uuid" }));
  assert.equal(invalidLeaseId.statusCode, 400);
  assert.equal(harness.leases.size, 0);
});

test("the disable switch rejects new sessions but still permits lease cleanup", async () => {
  const harness = createHarness();
  const created = await harness.handler(event("/session", "POST", { context }));
  const sessionId = (JSON.parse(created.body) as { sessionId: string }).sessionId;
  harness.setEnabled(false);
  const denied = await harness.handler(event("/session", "POST", { context }));
  assert.equal(denied.statusCode, 503);
  const ended = await harness.handler(event("/session/end", "POST", { sessionId }));
  assert.equal(ended.statusCode, 200);
  assert.equal(harness.leases.has(sessionId), false);
});
