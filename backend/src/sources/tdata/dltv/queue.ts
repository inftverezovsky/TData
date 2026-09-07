import { executeDltv, type DltvMode } from "./client";
import type { DltvRunOptions, DltvRunResult } from "./types";

let dltvQueue: Promise<unknown> = Promise.resolve();
const activeRequests = new Map<string, Promise<DltvRunResult>>();
let lastStartedAt = 0;

const DLTV_MODES = new Set<DltvMode>(["events", "search", "event", "health"]);

export async function runDltv(mode: DltvMode, queryOrUrl?: string, options: DltvRunOptions = {}): Promise<DltvRunResult> {
  if (!DLTV_MODES.has(mode)) {
    throw new Error(`Unsupported DLTV mode: ${mode}`);
  }

  const requestKey = `${mode}:${queryOrUrl || ""}:${options.noCache ? "force" : "cached"}:${options.signal ? "abortable" : "shared"}:${options.monitorMode ? "monitor" : "full"}`;
  const active = activeRequests.get(requestKey);
  if (active) return active;

  const queueDelayMs = Number(process.env.DLTV_QUEUE_DELAY_MS || 1000);
  const currentPromise = dltvQueue;
  const nextPromise = (async () => {
    try {
      await currentPromise;
      options.signal?.throwIfAborted();
      const waitMs = Math.max(0, queueDelayMs - (Date.now() - lastStartedAt));
      if (waitMs > 0) await abortableDelay(waitMs, options.signal);
    } catch {}
    lastStartedAt = Date.now();
    try {
      return await executeDltv(mode, queryOrUrl, options);
    } finally {
      activeRequests.delete(requestKey);
    }
  })();

  activeRequests.set(requestKey, nextPromise);
  dltvQueue = nextPromise;
  return nextPromise;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
