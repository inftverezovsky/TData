import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { classifyHltvEmptyResult } from "../backend/src/sources/tdata/hltv/scraper/helpers";
import {
  findExistingHltvTournament,
  normalizeHltvTournamentTitle,
  parseHltvSourcePageId,
  shouldReplaceHltvMatchesOnImport,
} from "../backend/src/sources/tdata/hltv/importTournament";
import { forceKillChild } from "../backend/src/sources/tdata/hltv/scraper/execute";
import { maskProxyUrl } from "../backend/src/proxy/proxySelector";

// The browser scraper is plain ESM because it is executed directly by Node in production.
// @ts-expect-error The production browser helper intentionally remains plain ESM.
import { buildHltvEventMatchesUrl, classifyHltvPageHtml, extractHltvEventTitle, parseHltvMatchesHtml, validateHltvNavigationUrl } from "../scripts/hltv_semantics.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("parser log proxy masking removes the complete credential pair", () => {
  const masked = maskProxyUrl("socks5://sensitive-user:sensitive-password@proxy.example:1080/path?token=secret");
  assert.equal(masked, "socks5://proxy.example:1080");
  assert.doesNotMatch(masked, /sensitive|token|secret/i);
});

test("HLTV title fallback cannot claim a tournament owned by another provider", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    tournament: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        calls.push(where);
        if (where.sourceTitle === "Shared title" && !("OR" in where)) {
          return { id: "foreign-provider" };
        }
        return null;
      },
    },
  };

  const found = await findExistingHltvTournament(
    "counterstrike",
    "Shared title",
    "Shared title",
    "https://www.hltv.org/events/8249/shared-title",
    null,
    client as never,
  );

  assert.equal(found, null);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    disciplineSlug: "counterstrike",
    sourceTitle: "Shared title",
    OR: [
      { sourceUrl: { startsWith: "https://www.hltv.org/events/" } },
      { sourceUrl: { startsWith: "https://hltv.org/events/" } },
      { sourceUrl: "" },
    ],
  });
});

test("HLTV title fallback still accepts an explicit legacy empty source URL", async () => {
  const client = {
    tournament: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => (
        where.sourceTitle === "Legacy title" && "OR" in where
          ? { id: "legacy-empty-url" }
          : null
      ),
    },
  };

  const found = await findExistingHltvTournament(
    "counterstrike",
    "Legacy title",
    "Legacy title",
    "https://www.hltv.org/events/8249/legacy-title",
    null,
    client as never,
  );
  assert.equal(found?.id, "legacy-empty-url");
});

test("HLTV rejects an unexplained empty event result", () => {
  assert.equal(classifyHltvEmptyResult("event", { ok: true }, 0, null), "parse_failed");
  assert.equal(
    classifyHltvEmptyResult("event", { ok: true, validEmpty: true }, 0, null),
    "empty_valid"
  );
  assert.equal(classifyHltvEmptyResult("event", { ok: true }, 2, null), null);
});

test("HLTV page validation distinguishes Cloudflare, selector drift and explicit empty state", () => {
  assert.deepEqual(
    classifyHltvPageHtml("event", "<html><title>Just a moment...</title><body>Cloudflare Ray ID</body></html>"),
    { ok: false, errorClass: "cloudflare_block", validEmpty: false, emptyState: null }
  );
  assert.deepEqual(
    classifyHltvPageHtml("event", "<html><title>HLTV.org</title><body><main>new unknown markup</main></body></html>"),
    { ok: false, errorClass: "selector_changed", validEmpty: false, emptyState: null }
  );
  assert.deepEqual(
    classifyHltvPageHtml(
      "event",
      "<html><title>HLTV.org</title><body><div class='standard-box no-matches'>There are no upcoming matches</div></body></html>"
    ),
    { ok: true, errorClass: null, validEmpty: true, emptyState: "no_upcoming_matches" }
  );
  assert.deepEqual(
    classifyHltvPageHtml(
      "event",
      "<html><title>HLTV.org</title><body><div class='event-status'>This event has been cancelled</div></body></html>"
    ),
    { ok: true, errorClass: null, validEmpty: true, emptyState: "event_cancelled" }
  );
  assert.deepEqual(
    classifyHltvPageHtml(
      "event",
      "<html><title>HLTV.org</title><body><div class='standard-box event-status'>This event has been removed</div></body></html>"
    ),
    { ok: true, errorClass: null, validEmpty: true, emptyState: "event_deleted" }
  );
  assert.deepEqual(
    classifyHltvPageHtml(
      "event",
      "<html><title>HLTV.org</title><body><aside class='standard-box'>News: this event has been cancelled</aside></body></html>"
    ),
    { ok: false, errorClass: "selector_changed", validEmpty: false, emptyState: null }
  );
  assert.deepEqual(
    classifyHltvPageHtml(
      "event",
      "<html><title>HLTV.org</title><body><aside class='standard-box'>Sidebar: there are no upcoming matches today</aside></body></html>"
    ),
    { ok: false, errorClass: "selector_changed", validEmpty: false, emptyState: null }
  );
});

