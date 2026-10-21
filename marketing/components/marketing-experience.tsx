"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { MarketingSiteConfig } from "@/lib/site-config";

const stages = [
  ["01", "Discover", "Stories, research, and updates from reviewed RSS and Atom feeds."],
  ["02", "Compose", "Selected developments become one playful, diagrammatic panoramic image."],
  ["03", "Generate", "A world foundation model turns that image into a spatial environment."],
  ["04", "Explore", "Story landmarks connect the generated world back to their original sources."],
] as const;

const possibilities = [
  ["Follow your interests", "Curate a world around the subjects and sources that matter to you."],
  ["Change the rhythm", "Create one world each week, several each day, or one for every category."],
  ["Use other information", "Turn archives, collections, datasets, or an agent’s work into places."],
  ["Replace every layer", "Bring another source, image model, world model, cloud, or interface."],
] as const;

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
    </svg>
  );
}

export function MarketingExperience({ explorerUrl, githubUrl }: MarketingSiteConfig) {
  const reduceMotion = useReducedMotion();
  const [showEmbeddedWorld, setShowEmbeddedWorld] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px) and (pointer: fine)");
    const update = () => setShowEmbeddedWorld(desktop.matches);
    update();
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, []);
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
          <a className="text-link desktop-link github-link" href={githubUrl} target="_blank" rel="noopener noreferrer"><GitHubIcon /> GitHub <Arrow diagonal /></a>
          <a className="pill-link" href={explorerUrl} target="_blank" rel="noopener noreferrer">Explore today <Arrow /></a>
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
            Every day, curated stories and discoveries become a new world to wander,
            look around, and slowly explore.
          </p>
          <div className="hero-actions">
            <a className="primary-link" href={explorerUrl} target="_blank" rel="noopener noreferrer">Enter today’s world <Arrow /></a>
            <a className="secondary-link hero-project-link" href="#project">Discover the project</a>
            <a className="secondary-link github-link hero-mobile-github" href={githubUrl} target="_blank" rel="noopener noreferrer"><GitHubIcon /> View on GitHub</a>
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
            The first experiment draws from reporting, research, and public-interest
            updates. The current sources often lean toward science, health, and
            technology: a curated view of the day, not a comprehensive news digest.
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
              Explore the current edition, discover its landmarks, and follow the
              stories behind them. Open the full experience on desktop or mobile.
            </p>
            <a className="secondary-link" href={explorerUrl} target="_blank" rel="noopener noreferrer">Open full experience <Arrow diagonal /></a>
          </div>
        </motion.div>
        {showEmbeddedWorld && <motion.div className="world-frame" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.08 }} variants={reveal} transition={transition}>
          <div className="frame-bar">
            <span><i /> Live world</span>
            <span>Interactive preview</span>
          </div>
          <iframe
            src={explorerUrl}
            title="Today’s interactive world"
            loading="lazy"
            allow="fullscreen"
            allowFullScreen
          />
          <noscript>
            <p className="frame-fallback">JavaScript is required for the embedded world. <a href={explorerUrl} target="_blank" rel="noopener noreferrer">Open it directly.</a></p>
          </noscript>
        </motion.div>}
      </section>

      <section className="open-section">
        <div className="section-shell">
          <motion.div className="section-heading open-heading" initial="hidden" whileInView="visible" viewport={viewport} variants={reveal} transition={transition}>
            <p className="section-index">04 / Open by design</p>
            <h2>One project.<br /><em>Many possible worlds.</em></h2>
            <p>
              The daily edition is only the beginning. The project is MIT-licensed, open source, and
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
            <a className="primary-link light github-cta" href={githubUrl} target="_blank" rel="noopener noreferrer"><span className="github-link"><GitHubIcon /> View on GitHub</span><span className="github-cta-arrow"><Arrow diagonal /></span></a>
          </motion.div>
        </div>
      </section>

      <footer className="site-footer section-shell">
        <a className="wordmark" href="#top"><span className="mark" aria-hidden="true"><i /></span><span>A World Every Day</span></a>
        <p>A living, evolving digital installation.</p>
        <div>
          <a className="github-link" href={githubUrl} target="_blank" rel="noopener noreferrer"><GitHubIcon /> GitHub</a>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer">Explore today</a>
        </div>
        <div className="creator-credit">
          <span>Built by Adam</span>
          <a href="https://x.com/ajc_builds" target="_blank" rel="noopener noreferrer" aria-label="Adam on X">X</a>
          <a href="https://www.linkedin.com/in/adamchernick/" target="_blank" rel="noopener noreferrer" aria-label="Adam on LinkedIn">LinkedIn</a>
        </div>
      </footer>
    </main>
  );
}
