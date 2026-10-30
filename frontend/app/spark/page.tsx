import { PublicationExperience } from "@/components/publication-experience";
import { loadFallbackPublication } from "@/lib/server-publication";

export default async function SparkViewer() {
  const publication = await loadFallbackPublication();
  return <PublicationExperience fallback={publication} renderer="spark" />;
}
