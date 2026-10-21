import { Raycaster, Vector3, type Object3D } from "three";

type Hit = { distance: number; point: Vector3; object: Object3D };
type RaycastWorld = { raycast: (raycaster: Raycaster, hits: Hit[]) => void };
type Point = { x: number; y: number; z: number };

/** Reuse scratch objects for ground and focus-view checks, outside the frame loop. */
export function createCameraQueries(world: RaycastWorld) {
  const raycaster = new Raycaster();
  const origin = new Vector3();
  const direction = new Vector3();
  const hits: Hit[] = [];

  return {
    groundHeight(navigationRadius: number): number | undefined {
      raycaster.set(origin.set(0, 0, 0), direction.set(0, -1, 0));
      raycaster.near = 0.001;
      raycaster.far = Math.max(navigationRadius * 2, 1);
      hits.length = 0;
      world.raycast(raycaster, hits);
      let nearest: Hit | undefined;
      for (const hit of hits) if (!nearest || hit.distance < nearest.distance) nearest = hit;
      return nearest?.point.y;
    },
    visibility(position: Point, target: Point): number {
      origin.set(position.x, position.y, position.z);
      direction.set(target.x - position.x, target.y - position.y, target.z - position.z);
      const distance = direction.length();
      if (distance <= 0.05) return 1;
      raycaster.set(origin, direction.divideScalar(distance));
      raycaster.near = 0.05;
      // Exclude the target's own soft splats from the obstruction check.
      raycaster.far = distance - Math.min(0.6, distance * 0.12);
      if (raycaster.far <= raycaster.near) return 1;
      hits.length = 0;
      world.raycast(raycaster, hits);
      if (hits.length === 0) return 1;
      let closest = Infinity;
      for (const hit of hits) closest = Math.min(closest, hit.distance);
      return Math.max(0, Math.min(1, closest / raycaster.far));
    },
  };
}
