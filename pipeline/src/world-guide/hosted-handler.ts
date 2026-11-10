import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  worldGuideContextSchema,
  worldGuideResearchInputSchema,
  worldGuideResearchResultSchema,
  type WorldGuideContext,
} from "./contracts.js";
import type { WorldGuideResearchService } from "./research.js";

const sessionLifetimeSeconds = 15 * 60;
const maxResearchPerSession = 4;
const maxBodyBytes = 64 * 1024;

export type HostedWorldGuideLease = {
  sessionId: string;
  expiresAt: number;
  context: WorldGuideContext;
  researchCount: number;
};

export type HostedWorldGuideEvent = {
  resource?: string;
  path?: string;
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { identity?: { sourceIp?: string } };
};

export type HostedWorldGuideDependencies = {
  isEnabled(): Promise<boolean>;
  isResearchEnabled(): Promise<boolean>;
  dailyAllowanceAvailable(): Promise<boolean>;
  createLease(lease: HostedWorldGuideLease, sourceIp: string, dailyLimit: number, perIpLimit: number): Promise<boolean | "daily_limit_reached">;
  findLease(sessionId: string): Promise<HostedWorldGuideLease | null>;
  reserveResearch(sessionId: string, day: string, dailyLimit: number, nowSeconds: number): Promise<HostedWorldGuideLease | null>;
  deleteLease(sessionId: string): Promise<void>;
  getConversationToken(): Promise<string>;
  getResearchService?(): Promise<WorldGuideResearchService | undefined>;
  now?: () => number;
};

export type HostedWorldGuideConfig = {
  allowedOrigin: string;
  dailySessionLimit: number;
  perIpDailySessionLimit: number;
  dailyResearchLimit: number;
};

function response(statusCode: number, origin: string, body?: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    },
    body: body ? JSON.stringify(body) : "",
  };
}

function requestBody(event: HostedWorldGuideEvent): unknown {
  const raw = event.body ?? "";
  const body = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) throw new Error("request-too-large");
  return body.trim() ? JSON.parse(body) as unknown : {};
}

function utcDay(nowMs: number) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createHostedWorldGuideHandler(
  config: HostedWorldGuideConfig,
  dependencies: HostedWorldGuideDependencies,
) {
  const now = dependencies.now ?? Date.now;

  return async (event: HostedWorldGuideEvent) => {
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const origin = headers.origin;
    if (!origin || origin !== config.allowedOrigin) return response(403, config.allowedOrigin, { error: "origin_not_allowed" });

    // API Gateway's resource is stage-independent; path may include the stage.
    const path = (event.resource ?? event.path ?? "/").replace(/\/$/, "") || "/";
    const method = (event.httpMethod ?? "GET").toUpperCase();
    if (method === "OPTIONS") return response(204, origin);

    if (path === "/status" && method === "GET") {
      try {
        const enabled = await dependencies.isEnabled();
        const researchEnabled = enabled && await dependencies.isResearchEnabled();
        const dailyLimitReached = enabled && !await dependencies.dailyAllowanceAvailable();
        return response(200, origin, { enabled, researchEnabled, dailyLimitReached });
      } catch {
        return response(200, origin, { enabled: false, researchEnabled: false, dailyLimitReached: false });
      }
    }

    if (!["/session", "/session/end", "/research"].includes(path)) {
      return response(404, origin, { error: "not_found" });
    }
    if (method !== "POST") return response(405, origin, { error: "method_not_allowed" });

    try {
      const enabled = await dependencies.isEnabled();
      // Let clients release their lease even after the operator flips the kill switch.
      if (!enabled && path !== "/session/end") return response(503, origin, { error: "world_guide_disabled" });

      if (path === "/session") {
        let body: unknown;
        try {
          body = requestBody(event);
        } catch {
          return response(400, origin, { error: "invalid_request" });
        }
        const parsedRequest = z.object({ context: worldGuideContextSchema }).strict().safeParse(body);
        if (!parsedRequest.success) return response(400, origin, { error: "invalid_world_context" });
        const sourceIp = event.requestContext?.identity?.sourceIp;
        if (!sourceIp) return response(400, origin, { error: "request_source_unavailable" });

        const nowMs = now();
        const sessionId = randomUUID();
        const lease: HostedWorldGuideLease = {
          sessionId,
          expiresAt: Math.floor(nowMs / 1000) + sessionLifetimeSeconds,
          context: parsedRequest.data.context,
          researchCount: 0,
        };
        const reserved = await dependencies.createLease(
          lease,
          sourceIp,
          config.dailySessionLimit,
          config.perIpDailySessionLimit,
        );
        if (reserved === "daily_limit_reached") return response(429, origin, { error: "daily_limit_reached" });
        if (!reserved) return response(429, origin, { error: "session_limit_reached" });

        try {
          const conversationToken = await dependencies.getConversationToken();
          return response(200, origin, { sessionId, conversationToken, leaseExpiresInSeconds: sessionLifetimeSeconds });
        } catch {
          await dependencies.deleteLease(sessionId);
          return response(502, origin, { error: "conversation_auth_unavailable" });
        }
      }

      let body: unknown;
      try {
        body = requestBody(event);
      } catch {
        return response(400, origin, { error: "invalid_request" });
      }
      if (typeof body !== "object" || body === null || !("sessionId" in body) || !isSessionId(body.sessionId)) {
        return response(400, origin, { error: "invalid_request" });
      }

      if (path === "/session/end") {
        if (Object.keys(body).length !== 1) return response(400, origin, { error: "invalid_request" });
        await dependencies.deleteLease(body.sessionId);
        return response(200, origin, { ended: true });
      }

      if (!dependencies.getResearchService || !await dependencies.isResearchEnabled()) {
        return response(503, origin, { error: "research_disabled" });
      }
      const lease = await dependencies.findLease(body.sessionId);
      const nowSeconds = Math.floor(now() / 1000);
      if (!lease || lease.expiresAt <= nowSeconds) return response(404, origin, { error: "session_not_found" });

      const { sessionId: _sessionId, ...researchBody } = body;
      const parsedInput = worldGuideResearchInputSchema.safeParse(researchBody);
      if (!parsedInput.success) return response(400, origin, { error: "invalid_request" });
      if (parsedInput.data.editionId !== lease.context.editionId) return response(409, origin, { error: "stale_edition" });
      if (parsedInput.data.storyIds.some((id) => !lease.context.stories.some((story) => story.id === id))) {
        return response(404, origin, { error: "unknown_story" });
      }
      const research = await dependencies.getResearchService();
      if (!research) return response(503, origin, { error: "research_disabled" });

      const reservedLease = await dependencies.reserveResearch(
        body.sessionId,
        utcDay(now()),
        config.dailyResearchLimit,
        nowSeconds,
      );
      if (!reservedLease) return response(429, origin, { error: "research_limit_reached" });
      if (reservedLease.researchCount > maxResearchPerSession) return response(429, origin, { error: "research_limit_reached" });

      try {
        const result = worldGuideResearchResultSchema.parse(
          await research.research(parsedInput.data, reservedLease.context),
        );
        return response(200, origin, { result });
      } catch {
        return response(502, origin, { error: "research_unavailable" });
      }
    } catch (error) {
      console.error("World Guide request failed", {
        path,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return response(503, origin, { error: "world_guide_unavailable" });
    }
  };
}
