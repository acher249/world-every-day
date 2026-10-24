import { getNavigationRadius } from "./spatial-navigation";
import { depthOfFieldTarget } from "./viewer-presentation";

export interface FrameCapture {
  info: { version: string; sha256: string; width: number; height: number; initializationMs: number };
  renderFrame(pose?: { yaw: number; pitch: number; drift?: { x: number; y: number; z: number } }): Promise<{ png: string; renderMs: number }>;
  dispose(): void;
}

/** Offline capture. Rendering is explicit and waits for Spark's offline sort. */
export async function createFrameCapture(
  canvas: HTMLCanvasElement, splatUrl: string, sha256: string, signal: AbortSignal,
): Promise<FrameCapture> {
  const started = performance.now();
  const [THREE, { SparkRenderer, SplatMesh }] = await Promise.all([
    import("three"), import("@sparkjsdev/spark"),
  ]);
  const response = await fetch(splatUrl, { signal });
  if (!response.ok) throw new Error(`World download failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 512 * 1024 * 1024) throw new Error("World exceeds the 512 MiB capture limit");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== sha256) throw new Error("World checksum mismatch");
  signal.throwIfAborted();
  const width = 1280, height = 720;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(2 * Math.atan(height / width) * 180 / Math.PI, width / height, 0.01, 1000);
  const spark = new SparkRenderer({ renderer, autoUpdate: false,
    target: { width, height, superXY: 1, colorSpace: THREE.SRGBColorSpace } });
  scene.add(spark);
  const splat = new SplatMesh({ fileBytes: bytes, fileName: "world.spz", raycastable: false });
  splat.quaternion.set(1, 0, 0, 0);
  scene.add(splat);
  let disposed = false, rendering = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    splat.dispose();
    spark.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  try {
    await splat.initialized;
    signal.throwIfAborted();
    scene.updateMatrixWorld(true);
    const size = splat.getBoundingBox().applyMatrix4(splat.matrixWorld).getSize(new THREE.Vector3());
    const dimension = Math.max(size.x, size.y, size.z, 0.01);
    camera.near = Math.max(dimension / 10000, 0.001);
    camera.far = Math.max(dimension * 100, 100);
    camera.updateProjectionMatrix();
    Object.assign(spark, depthOfFieldTarget(getNavigationRadius(dimension), null, false));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Capture image context unavailable");
    return {
      info: { version: "frame-probe-v1", sha256: digest, width, height, initializationMs: performance.now() - started },
      async renderFrame(pose = { yaw: 0, pitch: 0 }) {
        if (disposed || rendering) throw new Error("Capture is disposed or already rendering");
        if (!Number.isFinite(pose.yaw) || !Number.isFinite(pose.pitch) || Math.abs(pose.pitch) > Math.PI / 18) {
          throw new Error("Capture requires a finite heading and pitch within ±10 degrees");
        }
        rendering = true;
        const start = performance.now();
        try {
          const drift = pose.drift ?? { x: 0, y: 0, z: 0 };
          if (![drift.x, drift.y, drift.z].every(Number.isFinite) || Math.hypot(drift.x, drift.y, drift.z) > 0.1 || drift.y < 0) {
            throw new Error("Capture drift must stay above origin and within 10% of navigation radius");
          }
          camera.position.set(drift.x, drift.y, drift.z).multiplyScalar(getNavigationRadius(dimension));
          camera.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
          camera.updateMatrixWorld(true);
          await spark.update({ scene, camera });
          const pixels = await spark.renderReadTarget({ scene, camera });
          const image = context.createImageData(width, height);
          // WebGL readback starts at the bottom; PNG rows start at the top.
          for (let row = 0; row < height; row++) {
            image.data.set(pixels.subarray((height - row - 1) * width * 4, (height - row) * width * 4), row * width * 4);
          }
          context.putImageData(image, 0, 0);
          return { png: output.toDataURL("image/png"), renderMs: performance.now() - start };
        } finally { rendering = false; }
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
