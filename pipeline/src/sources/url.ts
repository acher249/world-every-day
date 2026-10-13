const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

export function canonicalizeSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Source URLs must use HTTPS");
  if (url.username || url.password) throw new Error("Source URLs must not contain credentials");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

export function hostnameAllowed(url: URL, allowedHosts: readonly string[]): boolean {
  const hostname = url.hostname.toLowerCase();
  return allowedHosts.some((value) => {
    const allowed = value.toLowerCase();
    return hostname === allowed || hostname.endsWith(`.${allowed}`);
  });
}

