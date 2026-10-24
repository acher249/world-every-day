/** Installed by private video workers on loopback, before the application loads. */
export interface OfflineTour {
  seed: number;
  step?: () => void;
  render?: () => Promise<void>;
}

declare global {
  interface Window { __WORLD_OFFLINE_TOUR__?: OfflineTour }
}

export function offlineTour(): OfflineTour | undefined {
  if (typeof window === "undefined" || !["127.0.0.1", "localhost"].includes(window.location.hostname)) return;
  return window.__WORLD_OFFLINE_TOUR__;
}