test("HLTV main-frame navigation policy allows only HTTPS HLTV origins", () => {
  assert.equal(
    validateHltvNavigationUrl("https://www.hltv.org/events/8249/test?tab=matches#live"),
    "https://www.hltv.org/events/8249/test?tab=matches",
  );
  assert.equal(
    validateHltvNavigationUrl("https://hltv.org/search?query=blast"),
    "https://hltv.org/search?query=blast",
  );

  for (const value of [
    "http://www.hltv.org/events/8249/test",
    "https://evil.example/events/8249/test",
    "https://www.hltv.org.evil.example/events/8249/test",
    "https://user:pass@www.hltv.org/events/8249/test",
    "https://www.hltv.org:444/events/8249/test",
  ]) {
    assert.throws(
      () => validateHltvNavigationUrl(value),
      (error: unknown) => error instanceof Error
        && (error as Error & { errorClass?: string }).errorClass === "parse_failed",
    );
  }
});

test("HLTV Playwright aborts off-origin main-frame redirects before network continuation", () => {
  const browserSource = fs.readFileSync(path.join(ROOT, "scripts/hltv_playwright.mjs"), "utf8");
  const routeStart = browserSource.indexOf("await page.route('**/*'");
  const routeEnd = browserSource.indexOf("await page.addInitScript", routeStart);
  const routeSource = browserSource.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(routeSource, /request\.isNavigationRequest\(\)/);
  assert.match(routeSource, /request\.frame\(\) === page\.mainFrame\(\)/);
  assert.match(routeSource, /validateHltvNavigationUrl\(request\.url\(\)\)/);
  assert.match(routeSource, /route\.abort\('blockedbyclient'\)/);
  assert.ok(
    routeSource.indexOf("validateHltvNavigationUrl(request.url())")
      < routeSource.lastIndexOf("route.continue()"),
  );
  assert.match(browserSource, /validateHltvNavigationUrl\(url\)[\s\S]*page\.goto\(safeUrl/);
});

test("HLTV proxy credentials are passed outside argv and removed before Chromium starts", () => {
  const executeSource = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/hltv/scraper/execute.ts",
  ), "utf8");
  const browserSource = fs.readFileSync(path.join(ROOT, "scripts/hltv_playwright.mjs"), "utf8");

  assert.doesNotMatch(executeSource, /args\.push\("--proxy"/);
  assert.match(executeSource, /env:\s*buildHltvChildEnvironment\(proxyStr\)/);
  assert.match(browserSource, /process\.env\.HLTV_PLAYWRIGHT_PROXY/);
  assert.match(browserSource, /delete process\.env\.HLTV_PLAYWRIGHT_PROXY/);
});

test("HLTV Unix child cleanup targets the detached process group", async () => {
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  let windowsTreeKillCalled = false;

  await forceKillChild(42_424, {
    platform: "linux",
    kill: (pid, signal) => {
      killCalls.push({ pid, signal });
    },
    killWindowsTree: async () => {
      windowsTreeKillCalled = true;
    },
  });

  assert.deepEqual(killCalls, [{ pid: -42_424, signal: "SIGKILL" }]);
  assert.equal(windowsTreeKillCalled, false);

  const executeSource = fs.readFileSync(path.join(
    ROOT,
    "backend/src/sources/tdata/hltv/scraper/execute.ts",
  ), "utf8");
  assert.match(executeSource, /detached:\s*process\.platform !== "win32"/);
});

