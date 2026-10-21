"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { stickValueAt, type StickValue } from "@/lib/touch-navigation";

const neutral: StickValue = { x: 0, y: 0 };

export function MobileJoystick({ movementRef, onMove }: { movementRef: RefObject<StickValue>; onMove?: () => void }) {
  const activePointer = useRef<number | null>(null);
  const [position, setPosition] = useState<StickValue>(neutral);

  useEffect(() => {
    const reset = () => {
      activePointer.current = null;
      movementRef.current = neutral;
      setPosition(neutral);
    };
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      activePointer.current = null;
      movementRef.current = neutral;
    };
  }, [movementRef]);

  function update(event: PointerEvent<HTMLDivElement>) {
    const value = stickValueAt(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    movementRef.current = value;
    if (value.x !== 0 || value.y !== 0) onMove?.();
    setPosition(value);
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    movementRef.current = neutral;
    setPosition(neutral);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="mobile-joystick" role="group" aria-label="Move through the world">
      <div
        className="mobile-joystick-track"
        onPointerDown={(event) => {
          if (activePointer.current !== null) return;
          event.preventDefault();
          activePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          update(event);
        }}
        onPointerMove={(event) => {
          if (activePointer.current === event.pointerId) update(event);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <span className="mobile-joystick-knob" style={{ transform: `translate(${position.x * 30}px, ${-position.y * 30}px)` }} />
      </div>
      <span className="mobile-joystick-label">Move</span>
    </div>
  );
}
