import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOfficialSourceUrl,
  TLineValidationError,
} from "../backend/src/tline/api/validation";
import { resolveOfficialSourceConfig } from "../backend/src/tline/api/officialSource";

test("official source URL accepts the registered volley.ru HTTPS origin", () => {
  assert.equal(
    parseOfficialSourceUrl(
      "https://volley.ru/calendar/01KYPZAKJB0SMM0D6TGV3W0Y85/allgames",
      ["volley.ru"],
    ),
    "https://volley.ru/calendar/01KYPZAKJB0SMM0D6TGV3W0Y85/allgames",
  );
});

test("official source URL rejects SSRF targets, credentials and non-HTTPS URLs", () => {
  for (const candidate of [
    "http://volley.ru/calendar/test",
    "https://user:password@volley.ru/calendar/test",
    "https://127.0.0.1/calendar/test",
    "https://10.1.2.3/calendar/test",
    "https://[::1]/calendar/test",
    "https://localhost/calendar/test",
    "https://volley.ru.evil.example/calendar/test",
  ]) {
    assert.throws(
      () => parseOfficialSourceUrl(candidate, ["volley.ru"]),
      (error: unknown) => error instanceof TLineValidationError,
      candidate,
    );
  }
});

test("official source URL rejects fragments and normalizes the hostname", () => {
  assert.throws(
    () => parseOfficialSourceUrl("https://volley.ru/calendar/test#secret", ["volley.ru"]),
    (error: unknown) => error instanceof TLineValidationError && error.code === "INVALID_SOURCE_URL",
  );
  assert.equal(
    parseOfficialSourceUrl("https://VOLLEY.RU/calendar/test", ["volley.ru"]),
    "https://volley.ru/calendar/test",
  );
});

test("official source config infers the provider and external championship ID from an exact URL", () => {
  assert.deepEqual(
    resolveOfficialSourceConfig("https://volley.ru/calendar/01ABC/allgames"),
    { provider: "volley-ru", externalId: "01ABC", sourceUrl: "https://volley.ru/calendar/01ABC/allgames" },
  );
  assert.deepEqual(
    resolveOfficialSourceConfig("https://нффр.рф/sport/calendar/200"),
    { provider: "nffr-floorball", externalId: "200", sourceUrl: "https://xn--m1agla.xn--p1ai/sport/calendar/200" },
  );
  assert.deepEqual(
    resolveOfficialSourceConfig("https://hockey.by/calendar/"),
    { provider: "hockey-by", externalId: "11:5", sourceUrl: "https://hockey.by/calendar/" },
  );
  for (const candidate of [
    "https://xn--m1agla.xn--p1ai/sport/calendar/not-a-number",
    "https://xn--m1agla.xn--p1ai/sport/calendar/200?other=1",
    "https://sub.xn--m1agla.xn--p1ai/sport/calendar/200",
    "https://volley.ru/calendar/01ABC/allgames?other=1",
    "https://hockey.by/calendar",
    "https://hockey.by/calendar/?season=11",
    "https://hockey.by:444/calendar/",
    "https://user:pass@hockey.by/calendar/",
    "https://sub.hockey.by/calendar/",
    "https://hockey.by/gamecenter/123/",
  ]) {
    assert.throws(
      () => resolveOfficialSourceConfig(candidate),
      (error: unknown) => error instanceof TLineValidationError && error.code === "INVALID_SOURCE_URL",
      candidate,
    );
  }
});
