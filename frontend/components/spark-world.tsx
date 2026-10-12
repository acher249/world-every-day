"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { OrbitControls as OrbitControlsInstance } from "three/addons/controls/OrbitControls.js";
import type {
  SparkRenderer as SparkRendererInstance,
  SplatMesh as SplatMeshInstance,
} from "@sparkjsdev/spark";

export type ViewerState = "poster" | "loading" | "ready" | "error";

type SparkWorldProps = {
  alt: string;
  onViewerStateChange?: (state: ViewerState) => void;
  posterSrc: string;
  splatUrl?: string;
};

export function SparkWorld({ alt, onViewerStateChange, posterSrc, splatUrl }: SparkWorldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewerState, setViewerState] = useState<ViewerState>(
    splatUrl ? "loading" : "poster",
  );
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    onViewerStateChange?.(viewerState);
  }, [onViewerStateChange, viewerState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !splatUrl) {
      setViewerState("poster");
      return;
    }

    let cancelled = false;
    let renderer: WebGLRenderer | undefined;
    let scene: Scene | undefined;
    let camera: PerspectiveCamera | undefined;
    let controls: OrbitControlsInstance | undefined;
    let spark: SparkRendererInstance | undefined;
    let splat: SplatMeshInstance | undefined;
    let resizeObserver: ResizeObserver | undefined;

    async function initialize() {
      try {
        setViewerState("loading");

        const [{ PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer }, sparkModule, controlsModule] =
          await Promise.all([
            import("three"),
            import("@sparkjsdev/spark"),
            import("three/addons/controls/OrbitControls.js"),
          ]);

        if (cancelled || !canvas) return;

        const context = canvas.getContext("webgl2", {
          alpha: true,
          antialias: false,
          powerPreference: "high-performance",
        });

        if (!context) {
          throw new Error("WebGL 2 is not available on this device.");
        }

        renderer = new WebGLRenderer({ canvas, context, antialias: false, alpha: true });
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

        scene = new Scene();
        camera = new PerspectiveCamera(60, 1, 0.01, 1000);

        spark = new sparkModule.SparkRenderer({ renderer });
        scene.add(spark);

        splat = new sparkModule.SplatMesh({
          url: splatUrl,
          onProgress: (event) => {
            if (!event.lengthComputable || cancelled) return;
            setProgress(Math.round((event.loaded / event.total) * 100));
          },
        });
        splat.quaternion.set(1, 0, 0, 0);
        scene.add(splat);

        await splat.initialized;
        if (cancelled || !renderer || !scene || !camera || !splat) return;

        scene.updateMatrixWorld(true);
        const bounds = splat.getBoundingBox().applyMatrix4(splat.matrixWorld);
        const center = bounds.getCenter(new Vector3());
        const size = bounds.getSize(new Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
        const distance = maxDimension / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.2;

        camera.near = Math.max(maxDimension / 10000, 0.001);
        camera.far = Math.max(maxDimension * 100, 100);
        camera.position.copy(center).add(new Vector3(0, maxDimension * 0.08, distance));
        camera.updateProjectionMatrix();

        controls = new controlsModule.OrbitControls(camera, canvas);
        controls.target.copy(center);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.minDistance = maxDimension * 0.08;
        controls.maxDistance = maxDimension * 4;
        controls.update();

        const resize = () => {
          if (!renderer || !camera) return;
          const width = canvas.clientWidth;
          const height = canvas.clientHeight;
          if (!width || !height) return;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();

        renderer.setAnimationLoop(() => {
          controls?.update();
          if (renderer && scene && camera) renderer.render(scene, camera);
        });

        setProgress(100);
        setViewerState("ready");
      } catch (error) {
        if (!cancelled) {
          console.error("Spark.js world failed to initialize", error);
          setViewerState("error");
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      renderer?.setAnimationLoop(null);
      controls?.dispose();
      splat?.dispose();
      spark?.dispose();
      renderer?.dispose();
    };
  }, [splatUrl]);

  const showPoster = viewerState !== "ready";

  return (
    <div className="spark-world" data-viewer-state={viewerState}>
      <Image
        className="world-poster"
        src={posterSrc}
        alt={alt}
        fill
        priority
        sizes="100vw"
        aria-hidden={viewerState === "ready"}
      />
      <canvas
        ref={canvasRef}
        className="spark-canvas"
        aria-label={splatUrl ? `Interactive 3D world. ${alt}` : undefined}
        aria-hidden={!splatUrl || showPoster}
      />
      {splatUrl && viewerState === "loading" ? (
        <div className="spark-status" role="status">
          <span className="spark-status-orbit" aria-hidden="true" />
          Loading spatial world{progress === null ? "" : ` · ${progress}%`}
        </div>
      ) : null}
      {viewerState === "error" ? (
        <p className="spark-fallback-note" role="status">
          Spatial view unavailable · Showing today&apos;s image
        </p>
      ) : null}
      {!splatUrl ? <span className="poster-badge">Image preview · Spark.js ready</span> : null}
    </div>
  );
}

