"use client";

import Script from "next/script";
import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { latestPostId } from "@/lib/latest-post";

export function LatestPost() {
  const section = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const visible = useInView(section, { once: true, margin: "200px" });
  const [postId, setPostId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"loading" | "unavailable" | "loaded">("loading");

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    fetch("/generated/social/latest.json", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? latestPostId(await response.json()) : null)
      .then((id) => {
        if (!controller.signal.aborted) {
          setPostId(id);
          if (!id) setStatus("unavailable");
        }
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("unavailable"); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [visible]);

  useEffect(() => {
    if (!visible || status !== "loading") return;
    const timeout = setTimeout(() => setStatus("unavailable"), 20_000);
    return () => clearTimeout(timeout);
  }, [visible, status]);

  useEffect(() => {
    if (!postId || !ready || !container.current) return;
    const runtime = window as typeof window & {
      twttr?: { widgets: { createTweet: (id: string, element: HTMLElement, options: object) => Promise<unknown> } };
    };
    const host = document.createElement("div");
    container.current.replaceChildren(host);
    let cancelled = false;
    void runtime.twttr?.widgets.createTweet(postId, host, {
      theme: "light", dnt: true, conversation: "none", cards: "visible", align: "center",
    }).then((widget) => {
      if (!cancelled) setStatus(widget ? "loaded" : "unavailable");
    }).catch(() => { if (!cancelled) setStatus("unavailable"); });
    return () => { cancelled = true; host.remove(); };
  }, [postId, ready]);

  return (
    <section className="latest-post section-shell" ref={section} aria-labelledby="latest-post-title">
      <div>
        <p className="eyebrow">From the project</p>
        <h2 id="latest-post-title">The latest world, on X.</h2>
        <p>A daily dispatch from this living installation.</p>
        <a className="secondary-link" href={postId ? `https://x.com/i/status/${postId}` : "https://x.com/aworldeveryday"} target="_blank" rel="noopener noreferrer">
          {postId ? "View post on X ↗" : "Follow the project on X ↗"}
        </a>
      </div>
      <div className="latest-post-widget">
        {status !== "loaded" && <p role="status">{status === "loading" ? "Loading the latest post…" : "The post preview is unavailable. You can view it on X."}</p>}
        <div ref={container} />
      </div>
      {postId && <Script src="https://platform.x.com/widgets.js" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setStatus("unavailable")} />}
    </section>
  );
}
