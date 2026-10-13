"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type {
  SparkRenderer as SparkRendererInstance,
  SplatMesh as SplatMeshInstance,
} from "@sparkjsdev/spark";
import {
  clampToNavigationSphere,
  getFocusPosition,
  getNavigationRadius,
  smootherstep,
} from "@/lib/spatial-navigation";
import { equirectangularTargetToDirection } from "@/lib/equirectangular-ray";

export type ViewerState = "poster" | "loading" | "ready" | "error";

export type WorldAnchor = {
  active: boolean;
  fallbackScreenPosition: { x: number; y: number };
  id: string;
  label: string;
  number: string;
  tone: "cyan" | "amber" | "green";
  worldPosition: { x: number; y: number; z: number };
};

type SparkWorldProps = {
  focusedAnchorId?: string | null;
  alt: string;
  anchors?: WorldAnchor[];
  onAnchorSelect?: (id: string) => void;
  onViewerStateChange?: (state: ViewerState) => void;
  posterSrc: string;
  splatUrl?: string;
};

export function SparkWorld({
  focusedAnchorId = null,
  alt,
  anchors = [],
  onAnchorSelect,
  onViewerStateChange,
  posterSrc,
  splatUrl,
}: SparkWorldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const anchorsRef = useRef(anchors);
  const focusedAnchorIdRef = useRef(focusedAnchorId);
  const [viewerState, setViewerState] = useState<ViewerState>(
    splatUrl ? "loading" : "poster",
  );
  const [progress, setProgress] = useState<number | null>(null);
  anchorsRef.current = anchors;
  focusedAnchorIdRef.current = focusedAnchorId;

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
    let spark: SparkRendererInstance | undefined;
    let splat: SplatMeshInstance | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const removeInputListeners: Array<() => void> = [];

    async function initialize() {
      try {
        setViewerState("loading");

        const [{ Euler, Matrix4, Object3D, PerspectiveCamera, Quaternion, Raycaster, Scene, SRGBColorSpace, Vector3, WebGLRenderer }, sparkModule] =
          await Promise.all([
            import("three"),
            import("@sparkjsdev/spark"),
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
        const cameraFloatRig = new Object3D();
        cameraFloatRig.add(camera);
        scene.add(cameraFloatRig);

        spark = new sparkModule.SparkRenderer({
          renderer,
          minSortIntervalMs: 32,
        });
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
        const size = bounds.getSize(new Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
        const navigationRadius = getNavigationRadius(maxDimension);

        camera.near = Math.max(maxDimension / 10000, 0.001);
        camera.far = Math.max(maxDimension * 100, 100);
        camera.position.set(0, 0, 0);
        camera.updateProjectionMatrix();

        if (process.env.NODE_ENV === "development") {
          const developmentWindow = window as typeof window & {
            __WORLD_EVERY_DAY_BAKE__?: (targets: Array<{
              id: string;
              x: number;
              y: number;
            }>) => Array<{
              id: string;
              imageTarget: { x: number; y: number };
              worldPosition: { x: number; y: number; z: number } | null;
            }>;
          };
          developmentWindow.__WORLD_EVERY_DAY_BAKE__ = (targets) => {
            scene?.updateMatrixWorld(true);
            const raycaster = new Raycaster();
            raycaster.near = Math.max(maxDimension / 10000, 0.001);
            raycaster.far = Math.max(maxDimension * 100, 100);

            return targets.map(({ id, x, y }) => {
              const direction = equirectangularTargetToDirection({ x, y });
              raycaster.set(
                new Vector3(0, 0, 0),
                new Vector3(direction.x, direction.y, direction.z).normalize(),
              );
              const intersections: Array<{
                distance: number;
                point: InstanceType<typeof Vector3>;
                object: InstanceType<typeof Object3D>;
              }> = [];
              splat?.raycast(raycaster, intersections);
              intersections.sort((first, second) => first.distance - second.distance);
              const point = intersections[0]?.point;
              return {
                id,
                imageTarget: { x, y },
                worldPosition: point
                  ? { x: point.x, y: point.y, z: point.z }
                  : null,
              };
            });
          };
        }

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

        let yaw = 0;
        let pitch = 0;
        let dragging = false;
        let lastPointerX = 0;
        let lastPointerY = 0;
        const pressedKeys = new Set<string>();
        const cameraEuler = new Euler(0, 0, 0, "YXZ");
        const cameraFloatEuler = new Euler(0, 0, 0, "YXZ");
        const initialCameraPosition = new Vector3(0, 0, 0);
        const initialCameraRotation = new Quaternion();
        const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        let focusTransition: {
          duration: number;
          elapsed: number;
          position: InstanceType<typeof Vector3>;
          rotation: InstanceType<typeof Quaternion>;
          startPosition: InstanceType<typeof Vector3>;
          startRotation: InstanceType<typeof Quaternion>;
        } | null = null;
        let lastFocusedAnchorId: string | null = null;

        const updateCameraRotation = () => {
          cameraEuler.set(pitch, yaw, 0);
          camera?.quaternion.setFromEuler(cameraEuler);
        };
        const cancelCameraFocus = () => {
          if (!focusTransition || !camera) return;
          focusTransition = null;
          cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
          pitch = cameraEuler.x;
          yaw = cameraEuler.y;
        };
        const onKeyDown = (event: KeyboardEvent) => {
          const target = event.target;
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement ||
            (target instanceof HTMLElement && target.isContentEditable)
          ) return;
          if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"].includes(event.code)) {
            event.preventDefault();
            cancelCameraFocus();
            pressedKeys.add(event.code);
          }
        };
        const onKeyUp = (event: KeyboardEvent) => pressedKeys.delete(event.code);
        const onPointerDown = (event: PointerEvent) => {
          if (event.button !== 0) return;
          cancelCameraFocus();
          canvas.focus();
          dragging = true;
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          canvas.setPointerCapture(event.pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
          if (!dragging) return;
          yaw -= (event.clientX - lastPointerX) * 0.0025;
          pitch -= (event.clientY - lastPointerY) * 0.0025;
          pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          updateCameraRotation();
        };
        const onPointerUp = (event: PointerEvent) => {
          dragging = false;
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        };
        const onWheel = (event: WheelEvent) => {
          if (!camera) return;
          event.preventDefault();
          cancelCameraFocus();
          const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          camera.position.addScaledVector(forward, event.deltaY * -maxDimension * 0.00022);
          clampToNavigationSphere(camera.position, navigationRadius);
        };
        const onBlur = () => pressedKeys.clear();

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        removeInputListeners.push(
          () => window.removeEventListener("keydown", onKeyDown),
          () => window.removeEventListener("keyup", onKeyUp),
          () => window.removeEventListener("blur", onBlur),
          () => canvas.removeEventListener("pointerdown", onPointerDown),
          () => canvas.removeEventListener("pointermove", onPointerMove),
          () => canvas.removeEventListener("pointerup", onPointerUp),
          () => canvas.removeEventListener("pointercancel", onPointerUp),
          () => canvas.removeEventListener("wheel", onWheel),
        );

        const projectedAnchor = new Vector3();
        const anchorInCameraSpace = new Vector3();
        const projectedAnchorPositions = new Map<string, { x: number; y: number }>();
        const movement = new Vector3();
        const velocity = new Vector3();
        const targetVelocity = new Vector3();
        const forward = new Vector3();
        const right = new Vector3();
        const up = new Vector3(0, 1, 0);
        const focusTarget = new Vector3();
        const focusDirection = new Vector3();
        const focusLookMatrix = new Matrix4();
        const focusRotation = new Quaternion();
        const flightSpeed = Math.max(maxDimension * 0.014, 0.08);
        const floatPositionAmplitude = Math.min(
          navigationRadius * 0.034,
          maxDimension * 0.0056,
        );
        const floatRotationAmplitude = 0.011;
        const floatPhase = Math.random() * Math.PI * 2;
        let cameraFloatTime = 0;
        let previousFrameTime = performance.now();

        renderer.setAnimationLoop(() => {
          if (renderer && scene && camera && splat) {
            const frameTime = performance.now();
            const deltaSeconds = Math.min((frameTime - previousFrameTime) / 1000, 0.1);
            previousFrameTime = frameTime;
            const requestedFocusId = focusedAnchorIdRef.current;
            if (requestedFocusId !== lastFocusedAnchorId) {
              const previousFocusedAnchorId = lastFocusedAnchorId;
              lastFocusedAnchorId = requestedFocusId;
              focusTransition = null;
              const anchor = anchorsRef.current.find(({ id }) => id === requestedFocusId);
              let destination: InstanceType<typeof Vector3> | null = null;
              let destinationRotation: InstanceType<typeof Quaternion> | null = null;
              if (anchor) {
                focusTarget.set(anchor.worldPosition.x, anchor.worldPosition.y, anchor.worldPosition.z);
                const focusPosition = getFocusPosition(anchor.worldPosition, navigationRadius);
                destination = focusDirection.set(
                  focusPosition.x,
                  focusPosition.y,
                  focusPosition.z,
                );
                focusLookMatrix.lookAt(destination, focusTarget, up);
                focusRotation.setFromRotationMatrix(focusLookMatrix);
                destinationRotation = focusRotation;
              } else if (requestedFocusId === null && previousFocusedAnchorId !== null) {
                destination = initialCameraPosition;
                destinationRotation = initialCameraRotation;
              }

              if (destination && destinationRotation) {
                velocity.set(0, 0, 0);
                if (reducedMotionQuery.matches) {
                  camera.position.copy(destination);
                  camera.quaternion.copy(destinationRotation);
                  cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
                  pitch = cameraEuler.x;
                  yaw = cameraEuler.y;
                } else {
                  focusTransition = {
                    duration: 1.75,
                    elapsed: 0,
                    position: destination.clone(),
                    rotation: destinationRotation.clone(),
                    startPosition: camera.position.clone(),
                    startRotation: camera.quaternion.clone(),
                  };
                }
              }
            }

            if (focusTransition) {
              focusTransition.elapsed = Math.min(
                focusTransition.elapsed + deltaSeconds,
                focusTransition.duration,
              );
              const transitionProgress = smootherstep(
                focusTransition.elapsed / focusTransition.duration,
              );
              camera.position.lerpVectors(
                focusTransition.startPosition,
                focusTransition.position,
                transitionProgress,
              );
              clampToNavigationSphere(camera.position, navigationRadius);
              camera.quaternion.slerpQuaternions(
                focusTransition.startRotation,
                focusTransition.rotation,
                transitionProgress,
              );
              if (focusTransition.elapsed >= focusTransition.duration) {
                camera.position.copy(focusTransition.position);
                camera.quaternion.copy(focusTransition.rotation);
                focusTransition = null;
                cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
                pitch = cameraEuler.x;
                yaw = cameraEuler.y;
              }
            } else {
              movement.set(0, 0, 0);
              forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
              right.set(1, 0, 0).applyQuaternion(camera.quaternion);
              if (pressedKeys.has("KeyW")) movement.add(forward);
              if (pressedKeys.has("KeyS")) movement.sub(forward);
              if (pressedKeys.has("KeyD")) movement.add(right);
              if (pressedKeys.has("KeyA")) movement.sub(right);
              if (pressedKeys.has("KeyE")) movement.add(up);
              if (pressedKeys.has("KeyQ")) movement.sub(up);
              if (movement.lengthSq() > 0) {
                const boost = pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight") ? 3 : 1;
                targetVelocity.copy(movement).normalize().multiplyScalar(flightSpeed * boost);
              } else {
                targetVelocity.set(0, 0, 0);
              }

              const dampingRate = movement.lengthSq() > 0 ? 5.5 : 4;
              velocity.lerp(targetVelocity, 1 - Math.exp(-dampingRate * deltaSeconds));
              if (targetVelocity.lengthSq() === 0 && velocity.lengthSq() < 0.000001) {
                velocity.set(0, 0, 0);
              }
              camera.position.addScaledVector(velocity, deltaSeconds);
              clampToNavigationSphere(camera.position, navigationRadius);
            }

            if (reducedMotionQuery.matches) {
              cameraFloatRig.position.set(0, 0, 0);
              cameraFloatRig.quaternion.identity();
            } else {
              cameraFloatTime += deltaSeconds;
              cameraFloatRig.position.set(
                (
                  Math.sin(cameraFloatTime * 0.23 + floatPhase) +
                  Math.sin(cameraFloatTime * 0.41 + floatPhase * 0.7) * 0.35
                ) * floatPositionAmplitude,
                (
                  Math.sin(cameraFloatTime * 0.19 + floatPhase + 1.8) +
                  Math.sin(cameraFloatTime * 0.37 + floatPhase * 1.2) * 0.3
                ) * floatPositionAmplitude * 0.7,
                Math.sin(cameraFloatTime * 0.17 + floatPhase + 3.4) *
                  floatPositionAmplitude * 0.45,
              );
              cameraFloatEuler.set(
                (
                  Math.sin(cameraFloatTime * 0.16 + floatPhase + 0.9) +
                  Math.sin(cameraFloatTime * 0.31 + floatPhase) * 0.22
                ) * floatRotationAmplitude * 0.72,
                (
                  Math.sin(cameraFloatTime * 0.14 + floatPhase + 2.1) +
                  Math.sin(cameraFloatTime * 0.29 + floatPhase * 0.8) * 0.24
                ) * floatRotationAmplitude,
                Math.sin(cameraFloatTime * 0.12 + floatPhase + 4.2) *
                  floatRotationAmplitude * 0.38,
              );
              cameraFloatRig.quaternion.setFromEuler(cameraFloatEuler);
            }

            renderer.render(scene, camera);
            camera.updateMatrixWorld();

            for (const anchor of anchorsRef.current) {
              const element = anchorElementsRef.current.get(anchor.id);
              if (!element) continue;

              projectedAnchor.set(
                anchor.worldPosition.x,
                anchor.worldPosition.y,
                anchor.worldPosition.z,
              );
              anchorInCameraSpace
                .copy(projectedAnchor)
                .applyMatrix4(camera.matrixWorldInverse);
              projectedAnchor.project(camera);

              const visible =
                anchorInCameraSpace.z < 0 &&
                projectedAnchor.z >= -1 &&
                projectedAnchor.z <= 1 &&
                Math.abs(projectedAnchor.x) <= 1.08 &&
                Math.abs(projectedAnchor.y) <= 1.08;

              const screenX = (projectedAnchor.x * 0.5 + 0.5) * 100;
              const screenY = (-projectedAnchor.y * 0.5 + 0.5) * 100;
              const previousPosition = projectedAnchorPositions.get(anchor.id);
              if (
                !previousPosition ||
                Math.abs(screenX - previousPosition.x) > 0.005 ||
                Math.abs(screenY - previousPosition.y) > 0.005
              ) {
                element.style.transform = `translate3d(${screenX}vw, ${screenY}vh, 0) translate(-50%, -50%)`;
                projectedAnchorPositions.set(anchor.id, { x: screenX, y: screenY });
              }
              if (element.dataset.visible !== String(visible)) {
                element.dataset.visible = String(visible);
                element.style.opacity = visible ? "1" : "0";
                element.style.visibility = visible ? "visible" : "hidden";
                element.style.pointerEvents = visible ? "auto" : "none";
                element.tabIndex = visible ? 0 : -1;
                element.setAttribute("aria-hidden", visible ? "false" : "true");
              }
            }
          }
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
      if (process.env.NODE_ENV === "development") {
        delete (window as typeof window & {
          __WORLD_EVERY_DAY_BAKE__?: unknown;
        }).__WORLD_EVERY_DAY_BAKE__;
      }
      resizeObserver?.disconnect();
      removeInputListeners.forEach((remove) => remove());
      renderer?.setAnimationLoop(null);
      splat?.dispose();
      spark?.dispose();
      renderer?.dispose();
    };
  }, [splatUrl]);

  const showPoster = viewerState === "poster" || viewerState === "error";

  return (
    <div className="spark-world" data-viewer-state={viewerState}>
      {showPoster ? (
        <Image
          className="world-poster"
          src={posterSrc}
          alt={alt}
          fill
          priority={!splatUrl}
          sizes="100vw"
        />
      ) : null}
      <canvas
        ref={canvasRef}
        className="spark-canvas"
        tabIndex={splatUrl ? 0 : -1}
        aria-label={splatUrl ? `Interactive 3D world. ${alt}` : undefined}
        aria-hidden={viewerState !== "ready"}
      />
      {anchors.map((anchor) => (
        <button
          key={anchor.id}
          ref={(element) => {
            if (element) anchorElementsRef.current.set(anchor.id, element);
            else anchorElementsRef.current.delete(anchor.id);
          }}
          className={`hotspot hotspot-${anchor.tone} ${anchor.active ? "is-active" : ""}`}
          data-anchor-id={anchor.id}
          data-anchor-state="baked"
          style={{
            transform: `translate3d(${anchor.fallbackScreenPosition.x * 100}vw, ${anchor.fallbackScreenPosition.y * 100}vh, 0) translate(-50%, -50%)`,
          }}
          onClick={() => onAnchorSelect?.(anchor.id)}
          aria-label={`Explore story ${anchor.number}: ${anchor.label}`}
          aria-pressed={anchor.active}
        >
          <span className="hotspot-pulse" aria-hidden="true" />
          <span className="hotspot-core">{anchor.number}</span>
          <span className="hotspot-label">{anchor.label}</span>
        </button>
      ))}
      {splatUrl && viewerState === "loading" ? (
        <div className="spark-loading" role="status">
          <span className="spark-loading-dot" aria-hidden="true" />
          <span>Loading world</span>
          {progress === null ? null : <small>{progress}%</small>}
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

