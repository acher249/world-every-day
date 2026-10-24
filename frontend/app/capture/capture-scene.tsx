"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createFrameCapture, type FrameCapture } from "@/lib/frame-capture";

declare global {
  interface Window {
    __WORLD_CAPTURE__?: FrameCapture;
    __WORLD_CAPTURE_ERROR__?: string;
  }
}

/** Private workers serve the checked asset over loopback; this route has no UI. */
export function CaptureScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const parameters = useSearchParams();
  const splat = parameters.get("splat");
  const sha256 = parameters.get("sha256");
  useEffect(() => {
    if (!canvas.current) return;
    let cancelled = false;
    let capture: FrameCapture | undefined;
    delete window.__WORLD_CAPTURE_ERROR__;
    if (!splat || !/^\/generated\/[a-z0-9][a-z0-9-]*\.spz$/.test(splat) ||
        !sha256 || !/^[a-f0-9]{64}$/.test(sha256)) {
      window.__WORLD_CAPTURE_ERROR__ = "A local SPZ path and SHA-256 are required";
      return;
    }
    const abort = new AbortController();
    createFrameCapture(canvas.current, splat, sha256, abort.signal).then((value) => {
      if (cancelled) value.dispose();
      else window.__WORLD_CAPTURE__ = capture = value;
    }).catch((error: unknown) => {
      if (!cancelled) window.__WORLD_CAPTURE_ERROR__ = error instanceof Error ? error.message : "Capture initialization failed";
    });
    return () => {
      cancelled = true;
      abort.abort();
      if (window.__WORLD_CAPTURE__ === capture) delete window.__WORLD_CAPTURE__;
      capture?.dispose();
    };
  }, [splat, sha256]);
  return <canvas ref={canvas} width={1280} height={720} aria-label="World capture" />;
}
