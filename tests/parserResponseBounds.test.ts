import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const MONITORED_EXTERNAL_CLIENTS = [
  "backend/src/sources/tdata/vlr/scraper.ts",
  "backend/src/sources/tdata/dltv/client.ts",
  "backend/src/sources/tdata/fandom/client.ts",
  "backend/src/sources/tdata/liquipedia/client/network.ts",
  "backend/src/sources/tbvolley/VolleyballWorld/index.ts",
  "backend/src/sources/tbvolley/beach.volley.ru/index.ts",
  "backend/src/sources/tbvolley/GermanBeachTour/index.ts",
  "backend/src/sources/tbvolley/TwelveNdr/index.ts",
  "backend/src/sources/tbvolley/CBV/index.ts",
  "backend/src/sources/tbvolley/Federvolley/index.ts",
  "backend/src/sources/tablet/WTT/index.ts",
] as const;

test("parser-monitor external clients stream response bodies through the shared byte limit", () => {
  for (const relativePath of MONITORED_EXTERNAL_CLIENTS) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, /readBoundedBodyText/u, `${relativePath} must use the shared bounded reader`);
    assert.doesNotMatch(source, /await\s+(?:response|res)\.(?:text|json)\s*\(/u, `${relativePath} reads an unbounded body`);
  }
});

test("admin tournament import never delegates chunked bodies to Request.json", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "frontend/src/app/api/[disciplineSlug]/import-tournament/route.ts"),
    "utf8",
  );
  assert.match(route, /readBoundedBodyJson/u);
  assert.doesNotMatch(route, /request\.json\s*\(/u);
});
