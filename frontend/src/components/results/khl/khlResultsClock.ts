"use client";

import { useSyncExternalStore } from "react";

export const KHL_CLOCK_INTERVAL_MS = 15_000;

// A primitive bucket is stable across reads and never includes a future instant.
export function readKhlClientTime() {
  return Math.floor(Date.now() / KHL_CLOCK_INTERVAL_MS) * KHL_CLOCK_INTERVAL_MS;
}

export function readKhlServerTime(): null {
  return null;
}

export function subscribeKhlClock(onChange: () => void) {
  const timer = window.setInterval(onChange, KHL_CLOCK_INTERVAL_MS);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

export function useKhlResultsTime() {
  // Static HTML and its first hydration render share the same clock-free state.
  return useSyncExternalStore(subscribeKhlClock, readKhlClientTime, readKhlServerTime);
}
