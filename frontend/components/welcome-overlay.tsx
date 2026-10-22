"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { hasSeenWelcome, rememberWelcome } from "@/lib/welcome";

export function WelcomeOverlay({ ready }: { ready: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    try { setOpen(!hasSeenWelcome(window.localStorage)); }
    catch { setOpen(true); }
    setChecked(true);
  }, []);

  const visible = ready && checked && open;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!visible || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus({ preventScroll: true });
      else document.querySelector<HTMLCanvasElement>(".spark-canvas")?.focus({ preventScroll: true });
    };
  }, [visible]);

  function dismiss() {
    try { rememberWelcome(window.localStorage); } catch { /* Storage may be blocked. */ }
    setOpen(false);
  }

  const reveal = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 8 },
    visible: { opacity: 1, y: 0 },
  };

  if (!visible) return null;
  return (
    <dialog
      ref={dialogRef}
      className="welcome-overlay"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-description"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => {
        if (event.target instanceof Element && !event.target.closest(".welcome-card")) dismiss();
      }}
    >
      <motion.section className="welcome-card" initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: reduceMotion ? 0 : 0.055 } } }}>
        <motion.div className="welcome-heading" variants={reveal}>
          <span className="panel-kicker">A little orientation</span>
          <button ref={closeRef} className="icon-button" type="button" aria-label="Close welcome" onClick={dismiss}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
        </motion.div>
        <motion.h2 id="welcome-title" variants={reveal}>Welcome to<br />A World Every Day.</motion.h2>
        <motion.p id="welcome-description" variants={reveal}>A living digital installation where daily stories and discoveries become a new world to explore.</motion.p>
        <motion.div className="welcome-navigation desktop-controls" variants={reveal}>
          <div className="welcome-move-keys" aria-hidden="true"><kbd>W</kbd><div><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div></div>
          <div><strong>WASD to move</strong><span>Mouse drag to look · Shift to move faster</span></div>
        </motion.div>
        <motion.div className="welcome-navigation mobile-controls" variants={reveal}>
          <svg className="welcome-stick" aria-hidden="true" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" opacity=".3"/><circle cx="32" cy="32" r="12" fill="currentColor" opacity=".15"/><circle cx="32" cy="32" r="4" fill="currentColor"/><path d="m29 12 3-3 3 3m-6 40 3 3 3-3M12 29l-3 3 3 3m40-6 3 3-3 3" fill="none" stroke="currentColor" /></svg>
          <div><strong>Left stick to move</strong><span>Drag the world to look around</span></div>
        </motion.div>
        <motion.div className="welcome-tips" variants={reveal}>
          <p><span className="welcome-marker" aria-hidden="true">01</span><span>Select a numbered landmark to read its story.</span></p>
          <p><span className="welcome-marker echo" aria-hidden="true">✦</span><span>Explore echoes to learn what the objects represent.</span></p>
          <p><span className="welcome-arrows" aria-hidden="true">{[false, true].map((right) => <kbd key={String(right)}><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d={right ? "M4 10h12m-5-5 5 5-5 5" : "M16 10H4m5-5-5 5 5 5"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></kbd>)}</span><span>Use the arrows to travel between stories.</span></p>
        </motion.div>
      </motion.section>
    </dialog>
  );
}
