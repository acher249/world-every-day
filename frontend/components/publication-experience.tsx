"use client";

import { useEffect, useState } from "react";

import { WorldExperience } from "@/components/world-experience";
import { currentEditionPointerSchema, publicationPathForEdition, unpublishedCurrentSchema } from "@/lib/publication-loader";
import { parsePublicationManifest, type PublicationManifest } from "@/lib/publication-schema";

export function PublicationExperience({ fallback }: { fallback: PublicationManifest }) {
  const [publication, setPublication] = useState<PublicationManifest | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const requested = new URLSearchParams(window.location.search).get("edition");
        let path: string;
        let expectedHash: string | undefined;
        if (requested) {
          path = publicationPathForEdition(requested);
        } else {
          const current = await fetch("/generated/current.json", { cache: "no-store", signal: controller.signal });
          if (current.status === 404) {
            setPublication(fallback);
            return;
          }
          if (!current.ok) throw new Error(`Current edition request failed: ${current.status}`);
          const currentPayload: unknown = await current.json();
          if (unpublishedCurrentSchema.safeParse(currentPayload).success) {
            setPublication(fallback);
            return;
          }
          const pointer = currentEditionPointerSchema.parse(currentPayload);
          path = pointer.publicationUrl;
          expectedHash = pointer.publicationSha256;
        }
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok) throw new Error(`Publication request failed: ${response.status}`);
        const contents = await response.text();
        if (expectedHash) {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contents));
          const actual = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
          if (actual !== expectedHash) throw new Error("Current publication checksum mismatch");
        }
        const result = parsePublicationManifest(JSON.parse(contents));
        if (result.edition.status !== "published") throw new Error("Requested edition is not published");
        if (requested && result.edition.id !== requested) throw new Error("Requested edition id mismatch");
        if (!controller.signal.aborted) setPublication(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Could not load the published world", error);
        setPublication(fallback);
      }
    }
    void load();
    return () => controller.abort();
  }, [fallback]);

  if (!publication) return (
    <div className="world-app">
      <div className="spark-loading" role="status">
        <span className="spark-loading-dot" aria-hidden="true" />
        <span>Loading world</span>
      </div>
    </div>
  );
  return <WorldExperience key={publication.edition.id} publication={publication} />;
}
