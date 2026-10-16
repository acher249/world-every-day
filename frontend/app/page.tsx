import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { PublicationExperience } from "@/components/publication-experience";
import demoPublication from "@/data/fixtures/demo-publication.v1.json";
import { parsePublicationManifest } from "@/lib/publication-schema";

async function loadPublication() {
  const localManifest = process.env.LOCAL_PUBLICATION_MANIFEST;
  if (!localManifest) return parsePublicationManifest(demoPublication);
  if (basename(localManifest) !== localManifest || !localManifest.endsWith(".json")) {
    throw new Error("LOCAL_PUBLICATION_MANIFEST must be a JSON filename in public/generated");
  }

  const contents = await readFile(
    join(process.cwd(), "public", "generated", localManifest),
    "utf8",
  );
  return parsePublicationManifest(JSON.parse(contents));
}

export default async function Home() {
  const publication = await loadPublication();

  return <PublicationExperience fallback={publication} />;
}

