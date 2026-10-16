export type Point3 = { x: number; y: number; z: number };

const MINIMUM_FOCUS_DISTANCE = 2.5;
const FOCUS_STANDOFF_RATIO = 0.9;
const MAX_NAVIGATION_RADIUS = 5.3703;
const MIN_NAVIGATION_RADIUS = 0.25;

export function smootherstep(progress: number) {
  const t = Math.max(0, Math.min(progress, 1));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function getNavigationRadius(maxDimension: number) {
  return Math.max(
    MIN_NAVIGATION_RADIUS,
    Math.min(maxDimension * 0.15, MAX_NAVIGATION_RADIUS),
  );
}

export function getNavigationFloor(radius: number, groundHeight?: number) {
  if (groundHeight !== undefined && Number.isFinite(groundHeight)) {
    return Math.min(0, groundHeight + 0.4);
  }
  return -Math.min(radius * 0.05, 0.25);
}

export function clampToNavigationSphere(point: Point3, radius: number) {
  const distance = Math.hypot(point.x, point.y, point.z);
  if (distance <= radius || distance < Number.EPSILON) return point;

  const scale = radius / distance;
  point.x *= scale;
  point.y *= scale;
  point.z *= scale;
  return point;
}

export function clampToNavigationBounds(
  point: Point3,
  radius: number,
  floor = getNavigationFloor(radius),
) {
  clampToNavigationSphere(point, radius);
  point.y = Math.max(point.y, floor);
  return point;
}

export function getFocusPosition(
  target: Point3,
  navigationRadius: number,
  floor = getNavigationFloor(navigationRadius),
): Point3 {
  const targetDistance = Math.hypot(target.x, target.y, target.z);
  if (targetDistance < Number.EPSILON) return { x: 0, y: 0, z: 0 };

  const standoffDistance = Math.max(
    MINIMUM_FOCUS_DISTANCE,
    targetDistance * FOCUS_STANDOFF_RATIO,
  );
  const cameraDistanceFromOrigin = targetDistance - standoffDistance;
  const scale = cameraDistanceFromOrigin / targetDistance;
  const position = {
    x: target.x * scale,
    y: target.y * scale,
    z: target.z * scale,
  };
  clampToNavigationBounds(position, navigationRadius, floor);
  const distanceToTarget = Math.hypot(
    target.x - position.x,
    target.y - position.y,
    target.z - position.z,
  );
  if (distanceToTarget < standoffDistance) {
    const horizontalDistance = Math.hypot(position.x - target.x, position.z - target.z);
    const requiredHorizontalDistance = Math.sqrt(Math.max(
      0,
      standoffDistance ** 2 - (position.y - target.y) ** 2,
    ));
    const directionX = horizontalDistance > Number.EPSILON
      ? (position.x - target.x) / horizontalDistance : 0;
    const directionZ = horizontalDistance > Number.EPSILON
      ? (position.z - target.z) / horizontalDistance : 1;
    position.x = target.x + directionX * requiredHorizontalDistance;
    position.z = target.z + directionZ * requiredHorizontalDistance;
    clampToNavigationBounds(position, navigationRadius, floor);
  }
  return position;
}

export function cycleId(ids: string[], currentId: string | null, direction: -1 | 1) {
  if (ids.length === 0) return null;
  const currentIndex = currentId === null ? -1 : ids.indexOf(currentId);
  if (currentIndex < 0) return direction > 0 ? ids[0] : ids.at(-1) ?? null;
  return ids[(currentIndex + direction + ids.length) % ids.length] ?? null;
}
