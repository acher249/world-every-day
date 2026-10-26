export type ImagePoint = { x: number; y: number };
export type LandmarkBounds = { xMin: number; yMin: number; xMax: number; yMax: number };
export type LandmarkRayTarget = ImagePoint & { id: string; boundingBox?: LandmarkBounds; storyId?: string };
export type SurfaceSample = {
  imageTarget: ImagePoint;
  point: { x: number; y: number; z: number };
  distance: number;
};

function inside(point: ImagePoint, bounds: LandmarkBounds): boolean {
  return point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax;
}

/** Story echoes may share their own story's region, but cannot claim another story. */
export function landmarkExclusionBounds(target: LandmarkRayTarget, targets: LandmarkRayTarget[]): LandmarkBounds[] {
  return targets.filter((other) => !other.storyId && other.id !== target.id && other.id !== target.storyId)
    .flatMap((other) => other.boundingBox ? [other.boundingBox] : []);
}

/** Sample the whole region, including the frame of hollow objects. */
export function landmarkRayTargets(target: ImagePoint, bounds?: LandmarkBounds, excluded: LandmarkBounds[] = []): ImagePoint[] {
  if (!bounds) return excluded.some((box) => inside(target, box)) ? [] : [target];
  const points = [target];
  for (const y of [0.08, 0.29, 0.5, 0.71, 0.92]) {
    for (const x of [0.08, 0.29, 0.5, 0.71, 0.92]) {
      const point = {
        x: bounds.xMin + (bounds.xMax - bounds.xMin) * x,
        y: bounds.yMin + (bounds.yMax - bounds.yMin) * y,
      };
      if (!points.some((entry) => Math.hypot(entry.x - point.x, entry.y - point.y) < 1e-6)) points.push(point);
    }
  }
  return points.filter((point) => !excluded.some((box) => inside(point, box)));
}

/** Prefer supported geometry near the intended image target, never an average inside a hole. */
export function selectLandmarkSurface(samples: SurfaceSample[], target: ImagePoint, bounds?: LandmarkBounds, excluded: LandmarkBounds[] = []) {
  const valid = samples.filter((sample) => Number.isFinite(sample.distance) && sample.distance > 0 &&
    Object.values(sample.point).every(Number.isFinite) &&
    (!bounds || inside(sample.imageTarget, bounds)) && !excluded.some((box) => inside(sample.imageTarget, box)));
  if (!bounds) return valid[0] ?? null;
  const width = bounds.xMax - bounds.xMin;
  const height = bounds.yMax - bounds.yMin;
  if (width <= 0 || height <= 0) return null;
  const imageDistance = (a: ImagePoint, b: ImagePoint) => Math.hypot((a.x - b.x) / width, (a.y - b.y) / height);
  const minimumSupport = Math.max(3, Math.ceil(valid.length * 0.12));
  const ordered = [...valid].sort((a, b) => a.distance - b.distance);
  const candidates = new Set<SurfaceSample>();
  for (const nearest of ordered) {
    // A bounded depth band avoids chaining foreground and distant background together.
    const band = ordered.filter((sample) => sample.distance >= nearest.distance && sample.distance <= nearest.distance * 1.25);
    const supported = band.filter((sample) => band.filter((neighbor) =>
      imageDistance(sample.imageTarget, neighbor.imageTarget) <= 0.32).length >= 2);
    if (supported.length < minimumSupport) continue;
    for (const sample of supported) candidates.add(sample);
  }
  return [...candidates].sort((a, b) => imageDistance(a.imageTarget, target) - imageDistance(b.imageTarget, target) || a.distance - b.distance)[0] ?? null;
}
