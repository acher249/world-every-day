/** Accept identifiers only, never provider-supplied HTML or URLs. */
export function latestPostId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === "1.0.0" && typeof record.postId === "string" &&
    /^[0-9]{1,30}$/.test(record.postId) ? record.postId : null;
}
