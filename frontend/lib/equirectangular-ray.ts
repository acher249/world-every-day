export type NormalizedImagePoint = { x: number; y: number };

export function equirectangularTargetToDirection({
  x,
  y,
}: NormalizedImagePoint): { x: number; y: number; z: number } {
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error("Equirectangular targets must use normalized coordinates");
  }

  const longitude = (x - 0.5) * Math.PI * 2;
  const latitude = (0.5 - y) * Math.PI;
  const latitudeRadius = Math.cos(latitude);

  return {
    x: Math.sin(longitude) * latitudeRadius,
    y: Math.sin(latitude),
    z: -Math.cos(longitude) * latitudeRadius,
  };
}
