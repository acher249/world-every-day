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

/** Keep the idle scene gently focused; focus a landmark as it is highlighted. */
export function depthOfFieldTarget(
  navigationRadius: number,
  anchorDistance: number | null,
  mobile: boolean,
): { focalDistance: number; apertureAngle: number } {
  const idleDistance = Math.max(navigationRadius * 0.7, 2);
  const idleAperture = mobile ? 0.0025 : 0.0032;
  if (anchorDistance === null) {
    return { focalDistance: idleDistance, apertureAngle: idleAperture };
  }
  const distance = Math.max(anchorDistance, 0.1);
  const proximity = Math.max(0, Math.min(1, 1 - distance / idleDistance));
  return {
    focalDistance: distance,
    apertureAngle: idleAperture * (0.75 - proximity * 0.25),
  };
}

/** Bound splat fill rate on touch layouts without changing desktop sharpness. */
export function viewerPixelRatio(devicePixelRatio: number, mobile: boolean): number {
  return Math.min(Math.max(devicePixelRatio, 1), mobile ? 1.25 : 1.5);
}
