import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchFedervolleyOfficialCalendar,
  fetchFedervolleyOfficialTournamentRows,
} from "../backend/src/sources/tbvolley/Federvolley/officialJson";

test("Federvolley official index paginates only approved season paths and deduplicates rows", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; options: RequestInit }> = [];
  try {
    globalThis.fetch = async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      requests.push({ url, options: options || {} });
      if (url.endsWith("/2026/discipline.json")) {
        return jsonResponse({ pages: [
          { path_discipline: "2026/1/discipline.json" },
          { path_discipline: "2026/2/discipline.json" },
        ] });
      }
      const suffix = url.includes("/2026/1/") ? "one" : "two";
      return jsonResponse({ beach_volley: { serie: { national: { men: { codici: [
        { path: `2026/BVL/M/${suffix === "one" ? "11295" : "11562"}/calendario.json`, codice: suffix },
        { path: "2026/BVL/M/duplicate/calendario.json", codice: "duplicate" },
      ] } } } } });
    };

    const rows = await fetchFedervolleyOfficialTournamentRows(2026);

    assert.equal(rows.length, 3);
    assert.deepEqual(new Set(requests.map((request) => new URL(request.url).hostname)), new Set([
      "pub-8394085fb0ca451eaa42bc05b01c416f.r2.dev",
    ]));
    assert.equal(requests.length, 3);
    assert.equal((requests[0].options.headers as Record<string, string>).Accept, "application/json");
    assert.equal(requests[0].options.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Federvolley official index accepts a direct series and rejects unapproved page paths", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({ beach_volley: { serie: {
      regional: { women: { codici: [{ path: "2026/BVL/F/12000/calendario.json" }] } },
    } } });
    const direct = await fetchFedervolleyOfficialTournamentRows(2026);
    assert.equal(direct.length, 1);

    globalThis.fetch = async () => jsonResponse({ pages: [
      { path_discipline: "2025/1/discipline.json" },
    ] });
    await assert.rejects(fetchFedervolleyOfficialTournamentRows(2026), /invalid path/u);

    globalThis.fetch = async () => jsonResponse({ changed: true });
    await assert.rejects(fetchFedervolleyOfficialTournamentRows(2026), /unexpected page list/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Federvolley official calendar validates identity and response semantics", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return jsonResponse({ data: { id: "12000", matches: [] } });
    };
    const calendar = await fetchFedervolleyOfficialCalendar({
      year: 2026,
      gender: "women",
      nodeId: "12000",
    });
    assert.deepEqual(calendar, { data: { id: "12000", matches: [] } });
    assert.match(requested[0], /\/2026\/BVL\/F\/12000\/calendario\.json$/u);

    await assert.rejects(
      fetchFedervolleyOfficialCalendar({ year: 1999, gender: "men", nodeId: "12000" }),
      /season is invalid/u,
    );
    await assert.rejects(
      fetchFedervolleyOfficialCalendar({ year: 2026, gender: "men", nodeId: "..\/admin" }),
      /id is invalid/u,
    );

    globalThis.fetch = async () => new Response("<html>changed</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await assert.rejects(
      fetchFedervolleyOfficialCalendar({ year: 2026, gender: "men", nodeId: "12000" }),
      /non-JSON/u,
    );

    globalThis.fetch = async () => new Response("{broken", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      fetchFedervolleyOfficialCalendar({ year: 2026, gender: "men", nodeId: "12000" }),
      /invalid JSON/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