test("HLTV Unix child cleanup falls back to the direct child when the group is already absent", async () => {
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];

  await forceKillChild(42_425, {
    platform: "linux",
    kill: (pid, signal) => {
      killCalls.push({ pid, signal });
      if (pid < 0) throw new Error("ESRCH");
    },
  });

  assert.deepEqual(killCalls, [
    { pid: -42_425, signal: "SIGKILL" },
    { pid: 42_425, signal: "SIGKILL" },
  ]);
});

test("HLTV Windows child cleanup preserves taskkill subtree behavior", async () => {
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const treeKillCalls: number[] = [];

  await forceKillChild(42_426, {
    platform: "win32",
    kill: (pid, signal) => {
      killCalls.push({ pid, signal });
    },
    killWindowsTree: async (pid) => {
      treeKillCalls.push(pid);
    },
  });

  assert.deepEqual(killCalls, [{ pid: 42_426, signal: "SIGKILL" }]);
  assert.deepEqual(treeKillCalls, [42_426]);
});

test("HLTV child cleanup rejects unsafe process identifiers", async () => {
  const killCalls: number[] = [];
  const kill = (pid: number) => {
    killCalls.push(pid);
  };

  for (const pid of [undefined, Number.NaN, -10, 0, 1, process.pid]) {
    await forceKillChild(pid, { platform: "linux", kill });
  }

  assert.deepEqual(killCalls, []);
});

test("parser monitor service gives GNU timeout ownership of the monitor process group", () => {
  const serviceSource = fs.readFileSync(path.join(
    ROOT,
    "deploy/systemd/tdata-parser-monitor.service",
  ), "utf8");
  const readmeSource = fs.readFileSync(path.join(ROOT, "deploy/systemd/README.md"), "utf8");

  assert.doesNotMatch(serviceSource, /timeout\s+--foreground/);
  assert.match(serviceSource, /timeout\s+--signal=TERM\s+--kill-after=30s\s+58m/);
  assert.match(readmeSource, /separate in-container process group/i);
  assert.doesNotMatch(readmeSource, /cancelled or wedged `docker exec` cannot leave/i);
});

