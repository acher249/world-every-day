"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { demoEdition, demoStories, type DemoStory } from "@/data/demo-edition";
import { SparkWorld, type ViewerState } from "@/components/spark-world";

const ease = [0.22, 1, 0.36, 1] as const;

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

function StoryPanel({ story, onClose }: { story: DemoStory; onClose: () => void }) {
  return (
    <motion.aside
      className="story-panel"
      aria-label={`Story: ${story.title}`}
      initial={{ opacity: 0, x: 32, y: 8 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: 24, y: 8 }}
      transition={{ duration: 0.45, ease }}
    >
      <div className="panel-topline">
        <span>{story.category}</span>
        <button className="icon-button" onClick={onClose} aria-label="Close story">
          <CloseIcon />
        </button>
      </div>
      <p className="story-number">Story {story.number} / 10</p>
      <h2>{story.title}</h2>
      <p className="story-summary">{story.summary}</p>
      <div className="representation">
        <span>In this world</span>
        <p>{story.representation}</p>
      </div>
      <div className="demo-source">
        <span className="demo-source-dot" aria-hidden="true" />
        Illustrative demo — no external source
      </div>
    </motion.aside>
  );
}

export function WorldExperience() {
  const splatUrl = process.env.NEXT_PUBLIC_WORLD_SPLAT_URL;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(true);
  const [worldViewerState, setWorldViewerState] = useState<ViewerState>(
    splatUrl ? "loading" : "poster",
  );
  const panRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const activeStory = useMemo(
    () => demoStories.find((story) => story.id === activeId) ?? null,
    [activeId],
  );

  useEffect(() => {
    const element = panRef.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
  }, []);

  function selectStory(story: DemoStory) {
    setActiveId(story.id);
    setShowGuide(false);
  }

  return (
    <>
      <section className="world-stage" aria-labelledby="edition-title">
        <nav className="site-nav" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="A World Every Day, home">
            <span className="brand-orbit" aria-hidden="true"><i /></span>
            <span>A World Every Day</span>
          </a>
          <div className="nav-links">
            <a href="#thesis">Thesis</a>
            <a href="#method">Method</a>
            <a href="#archive">Archive</a>
          </div>
          <a className="nav-source" href="https://github.com/acher249/world-every-day" target="_blank" rel="noreferrer">
            Open source <ArrowUpRight />
          </a>
        </nav>

        <div className="world-scroll" ref={panRef}>
          <motion.div
            className={`world-canvas ${worldViewerState === "ready" ? "is-spatial" : ""}`}
            initial={reduceMotion ? false : { scale: 1.04, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.6, ease }}
          >
            <SparkWorld
              posterSrc="/images/demo-world.png"
              splatUrl={splatUrl}
              onViewerStateChange={setWorldViewerState}
              alt="A fictional coastal world containing coral gardens, a DNA monument, wind turbines, penguins, forests, waterworks, and an observatory"
            />
            <div className="world-wash" aria-hidden="true" />
            {demoStories.map((story) => (
              <button
                key={story.id}
                className={`hotspot hotspot-${story.tone} ${activeId === story.id ? "is-active" : ""}`}
                style={{ left: `${story.x}%`, top: `${story.y}%` }}
                onClick={() => selectStory(story)}
                aria-label={`Explore story ${story.number}: ${story.title}`}
                aria-pressed={activeId === story.id}
              >
                <span className="hotspot-pulse" aria-hidden="true" />
                <span className="hotspot-core">{story.number}</span>
                <span className="hotspot-label">{story.title}</span>
              </button>
            ))}
          </motion.div>
        </div>

        <div className="edition-copy" id="top">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="eyebrow">
            {demoEdition.eyebrow}
          </motion.p>
          <motion.h1
            id="edition-title"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8, ease }}
          >
            {demoEdition.title}
          </motion.h1>
          <motion.div
            className="edition-meta"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
          >
            <span>{demoEdition.date}</span>
            <span className="meta-line" aria-hidden="true" />
            <span>World 001</span>
          </motion.div>
          <p className="edition-description">{demoEdition.description}</p>
        </div>

        <AnimatePresence>
          {activeStory ? <StoryPanel key={activeStory.id} story={activeStory} onClose={() => setActiveId(null)} /> : null}
        </AnimatePresence>

        <div className="explore-guide" data-visible={showGuide && !activeStory}>
          <span className="guide-cross" aria-hidden="true" />
          <div><strong>Explore the signals</strong><span>Choose a numbered landmark</span></div>
        </div>
        <p className="mobile-pan-hint">Swipe the world · Tap a signal</p>

        <div className="story-rail" aria-label="Stories in this world">
          <div className="rail-track">
            {demoStories.map((story) => (
              <button
                key={story.id}
                className={activeId === story.id ? "is-active" : ""}
                onClick={() => selectStory(story)}
              >
                <span>{story.number}</span>
                {story.category}
              </button>
            ))}
          </div>
          <span className="rail-count">10 signals</span>
        </div>
      </section>

      <main className="manifesto">
        <section className="thesis-section" id="thesis">
          <p className="section-index">01 / Thesis</p>
          <div>
            <p className="kicker">The news usually arrives as an endless feed.</p>
            <h2>What if the day arrived as a place?</h2>
            <p className="body-large">
              Engagement-driven media rewards alarm, outrage, and the next click. A World Every Day is an artistic counterproposal: a slower, spatial way to encounter credible stories of discovery, repair, cooperation, and meaningful attempts to solve real problems.
            </p>
          </div>
        </section>

        <section className="principle-band">
          <p>Our editorial principle</p>
          <blockquote>
            “Select credible developments that reveal <em>progress, possibility, discovery, repair, cooperation,</em> or meaningful attempts to address real problems.”
          </blockquote>
          <span>Constructive significance</span>
        </section>

        <section className="method-section" id="method">
          <div className="method-heading">
            <p className="section-index">02 / Method</p>
            <h2>From the day<br />to a world.</h2>
          </div>
          <ol className="method-list">
            <li><span>01</span><div><h3>Gather</h3><p>Find credible developments across science, health, climate, technology, culture, and communities.</p></div></li>
            <li><span>02</span><div><h3>Interpret</h3><p>Select ten constructively significant stories and translate them into physical subjects within one coherent place.</p></div></li>
            <li><span>03</span><div><h3>Generate</h3><p>Create a source image, then let a world model interpret it as a navigable spatial environment.</p></div></li>
            <li><span>04</span><div><h3>Explore</h3><p>Connect each landmark back to an original summary and its sources, preserving curiosity and context.</p></div></li>
          </ol>
        </section>

        <section className="archive-section" id="archive">
          <p className="section-index">03 / Archive</p>
          <div className="archive-message">
            <span className="archive-orbit" aria-hidden="true"><i /></span>
            <h2>One world is a moment.<br />An archive becomes a memory.</h2>
            <p>The first real edition is still ahead. Each published world will remain here as a record of what people discovered, restored, imagined, and made better.</p>
            <a href="https://github.com/acher249/world-every-day" target="_blank" rel="noreferrer">Follow the open-source build <ArrowUpRight /></a>
          </div>
        </section>
      </main>

      <footer>
        <span>A World Every Day</span>
        <span>An open-source living artwork</span>
        <span>Built in public · 2026</span>
      </footer>
    </>
  );
}

