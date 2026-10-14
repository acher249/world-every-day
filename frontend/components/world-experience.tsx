"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
  SparkWorld,
  type ViewerState,
  type WorldAnchor,
} from "@/components/spark-world";
import { cycleId } from "@/lib/spatial-navigation";
import { canRenderWorldInteractions } from "@/lib/world-interactions";
import type {
  PublicationManifest,
  PublicationStory,
} from "@/lib/publication-schema";

const ease = [0.22, 1, 0.36, 1] as const;
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

function ArrowUpRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.5" />
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

function StoryIndex({
  stories,
  activeId,
  onClose,
  onSelect,
}: {
  stories: PublicationStory[];
  activeId: string | null;
  onClose: () => void;
  onSelect: (story: PublicationStory) => void;
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
            <span>Continue exploring</span>
            {story.sources.map((source) => (
              <motion.a variants={textReveal} key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                <span>{source.publisher}<strong>{source.title}</strong></span>
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
        <motion.div className="controls-list" variants={staggeredText}>
          {controls.map((control) => (
            <motion.div className="control-row" key={control.action} variants={textReveal}>
              <span>{control.action}</span>
              <span className="control-keys">
                {control.keys.map((key) => (
                  key === "Mouse drag" ? (
                    <span className="responsive-control-key" key={key}>
                      <kbd className="desktop-control-key">Mouse drag</kbd>
                      <kbd className="mobile-control-key">Drag</kbd>
                    </span>
                  ) : <kbd key={key}>{key}</kbd>
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

export function WorldExperience({ publication }: { publication: PublicationManifest }) {
  const localSplatUrl = process.env.NEXT_PUBLIC_WORLD_SPLAT_URL;
  const localSplatSha256 = process.env.NEXT_PUBLIC_WORLD_SPLAT_SHA256;
  const splatUrl = publication.world.splat?.url ?? localSplatUrl;
  const { edition, stories, storyEchoes } = publication;
  const renderedSplatSha256 = publication.world.splat?.sha256 ?? localSplatSha256;
  const interactionsMatchRenderedWorld = canRenderWorldInteractions({
    interactionSplatSha256:
      publication.world.interactionMapping.sourceSplatSha256,
    renderedSplatSha256,
    splatUrl,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [viewerState, setViewerState] = useState<ViewerState>(splatUrl ? "loading" : "poster");
  const activeStory = useMemo(
    () => stories.find((story) => story.id === activeId) ?? null,
    [activeId, stories],
  );
  const anchors = useMemo<WorldAnchor[]>(
    () => interactionsMatchRenderedWorld ? [
      ...stories.map((story, index): WorldAnchor => ({
      kind: "story",
      active: activeId === story.id,
      category: story.category,
      fallbackScreenPosition: {
        x: story.interaction.screenRegion.x,
        y: story.interaction.screenRegion.y,
      },
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
    [activeId, interactionsMatchRenderedWorld, stories, storyEchoes],
  );
  const activeStoryIndex = activeStory
    ? stories.findIndex((story) => story.id === activeStory.id)
    : -1;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      if (event.key === "Escape") {
        setActiveId(null);
        setIndexOpen(false);
        setControlsOpen(false);
        return;
      }
      if (controlsOpen) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      setActiveId((currentId) => cycleId(stories.map(({ id }) => id), currentId, direction));
      setIndexOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controlsOpen, stories]);

  function selectStory(story: PublicationStory) {
    setActiveId(story.id);
    setIndexOpen(false);
    setControlsOpen(false);
  }

  return (
    <MotionConfig reducedMotion="user">
    <main className="world-app" aria-labelledby="edition-title">
      <div className="world-canvas">
        <SparkWorld
          focusedAnchorId={activeId}
          posterSrc={publication.world.poster.src}
          splatSha256={renderedSplatSha256}
          splatUrl={splatUrl}
          anchors={anchors}
          onAnchorSelect={(id) => {
            const story = stories.find((candidate) => candidate.id === id);
            if (story) selectStory(story);
          }}
          onViewerStateChange={setViewerState}
          alt={publication.world.poster.alt}
        />
        <div className="world-wash" aria-hidden="true" />
      </div>

      <header className="viewer-header">
        <motion.button
          className="hud-button story-menu-button"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease }}
          onClick={() => {
            setActiveId(null);
            setControlsOpen(false);
            setIndexOpen((open) => !open);
          }}
          aria-expanded={indexOpen}
          aria-controls="story-index"
        >
          <MenuIcon />
          <span>Stories</span>
        </motion.button>
        <motion.div
          className="viewer-title"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08, ease }}
        >
          <span className="brand-orbit" aria-hidden="true"><i /></span>
          <h1 id="edition-title">A World Every Day</h1>
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
              setActiveId(null);
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

      <div className="viewer-footer">
        <motion.div
          className="edition-stamp"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease }}
        >
          <span>{edition.displayDate}</span>
          <span>World {String(edition.sequence).padStart(3, "0")}</span>
        </motion.div>
        <motion.p
          className="interaction-hint"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.26, ease }}
        >
          <span className="desktop-interaction-hint">Drag to look · WASD to fly · Shift to boost</span>
          <span className="mobile-interaction-hint">Drag to look · Tap landmarks to explore</span>
        </motion.p>
      </div>

      <motion.div
        className="movement-keys"
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

      <AnimatePresence>
        {indexOpen ? (
          <StoryIndex
            stories={stories}
            activeId={activeId}
            onClose={() => setIndexOpen(false)}
            onSelect={selectStory}
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
            onClose={() => setActiveId(null)}
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
