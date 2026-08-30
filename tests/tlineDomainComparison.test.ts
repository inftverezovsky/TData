import assert from "node:assert/strict";
import test from "node:test";
import { TLINE_AUTOMATIC_STATUSES, type AdminLineMatch, type OfficialSourceMatch } from "../backend/src/tline/domain/types";
import { compareTLineMatches } from "../backend/src/tline/comparison/engine";
import { resolveEffectiveStatus } from "../backend/src/tline/comparison/statusOverlay";

const source = (
  id: string,
  startTimeUtc: string | null,
  overrides: Partial<OfficialSourceMatch> = {},
): OfficialSourceMatch => ({
  id,
  championshipId: "championship",
  externalId: id,
  home: { sourceTeamId: `${id}-home`, name: "Динамо", adminTeamId: "team-a" },
  away: { sourceTeamId: `${id}-away`, name: "Локомотив", adminTeamId: "team-b" },
  startTimeRaw: startTimeUtc ?? "TBD",
  sourceTimezone: "Europe/Moscow",
  startTimeUtc,
  status: "SCHEDULED",
  ...overrides,
});

const admin = (
  id: string,
  startTimeUtc: string | null,
  overrides: Partial<AdminLineMatch> = {},
): AdminLineMatch => ({
  id,
  championshipId: "championship",
  externalId: id,
  home: { adminTeamId: "team-a", name: "Динамо" },
  away: { adminTeamId: "team-b", name: "Локомотив" },
  startTimeUtc,
  status: "SCHEDULED",
  ...overrides,
});

const compare = (sources: readonly OfficialSourceMatch[], admins: readonly AdminLineMatch[], tolerance = 2) =>
  compareTLineMatches({
    sourceMatches: sources,
    adminMatches: admins,
    allowedTimeDriftMinutes: tolerance,
    candidateMatchWindowMinutes: 180,
  });

test("domain exposes every automatic status from the TLine passport", () => {
  assert.deepEqual(TLINE_AUTOMATIC_STATUSES, [
    "PENDING", "PROCESSING", "AUTO_OK", "TIME_WARNING", "TIME_ERROR", "TIME_CRITICAL",
    "SOURCE_ONLY", "ADMIN_ONLY", "TEAM_UNMAPPED", "MATCH_AMBIGUOUS", "DUPLICATE_SOURCE",
    "DUPLICATE_ADMIN", "SOURCE_TIME_UNDEFINED", "STATUS_MISMATCH", "PARSER_FAILED", "CANCELLED",
  ]);
});

test("exact match is AUTO_OK and reverse home/away is a non-error ok* marker", () => {
  const exact = compare([source("source-1", "2026-12-01T11:00:00.000Z")], [admin("admin-1", "2026-12-01T11:00:00.000Z")]);
  assert.equal(exact[0].automaticStatus, "AUTO_OK");
  assert.equal(exact[0].swappedSides, false);

  const swapped = compare(
    [source("source-2", "2026-12-01T11:00:00.000Z")],
    [
      admin("admin-2", "2026-12-01T11:00:00.000Z", {
        home: { adminTeamId: "team-b", name: "Локомотив" },
        away: { adminTeamId: "team-a", name: "Динамо" },
      }),
    ],
  );
  assert.equal(swapped[0].automaticStatus, "AUTO_OK");
  assert.equal(swapped[0].swappedSides, true);
  assert.equal(resolveEffectiveStatus(swapped[0]).display, "ok*");
});

