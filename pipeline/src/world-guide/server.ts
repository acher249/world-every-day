import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { worldGuideResearchInputSchema, worldGuideResearchResultSchema, worldGuideContextSchema, type WorldGuideContext } from "./contracts.js";
import type { WorldGuideResearchService } from "./research.js";
import type { WorldGuideConfig } from "./config.js";

const sessionTtlMs = 15 * 60 * 1000;
const requestWindowMs = 60 * 1000;
const maxRequestsPerWindow = 5;

type SessionLease = { expiresAt: number; context?: WorldGuideContext; researchCount: number };
type RequestWindow = { startedAt: number; count: number };
type WorldGuideServerOptions = { research?: WorldGuideResearchService };

function json(response: ServerResponse, status: number, body: Record<string, unknown>) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function addCors(response: ServerResponse, origin: string) {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
}

function currentOrigin(request: IncomingMessage): string | null {
  const origin = request.headers.origin;
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function pruneSessions(sessions: Map<string, SessionLease>, now: number) {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > maxBytes) throw new Error("Request body is too large");
  }
  return body.trim() ? JSON.parse(body) as unknown : {};
}

export function createWorldGuideServer(
  config: WorldGuideConfig,
  now: () => number = Date.now,
  options: WorldGuideServerOptions = {},
): Server {
  const sessions = new Map<string, SessionLease>();
  const windows = new Map<string, RequestWindow>();

  return createServer(async (request, response) => {
    const origin = currentOrigin(request);
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (path === "/health" && request.method === "GET") {
      return json(response, 200, { status: config.enabled ? "configured" : "disabled" });
    }

    if (path === "/status" && request.method === "GET") {
      if (!origin || origin !== config.allowedOrigin) return json(response, 403, { error: "origin_not_allowed" });
      addCors(response, config.allowedOrigin);
      return json(response, 200, { enabled: config.enabled, researchEnabled: config.enabled && config.researchEnabled });
    }

    if (request.method === "OPTIONS") {
      if (!origin || origin !== config.allowedOrigin) return json(response, 403, { error: "origin_not_allowed" });
      addCors(response, config.allowedOrigin);
      response.writeHead(204, { "Cache-Control": "no-store" });
      return response.end();
    }

    if (path !== "/session" && path !== "/session/end" && path !== "/research") {
      return json(response, 404, { error: "not_found" });
    }
    if (!origin || origin !== config.allowedOrigin) {
      return json(response, 403, { error: "origin_not_allowed" });
    }
    addCors(response, config.allowedOrigin);
    if (!config.enabled) return json(response, 503, { error: "world_guide_disabled" });

    const requestKey = "local";
    pruneSessions(sessions, now());

    if (path === "/session/end") {
      if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
      let body: unknown;
      try {
        body = await readJson(request, 2048);
      } catch {
        return json(response, 400, { error: "invalid_request" });
      }
      if (typeof body !== "object" || body === null || !("sessionId" in body) || typeof body.sessionId !== "string") {
        return json(response, 400, { error: "invalid_request" });
      }
      const lease = sessions.get(body.sessionId);
      if (!lease) return json(response, 404, { error: "session_not_found" });
      sessions.delete(body.sessionId);
      return json(response, 200, { ended: true });
    }

    if (path === "/research") {
      if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
      if (!options.research || !config.researchEnabled) return json(response, 503, { error: "research_disabled" });
      let body: unknown;
      try {
        body = await readJson(request, 4096);
      } catch {
        return json(response, 400, { error: "invalid_request" });
      }
      if (typeof body !== "object" || body === null || !("sessionId" in body) || typeof body.sessionId !== "string") {
        return json(response, 400, { error: "invalid_request" });
      }
      const lease = sessions.get(body.sessionId);
      if (!lease || lease.expiresAt <= now()) {
        return json(response, 404, { error: "session_not_found" });
      }
      if (!lease.context) return json(response, 409, { error: "world_context_missing" });
      const { sessionId: _sessionId, ...rawResearchInput } = body;
      const parsedInput = worldGuideResearchInputSchema.safeParse(rawResearchInput);
      if (!parsedInput.success) return json(response, 400, { error: "invalid_request" });
      if (parsedInput.data.editionId !== lease.context.editionId) return json(response, 409, { error: "stale_edition" });
      if (parsedInput.data.storyIds.some((id) => !lease.context!.stories.some((story) => story.id === id))) {
        return json(response, 404, { error: "unknown_story" });
      }
      if (lease.researchCount >= 4) return json(response, 429, { error: "research_limit_reached" });

      const currentWindow = windows.get(requestKey);
      const requestWindow = !currentWindow || now() - currentWindow.startedAt >= requestWindowMs
        ? { startedAt: now(), count: 0 }
        : currentWindow;
      if (requestWindow.count >= maxRequestsPerWindow) return json(response, 429, { error: "rate_limited" });
      requestWindow.count += 1;
      windows.set(requestKey, requestWindow);
      lease.researchCount += 1;
      try {
        const result = await options.research.research(parsedInput.data, lease.context);
        return json(response, 200, { result: worldGuideResearchResultSchema.parse(result) });
      } catch {
        return json(response, 502, { error: "research_unavailable" });
      }
    }

    if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
    let context: WorldGuideContext | undefined;
    try {
      const body = await readJson(request, 64 * 1024);
      if (typeof body === "object" && body !== null && "context" in body) {
        context = worldGuideContextSchema.parse(body.context);
      }
    } catch {
      return json(response, 400, { error: "invalid_world_context" });
    }
    const currentWindow = windows.get(requestKey);
    const requestWindow = !currentWindow || now() - currentWindow.startedAt >= requestWindowMs
      ? { startedAt: now(), count: 0 }
      : currentWindow;
    if (requestWindow.count >= maxRequestsPerWindow) return json(response, 429, { error: "rate_limited" });
    requestWindow.count += 1;
    windows.set(requestKey, requestWindow);

    if (sessions.size >= 1) return json(response, 429, { error: "session_limit_reached" });
    const sessionId = randomUUID();
    sessions.set(sessionId, { expiresAt: now() + sessionTtlMs, context, researchCount: 0 });
    return json(response, 200, { sessionId, localLeaseExpiresInSeconds: sessionTtlMs / 1000 });
  });
}
