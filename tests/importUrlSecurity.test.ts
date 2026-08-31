import assert from "node:assert/strict";
import test from "node:test";

import { validateTournamentImportSourceUrl } from "../backend/src/imports/sourceUrlPolicy";
import { validateDltvEventUrl } from "../backend/src/sources/tdata/dltv/client";
import { normalizeHltvEventUrl } from "../backend/src/sources/tdata/hltv/importTournament";
import { resolveVlrEventUrl } from "../backend/src/sources/tdata/vlr/scraper";
import { POST as postTournamentImport } from "../frontend/src/app/api/[disciplineSlug]/import-tournament/route";

test("tournament import URL policy accepts canonical provider URLs", () => {
  assert.equal(
    validateTournamentImportSourceUrl("hltv", "https://www.hltv.org/events/8249/blast-open-porto-2026", "counterstrike"),
    "https://www.hltv.org/events/8249/blast-open-porto-2026",
  );
  assert.equal(
    validateTournamentImportSourceUrl("dltv", "https://ru.dltv.org/events/qualifiers/elite-league", "dota2"),
    "https://ru.dltv.org/events/qualifiers/elite-league",
  );
  assert.equal(
    validateTournamentImportSourceUrl("liquipedia", "https://liquipedia.net/dota2/The_International", "dota2"),
    "https://liquipedia.net/dota2/The_International",
  );
});

test("tournament import URL policy rejects SSRF, credentials, ports and cross-provider paths", () => {
  const blocked = [
    ["dltv", "http://127.0.0.1:3010/api/health", "dota2"],
    ["dltv", "https://ru.dltv.org.evil.example/events/x", "dota2"],
    ["hltv", "https://user:pass@www.hltv.org/events/8249/x", "counterstrike"],
    ["vlr", "https://www.vlr.gg:444/event/1/x", "valorant"],
    ["liquipedia", "https://liquipedia.net/counterstrike/Foo", "dota2"],
    ["wtt", "https://www.worldtabletennis.com/admin", "tabletennis"],
  ] as const;

  for (const [source, url, slug] of blocked) {
    assert.throws(
      () => validateTournamentImportSourceUrl(source, url, slug),
      /invalid|allowed|source|match/i,
      `${source} should reject ${url}`,
    );
  }
});

test("providers that derive their own canonical URL may omit pageUrl", () => {
  assert.equal(validateTournamentImportSourceUrl("cbv", "", "beachvolleyball"), "");
});

test("direct parser clients enforce their own event URL allowlists", () => {
  assert.equal(validateDltvEventUrl("https://ru.dltv.org/events/a/b"), "https://ru.dltv.org/events/a/b");
  assert.equal(resolveVlrEventUrl("123"), "https://www.vlr.gg/event/123");
  assert.equal(normalizeHltvEventUrl("https://hltv.org/events/8249/blast-open-porto-2026"), "https://www.hltv.org/events/8249/blast-open-porto-2026");
  assert.throws(() => validateDltvEventUrl("http://127.0.0.1/events/a"), /invalid/i);
  assert.throws(() => resolveVlrEventUrl("https://127.0.0.1/event/123/x"), /invalid|same-origin/i);
  assert.throws(() => normalizeHltvEventUrl("https://evil.example/events/8249/x"), /invalid/i);
});

test("tournament import keeps the UI workflow public but rejects cross-origin mutations", async () => {
  const params = { params: Promise.resolve({ disciplineSlug: "counterstrike" }) };
  const sameOrigin = await postTournamentImport(new Request("http://localhost/api/counterstrike/import-tournament", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: "{}",
  }), params);
  assert.notEqual(sameOrigin.status, 401);

  const crossOrigin = await postTournamentImport(new Request("http://localhost/api/counterstrike/import-tournament", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: "{}",
  }), params);
  assert.equal(crossOrigin.status, 403);
});
