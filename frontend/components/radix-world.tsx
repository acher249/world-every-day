"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Vector3 } from "three";
import type { StickValue } from "@/lib/touch-navigation";
import { clampToNavigationBounds, getFocusPosition, getNavigationFloor, getNavigationRadius, interpolateHeading, smootherstep } from "@/lib/spatial-navigation";
import { cameraRelativeFocusCenter, focusPositionForLandmark, focusShapeForLandmark } from "@/lib/focus-region";
import { companionOffset } from "@/lib/world-interactions";
import { depthOfFieldTarget, focusPanelYaw, hotspotVisualScale, viewerPixelRatio } from "@/lib/viewer-presentation";
import { observeViewerVisibility } from "@/lib/viewer-visibility";
import type { ViewerState, WorldAnchor } from "@/components/spark-world";
import { WorldLoadingIndicator } from "@/components/world-loading-indicator";

type Props = {
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
  splatUrl?: string;
  mobileMovementRef?: RefObject<StickValue>;
};

function echoDescription(anchor: Extract<WorldAnchor, { kind: "echo" }>) {
  return anchor.focusStoryId ? anchor.explanation : `${anchor.explanation} From the article “${anchor.storyTitle}.”`;
}

/** Radix/WebGPU renderer for the shared World Experience interface. */
export function RadixWorld({
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
  splatUrl,
  mobileMovementRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorElementsRef = useRef(new Map<string, HTMLElement>());
  const anchorStylesRef = useRef(new Map<string, { x: number; y: number; visible: boolean; size: number; shift: number }>());
  const anchorsRef = useRef(anchors);
  const focusedAnchorRef = useRef(focusedAnchorId);
  const panelOpenRef = useRef(storyPanelOpen);
  const storyIndexOpenRef = useRef(storyIndexOpen);
  const cycleRevisionRef = useRef(focusCycleRevision);
  const resetRevisionRef = useRef(focusResetRevision);
  const hoveredIdRef = useRef<string | null>(null);
  const cycleHoverLockedRef = useRef(false);
  const [viewerState, setViewerState] = useState<ViewerState>(splatUrl ? "loading" : "poster");
  const [progress, setProgress] = useState<number | null>(null);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  anchorsRef.current = anchors;
  focusedAnchorRef.current = focusedAnchorId;
  panelOpenRef.current = storyPanelOpen;
  storyIndexOpenRef.current = storyIndexOpen;
  cycleRevisionRef.current = focusCycleRevision;
  resetRevisionRef.current = focusResetRevision;

  useEffect(() => onViewerStateChange?.(viewerState), [onViewerStateChange, viewerState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !splatUrl) {
      setViewerState("poster");
      return;
    }

    let cancelled = false;
    let renderer: import("three/webgpu").WebGPURenderer | undefined;
    let splatRenderer: import("@sparkjsdev/radix").SplatRenderer | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const removeListeners: Array<() => void> = [];

    async function initialize() {
      try {
        setViewerState("loading");
        const [THREE, TSL, radix] = await Promise.all([import("three"), import("three/tsl"), import("@sparkjsdev/radix")]);
        renderer = await radix.createRenderer({ canvas: canvas!, antialias: false });
        if (cancelled) return;
        const caps = radix.getGpuCaps(renderer);
        const data = await radix.loadSplats(splatUrl!, {
          name: splatUrl!.split("/").pop() ?? "world.spz",
          onProgress: (fraction, stage) => {
            if (cancelled) return;
            const normalized = Math.max(0, Math.min(1, fraction));
            const percent = stage === "downloading"
              ? Math.round(normalized * 70)
              : Math.round(70 + normalized * 22);
            setProgress((current) => current === percent ? current : percent);
          },
        });
        if (cancelled) return;
        setProgress(94);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
        const cameraRig = new THREE.Object3D();
        cameraRig.add(camera);
        scene.add(cameraRig);
        const model = new THREE.Object3D();
        model.rotation.x = Math.PI;
        scene.add(model);
        const collection = new radix.SplatCollection([
          radix.SplatCollection.arrays(radix.GpuArrays.fromData(renderer, data), { matrixWorld: model.matrixWorld }),
        ]);
        const focusCenter = new THREE.Vector3();
        const focusInverseRadii = new THREE.Vector3(1, 1, 1);
        const focusCenterNode = TSL.uniform(focusCenter);
        const focusInverseRadiiNode = TSL.uniform(focusInverseRadii);
        const focusStrengthNode = TSL.uniform(0);
        const focusBrightnessNode = TSL.uniform(0.5);
        const focusWaveTimeNode = TSL.uniform(0);
        const focusWaveFrequencyNode = TSL.uniform(1);
        const focusWaveAmplitudeNode = TSL.uniform(0);
        const modifier = (splat: import("@sparkjsdev/radix").SplatNode) => {
          const center = splat.get("center");
          const relative = center.sub(focusCenterNode).mul(focusInverseRadiiNode);
          const wavePhase = center.x.mul(0.82).add(center.z.mul(0.57)).mul(focusWaveFrequencyNode).sub(focusWaveTimeNode.mul(0.5));
          const waveSine = TSL.sin(wavePhase);
          const swell = waveSine.add(TSL.sin(wavePhase.mul(1.7).add(focusWaveTimeNode.mul(0.12)).add(0.8)).mul(0.175));
          const waveOffset = TSL.vec3(TSL.cos(wavePhase).mul(0.11), swell, waveSine.mul(0.11))
            .mul(focusWaveAmplitudeNode.mul(focusStrengthNode));
          const wave = waveSine.mul(0.06).add(swell.mul(0.04));
          const edge = TSL.smoothstep(0.82, 1.08, TSL.length(relative).sub(wave));
          const amount = edge.mul(focusStrengthNode);
          const brightness = TSL.mix(TSL.float(1), focusBrightnessNode, amount);
          return radix.GpuSplats.Splat(
            center.add(waveOffset.mul(edge)), splat.get("scales"), splat.get("quaternion"),
            splat.get("rgb").mul(brightness), splat.get("opacity"), splat.get("index"),
          );
        };
        // Radix selects GPU sorting on WebGPU and its asynchronous CPU sort on
        // WebGL. Keep its backend-aware default so browsers without WebGPU can
        // still use the spatial viewer.
        splatRenderer = new radix.SplatRenderer({ renderer, collection, modifier, modifierSpace: "world" });
        scene.add(splatRenderer);
        const capsInfo = `Radix · ${caps.backend} · ${data.count.toLocaleString()} splats`;

        const maxAnchorDistance = Math.max(1, ...anchorsRef.current.map(({ worldPosition }) => Math.hypot(worldPosition.x, worldPosition.y, worldPosition.z)));
        const navigationRadius = getNavigationRadius(maxAnchorDistance / 0.15);
        const navigationFloor = getNavigationFloor(navigationRadius);
        const landmarkFocus = new Map<string, { center: InstanceType<typeof THREE.Vector3>; shape: InstanceType<typeof THREE.Vector3> }>();
        for (const anchor of anchorsRef.current) {
          if (anchor.kind !== "story") continue;
          const center = focusPositionForLandmark(anchor.imageTarget, anchor.worldPosition, anchor.imageBoundingBox);
          const shape = focusShapeForLandmark(navigationRadius, anchor.imageTarget, anchor.worldPosition, anchor.imageBoundingBox);
          landmarkFocus.set(anchor.id, {
            center: new THREE.Vector3(center.x, center.y, center.z),
            shape: new THREE.Vector3(shape.x, shape.y, shape.z),
          });
        }
        camera.far = Math.max(maxAnchorDistance * 100, 100);
        const mobileQuery = window.matchMedia("(max-width: 760px), (orientation: landscape) and (pointer: coarse)");
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const resize = () => {
          const width = Math.max(canvas!.clientWidth, 1);
          const height = Math.max(canvas!.clientHeight, 1);
          const pixelRatio = viewerPixelRatio(window.devicePixelRatio, mobileQuery.matches);
          if (renderer!.getPixelRatio() !== pixelRatio) renderer!.setPixelRatio(pixelRatio);
          renderer!.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas!);
        mobileQuery.addEventListener("change", resize);
        removeListeners.push(() => mobileQuery.removeEventListener("change", resize));
        resize();

        const pressed = new Set<string>();
        const euler = new THREE.Euler(0, 0, 0, "YXZ");
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        const movement = new THREE.Vector3();
        const velocity = new THREE.Vector3();
        const targetVelocity = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        const projection = new THREE.Vector3();
        const cameraSpace = new THREE.Vector3();
        const focusPoint = new THREE.Vector3();
        const focusShape = new THREE.Vector3(1, 1, 1);
        const inverseFocusShape = new THREE.Vector3(1, 1, 1);
        let yaw = 0;
        let pitch = 0;
        let pointerId: number | null = null;
        let pointerMode: "look" | "pan" = "look";
        let lastX = 0;
        let lastY = 0;
        let previousTime = performance.now();
        let lastFocusedId: string | null = null;
        let lastEffectId: string | null = null;
        let lastPanelSide: "left" | "right" | null = null;
        let firstFrameRendered = false;
        let lastCycleRevision = cycleRevisionRef.current;
        let lastResetRevision = resetRevisionRef.current;
        let transition: { elapsed: number; duration: number; start: Vector3; end: Vector3; startYaw: number; endYaw: number; startPitch: number; endPitch: number } | null = null;
        let focusTravel: { elapsed: number; duration: number; id: string; startView: Vector3; endView: Vector3; startInverseRadii: Vector3; endInverseRadii: Vector3 } | null = null;
        const focusTravelStartView = new THREE.Vector3();
        const focusTravelEndView = new THREE.Vector3();
        const focusTravelStartInverseRadii = new THREE.Vector3(1, 1, 1);
        const focusTravelEndInverseRadii = new THREE.Vector3(1, 1, 1);
        let lastMovement = 0;

        const applyRotation = () => {
          euler.set(pitch, yaw, 0);
          camera.quaternion.setFromEuler(euler);
        };
        const stopMovement = () => {
          pressed.clear();
          velocity.set(0, 0, 0);
          targetVelocity.set(0, 0, 0);
          lastMovement = 0;
          onMovementChange?.(0);
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (!["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"].includes(event.code)) return;
          event.preventDefault();
          pressed.add(event.code);
        };
        const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
        const onBlur = () => {
          stopMovement();
          pointerId = null;
        };
        const onPointerDown = (event: PointerEvent) => {
          if (pointerId !== null || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
          event.preventDefault();
          pointerId = event.pointerId;
          pointerMode = event.button === 0 ? "look" : "pan";
          lastX = event.clientX;
          lastY = event.clientY;
          canvas!.setPointerCapture(pointerId);
          canvas!.focus({ preventScroll: true });
        };
        const onPointerMove = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          const dx = event.clientX - lastX;
          const dy = event.clientY - lastY;
          if (pointerMode === "look") {
            yaw -= dx * 0.0025;
            pitch = THREE.MathUtils.clamp(pitch - dy * 0.0025, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
            applyRotation();
          } else {
            camera.getWorldDirection(forward);
            right.set(1, 0, 0).applyQuaternion(camera.quaternion);
            const scale = 0.00008 * navigationRadius;
            camera.position.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
            clampToNavigationBounds(camera.position, navigationRadius, navigationFloor);
          }
          lastX = event.clientX;
          lastY = event.clientY;
        };
        const onPointerUp = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          pointerId = null;
          if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
        };
        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          if (event.ctrlKey || mobileQuery.matches) {
            camera.getWorldDirection(forward);
            camera.position.addScaledVector(forward, THREE.MathUtils.clamp(-event.deltaY * 0.001, -0.35, 0.35));
          } else {
            right.set(1, 0, 0).applyQuaternion(camera.quaternion);
            camera.position.addScaledVector(right, -event.deltaX * navigationRadius * 0.00003);
            camera.position.addScaledVector(up, event.deltaY * navigationRadius * 0.00003);
          }
          clampToNavigationBounds(camera.position, navigationRadius, navigationFloor);
        };
        const preventContext = (event: Event) => event.preventDefault();
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        canvas!.addEventListener("pointerdown", onPointerDown);
        canvas!.addEventListener("pointermove", onPointerMove);
        canvas!.addEventListener("pointerup", onPointerUp);
        canvas!.addEventListener("pointercancel", onPointerUp);
        canvas!.addEventListener("wheel", onWheel, { passive: false });
        canvas!.addEventListener("contextmenu", preventContext);
        removeListeners.push(
          () => window.removeEventListener("keydown", onKeyDown),
          () => window.removeEventListener("keyup", onKeyUp),
          () => window.removeEventListener("blur", onBlur),
          () => canvas!.removeEventListener("pointerdown", onPointerDown),
          () => canvas!.removeEventListener("pointermove", onPointerMove),
          () => canvas!.removeEventListener("pointerup", onPointerUp),
          () => canvas!.removeEventListener("pointercancel", onPointerUp),
          () => canvas!.removeEventListener("wheel", onWheel),
          () => canvas!.removeEventListener("contextmenu", preventContext),
        );

        const renderFrame = (time: number) => {
          const delta = Math.min((time - previousTime) / 1000, 0.05);
          previousTime = time;
          if (lastResetRevision !== resetRevisionRef.current) {
            lastResetRevision = resetRevisionRef.current;
            hoveredIdRef.current = null;
            cycleHoverLockedRef.current = false;
            setHoverSuppressed(false);
          }
          if (lastCycleRevision !== cycleRevisionRef.current) {
            lastCycleRevision = cycleRevisionRef.current;
            hoveredIdRef.current = null;
            cycleHoverLockedRef.current = true;
            setHoverSuppressed(true);
          }
          const requestedId = focusedAnchorRef.current;
          const panelSide = !mobileQuery.matches && panelOpenRef.current ? "right" : !mobileQuery.matches && storyIndexOpenRef.current ? "left" : null;
          if (requestedId !== lastFocusedId || panelSide !== lastPanelSide) {
            const previousFocusedId = lastFocusedId;
            if (requestedId !== previousFocusedId) {
              velocity.set(0, 0, 0);
              targetVelocity.set(0, 0, 0);
            }
            lastFocusedId = requestedId;
            lastPanelSide = panelSide;
            const anchor = anchorsRef.current.find((item) => item.id === requestedId);
            if (anchor) {
              const destination = getFocusPosition(anchor.worldPosition, navigationRadius, navigationFloor);
              const target = new THREE.Vector3(anchor.worldPosition.x, anchor.worldPosition.y, anchor.worldPosition.z);
              const endPosition = new THREE.Vector3(destination.x, destination.y, destination.z);
              const direction = target.clone().sub(endPosition);
              const endYaw = Math.atan2(-direction.x, -direction.z);
              const endPitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
              let finalYaw = endYaw;
              if (panelSide) {
                const panel = document.querySelector(panelSide === "right" ? ".story-panel" : ".story-index");
                const panelWidth = panel?.getBoundingClientRect().width ?? Math.min(430, canvas!.clientWidth * 0.92);
                const offset = focusPanelYaw(canvas!.clientWidth, panelWidth, camera.aspect, camera.fov, panelSide);
                finalYaw += offset;
              }
              const targetFocus = anchor.kind === "story" ? landmarkFocus.get(anchor.id) : undefined;
              const targetShape = targetFocus?.shape ?? null;
              const targetFocusPosition = targetFocus?.center ?? anchor.worldPosition;
              if (targetShape && previousFocusedId && previousFocusedId !== anchor.id && !reducedMotion.matches) {
                const targetRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(endPitch, finalYaw, 0, "YXZ"));
                focusTravelStartView.copy(focusCenter).sub(camera.position).applyQuaternion(camera.quaternion.clone().invert());
                if (focusStrengthNode.value < 0.01 || focusTravelStartView.z >= 0) {
                  focusTravelStartView.set(0, 0, -Math.max(1, focusCenter.distanceTo(camera.position)));
                }
                focusTravelEndView.set(targetFocusPosition.x, targetFocusPosition.y, targetFocusPosition.z)
                  .sub(endPosition).applyQuaternion(targetRotation.clone().invert());
                focusTravelStartInverseRadii.copy(focusInverseRadii);
                focusTravelEndInverseRadii.set(1 / targetShape.x, 1 / targetShape.y, 1 / targetShape.z);
                focusTravel = {
                  elapsed: 0,
                  duration: 2.4,
                  id: anchor.id,
                  startView: focusTravelStartView.clone(),
                  endView: focusTravelEndView.clone(),
                  startInverseRadii: focusTravelStartInverseRadii.clone(),
                  endInverseRadii: focusTravelEndInverseRadii.clone(),
                };
              } else {
                focusTravel = null;
              }
            if (!anchor) focusTravel = null;
              if (reducedMotion.matches) {
                camera.position.copy(endPosition);
                yaw = finalYaw;
                pitch = endPitch;
                applyRotation();
                transition = null;
              } else {
                transition = {
                  elapsed: 0,
                  duration: 2.4,
                  start: camera.position.clone(),
                  end: endPosition,
                  startYaw: yaw,
                  endYaw: finalYaw,
                  startPitch: pitch,
                  endPitch,
                };
              }
            }
          }
          const stick = mobileMovementRef?.current;
          if ((stick && (stick.x || stick.y)) || pressed.size > 0) {
            transition = null;
            focusTravel = null;
          }
          if (transition) {
            transition.elapsed = Math.min(transition.elapsed + delta, transition.duration);
            const t = smootherstep(transition.elapsed / transition.duration);
            camera.position.lerpVectors(transition.start, transition.end, t);
            yaw = interpolateHeading(transition.startYaw, transition.endYaw, t);
            pitch = transition.startPitch + (transition.endPitch - transition.startPitch) * t;
            applyRotation();
            if (transition.elapsed >= transition.duration) transition = null;
          } else {
            movement.set(0, 0, 0);
            camera.getWorldDirection(forward);
            right.set(1, 0, 0).applyQuaternion(camera.quaternion);
            if (pressed.has("KeyW")) movement.add(forward);
            if (pressed.has("KeyS")) movement.sub(forward);
            if (pressed.has("KeyD")) movement.add(right);
            if (pressed.has("KeyA")) movement.sub(right);
            if (pressed.has("KeyE")) movement.add(up);
            if (pressed.has("KeyQ")) movement.sub(up);
            if (stick) movement.addScaledVector(forward, stick.y).addScaledVector(right, stick.x);
            const inputStrength = movement.length();
            const baseFlightSpeed = navigationRadius * 0.55 * 0.65;
            if (inputStrength > 1) movement.normalize();
            const boost = pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? 3 : 1;
            targetVelocity.copy(movement).multiplyScalar(baseFlightSpeed * boost);
            const dampingRate = inputStrength > 0 ? 5.5 : 4;
            velocity.lerp(targetVelocity, 1 - Math.exp(-dampingRate * delta));
            if (targetVelocity.lengthSq() === 0 && velocity.lengthSq() < 0.000001) velocity.set(0, 0, 0);
            camera.position.addScaledVector(velocity, delta);
            clampToNavigationBounds(camera.position, navigationRadius, navigationFloor);
            const intensity = Math.min(1, velocity.length() / baseFlightSpeed);
            if (Math.abs(intensity - lastMovement) >= 0.01) {
              lastMovement = intensity;
              onMovementChange?.(intensity);
            }
          }
          const focusedStory = anchorsRef.current.find((item): item is Extract<WorldAnchor, { kind: "story" }> =>
            item.id === (hoveredIdRef.current ?? requestedId) && item.kind === "story");
          if (focusedStory) {
            const targetFocus = landmarkFocus.get(focusedStory.id);
            if (targetFocus) {
              focusShape.copy(targetFocus.shape);
              focusPoint.copy(targetFocus.center);
            } else {
              focusShape.set(1, 1, 1);
              focusPoint.set(focusedStory.worldPosition.x, focusedStory.worldPosition.y, focusedStory.worldPosition.z);
            }
            const targetCenter = focusPoint;
            const firstFocus = lastEffectId === null;
            const focusEase = reducedMotion.matches ? 1 : 1 - Math.exp(-7 * delta);
            if (firstFocus) {
              focusCenter.copy(targetCenter);
              focusInverseRadii.set(1 / focusShape.x, 1 / focusShape.y, 1 / focusShape.z);
            } else if (focusTravel?.id === focusedStory.id) {
              focusTravel.elapsed = Math.min(focusTravel.elapsed + delta, focusTravel.duration);
              const progress = smootherstep(focusTravel.elapsed / focusTravel.duration);
              cameraRelativeFocusCenter(focusTravel.startView, focusTravel.endView, progress, camera.position, camera.quaternion, focusCenter);
              focusInverseRadii.lerpVectors(focusTravel.startInverseRadii, focusTravel.endInverseRadii, progress);
              if (focusTravel.elapsed >= focusTravel.duration) {
                focusTravel = null;
                focusCenter.copy(targetCenter);
                focusInverseRadii.set(1 / focusShape.x, 1 / focusShape.y, 1 / focusShape.z);
              }
            } else {
              if (focusTravel) focusTravel = null;
              focusCenter.lerp(targetCenter, focusEase);
              inverseFocusShape.set(1 / focusShape.x, 1 / focusShape.y, 1 / focusShape.z);
              focusInverseRadii.lerp(inverseFocusShape, focusEase);
            }
            focusStrengthNode.value += (1 - focusStrengthNode.value) * (reducedMotion.matches ? 1 : 1 - Math.exp(-5 * delta));
            const targetBrightness = panelOpenRef.current && focusedStory.id === requestedId ? 0.25 : 0.5;
            focusBrightnessNode.value += (targetBrightness - focusBrightnessNode.value) * focusEase;
            focusWaveTimeNode.value = reducedMotion.matches ? 0 : time * 0.001;
            focusWaveFrequencyNode.value = (Math.PI * 2) / (navigationRadius * 2.2);
            focusWaveAmplitudeNode.value = reducedMotion.matches ? 0 : navigationRadius * 0.0275;
            lastEffectId = focusedStory.id;
          } else {
            focusTravel = null;
            focusStrengthNode.value *= reducedMotion.matches ? 0 : Math.exp(-5 * delta);
            focusWaveAmplitudeNode.value = 0;
            if (focusStrengthNode.value < 0.001) lastEffectId = null;
          }
          const focusDistance = focusedStory && landmarkFocus.has(focusedStory.id) ? camera.position.distanceTo(focusPoint) : null;
          const depth = depthOfFieldTarget(navigationRadius, focusDistance, mobileQuery.matches);
          const focusBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-6 * delta);
          splatRenderer!.objectParams.focalDistance += (depth.focalDistance - splatRenderer!.objectParams.focalDistance) * focusBlend;
          const targetAperture = Math.tan(depth.apertureAngle / 2);
          splatRenderer!.objectParams.apertureTan += (targetAperture - splatRenderer!.objectParams.apertureTan) * focusBlend;
          camera.updateMatrixWorld(true);
          renderer!.render(scene, camera);
          for (const anchor of anchorsRef.current) {
            const element = anchorElementsRef.current.get(anchor.id);
            if (!element) continue;
            cameraSpace.set(anchor.worldPosition.x, anchor.worldPosition.y, anchor.worldPosition.z).applyMatrix4(camera.matrixWorldInverse);
            projection.set(anchor.worldPosition.x, anchor.worldPosition.y, anchor.worldPosition.z).project(camera);
            const visible = cameraSpace.z < 0 && projection.z >= -1 && projection.z <= 1 && Math.abs(projection.x) < 1.08 && Math.abs(projection.y) < 1.08;
            let previous = anchorStylesRef.current.get(anchor.id);
            if (!previous) {
              previous = { x: Infinity, y: Infinity, visible: !visible, size: 0, shift: Infinity };
              anchorStylesRef.current.set(anchor.id, previous);
            }
            if (previous.visible !== visible) {
              element.style.opacity = visible ? "1" : "0";
              element.style.visibility = visible ? "visible" : "hidden";
              element.style.pointerEvents = visible ? "auto" : "none";
              element.tabIndex = visible ? 0 : -1;
              element.setAttribute("aria-hidden", visible ? "false" : "true");
              previous.visible = visible;
            }
            if (!visible) continue;
            const x = (projection.x * 0.5 + 0.5) * 100;
            const y = (-projection.y * 0.5 + 0.5) * 100;
            const echoOffset = anchor.kind === "echo" && anchor.focusStoryId ? companionOffset(x) : 0;
            if (Math.abs(x - previous.x) > 0.005 || Math.abs(y - previous.y) > 0.005) {
              element.style.transform = `translate3d(calc(${x}vw + ${echoOffset}px), ${y}vh, 0) translate(-50%, -50%)`;
              previous.x = x;
              previous.y = y;
            }
            if (anchor.kind === "story") {
              const scale = hotspotVisualScale(x, y);
              const size = Math.round(scale * 1000) / 1000;
              if (previous.size !== size) {
                element.style.setProperty("--hotspot-visual-size", `${50 * scale}px`);
                element.style.setProperty("--hotspot-core-size", `${34 * scale}px`);
                previous.size = size;
              }
            }
            if (anchor.kind === "echo") {
              const center = x * canvas!.clientWidth / 100 + echoOffset;
              const halfWidth = Math.min(250, canvas!.clientWidth - 32) / 2;
              const safeCenter = Math.max(16 + halfWidth, Math.min(canvas!.clientWidth - 16 - halfWidth, center));
              const shift = Math.round(safeCenter - center);
              if (previous.shift !== shift) {
                element.style.setProperty("--echo-label-shift", `${shift}px`);
                previous.shift = shift;
              }
            }
          }
          if (!firstFrameRendered) {
            firstFrameRendered = true;
            setProgress(100);
            setViewerState("ready");
            console.info(capsInfo);
          }
        };
        renderer.setAnimationLoop(renderFrame);
        removeListeners.push(observeViewerVisibility(canvas!, (visible) => {
          previousTime = performance.now();
          stopMovement();
          canvas!.dataset.rendering = visible ? "active" : "paused";
          renderer?.setAnimationLoop(visible ? renderFrame : null);
        }));
      } catch (error) {
        if (!cancelled) {
          console.error("Radix WebGPU world failed to initialize", error);
          setViewerState("error");
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      onMovementChange?.(0);
      resizeObserver?.disconnect();
      removeListeners.forEach((remove) => remove());
      renderer?.setAnimationLoop(null);
      splatRenderer?.dispose();
      renderer?.dispose();
    };
  }, [mobileMovementRef, onMovementChange, splatUrl]);

  const showPoster = viewerState === "poster" || viewerState === "error";
  return (
    <div className="spark-world" data-viewer-state={viewerState} data-hover-suppressed={hoverSuppressed}
      onPointerMove={(event) => {
        if (event.pointerType === "touch" || Math.hypot(event.movementX, event.movementY) < 2) return;
        cycleHoverLockedRef.current = false;
        setHoverSuppressed(false);
        const marker = event.target instanceof Element ? event.target.closest<HTMLElement>(".hotspot, .story-echo") : null;
        hoveredIdRef.current = marker?.dataset.focusStoryId ?? (marker?.classList.contains("hotspot") ? marker.dataset.anchorId ?? null : null);
      }}>
      {showPoster && <Image className="world-poster" src={posterSrc} alt={alt} fill priority={!splatUrl} sizes="100vw" />}
      <canvas ref={canvasRef} className="spark-canvas" tabIndex={splatUrl ? 0 : -1}
        aria-label={splatUrl ? `Interactive WebGPU 3D world. ${alt}` : undefined} aria-hidden={viewerState !== "ready"}
        style={{ touchAction: "none" }} />
      {anchors.map((anchor) => anchor.kind === "story" ? (
        <button key={anchor.id} ref={(element) => { if (element) anchorElementsRef.current.set(anchor.id, element); else anchorElementsRef.current.delete(anchor.id); }}
          className={`hotspot hotspot-${anchor.tone} ${anchor.active ? "is-active" : ""}`} data-anchor-id={anchor.id} data-anchor-state="baked"
          style={{ transform: `translate3d(${anchor.fallbackScreenPosition.x * 100}vw, ${anchor.fallbackScreenPosition.y * 100}vh, 0) translate(-50%, -50%)` }}
          onPointerEnter={(event) => { if (event.pointerType !== "touch" && !hoverSuppressed && !cycleHoverLockedRef.current) { hoveredIdRef.current = anchor.id; onAnchorHover?.(); } }}
          onPointerLeave={() => { if (hoveredIdRef.current === anchor.id) hoveredIdRef.current = null; }}
          onFocus={() => { hoveredIdRef.current = anchor.id; }} onBlur={() => { if (hoveredIdRef.current === anchor.id) hoveredIdRef.current = null; }}
          onClick={() => onAnchorSelect?.(anchor.id)} aria-label={`Explore story ${anchor.number}: ${anchor.label}`} aria-pressed={anchor.active}>
          <span className="hotspot-visual" aria-hidden="true"><span className="hotspot-pulse" /><span className="hotspot-orbit"><i /></span><span className="hotspot-core"><span className="hotspot-number">{anchor.number}</span></span></span>
          <span className="hotspot-label hotspot-story-label"><small>Story {anchor.number} · {anchor.category}</small><strong>{anchor.label}</strong><span>{anchor.summary}</span><em>Click to explore</em></span>
        </button>
      ) : (
        <button key={anchor.id} ref={(element) => { if (element) anchorElementsRef.current.set(anchor.id, element); else anchorElementsRef.current.delete(anchor.id); }}
          type="button" className={`story-echo${anchor.focusStoryId ? " landmark-companion" : ""}`} data-anchor-id={anchor.id} data-focus-story-id={anchor.focusStoryId} data-anchor-state="baked"
          style={{ transform: `translate3d(calc(${anchor.fallbackScreenPosition.x * 100}vw + ${anchor.focusStoryId ? companionOffset(anchor.fallbackScreenPosition.x * 100) : 0}px), ${anchor.fallbackScreenPosition.y * 100}vh, 0) translate(-50%, -50%)` }}
          onPointerEnter={(event) => { if (event.pointerType !== "touch" && !cycleHoverLockedRef.current) { hoveredIdRef.current = anchor.focusStoryId ?? null; onAnchorHover?.(); } }}
          onPointerLeave={() => { if (hoveredIdRef.current === anchor.focusStoryId) hoveredIdRef.current = null; }}
          onFocus={() => { hoveredIdRef.current = anchor.focusStoryId ?? null; }} onBlur={() => { if (hoveredIdRef.current === anchor.focusStoryId) hoveredIdRef.current = null; }}
          onClick={(event) => { event.stopPropagation(); event.currentTarget.blur(); hoveredIdRef.current = null; setHoverSuppressed(true); if (anchor.focusStoryId) onAnchorSelect?.(anchor.focusStoryId); else onStoryNavigate?.(anchor.storyId); }}
          tabIndex={0} aria-label={`Story echo for story ${anchor.storyNumber}. ${echoDescription(anchor)}`}>
          <span className="story-echo-visual" aria-hidden="true"><span className="story-echo-pulse" /><span className="story-echo-orbit"><i /></span><span className="story-echo-core">✦</span></span>
          <span className="hotspot-label story-echo-label"><small>{anchor.focusStoryId ? "Landmark Echo" : "Story Echo"} · Story {anchor.storyNumber}</small><strong>{anchor.label}</strong><span>{echoDescription(anchor)}</span>{!anchor.focusStoryId && <span className="echo-story-action">Go to story {anchor.storyNumber} →</span>}</span>
        </button>
      ))}
      {splatUrl && <WorldLoadingIndicator progress={progress} visible={viewerState === "loading"} />}
      {viewerState === "error" && <p className="spark-fallback-note" role="status">Spatial view unavailable · Showing today&apos;s image</p>}
      {!splatUrl && <span className="poster-badge">Image preview · Radix ready</span>}
    </div>
  );
}
