"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SparkWorld,
  type ViewerState,
  type WorldAnchor,
} from "@/components/spark-world";
import { MobileJoystick } from "@/components/mobile-joystick";
import { cycleId, spatialStoryOrder } from "@/lib/spatial-navigation";
import { pastWorldLabel, type PastWorld } from "@/lib/publication-loader";
import { resolveProjectSiteUrl } from "@/lib/site-links";
import { WorldAudio, type WorldSound } from "@/lib/world-audio";
import { canRenderWorldInteractions } from "@/lib/world-interactions";
import type { StickValue } from "@/lib/touch-navigation";
import type {
  PublicationManifest,
  PublicationStory,
} from "@/lib/publication-schema";

const ease = [0.22, 1, 0.36, 1] as const;
const mobileLayoutQuery = "(max-width: 760px), (orientation: landscape) and (pointer: coarse)";
const textReveal = {
  hidden: { opacity: 0, y: 9 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease } },
  exit: { opacity: 0, y: -5, transition: { duration: 0.16 } },
};
const staggeredText = {
  hidden: {},
  visible: { transition: { delayChildren: 0.025, staggerChildren: 0.035 } },
  exit: { transition: { staggerChildren: 0.025, staggerDirection: -1 } },
};

function conciseSummary(value: string, maximumLength = 150): string {
  const firstSentence = value.match(/^.*?[.!?](?:\s|$)/)?.[0].trim();
  const candidate = firstSentence && firstSentence.length >= 60 ? firstSentence : value;
  if (candidate.length <= maximumLength) return candidate;
  const shortened = candidate.slice(0, maximumLength - 1).replace(/\s+\S*$/, "").trimEnd();
  return `${shortened}…`;
}

const controls = [
  { action: "Look around", keys: ["Mouse drag"] },
  { action: "Move", keys: ["W", "A", "S", "D"] },
  { action: "Move vertically", keys: ["Q", "E"] },
  { action: "Move faster", keys: ["Shift"] },
  { action: "Move forward or back", keys: ["Scroll"] },
  { action: "Cycle stories", keys: ["←", "→"] },
  { action: "Close a panel", keys: ["Esc"] },
] as const;
const mobileControls = [
  { action: "Move", keys: ["Left stick"] },
  { action: "Look around", keys: ["Drag the world"] },
  { action: "Cycle stories", keys: ["←", "→"] },
  { action: "Open a story", keys: ["Tap a landmark"] },
  { action: "Close a panel", keys: ["Tap outside"] },
] as const;

function ArrowUpRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15">
      <path d="m8 12 4-4m-5.5 1.5-1 1a3 3 0 0 0 4.25 4.25l2-2a3 3 0 0 0 0-4.25m-3.5 3.5a3 3 0 0 1 0-4.25l2-2a3 3 0 0 1 4.25 4.25l-1 1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function StoryArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="17" height="17">
      <path
        d={direction === "left" ? "M15 10H5m0 0 4-4m-4 4 4 4" : "M5 10h10m0 0-4-4m4 4-4 4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SoundIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <path d="M3 8h3l4-3v10l-4-3H3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      {enabled ? (
        <>
          <path d="M13 7a4 4 0 0 1 0 6M15 4.5a7 7 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </>
      ) : (
        <path d="m13 8 4 4m0-4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ControlsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <rect x="2.75" y="4.5" width="14.5" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M5.5 8h1.5M9.25 8h1.5M13 8h1.5M5.5 11h1.5M9.25 11h1.5M13 11h1.5M7.25 13.5h5.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function AboutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10 9v4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="10" cy="6.75" r=".75" fill="currentColor" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10 5.5V10l3 2" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StoryIndex({
  stories,
  activeId,
  onClose,
  onSelect,
  onPreview,
}: {
  stories: PublicationStory[];
  activeId: string | null;
  onClose: () => void;
  onSelect: (story: PublicationStory) => void;
  onPreview: (story: PublicationStory) => void;
}) {
  return (
    <motion.aside
      id="story-index"
      className="story-index"
      aria-label="Stories in this world"
      variants={{
        hidden: { x: "-100%" },
        visible: { x: 0, transition: { duration: 0.48, ease, delayChildren: 0.08, staggerChildren: 0.05 } },
        exit: { x: "-100%", transition: { duration: 0.4, ease } },
      }}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div className="panel-header" variants={textReveal}>
        <div>
          <span className="panel-kicker">Today&apos;s world</span>
          <h2>Stories</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close story index">
          <CloseIcon />
        </button>
      </motion.div>
      <motion.ol className="story-list" variants={staggeredText}>
        {stories.map((story, index) => (
          <motion.li key={story.id} variants={textReveal}>
            <button
              className={activeId === story.id ? "is-active" : ""}
              onClick={() => onSelect(story)}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onPreview(story);
              }}
              onFocus={() => onPreview(story)}
            >
              <span className="story-list-number">{String(index + 1).padStart(2, "0")}</span>
              <span>
                <small>{story.category}</small>
                <strong>{story.title}</strong>
              </span>
            </button>
          </motion.li>
        ))}
      </motion.ol>
    </motion.aside>
  );
}

function StoryPanel({
  story,
  storyNumber,
  storyCount,
  onClose,
}: {
  story: PublicationStory;
  storyNumber: string;
  storyCount: number;
  onClose: () => void;
}) {
  return (
    <motion.aside
      className="story-panel"
      aria-label={`Story: ${story.title}`}
      variants={{
        hidden: { x: "100%" },
        visible: { x: 0, transition: { duration: 0.48, ease, delayChildren: 0.08, staggerChildren: 0.05 } },
        exit: { x: "100%", transition: { duration: 0.4, ease } },
      }}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div className="panel-header" variants={textReveal}>
        <div>
          <span className="panel-kicker">{story.category}</span>
          <p>{storyNumber} / {String(storyCount).padStart(2, "0")}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close story">
          <CloseIcon />
        </button>
      </motion.div>
      <motion.div className="story-panel-content" variants={staggeredText}>
        <motion.h2 variants={textReveal}>{story.title}</motion.h2>
        <motion.p className="story-summary" variants={textReveal}>{story.summary}</motion.p>
        <motion.div className="representation" variants={textReveal}>
          <span>Find it in the world</span>
          <p>{story.representation}</p>
        </motion.div>
        {story.sources.length > 0 ? (
          <motion.div className="story-sources" aria-label="Sources" variants={staggeredText}>
            <span>View full article{story.sources.length === 1 ? "" : "s"}</span>
            {story.sources.map((source) => (
              <motion.a variants={textReveal} key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                <span>{source.publisher}<strong><LinkIcon />{source.title}</strong></span>
                <ArrowUpRight />
              </motion.a>
            ))}
          </motion.div>
        ) : (
          <motion.div className="demo-source" variants={textReveal}>
            <span className="demo-source-dot" aria-hidden="true" />
            Illustrative demo, no external source
          </motion.div>
        )}
      </motion.div>
    </motion.aside>
  );
}

function ControlsModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="controls-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        id="controls-dialog"
        className="controls-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="controls-title"
        variants={{
          hidden: { opacity: 0, y: 22, scale: 0.97 },
          visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease, delayChildren: 0.08, staggerChildren: 0.05 } },
          exit: { opacity: 0, y: 12, scale: 0.985, transition: { duration: 0.2 } },
        }}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <motion.header className="controls-header" variants={textReveal}>
          <div>
            <span className="panel-kicker">Navigation</span>
            <h2 id="controls-title">Explore the world</h2>
          </div>
          <button autoFocus className="icon-button" onClick={onClose} aria-label="Close controls">
            <CloseIcon />
          </button>
        </motion.header>
        <motion.div className="controls-list desktop-controls" variants={staggeredText}>
          {controls.map((control) => (
            <motion.div className="control-row" key={control.action} variants={textReveal}>
              <span>{control.action}</span>
              <span className="control-keys">
                {control.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            </motion.div>
          ))}
        </motion.div>
        <motion.div className="controls-list mobile-controls" variants={staggeredText}>
          {mobileControls.map((control) => (
            <motion.div className="control-row" key={control.action} variants={textReveal}>
              <span>{control.action}</span>
              <span className="control-keys">
                {control.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            </motion.div>
          ))}
        </motion.div>
        <motion.p className="controls-note" variants={textReveal}>
          Select any numbered landmark to open its story.
        </motion.p>
      </motion.section>
    </motion.div>
  );
}

