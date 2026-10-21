import { equirectangularTargetToDirection, type NormalizedImagePoint } from "@/lib/equirectangular-ray";
import type { Quaternion, Vector3 } from "three";
import { smootherstep } from "@/lib/spatial-navigation";

export function shouldTravelFocus(previousSelection: string | null, nextSelection: string | null, visibleHighlight: string | null): boolean {
  return previousSelection !== null && nextSelection !== null
    && previousSelection !== nextSelection && visibleHighlight !== nextSelection;
}

/** Use elapsed time, not eased camera progress, so settling isn't compressed at arrival. */
export function focusSweepWeight(progress: number): number {
  return smootherstep(progress / 0.22) * (1 - smootherstep((progress - 0.35) / 0.65));
}

/** Follow the camera's turn, preserving interpolated screen-space offsets and depth. */
export function cameraRelativeFocusCenter(
  startView: Vector3, endView: Vector3, progress: number,
  cameraPosition: Vector3, cameraRotation: Quaternion, output: Vector3,
): Vector3 {
  return output.lerpVectors(startView, endView, progress)
    .applyQuaternion(cameraRotation).add(cameraPosition);
}

export type ImageBoundingBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

export function defaultFocusRadius(navigationRadius: number): number {
  return Math.max(navigationRadius * 0.28, 0.8) * 1.3;
}

/** Independent padded half-extents, rather than a circle fitted around the box. */
export function focusShapeForLandmark(
  navigationRadius: number, target: NormalizedImagePoint,
  position: { x: number; y: number; z: number }, box?: ImageBoundingBox,
): { x: number; y: number; z: number } {
  const radius = focusRadiusForLandmark(navigationRadius, target, position, box);
  if (!box || box.xMax <= box.xMin || box.yMax <= box.yMin) return { x: radius * 1.3, y: radius, z: radius * 1.3 };
  const distance = Math.hypot(position.x, position.y, position.z);
  const latitude = (0.5 - target.y) * Math.PI;
  const horizontal = Math.max(Math.abs(target.x - box.xMin), Math.abs(box.xMax - target.x)) * Math.PI * 2 * Math.cos(latitude);
  const vertical = Math.max(Math.abs(target.y - box.yMin), Math.abs(box.yMax - target.y)) * Math.PI;
  const fallback = defaultFocusRadius(navigationRadius);
  const extent = (angle: number) => Math.max(fallback * 0.4,
    Math.min(fallback * 5, 2 * distance * Math.sin(Math.min(angle, Math.PI / 2) / 2) * 1.65));
  return { x: extent(horizontal), y: extent(vertical), z: radius * 1.3 };
}

/** Approximate a panorama landmark's world-space extent without extra splat raycasts. */
export function focusRadiusForLandmark(
  navigationRadius: number,
  imageTarget: NormalizedImagePoint,
  worldPosition: { x: number; y: number; z: number },
  box?: ImageBoundingBox,
): number {
  const fallback = defaultFocusRadius(navigationRadius);
  if (!box || box.xMin >= box.xMax || box.yMin >= box.yMax) return fallback;

  const center = equirectangularTargetToDirection(imageTarget);
  let angle = 0;
  for (const x of [box.xMin, box.xMax]) {
    for (const y of [box.yMin, box.yMax]) {
      const corner = equirectangularTargetToDirection({ x, y });
      const dot = Math.max(-1, Math.min(1, center.x * corner.x + center.y * corner.y + center.z * corner.z));
      angle = Math.max(angle, Math.acos(dot));
    }
  }

  const distance = Math.hypot(worldPosition.x, worldPosition.y, worldPosition.z);
  const estimated = 2 * distance * Math.sin(Math.min(angle, Math.PI / 2) / 2) * 1.12;
  return Math.max(fallback * 0.5, Math.min(fallback * 5, estimated));
}
