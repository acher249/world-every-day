"use client";

import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildWorldGuideContext,
  buildWorldGuideContextMessage,
  buildWorldGuideDynamicVariables,
  buildWorldGuideSelectionMessage,
  validateGuideNavigation,
  validateGuideResearch,
  type WorldGuideContext,
  researchResultSchema,
  type ResearchResult,
} from "@/lib/world-guide";
import type { PublicationManifest } from "@/lib/publication-schema";

type SessionGrant = { sessionId: string; localLeaseExpiresInSeconds?: number; leaseExpiresInSeconds?: number; conversationToken?: string };
type GuideToolMap = {
  navigate_to_story: (parameters: Record<string, unknown>) => string;
  research_stories: (parameters: Record<string, unknown>) => Promise<string>;
};
const mobileWorldGuideQuery = "(max-width: 760px), (orientation: landscape) and (pointer: coarse)";
const maxSessionDurationMs = 180_000;

function providerErrorText(message: string, context: unknown) {
  const details = context && typeof context === "object"
    ? context as Record<string, unknown>
    : {};
  const fields = ["code", "errorType", "debugMessage", "details"]
    .map((key) => details[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (fields.length) return `${message} (${fields.join(" · ")})`;
  if (/server error:\s*unknown error/i.test(message)) {
    return "ElevenLabs returned an unclassified connection error. Confirm the agent is published and allows direct browser connections from this local site.";
  }
  return message;
}

function GuideWaveform({
  active,
  speaking,
  desktop,
  getInput,
  getOutput,
}: {
  active: boolean;
  speaking: boolean;
  desktop: boolean;
  getInput: () => Uint8Array;
  getOutput: () => Uint8Array;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let width = 0;
    let height = 0;
    let ratio = 1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let running = true;

    const draw = (time = 0) => {
      if (!running) return;
      context.clearRect(0, 0, width, height);
      const data = active ? (speaking ? getOutput() : getInput()) : new Uint8Array(0);
      const barCount = desktop ? 68 : 34;
      const barWidth = Math.min(5, Math.max(1, (width - 3 * (barCount - 1)) / barCount));
      const gap = barCount > 1 ? Math.max(0, (width - barWidth * barCount) / (barCount - 1)) : 0;
      const gradient = context.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, "#49324f");
      gradient.addColorStop(0.42, "#795a91");
      gradient.addColorStop(0.76, "#c587b8");
      gradient.addColorStop(1, "#fff0fa");
      context.fillStyle = gradient;
      for (let index = 0; index < barCount; index++) {
        const sample = data.length ? data[Math.floor(index * data.length / barCount)] / 255 : 0;
        const movement = reducedMotion ? 0 : sample * height * 0.78;
        const barHeight = Math.max(2, Math.min(height - 2, 2 + movement));
        const x = index * (barWidth + gap);
        context.beginPath();
        context.roundRect(x, (height - barHeight) / 2, barWidth, barHeight, Math.min(2, barWidth / 2));
        context.fill();
      }
      if (active && !reducedMotion) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (frame) cancelAnimationFrame(frame);
      draw(performance.now());
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    return () => {
      running = false;
      resizeObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, desktop, getInput, getOutput, speaking]);

  return (
    <canvas
      ref={canvasRef}
      className="world-guide-waveform"
      data-layout={desktop ? "desktop" : "mobile"}
      role="img"
      aria-label={active ? speaking ? "World Guide is speaking" : "Listening to your voice" : "World Guide audio inactive"}
    />
  );
}

function GuideSession({
  backendUrl,
  agentId,
  publication,
  selectedStoryId,
  desktop,
  serviceEnabled,
  onNavigate,
  onConversationActive,
  providerError,
  onStartAttempt,
  userResponseRevision,
  startRequest,
}: {
  backendUrl: string;
  agentId: string;
  publication: PublicationManifest;
  selectedStoryId: string | null;
  desktop: boolean;
  serviceEnabled: boolean;
  onNavigate: (storyId: string, openPanel: boolean) => void;
  onConversationActive: (active: boolean) => void;
  providerError: string | null;
  onStartAttempt: () => void;
  userResponseRevision: number;
  startRequest: number;
}) {
  const { startSession, endSession, sendContextualUpdate, getInputByteFrequencyData, getOutputByteFrequencyData } = useConversationControls();
  const { status, message } = useConversationStatus();
  const { mode } = useConversationMode();
  const [grant, setGrant] = useState<SessionGrant | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useMemo(
    () => buildWorldGuideContext(publication, selectedStoryId),
    [publication, selectedStoryId],
  );
  const latestContextRef = useRef<WorldGuideContext>(context);
  const latestGrantRef = useRef<SessionGrant | null>(grant);
  const releaseLeaseRef = useRef<(activeGrant: SessionGrant | null) => Promise<void>>(() => Promise.resolve());
  const sentEditionRef = useRef<string | null>(null);
  const editionRef = useRef(context.editionId);
  const statusRef = useRef(status);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentJustSpokeRef = useRef(false);
  latestContextRef.current = context;
  latestGrantRef.current = grant;
  statusRef.current = status;

  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
    if ((status === "disconnected" && !pending) || status === "error") {
      if (maxSessionTimerRef.current) clearTimeout(maxSessionTimerRef.current);
      maxSessionTimerRef.current = null;
    }
    if (status !== "connected") {
      agentJustSpokeRef.current = false;
      return;
    }
    if (mode === "speaking") {
      agentJustSpokeRef.current = true;
      return;
    }
    if (mode === "listening" && agentJustSpokeRef.current) {
      agentJustSpokeRef.current = false;
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        void endSession();
      }, 24_000);
    }
  }, [endSession, mode, pending, status, userResponseRevision]);

  useEffect(() => () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxSessionTimerRef.current) clearTimeout(maxSessionTimerRef.current);
  }, []);

  useConversationClientTool<GuideToolMap>("navigate_to_story", (parameters) => {
    const validation = validateGuideNavigation(parameters, latestContextRef.current);
    if (!validation.ok) return "I couldn't match that to a story in this world.";
    const story = latestContextRef.current.stories.find(({ id }) => id === validation.action.storyId);
    if (!story) return "That story is no longer available in this world.";
    onNavigate(story.id, validation.action.openPanel);
    return `Navigated to ${story.title}.`;
  });

  useConversationClientTool<GuideToolMap>("research_stories", async (parameters) => {
    const validation = validateGuideResearch(parameters, latestContextRef.current);
    if (!validation.ok) return "I can't look that up from the current world's sources.";
    const activeGrant = latestGrantRef.current;
    if (!activeGrant) return "There isn't an active World Guide session to research with.";
    try {
      const response = await fetch(`${backendUrl.replace(/\/$/, "")}/research`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: activeGrant.sessionId, ...validation.request }),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        const explanations: Record<string, string> = {
          research_disabled: "On-demand article research is not enabled in this World Guide setup yet.",
          research_limit_reached: "The session has reached its research limit. Please start a new session later.",
          stale_edition: "That question refers to an edition that is no longer open.",
          research_unavailable: "I couldn't retrieve and analyze the permitted sources right now.",
        };
        return explanations[body?.error ?? ""] ?? "I couldn't research that question right now.";
      }
      const body = await response.json() as { result?: unknown };
      if (latestGrantRef.current?.sessionId !== activeGrant.sessionId ||
          latestContextRef.current.editionId !== validation.request.editionId ||
          statusRef.current !== "connected") {
        return "That research request belongs to a conversation that has ended or changed.";
      }
      const result = researchResultSchema.parse(body.result);
      const citations = result.citations.map(({ publisher, title }) => `${publisher}: ${title}`).join("; ");
      return `${result.answer}${citations ? ` Sources: ${citations}` : ""}`;
    } catch {
      return "I couldn't research that question right now. The published story summary is still available.";
    }
  });

  const releaseLease = useCallback(async (activeGrant: SessionGrant | null) => {
    if (!activeGrant) return;
    try {
      await fetch(`${backendUrl.replace(/\/$/, "")}/session/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: activeGrant.sessionId }),
        cache: "no-store",
        keepalive: true,
      });
    } catch {
      // The server-side lease also expires automatically.
    }
  }, [backendUrl]);
  releaseLeaseRef.current = releaseLease;

  useEffect(() => {
    if (editionRef.current === context.editionId) return;
    editionRef.current = context.editionId;
    sentEditionRef.current = null;
    const activeGrant = latestGrantRef.current;
    if (maxSessionTimerRef.current) clearTimeout(maxSessionTimerRef.current);
    maxSessionTimerRef.current = null;
    latestGrantRef.current = null;
    setGrant(null);
    if (statusRef.current !== "disconnected") void endSession();
    void releaseLease(activeGrant);
  }, [context.editionId, endSession, releaseLease]);

  useEffect(() => {
    if (status !== "connected") {
      if ((status === "disconnected" || status === "error") && sentEditionRef.current) {
        sentEditionRef.current = null;
        void releaseLease(grant);
        setGrant(null);
      }
      return;
    }
    if (sentEditionRef.current !== context.editionId) {
      sentEditionRef.current = context.editionId;
      sendContextualUpdate(buildWorldGuideContextMessage(context));
    }
  }, [context, grant, releaseLease, sendContextualUpdate, status]);

  useEffect(() => {
    if (
      status !== "connected" ||
      sentEditionRef.current !== context.editionId
    ) return;
    sendContextualUpdate(buildWorldGuideSelectionMessage(context));
  }, [context, selectedStoryId, sendContextualUpdate, status]);

  useEffect(() => () => {
    if (maxSessionTimerRef.current) clearTimeout(maxSessionTimerRef.current);
    if (statusRef.current !== "disconnected") void endSession();
    void releaseLeaseRef.current(latestGrantRef.current);
  }, [endSession]);

  const start = useCallback(async () => {
    if (maxSessionTimerRef.current) clearTimeout(maxSessionTimerRef.current);
    maxSessionTimerRef.current = null;
    onStartAttempt();
    setPending(true);
    setError(null);
    let microphone: MediaStream | null = null;
    let receivedGrant: SessionGrant | null = null;
    try {
      if (!serviceEnabled) throw new Error("World Guide is currently unavailable in this experience.");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone access.");
      }
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphone.getTracks().forEach((track) => track.stop());
      microphone = null;

      const response = await fetch(`${backendUrl.replace(/\/$/, "")}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ context }),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        const descriptions: Record<string, string> = {
          session_limit_reached: "World Guide has reached its session limit. Please try again later.",
          daily_limit_reached: "World Guide has reached today’s usage limit. Please try again tomorrow.",
          world_guide_disabled: "World Guide is currently off in this experience.",
        };
        throw new Error(descriptions[body?.error ?? ""] ?? `The World Guide service returned HTTP ${response.status}.`);
      }
      receivedGrant = await response.json() as SessionGrant;
      const connection = receivedGrant.conversationToken
        ? { conversationToken: receivedGrant.conversationToken, connectionType: "webrtc" as const }
        : agentId
          ? { agentId }
          : null;
      if (!connection) throw new Error("World Guide did not return a secure conversation token.");
      setGrant({
        sessionId: receivedGrant.sessionId,
        ...(receivedGrant.localLeaseExpiresInSeconds === undefined
          ? {}
          : { localLeaseExpiresInSeconds: receivedGrant.localLeaseExpiresInSeconds }),
        ...(receivedGrant.leaseExpiresInSeconds === undefined
          ? {}
          : { leaseExpiresInSeconds: receivedGrant.leaseExpiresInSeconds }),
      });
      latestGrantRef.current = receivedGrant;
      maxSessionTimerRef.current = setTimeout(() => {
        maxSessionTimerRef.current = null;
        latestGrantRef.current = null;
        setGrant(null);
        setError("World Guide sessions are limited to 3 minutes.");
        void endSession();
        void releaseLease(receivedGrant);
      }, maxSessionDurationMs);
      await startSession({
        ...connection,
        dynamicVariables: buildWorldGuideDynamicVariables(context),
      });
    } catch (cause) {
      if (maxSessionTimerRef.current) clearTimeout(maxSessionTimerRef.current);
      maxSessionTimerRef.current = null;
      microphone?.getTracks().forEach((track) => track.stop());
      latestGrantRef.current = null;
      if (receivedGrant) await releaseLease(receivedGrant);
      setGrant(null);
      setError(cause instanceof Error ? cause.message : "The World Guide could not start.");
    } finally {
      setPending(false);
    }
  }, [agentId, context, endSession, onStartAttempt, releaseLease, serviceEnabled, startSession]);

  const handledStartRequestRef = useRef(0);
  useEffect(() => {
    if (startRequest <= handledStartRequestRef.current) return;
    handledStartRequestRef.current = startRequest;
    void start();
  }, [start, startRequest]);

  const stop = async () => {
    if (maxSessionTimerRef.current) clearTimeout(maxSessionTimerRef.current);
    maxSessionTimerRef.current = null;
    const activeGrant = latestGrantRef.current;
    latestGrantRef.current = null;
    setGrant(null);
    await endSession();
    await releaseLease(activeGrant);
  };

  const active = status === "connected" || status === "connecting" || pending;
  useEffect(() => {
    onConversationActive(active);
    return () => onConversationActive(false);
  }, [active, onConversationActive]);
  useEffect(() => {
    if (!serviceEnabled && status !== "disconnected") void endSession();
  }, [endSession, serviceEnabled, status]);
  return (
    <section className="world-guide-card" data-layout={desktop ? "desktop" : "mobile"} aria-label="World Guide voice assistant">
      <motion.div
        className="world-guide-visual-row"
        initial={false}
        animate={{ height: desktop ? active ? 148 : 8 : 38 }}
        transition={{ type: "spring", stiffness: 160, damping: 24, mass: 0.8 }}
      >
        <div className="world-guide-visual">
          <GuideWaveform
            active={status === "connected"}
            speaking={mode === "speaking"}
            desktop={desktop}
            getInput={getInputByteFrequencyData}
            getOutput={getOutputByteFrequencyData}
          />
        </div>
        {desktop && status === "connected" && (
          <button className="hud-button world-guide-stop" type="button" aria-label="End conversation" title="End conversation" onClick={() => void stop()}>
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" /></svg>
          </button>
        )}
        {desktop && active && status !== "connected" && (
          <span className="world-guide-connecting world-guide-connecting-desktop" role="status">
            Connecting<span className="world-guide-spinner" aria-hidden="true" />
          </span>
        )}
      </motion.div>
      <div className="world-guide-footer">
        {!desktop && status === "connected" ? (
          <button className="hud-button world-guide-action" type="button" onClick={() => void stop()}>
            End conversation
          </button>
        ) : !desktop && active && status !== "connected" ? (
          <span className="world-guide-connecting" role="status">
            Connecting<span className="world-guide-spinner" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {(error || status === "error") && <p className="world-guide-error" role="alert">{error ?? providerError ?? message ?? "The conversation ended unexpectedly."}</p>}
    </section>
  );
}

export function WorldGuideVoice({
  backendUrl,
  agentId,
  publication,
  selectedStoryId,
  mobileTitleVisible,
  leftPanelOpen,
  rightPanelOpen,
  onNavigate,
  onConversationActive,
  hosted,
  initiallyEnabled,
}: {
  backendUrl: string;
  agentId: string;
  publication: PublicationManifest;
  selectedStoryId: string | null;
  mobileTitleVisible: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onNavigate: (storyId: string, openPanel: boolean) => void;
  onConversationActive: (active: boolean) => void;
  hosted: boolean;
  initiallyEnabled: boolean;
}) {
  const [startRequest, setStartRequest] = useState(0);
  const [conversationActive, setConversationActive] = useState(false);
  const entryRef = useRef<HTMLDivElement>(null);
  const [visualizerLayout, setVisualizerLayout] = useState<"desktop" | "mobile">(() =>
    typeof window !== "undefined" && window.matchMedia(mobileWorldGuideQuery).matches ? "mobile" : "desktop",
  );
  const [visualizerTop, setVisualizerTop] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [userResponseRevision, setUserResponseRevision] = useState(0);
  const [serviceEnabled, setServiceEnabled] = useState(hosted ? false : initiallyEnabled);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);
  const [availabilityChecked, setAvailabilityChecked] = useState(!hosted);
  const handleConversationActive = useCallback((active: boolean) => {
    setConversationActive(active);
    onConversationActive(active);
  }, [onConversationActive]);
  const handleStartAttempt = useCallback(() => setProviderError(null), []);
  const handleMessage = useCallback(({ role }: { role: string }) => {
    if (role === "user") setUserResponseRevision((revision) => revision + 1);
  }, []);
  useEffect(() => {
    setPortalTarget(document.querySelector<HTMLElement>(".world-app") ?? document.body);
  }, []);
  useEffect(() => {
    if (!hosted) {
      setServiceEnabled(initiallyEnabled);
      setAvailabilityChecked(true);
      return;
    }
    let disposed = false;
    let controller: AbortController | undefined;
    const readAvailability = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`${backendUrl.replace(/\/$/, "")}/status`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("World Guide status unavailable");
        const body = await response.json() as { enabled?: unknown; dailyLimitReached?: unknown };
        if (!disposed) {
          setServiceEnabled(body.enabled === true);
          setDailyLimitReached(body.dailyLimitReached === true);
          setAvailabilityChecked(true);
        }
      } catch {
        if (!disposed) {
          setServiceEnabled(false);
          setAvailabilityChecked(true);
        }
      }
    };
    void readAvailability();
    const timer = window.setInterval(() => void readAvailability(), 30_000);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [backendUrl, hosted, initiallyEnabled]);
  useEffect(() => {
    const mobileLayout = window.matchMedia(mobileWorldGuideQuery);
    const updatePosition = () => {
      const entry = entryRef.current;
      if (!entry) return;
      const entryRect = entry.getBoundingClientRect();
      if (!mobileLayout.matches) {
        setVisualizerLayout("desktop");
        setVisualizerTop(entryRect.top + entryRect.height / 2 + (conversationActive ? 0 : -4));
        return;
      }
      setVisualizerLayout("mobile");
      const title = mobileTitleVisible ? document.querySelector<HTMLElement>(".mobile-story-title") : null;
      const titleBottom = title?.getBoundingClientRect().bottom;
      const header = document.querySelector<HTMLElement>(".viewer-header");
      const headerBottom = header && getComputedStyle(header).display !== "none"
        ? header.getBoundingClientRect().bottom
        : 10;
      setVisualizerTop(titleBottom && titleBottom > 0 ? titleBottom + 8 : headerBottom + 8);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    mobileLayout.addEventListener("change", updatePosition);
    const resizeObserver = new ResizeObserver(updatePosition);
    if (entryRef.current) resizeObserver.observe(entryRef.current);
    const title = mobileTitleVisible ? document.querySelector<HTMLElement>(".mobile-story-title") : null;
    const header = document.querySelector<HTMLElement>(".viewer-header");
    if (title) resizeObserver.observe(title);
    if (header) resizeObserver.observe(header);
    return () => {
      window.removeEventListener("resize", updatePosition);
      mobileLayout.removeEventListener("change", updatePosition);
      resizeObserver.disconnect();
    };
  }, [conversationActive, mobileTitleVisible, selectedStoryId]);
  return (
    <>
      <div className="world-guide-entry" ref={entryRef}>
        <span className="world-guide-disabled-hint" tabIndex={(!serviceEnabled || dailyLimitReached) ? 0 : -1}>
          <button
            className="hud-button world-guide-toggle"
            type="button"
            disabled={(!serviceEnabled || dailyLimitReached)}
            title={(!serviceEnabled || dailyLimitReached)
              ? dailyLimitReached
                ? "World Guide has reached today’s usage limit. Please try again tomorrow."
                : availabilityChecked
                ? "World Guide is off in this experience. Run your own with the open-source project and an ElevenLabs agent."
                : "Checking World Guide availability…"
              : "Start a World Guide conversation"}
            aria-describedby={(!serviceEnabled || dailyLimitReached) ? "world-guide-runtime-status" : undefined}
            aria-pressed={conversationActive}
            aria-label={(!serviceEnabled || dailyLimitReached) ? "World Guide unavailable" : conversationActive ? "World Guide conversation active" : "Start World Guide conversation"}
            onClick={() => {
              if (!conversationActive && !dailyLimitReached) setStartRequest((request) => request + 1);
            }}
          >
            <span className="world-guide-toggle-mark" aria-hidden="true">✳</span>
            <span>World Guide</span>
          </button>
          {(!serviceEnabled || dailyLimitReached) && (
            <span className="world-guide-disabled-tooltip" id="world-guide-runtime-status" role="tooltip">
              {dailyLimitReached
                ? "World Guide has reached today’s usage limit. Please try again tomorrow."
                : availabilityChecked
                ? "World Guide is off in this experience. Run your own with the open-source project and an ElevenLabs agent."
                : "Checking World Guide availability…"}
            </span>
          )}
        </span>
      </div>
      {portalTarget && createPortal(
        <motion.div
          className="world-guide-popover"
          data-layout={visualizerLayout}
          data-left-panel={leftPanelOpen}
          data-right-panel={rightPanelOpen}
          initial={false}
          animate={{ top: visualizerTop }}
          transition={{ type: "spring", stiffness: 160, damping: 24, mass: 0.8 }}
        >
          <ConversationProvider
            onMessage={handleMessage}
            onError={(message, context) => setProviderError(providerErrorText(message, context))}
          >
            <GuideSession
              backendUrl={backendUrl}
              agentId={agentId}
              serviceEnabled={serviceEnabled}
              publication={publication}
              selectedStoryId={selectedStoryId}
              desktop={visualizerLayout === "desktop"}
              onNavigate={onNavigate}
              onConversationActive={handleConversationActive}
              providerError={providerError}
              onStartAttempt={handleStartAttempt}
              userResponseRevision={userResponseRevision}
              startRequest={startRequest}
            />
          </ConversationProvider>
        </motion.div>,
        portalTarget,
      )}
    </>
  );
}