function viewerLabel(state: ViewerState) {
  if (state === "loading") return "Loading world";
  if (state === "ready") return "World ready";
  if (state === "error") return "Poster fallback";
  return "Preview world";
}

export function WorldExperience({ publication, pastWorlds = [], currentEditionId = null }: {
  publication: PublicationManifest;
  pastWorlds?: PastWorld[];
  currentEditionId?: string | null;
}) {
  const projectSiteUrl = resolveProjectSiteUrl(process.env.NEXT_PUBLIC_PROJECT_SITE_URL);
  const localSplatUrl = process.env.NEXT_PUBLIC_WORLD_SPLAT_URL;
  const localSplatSha256 = process.env.NEXT_PUBLIC_WORLD_SPLAT_SHA256;
  const splatUrl = publication.world.splat?.url ?? localSplatUrl;
  const { edition, storyEchoes } = publication;
  const stories = useMemo(() => spatialStoryOrder(publication.stories), [publication.stories]);
  const renderedSplatSha256 = publication.world.splat?.sha256 ?? localSplatSha256;
  const interactionsMatchRenderedWorld = canRenderWorldInteractions({
    interactionSplatSha256:
      publication.world.interactionMapping.sourceSplatSha256,
    renderedSplatSha256,
    splatUrl,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [previewTitleId, setPreviewTitleId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  const [focusCycleRevision, setFocusCycleRevision] = useState(0);
  const [focusResetRevision, setFocusResetRevision] = useState(0);
  const [indexOpen, setIndexOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveRef = useRef<HTMLDivElement>(null);
  const [viewerState, setViewerState] = useState<ViewerState>(splatUrl ? "loading" : "poster");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundAvailable, setSoundAvailable] = useState(true);
  const audioRef = useRef<WorldAudio | null>(null);
  const autoSoundAttemptedRef = useRef(false);
  const mobileMovementRef = useRef<StickValue>({ x: 0, y: 0 });
  const activeStory = useMemo(
    () => stories.find((story) => story.id === activeId) ?? null,
    [activeId, stories],
  );
  const storyIds = useMemo(() => stories.map(({ id }) => id), [stories]);
  const previewStory = stories.find((story) => story.id === previewTitleId);
  const dismissPreviewTitle = useCallback(() => setPreviewTitleId(null), []);
  const playSound = useCallback((sound: WorldSound) => audioRef.current?.play(sound), []);
  const setMovementSound = useCallback((intensity: number) => audioRef.current?.setMovement(intensity), []);
  const closeStory = useCallback(() => {
    setPreviewTitleId(null);
    setActiveId(null);
    focusedIdRef.current = null;
    setFocusedId(null);
  }, []);
  const focusNextStory = useCallback((direction: -1 | 1, openPanel: boolean) => {
    const nextId = cycleId(storyIds, focusedIdRef.current, direction);
    if (nextId) playSound("travel");
    if (nextId) setFocusCycleRevision((revision) => revision + 1);
    focusedIdRef.current = nextId;
    setFocusedId(nextId);
    setActiveId(openPanel ? nextId : null);
    setPreviewTitleId(openPanel ? null : nextId);
    setIndexOpen(false);
  }, [playSound, storyIds]);
  const anchors = useMemo<WorldAnchor[]>(
    () => interactionsMatchRenderedWorld ? [
      ...stories.map((story, index): WorldAnchor => ({
      kind: "story",
      active: focusedId === story.id,
      category: story.category,
      fallbackScreenPosition: {
        x: story.interaction.screenRegion.x,
        y: story.interaction.screenRegion.y,
      },
      imageBoundingBox: story.interaction.imageBoundingBox,
      imageTarget: story.interaction.imageTarget,
      id: story.id,
      label: story.title,
      number: String(index + 1).padStart(2, "0"),
      summary: conciseSummary(story.summary),
      tone: story.interaction.screenRegion.tone,
      worldPosition: story.interaction.worldPosition,
    })),
      ...storyEchoes.map((echo): WorldAnchor => {
        const storyIndex = stories.findIndex(({ id }) => id === echo.storyId);
        const story = stories[storyIndex];
        return {
          kind: "echo",
          explanation: echo.explanation,
          fallbackScreenPosition: echo.interaction.imageTarget,
          id: echo.id,
          label: echo.label,
          storyNumber: String(storyIndex + 1).padStart(2, "0"),
          storyTitle: story?.title ?? "Related story",
          worldPosition: echo.interaction.worldPosition,
        };
      }),
    ] : [],
    [focusedId, interactionsMatchRenderedWorld, stories, storyEchoes],
  );
  const activeStoryIndex = activeStory
    ? stories.findIndex((story) => story.id === activeStory.id)
    : -1;

  useEffect(() => {
    setSoundAvailable(typeof window.AudioContext !== "undefined");
    function enableAfterDesktopInteraction(event: PointerEvent | KeyboardEvent) {
      if (
        autoSoundAttemptedRef.current ||
        window.matchMedia(mobileLayoutQuery).matches ||
        !window.matchMedia("(hover: hover) and (pointer: fine)").matches
      ) return;
      if (event.target instanceof Element && event.target.closest(".sound-toggle")) return;
      if (event instanceof KeyboardEvent && ["Alt", "Control", "Meta", "Shift"].includes(event.key)) return;
      autoSoundAttemptedRef.current = true;
      const audio = audioRef.current ?? new WorldAudio();
      audioRef.current = audio;
      void audio.enable().then((enabled) => {
        if (document.hidden) audio.disable();
        setSoundEnabled(enabled && !document.hidden);
      });
    }
    function pauseWhenHidden() {
      if (!document.hidden) return;
      audioRef.current?.disable();
      setSoundEnabled(false);
    }
    window.addEventListener("pointerdown", enableAfterDesktopInteraction);
    window.addEventListener("keydown", enableAfterDesktopInteraction);
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      window.removeEventListener("pointerdown", enableAfterDesktopInteraction);
      window.removeEventListener("keydown", enableAfterDesktopInteraction);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !archiveRef.current?.contains(event.target)) setArchiveOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (archiveOpen || activeId || indexOpen || controlsOpen || focusedId) {
          event.preventDefault();
          setArchiveOpen(false);
          closeStory();
          setIndexOpen(false);
          setControlsOpen(false);
          setFocusResetRevision((revision) => revision + 1);
        }
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      if (controlsOpen) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (event.repeat) return;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      focusNextStory(direction, !window.matchMedia(mobileLayoutQuery).matches);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeId, archiveOpen, closeStory, controlsOpen, focusNextStory, focusedId, indexOpen]);

  function selectStory(story: PublicationStory, openPanel: boolean) {
    setFocusCycleRevision((revision) => revision + 1);
    playSound(openPanel ? "story" : "travel");
    setActiveId(openPanel ? story.id : null);
    setPreviewTitleId(openPanel ? null : story.id);
    focusedIdRef.current = story.id;
    setFocusedId(story.id);
    setIndexOpen(false);
    setControlsOpen(false);
  }

  function previewStoryFromIndex(story: PublicationStory) {
    if (
      window.matchMedia(mobileLayoutQuery).matches ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
      focusedIdRef.current === story.id
    ) return;
    focusedIdRef.current = story.id;
    setFocusedId(story.id);
    setFocusCycleRevision((revision) => revision + 1);
  }

  async function toggleSound() {
    autoSoundAttemptedRef.current = true;
    const audio = audioRef.current ?? new WorldAudio();
    audioRef.current = audio;
    if (soundEnabled) {
      audio.disable();
      setSoundEnabled(false);
    } else {
      setSoundEnabled(await audio.enable());
    }
  }

  return (
    <MotionConfig reducedMotion="user">
    <main className="world-app" aria-labelledby="edition-title">
      <div
        className="world-canvas"
        onPointerDown={(event) => {
          if (
            event.target instanceof HTMLCanvasElement &&
            !window.matchMedia(mobileLayoutQuery).matches
          ) {
            setIndexOpen(false);
            setArchiveOpen(false);
            if (activeId) closeStory();
          }
        }}
      >
        <SparkWorld
          focusedAnchorId={focusedId}
          focusCycleRevision={focusCycleRevision}
          focusResetRevision={focusResetRevision}
          storyPanelOpen={activeId !== null}
          storyIndexOpen={indexOpen}
          mobileMovementRef={mobileMovementRef}
          posterSrc={publication.world.poster.src}
          splatSha256={renderedSplatSha256}
          splatUrl={splatUrl}
          anchors={anchors}
          onAnchorHover={() => playSound("hover")}
          onMovementChange={setMovementSound}
          onAnchorSelect={(id) => {
            const story = stories.find((candidate) => candidate.id === id);
            if (story) selectStory(story, true);
          }}
          onViewerStateChange={setViewerState}
          alt={publication.world.poster.alt}
        />
        <div className="world-wash" aria-hidden="true" />
      </div>

      <motion.div
        className="sound-controls"
        data-shifted={Boolean(activeStory)}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.2, ease }}
      >
        <button
          className="sound-toggle hud-button"
          type="button"
          aria-label={soundAvailable ? (soundEnabled ? "Mute world sound" : "Enable world sound") : "World sound unavailable"}
          aria-pressed={soundEnabled}
          title={soundEnabled ? "Mute world sound" : "Enable ambient sound and effects"}
          disabled={!soundAvailable}
          onClick={() => void toggleSound()}
        >
          <SoundIcon enabled={soundEnabled} />
          <span>Sound {soundEnabled ? "on" : "off"}</span>
        </button>
      </motion.div>

      <header className="viewer-header">
        <motion.div
          className="viewer-nav"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease }}
        >
          <button
            className="hud-button story-menu-button"
            onClick={() => {
              playSound("tap");
              closeStory();
              setControlsOpen(false);
              setIndexOpen((open) => !open);
            }}
            aria-expanded={indexOpen}
            aria-controls="story-index"
          >
            <MenuIcon />
            <span>Stories</span>
          </button>
          <a className="hud-button project-link" href={projectSiteUrl} target="_blank" rel="noopener noreferrer">
            <AboutIcon />
            <span>About the project</span>
          </a>
          <div className="archive-menu" ref={archiveRef}>
            <button
              className="hud-button archive-button"
              type="button"
              aria-label="Explore past worlds"
              aria-expanded={archiveOpen}
              aria-controls="past-worlds-list"
              onClick={() => {
                playSound("tap");
                setArchiveOpen((open) => !open);
              }}
            >
              <ArchiveIcon />
              <span>Explore Past Worlds</span>
              <span className="archive-chevron" aria-hidden="true">⌄</span>
            </button>
            <AnimatePresence>
              {archiveOpen && (
                <motion.div
                  id="past-worlds-list"
                  className="archive-list"
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.2, ease }}
                >
                  <span className="archive-list-heading">Past worlds</span>
                  {pastWorlds.length === 0 ? (
                    <p className="archive-empty">No past worlds yet</p>
                  ) : pastWorlds.map((world) => (
                    <a
                      key={world.editionId}
                      className="archive-world-link"
                      href={`/?edition=${encodeURIComponent(world.editionId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-current={publication.edition.id === world.editionId ? "page" : undefined}
                    >
                      <span>{pastWorldLabel(world.editionId)}</span>
                      <ArrowUpRight />
                    </a>
                  ))}
                  {currentEditionId && publication.edition.id !== currentEditionId && (
                    <a className="archive-world-link archive-today-link" href="/" target="_blank" rel="noopener noreferrer">
                      <span>Back to today</span>
                      <ArrowUpRight />
                    </a>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
        <motion.div
          className="viewer-title"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08, ease }}
        >
          <span className="brand-orbit" aria-hidden="true"><i /></span>
          <div className="viewer-title-copy">
            <h1 id="edition-title">A World Every Day</h1>
            <span className="viewer-edition-date">
              {edition.displayDate}{edition.eyebrow.includes("Technical test") ? " · Technical test" : ""}
            </span>
          </div>
        </motion.div>
        <motion.div
          className="viewer-actions"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.16, ease }}
        >
          <div className="viewer-status" data-state={viewerState}>
            <span aria-hidden="true" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                className="viewer-status-label"
                key={viewerState}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {viewerLabel(viewerState)}
              </motion.span>
            </AnimatePresence>
          </div>
          <button
            className="hud-button controls-button"
            onClick={() => {
              playSound("tap");
              closeStory();
              setIndexOpen(false);
              setControlsOpen(true);
            }}
            aria-expanded={controlsOpen}
            aria-controls="controls-dialog"
          >
            <ControlsIcon />
            <span>Controls</span>
          </button>
        </motion.div>
      </header>

      <AnimatePresence mode="wait">
        {previewStory && !activeId && !indexOpen && !controlsOpen && !archiveOpen && (
          <motion.p
            key={previewStory.id}
            className="mobile-story-title"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {previewStory.title}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="viewer-footer">
        <motion.div
          className="edition-stamp"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease }}
        >
          <span>World {String(edition.sequence).padStart(3, "0")}</span>
        </motion.div>
        <motion.p
          className="interaction-hint"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.26, ease }}
        >
          <span className="desktop-interaction-hint">Drag to look · WASD to fly · Shift to boost</span>
          <span className="mobile-interaction-hint">Left stick to move · Drag to look</span>
        </motion.p>
      </div>

      <motion.div
        className="movement-keys"
        data-shifted={indexOpen}
        aria-hidden="true"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.32, ease }}
      >
        <span />
        <kbd>W</kbd>
        <span />
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd>
      </motion.div>

      <motion.div
        className="story-cycle-hint"
        data-shifted={Boolean(activeStory)}
        aria-label="Use the left and right arrow keys to navigate through stories"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.36, ease }}
      >
        <span>Navigate through stories</span>
        <span className="story-cycle-keys" aria-hidden="true">
          <kbd>←</kbd>
          <kbd>→</kbd>
        </span>
      </motion.div>

      {viewerState === "ready" && stories.length > 0 && (
        <motion.div
          className="mobile-story-navigation"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.32, ease }}
          role="group"
          aria-label="Navigate through stories"
        >
          <button type="button" aria-label="Previous story" onClick={() => focusNextStory(-1, false)}><StoryArrow direction="left" /></button>
          <button type="button" aria-label="Next story" onClick={() => focusNextStory(1, false)}><StoryArrow direction="right" /></button>
        </motion.div>
      )}

      {viewerState === "ready" && <MobileJoystick movementRef={mobileMovementRef} onMove={dismissPreviewTitle} />}

      {(indexOpen || activeStory) && (
        <button
          type="button"
          className="panel-dismiss-zone"
          aria-label="Close the open panel"
          onClick={() => {
            setIndexOpen(false);
            closeStory();
          }}
        />
      )}

      <AnimatePresence>
        {indexOpen ? (
          <StoryIndex
            stories={stories}
            activeId={focusedId}
            onClose={() => {
              setIndexOpen(false);
              closeStory();
            }}
            onPreview={previewStoryFromIndex}
            onSelect={(story) => selectStory(story, !window.matchMedia(mobileLayoutQuery).matches)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {activeStory ? (
          <StoryPanel
            key={activeStory.id}
            story={activeStory}
            storyNumber={String(activeStoryIndex + 1).padStart(2, "0")}
            storyCount={stories.length}
            onClose={closeStory}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {controlsOpen ? <ControlsModal onClose={() => setControlsOpen(false)} /> : null}
      </AnimatePresence>
    </main>
    </MotionConfig>
  );
}
