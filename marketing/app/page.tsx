import { MarketingExperience } from "@/components/marketing-experience";
import { resolveMarketingSiteConfig } from "@/lib/site-config";

export default function Home() {
  return <MarketingExperience {...resolveMarketingSiteConfig()} />;
}
