import { HltvMode } from "../scraper";
import { executeScraper } from "./execute";
import { getHltvQueueDelayMs } from "@/lib/config/env";

let hltvHeavyQueue: Promise<any> = Promise.resolve();
let hltvHealthQueue: Promise<any> = Promise.resolve();
const activeRequests = new Map<string, Promise<any>>();
let lastHeavyStartedAt = 0;
let lastHealthStartedAt = 0;

const HLTV_MODES = new Set<HltvMode>(["scrape", "search", "event", "events", "health"]);

export async function runHltvScript(mode: HltvMode, queryOrId?: string, options: { noCache?: boolean } = {}) {
  if (!HLTV_MODES.has(mode)) {
    throw new Error(`Unsupported HLTV scraper mode: ${mode}`);
  }

  const requestKey = `${mode}:${queryOrId}:${options.noCache ? "force" : "cached"}`;
  
  // DEDUPLICATION: If exactly the same request is already running, return its promise
  if (activeRequests.has(requestKey)) {
    console.log(`[HLTV Queue] Attaching to existing active request for ${requestKey}`);
    return activeRequests.get(requestKey);
  }

  const isHealth = mode === "health";
  const currentPromise = isHealth ? hltvHealthQueue : hltvHeavyQueue;
  const requestId = Math.random().toString(36).substring(7);
  const queueDelayMs = getHltvQueueDelayMs();
  
  console.log(`[HLTV Queue] New request ${requestId} (${requestKey}) added to queue.`);
  
  const nextPromise = (async () => {
    try {
      await currentPromise;
      const lastStartedAt = isHealth ? lastHealthStartedAt : lastHeavyStartedAt;
      const waitMs = Math.max(0, queueDelayMs - (Date.now() - lastStartedAt));
      if (waitMs > 0) {
        console.log(`[HLTV Queue] Waiting ${waitMs}ms before starting ${requestKey}.`);
        await new Promise((resolve) => setTimeout(resolve, waitMs + Math.floor(Math.random() * Math.min(queueDelayMs, 500))));
      }
      console.log(`[HLTV Queue] Request ${requestId} is now STARTING.`);
    } catch (e) {
      console.log(`[HLTV Queue] Request ${requestId} is now STARTING (previous failed).`);
    }
    if (isHealth) lastHealthStartedAt = Date.now();
    else lastHeavyStartedAt = Date.now();
    
    try {
      const result = await executeScraper(mode, queryOrId, requestId, 1, false, options);
      return result;
    } finally {
      // Cleanup after completion
      activeRequests.delete(requestKey);
    }
  })();

  activeRequests.set(requestKey, nextPromise);
  if (isHealth) hltvHealthQueue = nextPromise;
  else hltvHeavyQueue = nextPromise;
  return nextPromise;
}
