import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOfficialSourceUrl,
  TLineValidationError,
} from "../backend/src/tline/api/validation";

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
