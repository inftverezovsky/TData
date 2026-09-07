import assert from "node:assert/strict";
import test from "node:test";
import {
  KHL_CLOCK_INTERVAL_MS, readKhlClientTime, readKhlServerTime, subscribeKhlClock,
} from "../frontend/src/components/results/khl/khlResultsClock";
import { partitionKhlResultsMatches } from "../frontend/src/components/results/khl/khlResultsViewModel";

test("clock snapshots are stable, never future, and cross Moscow midnight without new data", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T20:59:59.000Z") });
  const matches = [{ startsAt: "2026-09-05T14:00:00.000Z", status: "FINISHED" }];
  const before = readKhlClientTime();
  assert.equal(readKhlClientTime(), before);
  assert.ok(before <= Date.now() && Date.now() - before < KHL_CLOCK_INTERVAL_MS);
  assert.equal(readKhlServerTime(), null);
  assert.equal(partitionKhlResultsMatches(matches, new Date(before)).today.length, 1);
  context.mock.timers.setTime(Date.parse("2026-09-05T21:00:01.000Z"));
  const after = readKhlClientTime();
  assert.ok(after > before);
  assert.equal(readKhlServerTime(), null);
  const partition = partitionKhlResultsMatches(matches, new Date(after));
  assert.equal(partition.today.length, 0);
  assert.equal(partition.archive.length, 1);
});

test("clock refresh preserves the future-start guard within the same Moscow day", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T14:00:00.000Z") });
  const matches = [{ startsAt: "2026-09-05T14:00:10.000Z", status: "FINISHED" }];
  assert.equal(partitionKhlResultsMatches(matches, new Date(readKhlClientTime())).today.length, 0);
  context.mock.timers.setTime(Date.parse("2026-09-05T14:00:15.000Z"));
  assert.equal(partitionKhlResultsMatches(matches, new Date(readKhlClientTime())).today.length, 1);
});

test("clock wakes on timer, focus and visibility, then cleans up every subscription", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  let tick: (() => void) | undefined;
  let cleared = false;
  const fakeWindow = Object.assign(windowTarget, {
    setInterval(callback: () => void, interval: number) { assert.equal(interval, 15_000); tick = callback; return 9; },
    clearInterval(id: number) { assert.equal(id, 9); cleared = true; },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentTarget });
  try {
    let notifications = 0;
    const cleanup = subscribeKhlClock(() => { notifications++; });
    tick!();
    windowTarget.dispatchEvent(new Event("focus"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    assert.equal(notifications, 3);
    cleanup();
    assert.equal(cleared, true);
    windowTarget.dispatchEvent(new Event("focus"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    assert.equal(notifications, 3);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