test("HLTV repair only considers provider-owned rows and merges participant fields", () => {
  const repairSource = fs.readFileSync(path.join(ROOT, "scripts/repair-hltv-event.ts"), "utf8");
  assert.match(repairSource, /sourceUrl:\s*\{ startsWith: "https:\/\/www\.hltv\.org\/events\/" \}/);
  assert.match(repairSource, /mergeTournamentParticipantManualFields/);
  assert.match(repairSource, /planDltvUploadLogTransfer/);
  assert.match(repairSource, /planTournamentIdentityMerge/);
  assert.match(repairSource, /extractionStatus:\s*"MANUAL_REVIEW"/);
  assert.match(repairSource, /platformId:\s*identityPlan\.platformId/);
  const conflictGuardAt = repairSource.indexOf("if (identityPlan.manualReviewReasons.length > 0)");
  const destructiveMergeAt = repairSource.indexOf("await tx.tournamentMatch.updateMany");
  assert.ok(conflictGuardAt >= 0 && destructiveMergeAt > conflictGuardAt);
  assert.match(
    repairSource.slice(conflictGuardAt, destructiveMergeAt),
    /return \{ tournamentId: canonical\.id, manualReviewReasons: identityPlan\.manualReviewReasons \}/,
  );
  assert.doesNotMatch(repairSource, /disciplineSlug: "counterstrike",\s*OR:\s*\[/);
});

test("HLTV current match fixture produces a semantic match", () => {
  const html = `
    <html><title>Matches - HLTV.org</title><body>
      <div class="match-wrapper">
        <a href="/matches/2399999/inner-circle-vs-fut-blast-open-porto-2026">
          <div class="match-teamname">Inner Circle</div>
          <div class="match-teamname">FUT</div>
          <div class="match-event" data-event-headline="BLAST Open Porto 2026">Group A</div>
          <div class="matchMeta">bo3</div>
          <div class="matchTime" data-unix="1788091200">12:00</div>
        </a>
      </div>
    </body></html>`;

  const semantic = classifyHltvPageHtml("event", html);
  const matches = parseHltvMatchesHtml(html, 1_788_000_000);
  assert.equal(semantic.ok, true);
  assert.equal(semantic.validEmpty, false);
  assert.equal(semantic.emptyState, null);
  assert.deepEqual(matches.map((match: any) => ({
    id: match.id,
    tournament: match.tournament,
    team1: match.team1,
    team2: match.team2,
    unix_time: match.unix_time,
    format: match.format,
  })), [{
    id: "2399999",
    tournament: "BLAST Open Porto 2026",
    team1: "Inner Circle",
    team2: "FUT",
    unix_time: 1_788_091_200,
    format: "BO3",
  }]);
});

test("HLTV event title excludes the LAN badge and repairs the legacy glued suffix", () => {
  const html = `
    <a class="ongoing-event" href="/events/8249/blast-open-porto-2026">
      <div class="event-name-small">
        <span class="text-ellipsis">BLAST Open Porto 2026</span><span class="lan-marker">LAN</span>
      </div>
    </a>`;

  assert.equal(extractHltvEventTitle(html), "BLAST Open Porto 2026");
  assert.equal(normalizeHltvTournamentTitle("BLAST Open Porto 2026LAN"), "BLAST Open Porto 2026");
  assert.equal(normalizeHltvTournamentTitle("Elisa Masters LAN"), "Elisa Masters LAN");
});

test("HLTV keeps the canonical event slug while building the matches tab URL", () => {
  assert.equal(
    buildHltvEventMatchesUrl("https://www.hltv.org/events/8249/blast-open-porto-2026"),
    "https://www.hltv.org/events/8249/blast-open-porto-2026/matches"
  );
  assert.equal(
    buildHltvEventMatchesUrl("https://www.hltv.org/events/8249/blast-open-porto-2026/matches"),
    "https://www.hltv.org/events/8249/blast-open-porto-2026/matches"
  );
  assert.equal(
    buildHltvEventMatchesUrl("https://www.hltv.org/events/8249/blast-open-porto-2026?next=https://metadata.example/#matches"),
    "https://www.hltv.org/events/8249/blast-open-porto-2026/matches"
  );
});

test("HLTV stores a safe numeric event identity independently of title and slug", () => {
  assert.equal(parseHltvSourcePageId("8249"), 8249);
  assert.equal(parseHltvSourcePageId("not-an-id"), null);
  assert.equal(parseHltvSourcePageId("9999999999999999"), null);
});

test("HLTV replacement preserves last-good data unless the result is semantically validated", () => {
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: true,
    matchesCount: 6,
    validEmpty: false,
    persistedMatchesCount: 6,
  }), true);
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: true,
    matchesCount: 0,
    validEmpty: true,
    emptyState: "no_upcoming_matches",
    persistedMatchesCount: 6,
  }), false);
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: true,
    matchesCount: 0,
    validEmpty: true,
    emptyState: "no_upcoming_matches",
    persistedMatchesCount: 0,
  }), true);
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: true,
    matchesCount: 0,
    validEmpty: true,
    emptyState: "event_cancelled",
    persistedMatchesCount: 6,
  }), true);
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: true,
    matchesCount: 0,
    validEmpty: true,
    emptyState: "event_deleted",
    persistedMatchesCount: 6,
  }), true);
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: true,
    matchesCount: 0,
    validEmpty: false,
    emptyState: "event_deleted",
    persistedMatchesCount: 6,
  }), false);
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: true,
    matchesCount: 0,
    validEmpty: false,
    persistedMatchesCount: 0,
  }), false);
  assert.equal(shouldReplaceHltvMatchesOnImport({
    ok: false,
    matchesCount: 6,
    validEmpty: false,
    persistedMatchesCount: 6,
  }), false);
});
