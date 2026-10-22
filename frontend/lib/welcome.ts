export const WELCOME_STORAGE_KEY = "aworldeveryday:welcome-complete";

export function hasSeenWelcome(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(WELCOME_STORAGE_KEY) === "1"; }
  catch { return false; }
}

export function rememberWelcome(storage: Pick<Storage, "setItem">): void {
  try { storage.setItem(WELCOME_STORAGE_KEY, "1"); }
  catch { /* Browsing still works when storage is unavailable. */ }
}
