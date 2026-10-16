export function resolveProjectSiteUrl(configuredUrl: string | undefined): string {
  const value = configuredUrl?.trim() || "https://aworldeveryday.com";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_PROJECT_SITE_URL must be an absolute HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_PROJECT_SITE_URL must use HTTP or HTTPS");
  }
  return url.toString();
}
