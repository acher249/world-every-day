export function canRenderWorldInteractions({
  interactionSplatSha256,
  renderedSplatSha256,
  splatUrl,
}: {
  interactionSplatSha256: string;
  renderedSplatSha256?: string;
  splatUrl?: string;
}): boolean {
  if (!splatUrl) return true;
  return renderedSplatSha256 === interactionSplatSha256;
}
