export function parseGoogleKey(secret: string): string {
  let value = secret.trim();
  if (value.startsWith("{")) {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("GOOGLE_AI_API_KEY" in parsed) ||
        typeof parsed.GOOGLE_AI_API_KEY !== "string") {
      throw new Error("Google secret JSON must contain GOOGLE_AI_API_KEY");
    }
    value = parsed.GOOGLE_AI_API_KEY.trim();
  }
  if (!value) throw new Error("Google secret is empty");
  return value;
}
