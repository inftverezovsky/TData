import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyParserError,
  emptyValidIfNoItems,
  normalizeParserErrorClass,
  shouldCooldownProxyForError,
} from "../src/lib/proxy/parserErrors";
import { getHltvSearchErrorMessage } from "../src/lib/hltv/userFacingErrors";

test("classifyParserError maps proxy tunnel failures", () => {
  assert.equal(classifyParserError({ message: "net::ERR_TUNNEL_CONNECTION_FAILED" }), "proxy_tunnel");
  assert.equal(classifyParserError({ message: "Navigation interrupted by chrome-error://chromewebdata/" }), "proxy_tunnel");
  assert.equal(normalizeParserErrorClass("tunnel"), "proxy_tunnel");
});

test("classifyParserError maps Cloudflare and source statuses", () => {
  assert.equal(classifyParserError({ message: "Cloudflare challenge cf-ray abc" }), "cloudflare_block");
  assert.equal(classifyParserError({ statusCode: 403 }), "cloudflare_block");
  assert.equal(classifyParserError({ statusCode: 429 }), "rate_limited");
  assert.equal(classifyParserError({ statusCode: 503 }), "source_5xx");
  assert.equal(classifyParserError({ statusCode: 404 }), "source_4xx");
});

test("classifyParserError maps parser and selector failures", () => {
  assert.equal(classifyParserError({ message: "Timeout waiting for search elements" }), "selector_changed");
  assert.equal(classifyParserError({ message: "request timed out" }), "timeout");
  assert.equal(classifyParserError({ message: "page.goto: net::ERR_TIMED_OUT at https://www.hltv.org/search" }), "timeout");
  assert.equal(classifyParserError({ message: "mouse.wheel: Target page, context or browser has been closed" }), "timeout");
  assert.equal(classifyParserError({ message: "selector .match-wrapper not found" }), "selector_changed");
  assert.equal(classifyParserError({ message: "Liquipedia API returned invalid JSON" }), "parse_failed");
});

test("empty_valid is explicit and does not cool down proxies", () => {
  assert.equal(emptyValidIfNoItems([0]), "empty_valid");
  assert.equal(emptyValidIfNoItems([1]), null);
  assert.equal(shouldCooldownProxyForError("empty_valid"), false);
  assert.equal(shouldCooldownProxyForError("proxy_tunnel"), true);
});

test("HLTV user-facing errors hide technical scraper messages", () => {
  assert.equal(
    getHltvSearchErrorMessage(null, "HLTV request timed out. Proxy might be too slow."),
    "HLTV не успел ответить через текущий прокси. Попробуйте обновить поиск или сменить прокси.",
  );
  assert.equal(
    getHltvSearchErrorMessage(null, "page.goto: net::ERR_TIMED_OUT at https://www.hltv.org/search"),
    "HLTV не успел ответить через текущий прокси. Попробуйте обновить поиск или сменить прокси.",
  );
});
