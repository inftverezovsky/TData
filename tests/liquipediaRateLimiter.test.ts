import assert from "node:assert/strict";
import test from "node:test";
import {
  getLiquipediaRateLimitSnapshot,
  registerLiquipediaBackoff,
  resetLiquipediaRateLimitForTests,
} from "../src/lib/liquipedia/rateLimiter";

test("Liquipedia rate limiter registers Retry-After cooldown for 429", () => {
  resetLiquipediaRateLimitForTests();
  const previousCooldown = process.env.LIQUIPEDIA_COOLDOWN_MS;
  process.env.LIQUIPEDIA_COOLDOWN_MS = "100";
  const before = Date.now();

  try {
    registerLiquipediaBackoff("direct", "rate_limited", "2");

    const snapshot = getLiquipediaRateLimitSnapshot("direct");
    assert.ok(snapshot.cooldownUntil >= before + 1900);
    assert.ok(snapshot.cooldownUntil <= Date.now() + 2500);
  } finally {
    if (previousCooldown === undefined) delete process.env.LIQUIPEDIA_COOLDOWN_MS;
    else process.env.LIQUIPEDIA_COOLDOWN_MS = previousCooldown;
  }
});

test("Liquipedia rate limiter ignores non-blocking errors for cooldown", () => {
  resetLiquipediaRateLimitForTests();

  registerLiquipediaBackoff("direct", "parse_failed", "2");

  assert.equal(getLiquipediaRateLimitSnapshot("direct").cooldownUntil, 0);
});
