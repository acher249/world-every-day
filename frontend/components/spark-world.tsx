"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { BufferGeometry, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderer } from "three";
import type {
  SparkRenderer as SparkRendererInstance,
  SplatMesh as SplatMeshInstance,
} from "@sparkjsdev/spark";
import {
  clampToNavigationBounds,
  getClearFocusPosition,
  getNavigationFloor,
  getFocusPosition,
  getNavigationRadius,
  interpolateHeading,
  smootherstep,
} from "@/lib/spatial-navigation";
import { equirectangularTargetToDirection } from "@/lib/equirectangular-ray";
import { landmarkRayTargets, selectLandmarkSurface, type SurfaceSample } from "@/lib/landmark-raycast";
import { cameraRelativeFocusCenter, defaultFocusRadius, focusShapeForLandmark, focusSweepWeight, shouldTravelFocus, type ImageBoundingBox } from "@/lib/focus-region";
import { withFocusSplatShader } from "@/lib/splat-focus-shader";
import { observeViewerVisibility } from "@/lib/viewer-visibility";
import { companionOffset } from "@/lib/world-interactions";
import { depthOfFieldTarget, focusEffectId, focusPanelYaw, hotspotVisualScale, viewerPixelRatio } from "@/lib/viewer-presentation";
import {
  boundaryFragmentShader,
  boundaryLatitudeSegments,
  boundaryLongitudeSegments,
  boundaryOpacity,
  boundaryVertexShader,
} from "@/lib/navigation-boundary";
import type { StickValue } from "@/lib/touch-navigation";
import { offlineTour } from "@/lib/offline-tour";

export type ViewerState = "poster" | "loading" | "ready" | "error";

type WorldAnchorBase = {
  fallbackScreenPosition: { x: number; y: number };
  id: string;
  worldPosition: { x: number; y: number; z: number };
};

export type WorldAnchor = WorldAnchorBase & ({
  kind: "story";
  active: boolean;
  category: string;
  imageBoundingBox?: ImageBoundingBox;
  imageTarget: { x: number; y: number };
  label: string;
  number: string;
  summary: string;
  tone: "cyan" | "amber" | "green";
} | {
  kind: "echo";
  storyId: string;
  focusStoryId?: string;
  explanation: string;
  label: string;
  storyNumber: string;
  storyTitle: string;
});

function echoDescription(anchor: Extract<WorldAnchor, { kind: "echo" }>): string {
  return anchor.focusStoryId ? anchor.explanation
    : `${anchor.explanation} From the article “${anchor.storyTitle}.”`;
}

type SparkWorldProps = {
  focusedAnchorId?: string | null;
  focusCycleRevision?: number;
  focusResetRevision?: number;
  storyPanelOpen?: boolean;
  storyIndexOpen?: boolean;
  alt: string;
  anchors?: WorldAnchor[];
  onAnchorHover?: () => void;
  onAnchorSelect?: (id: string) => void;
  onStoryNavigate?: (id: string) => void;
  onMovementChange?: (intensity: number) => void;
  onViewerStateChange?: (state: ViewerState) => void;
  posterSrc: string;
  splatSha256?: string;
  splatUrl?: string;
  enableBake?: boolean;
  mobileMovementRef?: RefObject<StickValue>;
};

