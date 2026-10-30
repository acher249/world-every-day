"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function FullscreenButton({ children }: { children?: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setAvailable(Boolean(document.fullscreenEnabled));
    const update = () => setActive(Boolean(document.fullscreenElement));
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return (
    <div className="fullscreen-control">
      {error && <span role="status">{error}</span>}
      {children}
      {available && <button
        className="hud-button"
        type="button"
        aria-label={active ? "Exit fullscreen" : "Enter fullscreen"}
        title={active ? "Exit fullscreen" : "Enter fullscreen"}
        aria-pressed={active}
        onClick={async () => {
          setError("");
          try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
          } catch {
            setError("Fullscreen is unavailable in this browser.");
          }
        }}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={active ? "M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6" : "M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6"} />
        </svg>
      </button>}
    </div>
  );
}
