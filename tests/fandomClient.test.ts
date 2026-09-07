import assert from "node:assert/strict";
import test from "node:test";

import { fetchFandomTournamentCargoEvents } from "../backend/src/sources/tdata/fandom/client";

test("Fandom tournament discovery prefers CargoExport and does not call the rate-limited API", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    assert.match(url, /\/wiki\/Special:CargoExport/);
    return new Response(JSON.stringify([{ Name: "Test", OverviewPage: "League/Test" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const rows = await fetchFandomTournamentCargoEvents("https://lol.fandom.com/api.php");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title.OverviewPage, "League/Test");
    assert.equal(requested.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fandom tournament discovery falls back to the MediaWiki API when CargoExport is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("Special:CargoExport")) {
      return new Response("unavailable", { status: 503 });
    }
    return new Response(JSON.stringify({ cargoquery: [{ title: { OverviewPage: "League/Fallback" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const rows = await fetchFandomTournamentCargoEvents("https://lol.fandom.com/api.php");
    assert.equal(rows.length, 1);
    assert.equal(requested.length, 2);
    assert.match(requested[1], /action=cargoquery/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
