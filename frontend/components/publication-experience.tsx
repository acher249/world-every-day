"use client";

import { useEffect, useState } from "react";

import { WorldExperience } from "@/components/world-experience";
import { currentEditionPointerSchema, editionDate, resolveEditionRequest, unpublishedCurrentSchema, type PastWorld } from "@/lib/publication-loader";
import { parsePublicationManifest, type PublicationManifest } from "@/lib/publication-schema";

export function PublicationExperience({ fallback }: { fallback: PublicationManifest }) {
  const [publication, setPublication] = useState<PublicationManifest | null>(null);
  const [pastWorlds, setPastWorlds] = useState<PastWorld[]>([]);
  const [currentEditionId, setCurrentEditionId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const requested = new URLSearchParams(window.location.search).get("edition");
        let path: string;
        let expectedHash: string | undefined;
        let expectedEditionId: string | undefined;
        const current = await fetch("/generated/current.json", { cache: "no-store", signal: controller.signal });
        if (!current.ok && current.status !== 404) throw new Error(`Current edition request failed: ${current.status}`);
        const currentPayload: unknown = current.ok ? await current.json() : null;
        const pointer = currentPayload && !unpublishedCurrentSchema.safeParse(currentPayload).success
          ? currentEditionPointerSchema.parse(currentPayload)
          : null;
        if (pointer && !controller.signal.aborted) {
          setPastWorlds(pointer.pastWorlds ?? []);
          setCurrentEditionId(pointer.editionId);
        }
        if (requested) {
          const target = resolveEditionRequest(requested, pointer);
          path = target.publicationUrl;
          expectedHash = target.publicationSha256;
          expectedEditionId = target.editionId;
        } else {
          if (!pointer) {
            setPublication(fallback);
            return;
          }
          path = pointer.publicationUrl;
          expectedHash = pointer.publicationSha256;
          expectedEditionId = pointer.editionId;
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
        if (result.edition.id !== expectedEditionId) throw new Error("Requested edition id mismatch");
        if (!controller.signal.aborted) {
          const date = editionDate(result.edition.id);
          const datedTarget = date && pointer
            ? [pointer, ...(pointer.pastWorlds ?? [])].find((world) => editionDate(world.editionId) === date)
            : null;
          if (requested && date && datedTarget?.editionId === result.edition.id) {
            const url = new URL(window.location.href);
            url.searchParams.set("edition", date);
            window.history.replaceState(window.history.state, "", url);
          }
          setPublication(result);
        }
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
  return <WorldExperience key={publication.edition.id} publication={publication} pastWorlds={pastWorlds} currentEditionId={currentEditionId} />;
}
