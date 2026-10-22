import assert from "node:assert/strict";
import { test } from "node:test";
import { observeViewerVisibility } from "../lib/viewer-visibility";

test("viewer pauses outside the viewport or in a hidden document and disconnects", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  let intersection: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void;
  let visibility: () => void = () => {};
  let disconnected = false;
  let removed = false;
  const documentMock = {
    hidden: false,
    addEventListener: (_name: string, callback: () => void) => { visibility = callback; },
    removeEventListener: () => { removed = true; },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: class {
    constructor(callback: typeof intersection) { intersection = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } });
  try {
    const states: boolean[] = [];
    const stop = observeViewerVisibility({} as HTMLElement, visible => states.push(visible));
    intersection!([{ isIntersecting: true, intersectionRatio: 1 }]);
    intersection!([{ isIntersecting: true, intersectionRatio: 0.5 }]);
    documentMock.hidden = true;
    visibility();
    documentMock.hidden = false;
    visibility();
    intersection!([{ isIntersecting: false, intersectionRatio: 0 }]);
    assert.deepEqual(states, [false, true, false, true, false]);
    stop();
    assert.ok(disconnected && removed);
  } finally {
    for (const [key, descriptor] of [["document", originalDocument], ["IntersectionObserver", originalObserver]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
