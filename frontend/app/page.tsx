import { WorldExperience } from "@/components/world-experience";
import demoPublication from "@/data/fixtures/demo-publication.v1.json";
import { parsePublicationManifest } from "@/lib/publication-schema";

export default function Home() {
  const publication = parsePublicationManifest(demoPublication);

  return <WorldExperience publication={publication} />;
}

