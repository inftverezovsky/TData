import assert from "node:assert/strict";
import test from "node:test";
import { getTournamentImportUserMessage } from "../backend/src/imports/userFacingErrors";

test("Federvolley import errors keep the Federvolley source label", () => {
  const message = getTournamentImportUserMessage(
    "federvolley",
    null,
    "Federvolley HTTP 403: <html><title>Cloudflare</title></html>",
  );

  assert.match(message, /^Federvolley\/Cloudflare/);
  assert.equal(message.includes("Liquipedia"), false);
});

test("Federvolley import errors preserve useful fallback messages", () => {
  assert.equal(
    getTournamentImportUserMessage("federvolley", null, "Не удалось определить Federvolley node id"),
    "Не удалось определить Federvolley node id",
  );
});

test("Liquipedia import errors still use Liquipedia wording", () => {
  const message = getTournamentImportUserMessage("liquipedia", "cloudflare_block", null);

  assert.match(message, /^Liquipedia\/Cloudflare/);
});
