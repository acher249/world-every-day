"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { MarketingSiteConfig } from "@/lib/site-config";

const stages = [
  ["01", "Discover", "A bounded set of credible stories from reviewed RSS and Atom sources."],
  ["02", "Compose", "Ten developments become one playful, diagrammatic panoramic image."],
  ["03", "Generate", "A world foundation model turns that image into a spatial environment."],
  ["04", "Explore", "Story landmarks connect the generated world back to their original sources."],
] as const;

const possibilities = [
  ["Follow your interests", "Curate a world around the subjects and sources that matter to you."],
  ["Change the rhythm", "Create one world each week, several each day, or one for every category."],
  ["Use other information", "Turn research, archives, collections, or an agent’s work into places."],
  ["Replace every layer", "Bring another source, image model, world model, cloud, or interface."],
] as const;

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}

export function MarketingExperience({ explorerUrl, githubUrl }: MarketingSiteConfig) {
  const reduceMotion = useReducedMotion();
  const [previewActive, setPreviewActive] = useState(false);
  const viewport = { once: true, amount: 0.18 };
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.75, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <main id="main-content">
      <a className="skip-link" href="#project">Skip to the project</a>

      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="A World Every Day, home">
          <span className="mark" aria-hidden="true"><i /></span>
          <span>A World Every Day</span>
        </a>
        <nav aria-label="Primary navigation">
          <a className="text-link desktop-link" href="#project">The project</a>
          <a className="text-link desktop-link" href={githubUrl} target="_blank" rel="noreferrer">GitHub <Arrow diagonal /></a>
          <a className="pill-link" href={explorerUrl}>Explore today <Arrow /></a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <motion.div
          className="hero-copy"
          initial="hidden"
          animate="visible"
          variants={reveal}
          transition={transition}
        >
          <p className="eyebrow">A living digital installation</p>
          <h1>Information,<br /><em>as a place.</em></h1>
          <p className="hero-intro">
            Every day, a curated set of stories becomes a new world to wander,
            look around, and slowly explore.
          </p>
          <div className="hero-actions">
            <a className="primary-link" href={explorerUrl}>Enter today’s world <Arrow /></a>
            <a className="secondary-link" href="#project">Discover the project</a>
          </div>
        </motion.div>

        <motion.div
          className="hero-orbit"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.88, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ ...transition, delay: reduceMotion ? 0 : 0.18 }}
          aria-hidden="true"
        >
          <div className="world-sphere">
            <span className="latitude latitude-one" />
            <span className="latitude latitude-two" />
            <span className="longitude longitude-one" />
            <span className="longitude longitude-two" />
            <span className="world-glow" />
          </div>
          <div className="orbit orbit-one">
            <motion.span
              className="orbit-track"
              initial={{ rotate: 0 }}
              animate={reduceMotion ? { rotate: 0 } : { rotate: 360 }}
              transition={{ duration: 24, ease: "linear", repeat: Infinity }}
            ><i /></motion.span>
          </div>
          <div className="orbit orbit-two">
            <motion.span
              className="orbit-track"
              initial={{ rotate: 145 }}
              animate={reduceMotion ? { rotate: 145 } : { rotate: -215 }}
              transition={{ duration: 32, ease: "linear", repeat: Infinity }}
            ><i /></motion.span>
          </div>
          <span className="signal signal-one">Discovery</span>
          <span className="signal signal-two">Repair</span>
          <span className="signal signal-three">Culture</span>
        </motion.div>

        <p className="scroll-cue"><span /> Scroll to unfold</p>
      </section>

      <section className="thesis section-shell" id="project">
        <motion.div initial="hidden" whileInView="visible" viewport={viewport} variants={reveal} transition={transition}>
          <p className="section-index">01 / The idea</p>
          <p className="thesis-lead">
            Information increasingly arrives as an endless feed. A World Every Day is an
            artistic exploration: <em>what if information arrived as a place?</em>
          </p>
        </motion.div>
        <motion.div className="thesis-note" initial="hidden" whileInView="visible" viewport={viewport} variants={reveal} transition={transition}>
          <p>
            The first experiment begins with the news. Stories of discovery, progress,
            repair, and cooperation are gathered into a slower, more curious way of
            encountering what is happening around us and around the world.
          </p>
          <p>
            Each day becomes one limited, navigable environment. Over time, those
            environments become a living archive.
          </p>
          <p>
            It is also an ongoing exploration of world foundation models. As the
            models improve, the project will evolve with them, and the worlds will
            grow richer, more coherent, and more alive.
          </p>
        </motion.div>
      </section>

      <section className="process-section">
        <div className="section-shell">
          <motion.div className="section-heading" initial="hidden" whileInView="visible" viewport={viewport} variants={reveal} transition={transition}>
            <p className="section-index">02 / From day to world</p>
            <h2>A day becomes<br />somewhere else.</h2>
            <p>One open pipeline, four distinct transformations.</p>
          </motion.div>
          <div className="stage-list">
            {stages.map(([number, title, description], index) => (
              <motion.article
                className="stage"
                key={number}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                variants={reveal}
                transition={{ ...transition, delay: reduceMotion ? 0 : index * 0.06 }}
              >
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="live-section section-shell" id="today">
        <motion.div className="live-heading" initial="hidden" whileInView="visible" viewport={viewport} variants={reveal} transition={transition}>
          <div>
            <p className="section-index">03 / Today’s world</p>
            <h2>Look around.</h2>
          </div>
          <div>
            <p>
              The world below is the current immersive edition. Move through it here,
              or open the full experience for its complete controls and story index.
            </p>
            <a className="secondary-link" href={explorerUrl}>Open full experience <Arrow diagonal /></a>
          </div>
        </motion.div>
        <motion.div className={`world-frame${previewActive ? " is-active" : ""}`} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.08 }} variants={reveal} transition={transition}>
          <div className="frame-bar">
            <span><i /> Live world</span>
            <span>Interactive preview</span>
          </div>
          <button
            className="mobile-frame-gate"
            type="button"
            aria-pressed={previewActive}
            onClick={() => setPreviewActive((active) => !active)}
          >
            {previewActive ? "Exit preview" : "Interact with world"}
          </button>
          <iframe
            src={explorerUrl}
            title="Today’s interactive world"
            loading="lazy"
            allow="fullscreen"
            allowFullScreen
          />
          <noscript>
            <p className="frame-fallback">JavaScript is required for the embedded world. <a href={explorerUrl}>Open it directly.</a></p>
          </noscript>
        </motion.div>
      </section>

      <section className="open-section">
        <div className="section-shell">
          <motion.div className="section-heading open-heading" initial="hidden" whileInView="visible" viewport={viewport} variants={reveal} transition={transition}>
            <p className="section-index">04 / Open by design</p>
            <h2>One project.<br /><em>Many possible worlds.</em></h2>
            <p>
              News is only the beginning. The project is MIT-licensed, open source, and
              designed so every layer can be changed.
            </p>
          </motion.div>
          <div className="possibility-grid">
            {possibilities.map(([title, description], index) => (
              <motion.article
                key={title}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                variants={reveal}
                transition={{ ...transition, delay: reduceMotion ? 0 : index * 0.05 }}
              >
                <span aria-hidden="true">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </motion.article>
            ))}
          </div>
          <motion.div className="source-cta" initial="hidden" whileInView="visible" viewport={viewport} variants={reveal} transition={transition}>
            <div>
              <p className="eyebrow">Fork it. Change it. Build another world.</p>
              <h2>The whole project<br />is an invitation.</h2>
            </div>
            <a className="primary-link light" href={githubUrl} target="_blank" rel="noreferrer">View on GitHub <Arrow diagonal /></a>
          </motion.div>
        </div>
      </section>

      <footer className="site-footer section-shell">
        <a className="wordmark" href="#top"><span className="mark" aria-hidden="true"><i /></span><span>A World Every Day</span></a>
        <p>A living, evolving digital installation.</p>
        <div>
          <a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
          <a href={explorerUrl}>Explore today</a>
        </div>
      </footer>
    </main>
  );
}