test("time drift follows tolerance, warning, error, critical and Moscow date rules", () => {
  const base = source("source", "2026-12-01T10:00:00.000Z");
  const statuses = [
    admin("within", "2026-12-01T10:02:00.000Z"),
    admin("warning", "2026-12-01T10:05:00.000Z"),
    admin("error", "2026-12-01T10:06:00.000Z"),
    admin("critical", "2026-12-01T10:31:00.000Z"),
  ].map((item) => compare([base], [item])[0].automaticStatus);

  assert.deepEqual(statuses, ["AUTO_OK", "TIME_WARNING", "TIME_ERROR", "TIME_CRITICAL"]);

  const nextMoscowDate = compare(
    [source("cross-date", "2026-12-01T20:58:00.000Z")],
    [admin("next-day", "2026-12-01T21:01:00.000Z")],
    5,
  );
  assert.equal(nextMoscowDate[0].automaticStatus, "TIME_CRITICAL");
});

test("source-only, admin-only, unmapped and undefined-time evidence is retained", () => {
  assert.equal(compare([source("source-only", "2026-12-01T11:00:00.000Z")], [])[0].automaticStatus, "SOURCE_ONLY");
  assert.equal(compare([], [admin("admin-only", "2026-12-01T11:00:00.000Z")])[0].automaticStatus, "ADMIN_ONLY");

  const unmapped = source("unmapped", "2026-12-01T11:00:00.000Z", {
    home: { sourceTeamId: "unknown", name: "Неизвестные", adminTeamId: null },
  });
  assert.equal(compare([unmapped], [])[0].automaticStatus, "TEAM_UNMAPPED");
  assert.equal(compare([source("date-only", null)], [admin("known-time", "2026-12-01T11:00:00.000Z")])[0].automaticStatus, "SOURCE_TIME_UNDEFINED");
});

test("status mismatch is explicit while equal cancelled states can match", () => {
  const mismatch = compare(
    [source("postponed", "2026-12-01T11:00:00.000Z", { status: "POSTPONED" })],
    [admin("scheduled", "2026-12-01T11:00:00.000Z")],
  );
  assert.equal(mismatch[0].automaticStatus, "STATUS_MISMATCH");

  const cancelled = compare(
    [source("cancelled-source", null, { status: "CANCELLED" })],
    [admin("cancelled-admin", null, { status: "CANCELLED" })],
  );
  assert.equal(cancelled[0].automaticStatus, "AUTO_OK");
});

test("repeated team pairs are assigned one-to-one by nearest time", () => {
  const results = compare(
    [source("early", "2026-12-01T10:00:00.000Z"), source("late", "2026-12-01T14:00:00.000Z")],
    [admin("late-admin", "2026-12-01T14:02:00.000Z"), admin("early-admin", "2026-12-01T10:01:00.000Z")],
  );

  assert.deepEqual(
    results.map((result) => [result.sourceMatchId, result.adminMatchId, result.automaticStatus]),
    [
      ["early", "early-admin", "AUTO_OK"],
      ["late", "late-admin", "AUTO_OK"],
    ],
  );
});

test("equal candidates are ambiguous instead of guessed", () => {
  const results = compare(
    [source("source", "2026-12-01T12:00:00.000Z")],
    [admin("before", "2026-12-01T11:50:00.000Z"), admin("after", "2026-12-01T12:10:00.000Z")],
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].automaticStatus, "MATCH_AMBIGUOUS");
  assert.deepEqual(results[0].candidateAdminMatchIds, ["before", "after"]);
});

test("exact repeated occurrences are classified as source or Admin duplicates", () => {
  const duplicatedSource = compare(
    [source("source-a", "2026-12-01T12:00:00.000Z"), source("source-b", "2026-12-01T12:00:00.000Z")],
    [admin("admin", "2026-12-01T12:00:00.000Z")],
  );
  assert.deepEqual(duplicatedSource.map((item) => item.automaticStatus), ["DUPLICATE_SOURCE", "DUPLICATE_SOURCE"]);

  const duplicatedAdmin = compare(
    [source("source", "2026-12-01T12:00:00.000Z")],
    [admin("admin-a", "2026-12-01T12:00:00.000Z"), admin("admin-b", "2026-12-01T12:00:00.000Z")],
  );
  assert.equal(duplicatedAdmin[0].automaticStatus, "DUPLICATE_ADMIN");
  assert.deepEqual(duplicatedAdmin[0].candidateAdminMatchIds, ["admin-a", "admin-b"]);

  const nearbyDuplicatedAdmin = compare(
    [source("source-near", "2026-12-01T12:02:00.000Z")],
    [admin("admin-near-a", "2026-12-01T12:00:00.000Z"), admin("admin-near-b", "2026-12-01T12:00:00.000Z")],
  );
  assert.equal(nearbyDuplicatedAdmin[0].automaticStatus, "DUPLICATE_ADMIN");
});

