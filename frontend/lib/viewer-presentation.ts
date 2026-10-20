import { smootherstep } from "@/lib/spatial-navigation";

/** Marker artwork changes size; its button and tooltip do not. */
export function hotspotVisualScale(screenX: number, screenY: number): number {
  const edge = Math.min(1, Math.max(Math.abs(screenX - 50), Math.abs(screenY - 50)) / 50);
  return 0.8 + 0.55 * (1 - smootherstep(edge));
}

/** Horizontal rotation needed to frame a target beside a right-hand panel. */
export function focusPanelYaw(width: number, panelWidth: number, aspect: number, verticalFovDegrees: number): number {
  if (width <= 0 || panelWidth <= 0 || panelWidth >= width) return 0;
  const targetNdcX = -panelWidth / width;
  return Math.atan(targetNdcX * aspect * Math.tan(verticalFovDegrees * Math.PI / 360));
}

/** Explicit story cycling wins over incidental hover as markers cross the cursor. */
export function focusEffectId(
  requestedId: string | null,
  hoveredId: string | null,
  panelOpen: boolean,
  cycling: boolean,
): string | null {
  return cycling ? requestedId : hoveredId ?? (panelOpen ? requestedId : null);
}
