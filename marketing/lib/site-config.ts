export type MarketingSiteConfig = {
  explorerUrl: string;
  githubUrl: string;
  siteUrl: string;
};

type Environment = Record<string, string | undefined>;

function publicUrl(value: string | undefined, fallback: string, label: string): string {
  const candidate = value?.trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function resolveMarketingSiteConfig(
  environment: Environment = process.env,
): MarketingSiteConfig {
  return {
    explorerUrl: publicUrl(
      environment.NEXT_PUBLIC_EXPLORER_URL,
      "https://explore.aworldeveryday.com",
      "NEXT_PUBLIC_EXPLORER_URL",
    ),
    githubUrl: publicUrl(
      environment.NEXT_PUBLIC_GITHUB_URL,
      "https://github.com/acher249/world-every-day",
      "NEXT_PUBLIC_GITHUB_URL",
    ),
    siteUrl: publicUrl(
      environment.NEXT_PUBLIC_SITE_URL,
      "https://aworldeveryday.com",
      "NEXT_PUBLIC_SITE_URL",
    ),
  };
}