test("matches from different championships never become candidates", () => {
  const results = compare(
    [source("source", "2026-12-01T12:00:00.000Z", { championshipId: "championship-a" })],
    [admin("admin", "2026-12-01T12:00:00.000Z", { championshipId: "championship-b" })],
  );
  assert.deepEqual(results.map((result) => result.automaticStatus), ["SOURCE_ONLY", "ADMIN_ONLY"]);
});

test("a persistent manual link pairs the named events before automatic candidates", () => {
  const results = compareTLineMatches({
    sourceMatches: [source("source", "2026-12-01T12:00:00.000Z")],
    adminMatches: [
      admin("automatic-nearest", "2026-12-01T12:01:00.000Z"),
      admin("operator-choice", "2026-12-01T12:04:00.000Z"),
    ],
    allowedTimeDriftMinutes: 2,
    candidateMatchWindowMinutes: 180,
    persistentLinks: [{ sourceMatchId: "source", adminMatchId: "operator-choice" }],
  });
  assert.deepEqual(results.map((result) => [result.sourceMatchId, result.adminMatchId, result.manualLinked]), [
    ["source", "operator-choice", true],
    [null, "automatic-nearest", undefined],
  ]);
  assert.equal(results[0].automaticStatus, "TIME_WARNING");
});

test("manual overlay never destroys the automatic result and expired ignore falls back", () => {
  const automatic = compare([source("source", "2026-12-01T12:00:00.000Z")], [])[0];
  const manual = resolveEffectiveStatus(automatic, {
    decision: { kind: "MANUAL_OK", decidedAt: "2026-12-01T13:00:00.000Z" },
    now: new Date("2026-12-01T13:01:00.000Z"),
  });
  assert.equal(manual.automaticStatus, "SOURCE_ONLY");
  assert.equal(manual.effectiveStatus, "MANUAL_OK");
  assert.equal(manual.display, "okᵐ");

  const ignored = resolveEffectiveStatus(automatic, {
    decision: { kind: "IGNORE_UNTIL", decidedAt: "2026-12-01T13:00:00.000Z", expiresAt: "2026-12-02T00:00:00.000Z" },
    now: new Date("2026-12-01T14:00:00.000Z"),
  });
  assert.equal(ignored.effectiveStatus, "IGNORED");

  const expired = resolveEffectiveStatus(automatic, {
    decision: { kind: "IGNORE_UNTIL", decidedAt: "2026-12-01T13:00:00.000Z", expiresAt: "2026-12-01T13:30:00.000Z" },
    now: new Date("2026-12-01T14:00:00.000Z"),
  });
  assert.equal(expired.effectiveStatus, "SOURCE_ONLY");

  assert.equal(resolveEffectiveStatus(automatic, {
    decision: { kind: "MANUAL_ERROR", decidedAt: "2026-12-01T13:00:00.000Z" },
  }).effectiveStatus, "MANUAL_ERROR");
  assert.equal(resolveEffectiveStatus(automatic, {
    decision: { kind: "EXCLUDE", decidedAt: "2026-12-01T13:00:00.000Z" },
  }).effectiveStatus, "IGNORED");
  assert.equal(resolveEffectiveStatus({ automaticStatus: "PROCESSING", swappedSides: false }).display, "loading");
});
