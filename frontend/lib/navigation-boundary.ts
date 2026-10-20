export const boundaryLongitudeSegments = 32;
export const boundaryLatitudeSegments = 16;
export const boundaryCircleColumns = boundaryLongitudeSegments * 7;
export const boundaryCircleRows = boundaryLatitudeSegments * 7;

/** Reveal the navigation limit only in the outer quarter of the world. */
export function boundaryOpacity(distanceFromOrigin: number, navigationRadius: number): number {
  if (navigationRadius <= 0) return 0;
  const t = Math.max(0, Math.min(1, (distanceFromOrigin / navigationRadius - 0.75) / 0.23));
  return t * t * (3 - 2 * t);
}

export const boundaryVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const boundaryFragmentShader = `
  uniform float boundaryOpacity;
  uniform float boundaryRadius;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vec3 toCamera = vWorldPosition - cameraPosition;
    float normalizedDistanceSquared = dot(toCamera, toCamera) / (boundaryRadius * boundaryRadius);
    float nearby = 1.0 - smoothstep(0.09, 1.96, normalizedDistanceSquared);
    if (nearby < 0.001) discard;

    vec2 cell = fract(vUv * vec2(${boundaryCircleColumns}.0, ${boundaryCircleRows}.0));
    float circleProximity = 1.0 - smoothstep(0.0036, 0.25, normalizedDistanceSquared);
    float circleRadius = mix(0.05, 0.48, circleProximity);
    float ringWidth = mix(0.012, 0.023, circleProximity);
    float circleDistance = length(cell - 0.5);
    float circle = 1.0 - smoothstep(ringWidth * 0.35, ringWidth, abs(circleDistance - circleRadius));
    float edgeDistance = min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y));
    float grid = 1.0 - smoothstep(0.002, 0.026, edgeDistance);
    float alpha = boundaryOpacity * nearby * (circle * 0.48 + grid * mix(0.13, 0.3, circleProximity) + 0.015);
    gl_FragColor = vec4(0.38, 0.96, 0.91, alpha);
  }
`;
