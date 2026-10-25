"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { StickValue } from "@/lib/touch-navigation";

const keys = [
  { key: "W", label: "Move forward", x: 0, y: 1 },
  { key: "A", label: "Strafe left", x: -1, y: 0 },
  { key: "S", label: "Move backward", x: 0, y: -1 },
  { key: "D", label: "Strafe right", x: 1, y: 0 },
];

/** Pointer and keyboard holds share the viewer's existing analog movement input. */
export function MovementButtons({ movementRef, disabled }: {
  movementRef: RefObject<StickValue>; disabled: boolean;
}) {
  const [held, setHeld] = useState<string | null>(null);
  const pointer = useRef<number | null>(null);
  function release() {
    pointer.current = null;
    movementRef.current = { x: 0, y: 0 };
    setHeld(null);
  }
  useEffect(() => {
    const reset = () => {
      pointer.current = null;
      movementRef.current = { x: 0, y: 0 };
      setHeld(null);
    };
    window.addEventListener("blur", reset);
    window.addEventListener("resize", reset);
    document.addEventListener("visibilitychange", reset);
    if (disabled) reset();
    return () => {
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", reset);
      document.removeEventListener("visibilitychange", reset);
      movementRef.current = { x: 0, y: 0 };
    };
  }, [disabled, movementRef]);
  return <>{keys.map(({ key, label, x, y }) => (
    <button key={key} type="button" disabled={disabled} aria-label={`${label} (hold)`}
      data-held={held === key} style={key === "W" ? { gridColumn: 2 } : key === "A" ? { gridColumn: 1, gridRow: 2 } : { gridRow: 2 }}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        movementRef.current = { x, y }; setHeld(key);
      }}
      onPointerMove={(event) => {
        if (pointer.current !== event.pointerId) return;
        const b = event.currentTarget.getBoundingClientRect();
        if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) release();
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault(); movementRef.current = { x, y }; setHeld(key);
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); release(); }
      }}
    ><kbd aria-hidden="true">{key}</kbd></button>
  ))}</>;
}