export function SparkWorld({
  focusedAnchorId = null,
  focusCycleRevision = 0,
  focusResetRevision = 0,
  storyPanelOpen = false,
  storyIndexOpen = false,
  alt,
  anchors = [],
  onAnchorHover,
  onAnchorSelect,
  onStoryNavigate,
  onMovementChange,
  onViewerStateChange,
  posterSrc,
  splatSha256,
  splatUrl,
  enableBake = false,
  mobileMovementRef,
}: SparkWorldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorElementsRef = useRef(new Map<string, HTMLElement>());
  const anchorsRef = useRef(anchors);
  const focusedAnchorIdRef = useRef(focusedAnchorId);
  const focusCycleRevisionRef = useRef(focusCycleRevision);
  const focusResetRevisionRef = useRef(focusResetRevision);
  const storyPanelOpenRef = useRef(storyPanelOpen);
  const storyIndexOpenRef = useRef(storyIndexOpen);
  const hoveredAnchorIdRef = useRef<string | null>(null);
  const cycleHoverLockedRef = useRef(false);
  const cycleNavigationActiveRef = useRef(false);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const [viewerState, setViewerState] = useState<ViewerState>(
    splatUrl ? "loading" : "poster",
  );
  const [progress, setProgress] = useState<number | null>(null);
  anchorsRef.current = anchors;
  focusedAnchorIdRef.current = focusedAnchorId;
  focusCycleRevisionRef.current = focusCycleRevision;
  focusResetRevisionRef.current = focusResetRevision;
  storyPanelOpenRef.current = storyPanelOpen;
  storyIndexOpenRef.current = storyIndexOpen;

  useEffect(() => {
    if (focusResetRevision === 0) return;
    cycleHoverLockedRef.current = false;
    cycleNavigationActiveRef.current = false;
    setHoverSuppressed(true);
    hoveredAnchorIdRef.current = null;
    canvasRef.current?.focus({ preventScroll: true });
  }, [focusResetRevision]);

  useEffect(() => {
    if (focusCycleRevision === 0) return;
    cycleHoverLockedRef.current = true;
    setHoverSuppressed(true);
    hoveredAnchorIdRef.current = null;
  }, [focusCycleRevision]);

  useEffect(() => {
    onViewerStateChange?.(viewerState);
  }, [onViewerStateChange, viewerState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !splatUrl) {
      setViewerState("poster");
      return;
    }
    const sourceSplatUrl = splatUrl;
    const tour = offlineTour();

    let cancelled = false;
    let renderer: WebGLRenderer | undefined;
    let scene: Scene | undefined;
    let boundaryScene: Scene | undefined;
    let camera: PerspectiveCamera | undefined;
    let spark: SparkRendererInstance | undefined;
    let splat: SplatMeshInstance | undefined;
    let boundaryGeometry: BufferGeometry | undefined;
    let boundaryMaterial: ShaderMaterial | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const removeInputListeners: Array<() => void> = [];

    async function initialize() {
      try {
        setViewerState("loading");
        if (enableBake) console.info("bake:loading-modules");

        const [{ BackSide, Euler, Matrix4, Mesh, Object3D, PerspectiveCamera, Quaternion, Raycaster, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer }, sparkModule, { createCameraQueries }] =
          await Promise.all([
            import("three"),
            import("@sparkjsdev/spark"),
            import("@/lib/camera-queries"),
          ]);

        if (cancelled || !canvas) return;
        if (enableBake) console.info("bake:modules-loaded");

        const context = canvas.getContext("webgl2", {
          alpha: true,
          antialias: false,
          powerPreference: "high-performance",
          preserveDrawingBuffer: Boolean(tour),
        });

        if (!context) {
          throw new Error("WebGL 2 is not available on this device.");
        }

        const mobileLayoutQuery = window.matchMedia("(max-width: 760px), (orientation: landscape) and (pointer: coarse)");
        renderer = new WebGLRenderer({ canvas, context, antialias: false, alpha: true });
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio, mobileLayoutQuery.matches));

        scene = new Scene();
        camera = new PerspectiveCamera(60, 1, 0.01, 1000);
        const cameraFloatRig = new Object3D();
        cameraFloatRig.add(camera);
        scene.add(cameraFloatRig);

        spark = new sparkModule.SparkRenderer({
          renderer,
          minSortIntervalMs: 32,
          ...(tour ? { autoUpdate: false } : {}),
        });
        const focusShader = enableBake ? null : withFocusSplatShader(spark.material.vertexShader);
        const focusCenterUniform = { value: new Vector3() };
        const focusRadiiUniform = { value: new Vector3(1, 1, 1) };
        const focusCenterViewUniform = { value: new Vector3() };
        const focusInverseRadiiUniform = { value: new Vector3(1, 1, 1) };
        const focusStrengthUniform = { value: 0 };
        const focusSweepUniform = { value: 0 };
        const focusBrightnessUniform = { value: 0.5 };
        const focusWaveTimeUniform = { value: 0 };
        const focusWaveFrequencyUniform = { value: 0 };
        const focusWaveAmplitudeUniform = { value: 0 };
        if (focusShader) {
          spark.material.vertexShader = focusShader;
          Object.assign(spark.material.uniforms, {
            focusCenterView: focusCenterViewUniform,
            focusInverseRadii: focusInverseRadiiUniform,
            focusStrength: focusStrengthUniform,
            focusSweep: focusSweepUniform,
            focusOutsideBrightness: focusBrightnessUniform,
            focusWaveTime: focusWaveTimeUniform,
            focusWaveFrequency: focusWaveFrequencyUniform,
            focusWaveAmplitude: focusWaveAmplitudeUniform,
          });
          spark.material.needsUpdate = true;
        } else if (!enableBake) {
          console.warn("The installed Spark shader changed; the focus-splat effect is unavailable.");
        }
        scene.add(spark);

        let lastBakeProgress = -1;
        splat = new sparkModule.SplatMesh({
          minRaycastOpacity: 0.01,
          raycastable: true,
          url: sourceSplatUrl,
          onProgress: (event) => {
            if (!event.lengthComputable || cancelled) return;
            const percent = Math.round((event.loaded / event.total) * 100);
            if (enableBake && Math.floor(percent / 25) > lastBakeProgress) {
              lastBakeProgress = Math.floor(percent / 25);
              console.info("bake:splat-progress", percent);
            }
            setProgress(percent);
          },
        });
        splat.quaternion.set(1, 0, 0, 0);
        scene.add(splat);

        if (enableBake) console.info("bake:loading-splat");
        await splat.initialized;
        if (cancelled || !renderer || !scene || !camera || !splat) return;
        if (enableBake) console.info("bake:splat-loaded");

        scene.updateMatrixWorld(true);
        const bounds = splat.getBoundingBox().applyMatrix4(splat.matrixWorld);
        const size = bounds.getSize(new Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
        const navigationRadius = getNavigationRadius(maxDimension);
        focusWaveFrequencyUniform.value = (Math.PI * 2) / (navigationRadius * 2.2);

        const boundaryOpacityUniform = { value: 0 };
        if (!enableBake) {
          boundaryScene = new Scene();
          boundaryGeometry = new SphereGeometry(navigationRadius * 1.04, boundaryLongitudeSegments, boundaryLatitudeSegments);
          boundaryMaterial = new ShaderMaterial({
            uniforms: {
              boundaryOpacity: boundaryOpacityUniform,
              boundaryRadius: { value: navigationRadius },
            },
            vertexShader: boundaryVertexShader,
            fragmentShader: boundaryFragmentShader,
            side: BackSide,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          });
          const boundaryMesh = new Mesh(boundaryGeometry, boundaryMaterial);
          boundaryScene.add(boundaryMesh);
        }

        camera.near = Math.max(maxDimension / 10000, 0.001);
        camera.far = Math.max(maxDimension * 100, 100);
        camera.position.set(0, 0, 0);
        camera.updateProjectionMatrix();
        if (!enableBake && !tour) renderer.render(scene, camera);
        camera.updateMatrixWorld();

        if (enableBake || tour) {
          // Spark normally updates this during rendering. The bake page skips
          // rendering, but CPU raycasts still need the loaded splat count.
          const splatCount = splat.packedSplats?.getNumSplats() ?? splat.extSplats?.getNumSplats() ?? 0;
          if (splatCount < 1) throw new Error("The world contains no raycastable splats");
          splat.context.numSplats.value = splatCount;
        }
        if (enableBake) {
          const splatCount = splat.context.numSplats.value;
          console.info("bake:raycast-ready", splatCount);
          const developmentWindow = window as typeof window & {
            __WORLD_EVERY_DAY_BAKE_INFO__?: {
              algorithmVersion: string;
              sourceSplatSha256?: string;
              splatUrl: string;
            };
            __WORLD_EVERY_DAY_BAKE__?: (targets: Array<{
              boundingBox?: { xMin: number; yMin: number; xMax: number; yMax: number };
              id: string;
              x: number;
              y: number;
            }>) => Array<{
              id: string;
              imageTarget: { x: number; y: number };
              worldPosition: { x: number; y: number; z: number } | null;
            }>;
          };
          const bakeInteractions = (targets: Array<{
            boundingBox?: { xMin: number; yMin: number; xMax: number; yMax: number };
            id: string;
            x: number;
            y: number;
          }>) => {
            scene?.updateMatrixWorld(true);
            const raycaster = new Raycaster();
            raycaster.near = Math.max(maxDimension / 10000, 0.001);
            raycaster.far = Math.max(maxDimension * 100, 100);

            return targets.map(({ boundingBox, id, x, y }) => {
              const candidates = landmarkRayTargets({ x, y }, boundingBox);
              const samples: SurfaceSample[] = [];
              for (const candidate of candidates) {
                const direction = equirectangularTargetToDirection(candidate);
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
                if (intersections[0]?.point) {
                  samples.push({ imageTarget: candidate, point: intersections[0].point, distance: intersections[0].distance });
                }
              }
              const hit = selectLandmarkSurface(samples, { x, y }, boundingBox);
              return {
                id,
                imageTarget: hit?.imageTarget ?? { x, y },
                worldPosition: hit
                  ? { x: hit.point.x, y: hit.point.y, z: hit.point.z }
                  : null,
              };
            });
          };
          developmentWindow.__WORLD_EVERY_DAY_BAKE_INFO__ = {
            algorithmVersion: "surface-grid-v1",
            sourceSplatSha256: splatSha256,
            splatUrl: sourceSplatUrl,
          };
          developmentWindow.__WORLD_EVERY_DAY_BAKE__ = bakeInteractions;
          console.info("bake:hook-ready");
          setProgress(100);
          setViewerState("ready");
          return;
        }

        const cameraQueries = createCameraQueries(splat);
        let groundHeight: number | undefined;
        try {
          groundHeight = cameraQueries.groundHeight(navigationRadius);
        } catch (error) {
          console.warn("Could not locate the ground; using the conservative navigation floor", error);
        }
        const navigationFloor = getNavigationFloor(navigationRadius, groundHeight);

        const resize = () => {
          if (!renderer || !camera) return;
          const width = canvas.clientWidth;
          const height = canvas.clientHeight;
          if (!width || !height) return;
          const pixelRatio = viewerPixelRatio(window.devicePixelRatio, mobileLayoutQuery.matches);
          if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        mobileLayoutQuery.addEventListener("change", resize);
        removeInputListeners.push(() => mobileLayoutQuery.removeEventListener("change", resize));
        resize();

        let yaw = 0;
        let pitch = tour ? -0.18 : 0;
        if (tour) camera.rotation.x = pitch;
        let lookPointerId: number | null = null;
        let lastPointerX = 0;
        let lastPointerY = 0;
        const pressedKeys = new Set<string>();
        const cameraEuler = new Euler(0, 0, 0, "YXZ");
        const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        // Spark's depth of field is part of its splat renderer, not a second
        // full-screen post-processing pass. Keep mobile aperture restrained.
        const initialDepthOfField = depthOfFieldTarget(navigationRadius, null, mobileLayoutQuery.matches);
        spark.focalDistance = initialDepthOfField.focalDistance;
        spark.apertureAngle = initialDepthOfField.apertureAngle;
        const defaultBubbleRadius = defaultFocusRadius(navigationRadius);
        const landmarkShapes = new Map<string, InstanceType<typeof Vector3>>();
        const bubbleShape = new Vector3(defaultBubbleRadius * 1.3, defaultBubbleRadius, defaultBubbleRadius * 1.3);
        const bubbleCycleStartShape = bubbleShape.clone();
        let bubbleTargetId: string | null = null;
        const bubblePoint = new Vector3();
        const bubbleCycleStart = new Vector3();
        const bubbleStartView = new Vector3();
        const bubbleEndView = new Vector3();
        const bubbleInverseRotation = new Quaternion();
        let bubbleCycleActive = false;
        let bubbleCycleTargetId: string | null = null;
        let directHighlightId: string | null = null;
        let lastFocusCycleRevision = focusCycleRevisionRef.current;
        let lastFocusResetRevision = focusResetRevisionRef.current;
        let focusTransition: {
          duration: number;
          elapsed: number;
          position: InstanceType<typeof Vector3>;
          pitch: number;
          yaw: number;
          startPosition: InstanceType<typeof Vector3>;
          startPitch: number;
          startYaw: number;
        } | null = null;
        let lastFocusedAnchorId: string | null = null;
        let lastFocusPanelSide: "left" | "right" | null = null;

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
          if (document.querySelector(".welcome-overlay[open]")) return;
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
          if (event.button !== 0 || lookPointerId !== null) return;
          cancelCameraFocus();
          canvas.focus();
          lookPointerId = event.pointerId;
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          canvas.setPointerCapture(event.pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
          if (lookPointerId !== event.pointerId) return;
          yaw -= (event.clientX - lastPointerX) * 0.0025;
          pitch -= (event.clientY - lastPointerY) * 0.0025;
          pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          updateCameraRotation();
        };
        const onPointerUp = (event: PointerEvent) => {
          if (lookPointerId !== event.pointerId) return;
          lookPointerId = null;
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        };
        const onLostPointerCapture = (event: PointerEvent) => {
          if (lookPointerId === event.pointerId) lookPointerId = null;
        };
        const onWheel = (event: WheelEvent) => {
          if (!camera) return;
          event.preventDefault();
          cancelCameraFocus();
          const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          camera.position.addScaledVector(forward, event.deltaY * -maxDimension * 0.00022);
          clampToNavigationBounds(camera.position, navigationRadius, navigationFloor);
        };
        const onBlur = () => pressedKeys.clear();

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("lostpointercapture", onLostPointerCapture);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        removeInputListeners.push(
          () => window.removeEventListener("keydown", onKeyDown),
          () => window.removeEventListener("keyup", onKeyUp),
          () => window.removeEventListener("blur", onBlur),
          () => canvas.removeEventListener("pointerdown", onPointerDown),
          () => canvas.removeEventListener("pointermove", onPointerMove),
          () => canvas.removeEventListener("pointerup", onPointerUp),
          () => canvas.removeEventListener("pointercancel", onPointerUp),
          () => canvas.removeEventListener("lostpointercapture", onLostPointerCapture),
          () => canvas.removeEventListener("wheel", onWheel),
        );

        const projectedAnchor = new Vector3();
        const anchorInCameraSpace = new Vector3();
        const projectedAnchorPositions = new Map<string, { x: number; y: number; size: number }>();
        const movement = new Vector3();
        const velocity = new Vector3();
        const targetVelocity = new Vector3();
        const movementStart = new Vector3();
        const forward = new Vector3();
        const right = new Vector3();
        const up = new Vector3(0, 1, 0);
        const focusTarget = new Vector3();
        const focalPoint = new Vector3();
        const focusDirection = new Vector3();
        const focusLookMatrix = new Matrix4();
        const focusRotation = new Quaternion();
        const focusPositions = new Map<string, InstanceType<typeof Vector3>>();
        const floatedCameraPosition = new Vector3();
        const flightSpeed = Math.max(maxDimension * 0.014, 0.08);
        const floatPositionAmplitude = Math.min(
          navigationRadius * 0.034,
          maxDimension * 0.0056,
        );
        const floatPhase = (tour ? (tour.seed % 10000) / 10000 : Math.random()) * Math.PI * 2;
        let cameraFloatTime = 0;
        let previousFrameTime = tour ? 0 : performance.now();
        let lastMovementSoundUpdate = 0;

        const renderFrame = () => {
          if (renderer && scene && camera && splat) {
            const frameTime = performance.now();
            const deltaSeconds = Math.min((frameTime - previousFrameTime) / 1000, 0.1);
            previousFrameTime = frameTime;
            const requestedFocusId = focusedAnchorIdRef.current;
            const desktopEffects = !mobileLayoutQuery.matches;
            const panelOpen = storyPanelOpenRef.current && desktopEffects;
            const panelSide = panelOpen ? "right" : storyIndexOpenRef.current && desktopEffects ? "left" : null;
            if (focusResetRevisionRef.current !== lastFocusResetRevision) {
              lastFocusResetRevision = focusResetRevisionRef.current;
              hoveredAnchorIdRef.current = null;
              bubbleCycleActive = false;
            }
            if (focusCycleRevisionRef.current !== lastFocusCycleRevision) {
              lastFocusCycleRevision = focusCycleRevisionRef.current;
              hoveredAnchorIdRef.current = null;
              cycleHoverLockedRef.current = true;
              bubbleCycleStart.copy(focusCenterUniform.value);
              bubbleCycleStartShape.copy(bubbleShape);
              bubbleCycleActive = shouldTravelFocus(lastFocusedAnchorId, requestedFocusId, bubbleTargetId);
              directHighlightId = bubbleCycleActive ? null : requestedFocusId;
              if (lastFocusedAnchorId === null) focusSweepUniform.value = 0;
              bubbleCycleTargetId = requestedFocusId;
            }
            if (requestedFocusId !== lastFocusedAnchorId || panelSide !== lastFocusPanelSide) {
              lastFocusedAnchorId = requestedFocusId;
              lastFocusPanelSide = panelSide;
              focusTransition = null;
              const anchor = anchorsRef.current.find(({ id }) => id === requestedFocusId);
              let destination: InstanceType<typeof Vector3> | null = null;
              let destinationRotation: InstanceType<typeof Quaternion> | null = null;
              if (anchor) {
                focusTarget.set(anchor.worldPosition.x, anchor.worldPosition.y, anchor.worldPosition.z);
                let focusPosition = focusPositions.get(anchor.id);
                if (!focusPosition) {
                  try {
                    const selected = getClearFocusPosition(
                      anchor.worldPosition,
                      navigationRadius,
                      navigationFloor,
                      (candidate) => cameraQueries.visibility(candidate, focusTarget),
                    );
                    focusPosition = new Vector3(selected.x, selected.y, selected.z);
                  } catch (error) {
                    console.warn("Could not check the hotspot view; using the standard focus position", error);
                    const fallback = getFocusPosition(anchor.worldPosition, navigationRadius, navigationFloor);
                    focusPosition = new Vector3(fallback.x, fallback.y, fallback.z);
                  }
                  focusPositions.set(anchor.id, focusPosition);
                }
                destination = focusDirection.set(
                  focusPosition.x,
                  focusPosition.y,
                  focusPosition.z,
                );
                focusLookMatrix.lookAt(destination, focusTarget, up);
                focusRotation.setFromRotationMatrix(focusLookMatrix);
                if (panelSide) {
                  const panelWidth = document.querySelector(panelSide === "left" ? ".story-index" : ".story-panel")?.getBoundingClientRect().width
                    ?? Math.min(430, canvas.clientWidth * 0.92);
                  const panelYaw = focusPanelYaw(canvas.clientWidth, panelWidth, camera.aspect, camera.fov, panelSide);
                  cameraEuler.setFromQuaternion(focusRotation, "YXZ");
                  cameraEuler.y += panelYaw;
                  cameraEuler.z = 0;
                  focusRotation.setFromEuler(cameraEuler);
                }
                destinationRotation = focusRotation;
              } else if (requestedFocusId === null) {
                // Closing a panel clears focus without moving the visitor.
                cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
                pitch = cameraEuler.x;
                yaw = cameraEuler.y;
              }

              if (destination && destinationRotation) {
                velocity.set(0, 0, 0);
                cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
                const startPitch = cameraEuler.x;
                const startYaw = cameraEuler.y;
                cameraEuler.setFromQuaternion(destinationRotation, "YXZ");
                cameraEuler.z = 0;
                destinationRotation.setFromEuler(cameraEuler);
                if (reducedMotionQuery.matches) {
                  camera.position.copy(destination);
                  camera.quaternion.copy(destinationRotation);
                  cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
                  pitch = cameraEuler.x;
                  yaw = cameraEuler.y;
                } else {
                  focusTransition = {
                    duration: tour ? 1.5 : 2.4,
                    elapsed: 0,
                    position: destination.clone(),
                    pitch: cameraEuler.x,
                    yaw: cameraEuler.y,
                    startPosition: camera.position.clone(),
                    startPitch,
                    startYaw,
                  };
                  bubbleInverseRotation.copy(camera.quaternion).invert();
                  bubbleStartView.copy(bubbleCycleStart).sub(camera.position).applyQuaternion(bubbleInverseRotation);
                  bubbleInverseRotation.copy(destinationRotation).invert();
                  bubbleEndView.copy(focusTarget).sub(destination).applyQuaternion(bubbleInverseRotation);
                  // A newly appearing effect starts in view, not at an old invisible target.
                  if (focusStrengthUniform.value < 0.01 || bubbleStartView.z >= 0) {
                    bubbleStartView.set(0, 0, -bubbleEndView.length());
                  }
                }
              }
            }

            const stick = mobileMovementRef?.current;
            if (stick && (stick.x !== 0 || stick.y !== 0)) cancelCameraFocus();

            if (focusTransition) {
              if (frameTime - lastMovementSoundUpdate >= 100) {
                onMovementChange?.(0);
                lastMovementSoundUpdate = frameTime;
              }
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
              clampToNavigationBounds(camera.position, navigationRadius, navigationFloor);
              // Separate heading and elevation keep the horizon level throughout the turn.
              pitch = focusTransition.startPitch + (focusTransition.pitch - focusTransition.startPitch) * transitionProgress;
              yaw = interpolateHeading(focusTransition.startYaw, focusTransition.yaw, transitionProgress);
              updateCameraRotation();
              if (focusTransition.elapsed >= focusTransition.duration) {
                camera.position.copy(focusTransition.position);
                focusTransition = null;
                cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
                pitch = cameraEuler.x;
                yaw = cameraEuler.y;
              }
            } else {
              movementStart.copy(camera.position);
              movement.set(0, 0, 0);
              forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
              right.set(1, 0, 0).applyQuaternion(camera.quaternion);
              if (pressedKeys.has("KeyW")) movement.add(forward);
              if (pressedKeys.has("KeyS")) movement.sub(forward);
              if (pressedKeys.has("KeyD")) movement.add(right);
              if (pressedKeys.has("KeyA")) movement.sub(right);
              if (pressedKeys.has("KeyE")) movement.add(up);
              if (pressedKeys.has("KeyQ")) movement.sub(up);
              if (stick) {
                movement.addScaledVector(forward, stick.y);
                movement.addScaledVector(right, stick.x);
              }
              if (movement.lengthSq() > 0) {
                const boost = pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight") ? 3 : 1;
                targetVelocity.copy(movement);
                if (targetVelocity.lengthSq() > 1) targetVelocity.normalize();
                targetVelocity.multiplyScalar(flightSpeed * boost);
              } else {
                targetVelocity.set(0, 0, 0);
              }

              const dampingRate = movement.lengthSq() > 0 ? 5.5 : 4;
              velocity.lerp(targetVelocity, 1 - Math.exp(-dampingRate * deltaSeconds));
              if (targetVelocity.lengthSq() === 0 && velocity.lengthSq() < 0.000001) {
                velocity.set(0, 0, 0);
              }
              camera.position.addScaledVector(velocity, deltaSeconds);
              clampToNavigationBounds(camera.position, navigationRadius, navigationFloor);
              if (frameTime - lastMovementSoundUpdate >= 100) {
                const distance = camera.position.distanceTo(movementStart);
                const intensity = deltaSeconds > 0
                  ? Math.min(1, distance / (flightSpeed * deltaSeconds * 2))
                  : 0;
                onMovementChange?.(intensity);
                lastMovementSoundUpdate = frameTime;
              }
            }

            cycleNavigationActiveRef.current = cycleHoverLockedRef.current && focusTransition !== null;

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
              // Translation retains the ambient float without introducing parent-rig roll.
              cameraFloatRig.quaternion.identity();
            }

            floatedCameraPosition.copy(camera.position).applyQuaternion(cameraFloatRig.quaternion);
            cameraFloatRig.position.y = Math.max(
              cameraFloatRig.position.y,
              navigationFloor - floatedCameraPosition.y,
            );

            const hoveredId = hoveredAnchorIdRef.current;
            const effectId = desktopEffects
              ? focusEffectId(requestedFocusId, hoveredId, panelOpen, cycleHoverLockedRef.current)
              : hoveredId ?? requestedFocusId;
            const effectAnchor = anchorsRef.current.find(
              (anchor): anchor is Extract<WorldAnchor, { kind: "story" }> => anchor.id === effectId && anchor.kind === "story",
            );
            let targetSweep = 0;
            if (focusShader && effectAnchor) {
              let targetShape = landmarkShapes.get(effectAnchor.id);
              if (targetShape === undefined) {
                const shape = focusShapeForLandmark(
                  navigationRadius,
                  effectAnchor.imageTarget,
                  effectAnchor.worldPosition,
                  effectAnchor.imageBoundingBox,
                );
                targetShape = new Vector3(shape.x, shape.y, shape.z);
                landmarkShapes.set(effectAnchor.id, targetShape);
              }
              bubblePoint.set(effectAnchor.worldPosition.x, effectAnchor.worldPosition.y, effectAnchor.worldPosition.z);
              const activateDirectly = directHighlightId === effectAnchor.id;
              if (bubbleCycleActive && effectAnchor.id === bubbleCycleTargetId && focusTransition && !reducedMotionQuery.matches) {
                const progress = smootherstep(focusTransition.elapsed / focusTransition.duration);
                // Begin settling well before arrival, using actual elapsed time.
                targetSweep = focusSweepWeight(focusTransition.elapsed / focusTransition.duration);
                // Interpolate in camera space so the focus follows the same turn as the view.
                cameraRelativeFocusCenter(bubbleStartView, bubbleEndView, progress,
                  camera.position, camera.quaternion, focusCenterUniform.value);
                bubbleShape.lerpVectors(bubbleCycleStartShape, targetShape, progress);
              } else {
                bubbleCycleActive = false;
                if (bubbleTargetId === null || reducedMotionQuery.matches || (activateDirectly && bubbleTargetId !== effectAnchor.id)) {
                  // First selection fades in at its final extent, not from a travel shape.
                  focusCenterUniform.value.copy(bubblePoint);
                  bubbleShape.copy(targetShape);
                } else {
                  focusCenterUniform.value.lerp(bubblePoint, 1 - Math.exp(-7 * deltaSeconds));
                  bubbleShape.lerp(targetShape, 1 - Math.exp(-7 * deltaSeconds));
                }
              }
              if (activateDirectly) directHighlightId = null;
              bubbleTargetId = effectAnchor.id;
              focusStrengthUniform.value += (1 - focusStrengthUniform.value) * (reducedMotionQuery.matches ? 1 : 1 - Math.exp(-5 * deltaSeconds));
              const targetBrightness = storyPanelOpenRef.current && effectAnchor.id === requestedFocusId ? 0.25 : 0.5;
              focusBrightnessUniform.value += (targetBrightness - focusBrightnessUniform.value) * (1 - Math.exp(-5 * deltaSeconds));
              const breathe = reducedMotionQuery.matches ? 1 : 1 + Math.sin(frameTime * 0.0017) * 0.045;
              focusRadiiUniform.value.set(bubbleShape.x * breathe, bubbleShape.y / breathe, bubbleShape.z / breathe);
              focusWaveTimeUniform.value = reducedMotionQuery.matches ? 0 : frameTime * 0.001;
              focusWaveAmplitudeUniform.value = reducedMotionQuery.matches ? 0 : navigationRadius * 0.055;
            } else {
              bubbleCycleActive = false;
              focusStrengthUniform.value *= reducedMotionQuery.matches ? 0 : Math.exp(-5 * deltaSeconds);
              if (focusStrengthUniform.value < 0.001) {
                focusStrengthUniform.value = 0;
                bubbleTargetId = null;
              }
            }
            // Preserve continuity on arrival, interruption, and rapid next/previous input.
            focusSweepUniform.value += (targetSweep - focusSweepUniform.value)
              * (reducedMotionQuery.matches ? 1 : 1 - Math.exp(-5 * deltaSeconds));
            if (focusSweepUniform.value < 0.0001) focusSweepUniform.value = 0;
            if (spark) {
              const anchorDistance = effectAnchor
                ? camera.position.distanceTo(focalPoint.set(effectAnchor.worldPosition.x, effectAnchor.worldPosition.y, effectAnchor.worldPosition.z))
                : null;
              const target = depthOfFieldTarget(navigationRadius, anchorDistance, !desktopEffects);
              const focusBlend = reducedMotionQuery.matches ? 1 : 1 - Math.exp(-6 * deltaSeconds);
              spark.focalDistance += (target.focalDistance - spark.focalDistance) * focusBlend;
              spark.apertureAngle += (target.apertureAngle - spark.apertureAngle) * focusBlend;
            }

            const boundaryTarget = boundaryOpacity(camera.position.length(), navigationRadius);
            boundaryOpacityUniform.value += (boundaryTarget - boundaryOpacityUniform.value) *
              (reducedMotionQuery.matches ? 1 : 1 - Math.exp(-5 * deltaSeconds));
            if (focusShader && focusStrengthUniform.value > 0) {
              // Camera-relative values are shared by every splat vertex in this draw.
              camera.updateWorldMatrix(true, false);
              focusCenterViewUniform.value.copy(focusCenterUniform.value).applyMatrix4(camera.matrixWorldInverse);
              focusInverseRadiiUniform.value.set(
                1 / focusRadiiUniform.value.x,
                1 / focusRadiiUniform.value.y,
                1 / focusRadiiUniform.value.z,
              );
            }
            if (!tour) renderer.render(scene, camera);
            if (!tour && boundaryScene && boundaryOpacityUniform.value > 0.003) {
              const autoClear = renderer.autoClear;
              renderer.autoClear = false;
              renderer.render(boundaryScene, camera);
              renderer.autoClear = autoClear;
            }
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

              if (element.dataset.visible !== String(visible)) {
                element.dataset.visible = String(visible);
                element.style.opacity = visible ? "1" : "0";
                element.style.visibility = visible ? "visible" : "hidden";
                element.style.pointerEvents = visible ? "auto" : "none";
                element.tabIndex = visible ? 0 : -1;
                element.setAttribute("aria-hidden", visible ? "false" : "true");
              }
              if (!visible) continue;

              const screenX = (projectedAnchor.x * 0.5 + 0.5) * 100;
              const screenY = (-projectedAnchor.y * 0.5 + 0.5) * 100;
              if (anchor.kind === "echo") {
                const offset = anchor.focusStoryId ? companionOffset(screenX) : 0;
                const center = screenX * canvas.clientWidth / 100 + offset;
                const halfWidth = Math.min(desktopEffects ? 270 : 250, canvas.clientWidth - 32) / 2;
                const safeCenter = Math.max(16 + halfWidth, Math.min(canvas.clientWidth - 16 - halfWidth, center));
                const shift = `${Math.round(safeCenter - center)}px`;
                if (element.style.getPropertyValue("--echo-label-shift") !== shift) element.style.setProperty("--echo-label-shift", shift);
              }
              let previousPosition = projectedAnchorPositions.get(anchor.id);
              if (!previousPosition) {
                previousPosition = { x: Infinity, y: Infinity, size: 0 };
                projectedAnchorPositions.set(anchor.id, previousPosition);
              }
              if (anchor.kind === "story") {
                const scale = hotspotVisualScale(screenX, screenY);
                const visualSize = Math.round(50 * scale * 10) / 10;
                if (previousPosition.size !== visualSize) {
                  element.style.setProperty("--hotspot-visual-size", `${visualSize}px`);
                  element.style.setProperty("--hotspot-core-size", `${(34 * scale).toFixed(1)}px`);
                  previousPosition.size = visualSize;
                }
              }
              if (
                Math.abs(screenX - previousPosition.x) > 0.005 ||
                Math.abs(screenY - previousPosition.y) > 0.005
              ) {
                const offset = anchor.kind === "echo" && anchor.focusStoryId ? companionOffset(screenX) : 0;
                element.style.transform = `translate3d(calc(${screenX}vw + ${offset}px), ${screenY}vh, 0) translate(-50%, -50%)`;
                previousPosition.x = screenX;
                previousPosition.y = screenY;
              }
            }
          }
        };
        if (tour) {
          tour.step = renderFrame;
          tour.render = async () => {
            if (!renderer || !scene || !camera || !spark) throw new Error("Tour viewer unavailable");
            await spark.update({ scene, camera });
            renderer.render(scene, camera);
            if (boundaryScene && boundaryOpacityUniform.value > 0.003) {
              const autoClear = renderer.autoClear;
              renderer.autoClear = false;
              renderer.render(boundaryScene, camera);
              renderer.autoClear = autoClear;
            }
          };
          removeInputListeners.push(() => { delete tour.step; delete tour.render; });
        } else if (enableBake) {
          renderer.setAnimationLoop(renderFrame);
        } else {
          removeInputListeners.push(observeViewerVisibility(canvas, (visible) => {
            previousFrameTime = performance.now();
            pressedKeys.clear();
            velocity.set(0, 0, 0);
            targetVelocity.set(0, 0, 0);
            if (!visible) onMovementChange?.(0);
            canvas.dataset.rendering = visible ? "active" : "paused";
            renderer?.setAnimationLoop(visible ? renderFrame : null);
          }));
        }

        setProgress(100);
        setViewerState("ready");
      } catch (error) {
        if (!cancelled) {
          if (enableBake) {
            (window as typeof window & { __WORLD_EVERY_DAY_BAKE_ERROR__?: string }).__WORLD_EVERY_DAY_BAKE_ERROR__ =
              error instanceof Error ? error.message : "Unknown bake viewer error";
          }
          console.error("Spark.js world failed to initialize", error);
          setViewerState("error");
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      onMovementChange?.(0);
      if (enableBake) {
        delete (window as typeof window & {
          __WORLD_EVERY_DAY_BAKE_INFO__?: unknown;
        }).__WORLD_EVERY_DAY_BAKE_INFO__;
        delete (window as typeof window & {
          __WORLD_EVERY_DAY_BAKE__?: unknown;
        }).__WORLD_EVERY_DAY_BAKE__;
        delete (window as typeof window & {
          __WORLD_EVERY_DAY_BAKE_ERROR__?: unknown;
        }).__WORLD_EVERY_DAY_BAKE_ERROR__;
      }
      resizeObserver?.disconnect();
      removeInputListeners.forEach((remove) => remove());
      renderer?.setAnimationLoop(null);
      splat?.dispose();
      spark?.dispose();
      boundaryGeometry?.dispose();
      boundaryMaterial?.dispose();
      renderer?.dispose();
    };
  }, [enableBake, mobileMovementRef, onMovementChange, splatSha256, splatUrl]);

  const showPoster = viewerState === "poster" || viewerState === "error";

  return (
    <div
      className="spark-world"
      data-viewer-state={viewerState}
      data-hover-suppressed={hoverSuppressed}
      onPointerMove={(event) => {
        if (
          event.pointerType === "touch" ||
          cycleNavigationActiveRef.current ||
          Math.hypot(event.movementX, event.movementY) < 2 ||
          (!cycleHoverLockedRef.current && !hoverSuppressed)
        ) return;
        cycleHoverLockedRef.current = false;
        setHoverSuppressed(false);
        const hotspot = event.target instanceof Element ? event.target.closest<HTMLElement>(".hotspot, .story-echo") : null;
        hoveredAnchorIdRef.current = hotspot?.dataset.focusStoryId ?? (hotspot?.classList.contains("hotspot") ? hotspot.dataset.anchorId ?? null : null);
      }}
    >
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
      {anchors.map((anchor) => anchor.kind === "story" ? (
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
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch" && !hoverSuppressed && !cycleHoverLockedRef.current) {
              hoveredAnchorIdRef.current = anchor.id;
              onAnchorHover?.();
            }
          }}
          onPointerLeave={() => {
            if (hoveredAnchorIdRef.current === anchor.id) hoveredAnchorIdRef.current = null;
            if (!cycleHoverLockedRef.current) setHoverSuppressed(false);
          }}
          onFocus={() => {
            cycleHoverLockedRef.current = false;
            setHoverSuppressed(false);
            hoveredAnchorIdRef.current = anchor.id;
          }}
          onBlur={() => {
            if (hoveredAnchorIdRef.current === anchor.id) hoveredAnchorIdRef.current = null;
          }}
          onClick={() => onAnchorSelect?.(anchor.id)}
          aria-label={`Explore story ${anchor.number}: ${anchor.label}`}
          aria-pressed={anchor.active}
        >
          <span className="hotspot-visual" aria-hidden="true">
            <span className="hotspot-pulse" />
            <span className="hotspot-orbit"><i /></span>
            <span className="hotspot-core"><span className="hotspot-number">{anchor.number}</span></span>
          </span>
          <span className="hotspot-label hotspot-story-label">
            <small>Story {anchor.number} · {anchor.category}</small>
            <strong>{anchor.label}</strong>
            <span>{anchor.summary}</span>
            <em>Click to explore</em>
          </span>
        </button>
      ) : (
        <button
          key={anchor.id}
          ref={(element) => {
            if (element) anchorElementsRef.current.set(anchor.id, element);
            else anchorElementsRef.current.delete(anchor.id);
          }}
          type="button"
          className={`story-echo${anchor.focusStoryId ? " landmark-companion" : ""}`}
          data-anchor-id={anchor.id}
          data-focus-story-id={anchor.focusStoryId}
          data-anchor-state="baked"
          style={{
            transform: `translate3d(calc(${anchor.fallbackScreenPosition.x * 100}vw + ${anchor.focusStoryId ? companionOffset(anchor.fallbackScreenPosition.x * 100) : 0}px), ${anchor.fallbackScreenPosition.y * 100}vh, 0) translate(-50%, -50%)`,
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch" && !cycleNavigationActiveRef.current) {
              cycleHoverLockedRef.current = false;
              setHoverSuppressed(false);
              hoveredAnchorIdRef.current = anchor.focusStoryId ?? null;
              onAnchorHover?.();
            }
          }}
          onPointerLeave={() => {
            if (hoveredAnchorIdRef.current === anchor.focusStoryId) hoveredAnchorIdRef.current = null;
          }}
          onFocus={() => {
            cycleHoverLockedRef.current = false;
            setHoverSuppressed(false);
            hoveredAnchorIdRef.current = anchor.focusStoryId ?? null;
          }}
          onBlur={() => {
            if (hoveredAnchorIdRef.current === anchor.focusStoryId) hoveredAnchorIdRef.current = null;
          }}
          onClick={(event) => {
            event.stopPropagation();
            event.currentTarget.blur();
            hoveredAnchorIdRef.current = null;
            setHoverSuppressed(true);
            if (anchor.focusStoryId) onAnchorSelect?.(anchor.focusStoryId);
            else onStoryNavigate?.(anchor.storyId);
          }}
          tabIndex={0}
          aria-label={`Story echo for story ${anchor.storyNumber}. ${echoDescription(anchor)}`}
        >
          <span className="story-echo-visual" aria-hidden="true">
            <span className="story-echo-pulse" />
            <span className="story-echo-orbit"><i /></span>
            <span className="story-echo-core">✦</span>
          </span>
          <span className="hotspot-label story-echo-label">
            <small>{anchor.focusStoryId ? "Landmark Echo" : "Story Echo"} · Story {anchor.storyNumber}</small>
            <strong>{anchor.label}</strong>
            <span>{echoDescription(anchor)}</span>
            {!anchor.focusStoryId && <span className="echo-story-action">Go to story {anchor.storyNumber} →</span>}
          </span>
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

