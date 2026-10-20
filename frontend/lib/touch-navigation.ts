export type StickValue = { x: number; y: number };

export function stickValueAt(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
): StickValue {
  const radius = Math.min(bounds.width, bounds.height) / 2;
  if (radius <= 0) return { x: 0, y: 0 };
  const x = (clientX - bounds.left - bounds.width / 2) / radius;
  const y = (bounds.top + bounds.height / 2 - clientY) / radius;
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.08) return { x: 0, y: 0 };
  const scale = Math.min(1, magnitude) / magnitude;
  return { x: x * scale, y: y * scale };
}
