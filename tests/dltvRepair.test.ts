import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildDltvRepairPlan,
  canonicalDltvEventUrl,
  canonicalDltvSourceTitle,
  derivePersistedDltvStatus,
  parseDltvRepairArguments,
  planTournamentIdentityMerge,
  planDltvParticipantTransfer,
  planDltvUploadLogTransfer,
  type DltvRepairCandidate,
} from "../scripts/repair-dltv-identities";

const ROOT = path.resolve(import.meta.dirname, "..");

function candidate(overrides: Partial<DltvRepairCandidate> & Pick<DltvRepairCandidate, "id" | "sourceUrl">): DltvRepairCandidate {
  return {
    id: overrides.id,
    sourceUrl: overrides.sourceUrl,
    sourceTitle: overrides.sourceTitle ?? overrides.id,
    status: overrides.status ?? "ongoing",
    startDate: Object.hasOwn(overrides, "startDate") ? overrides.startDate ?? null : "2026-08-01T00:00:00Z",
    endDate: Object.hasOwn(overrides, "endDate") ? overrides.endDate ?? null : "2026-09-01T00:00:00Z",
    extractionStatus: overrides.extractionStatus ?? "SUCCESS",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-08-01T00:00:00Z",
    matchCount: overrides.matchCount ?? 0,
    participantCount: overrides.participantCount ?? 0,
    uploadLogCount: overrides.uploadLogCount ?? 0,
    hasAdminMapping: overrides.hasAdminMapping ?? false,
    platformId: Object.hasOwn(overrides, "platformId") ? overrides.platformId ?? null : null,
    adminMapping: Object.hasOwn(overrides, "adminMapping") ? overrides.adminMapping ?? null : null,
  };
}

test("DLTV repair identity retains the complete qualification path", () => {
  assert.equal(
    canonicalDltvEventUrl("https://www.dltv.org/events/qualifiers/europe/elite-league/?utm_source=test#matches"),
    "https://ru.dltv.org/events/qualifiers/europe/elite-league",
  );
  assert.equal(
    canonicalDltvEventUrl("http://dltv.org/events/qualifiers/europe/elite-league"),
    "https://ru.dltv.org/events/qualifiers/europe/elite-league",
  );
  assert.notEqual(
    canonicalDltvEventUrl("https://ru.dltv.org/events/qualifiers/europe/elite-league"),
    canonicalDltvEventUrl("https://ru.dltv.org/events/qualifiers/americas/elite-league"),
  );
  assert.equal(
    canonicalDltvSourceTitle("https://ru.dltv.org/events/qualifiers/europe/elite-league"),
    "dltv:qualifiers/europe/elite-league",
  );
  assert.equal(canonicalDltvEventUrl("https://ru.dltv.org/matches/426528/example"), null);
  assert.equal(canonicalDltvEventUrl("https://ru.dltv.org:8443/events/example"), null);
  assert.equal(canonicalDltvEventUrl("https://ru.dltv.org.evil.example/events/example"), null);
});

test("DLTV repair plan groups exact canonical URLs and chooses the primary deterministically", () => {
  const inputs = [
    candidate({
      id: "row-low",
      sourceUrl: "https://www.dltv.org/events/qualifiers/europe/elite-league/?x=1",
      matchCount: 2,
      participantCount: 8,
    }),
    candidate({
      id: "row-primary",
      sourceUrl: "https://ru.dltv.org/events/qualifiers/europe/elite-league",
      matchCount: 12,
      participantCount: 16,
    }),
    candidate({
      id: "row-americas",
      sourceUrl: "https://ru.dltv.org/events/qualifiers/americas/elite-league",
      matchCount: 1,
    }),
  ];

  const forward = buildDltvRepairPlan(inputs, "2026-08-15T00:00:00Z");
  const reverse = buildDltvRepairPlan([...inputs].reverse(), "2026-08-15T00:00:00Z");
  assert.deepEqual(forward, reverse);
  assert.equal(forward.duplicateGroups.length, 1);
  assert.equal(forward.duplicateGroups[0].primaryId, "row-primary");
  assert.equal(forward.duplicateGroups[0].canonicalSourceTitle, "dltv:qualifiers/europe/elite-league");
  assert.deepEqual(forward.duplicateGroups[0].secondaryIds, ["row-low"]);
  assert.equal(forward.survivors.length, 2);
  assert.equal(
    forward.survivors.find((survivor) => survivor.primaryId === "row-americas")?.secondaryIds.length,
    0,
  );
});

test("DLTV persisted status is recalculated only from a valid start/end range", () => {
  const now = "2026-08-15T12:00:00Z";
  assert.equal(derivePersistedDltvStatus("2026-07-01T00:00:00Z", "2026-07-31T23:59:59Z", now), "finished");
  assert.equal(derivePersistedDltvStatus("2026-09-01T00:00:00Z", "2026-09-10T00:00:00Z", now), "upcoming");
  assert.equal(derivePersistedDltvStatus("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z", now), "ongoing");
  assert.equal(
    derivePersistedDltvStatus("2026-08-01T21:00:00Z", "2026-08-29T21:00:00Z", "2026-08-30T18:00:00Z"),
    "ongoing",
    "a DLTV end date stays active through the corresponding Moscow calendar day",
  );
  assert.equal(derivePersistedDltvStatus(null, null, now), null);
  assert.equal(derivePersistedDltvStatus("2026-09-10T00:00:00Z", "2026-09-01T00:00:00Z", now), null);
});

test("DLTV repair combines complementary duplicate date bounds", () => {
  const plan = buildDltvRepairPlan([
    candidate({
      id: "start-only",
      sourceUrl: "https://ru.dltv.org/events/complementary-dates",
      startDate: "2026-07-01T00:00:00Z",
      endDate: null,
    }),
    candidate({
      id: "end-only",
      sourceUrl: "https://www.dltv.org/events/complementary-dates/",
      startDate: null,
      endDate: "2026-07-31T23:59:59Z",
    }),
  ], "2026-08-15T00:00:00Z");

  assert.equal(plan.survivors[0].startDate?.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(plan.survivors[0].endDate?.toISOString(), "2026-07-31T23:59:59.000Z");
  assert.equal(plan.survivors[0].nextStatus, "finished");
});

test("DLTV repair sends an impossible aggregate date range to manual review", () => {
  const plan = buildDltvRepairPlan([
    candidate({
      id: "invalid-primary",
      sourceUrl: "https://ru.dltv.org/events/invalid-dates",
      startDate: "2026-09-10T00:00:00Z",
      endDate: "2026-09-01T00:00:00Z",
    }),
    candidate({
      id: "invalid-secondary",
      sourceUrl: "https://www.dltv.org/events/invalid-dates/",
      startDate: "2026-09-12T00:00:00Z",
      endDate: "2026-09-02T00:00:00Z",
    }),
  ], "2026-08-15T00:00:00Z");

  assert.equal(plan.manualReviewGroups.length, 1);
  assert.equal(plan.survivors[0].nextStatus, null);
  assert.equal(plan.survivors[0].startDate?.toISOString(), "2026-09-10T00:00:00.000Z");
  assert.equal(plan.survivors[0].endDate?.toISOString(), "2026-09-02T00:00:00.000Z");
  assert.match(
    plan.survivors[0].manualReviewReasons.join("; "),
    /DLTV date range.*precedes.*start/i,
  );
});

test("repair identity merge preserves the only tournament platform ID and combines admin mapping fields", () => {
  const plan = planTournamentIdentityMerge({
    tournaments: [
      { id: "primary", platformId: null },
      { id: "secondary", platformId: "platform-42" },
    ],
    mappings: [
      {
        id: "mapping-primary",
        tournamentId: "primary",
        disciplineSlug: "dota2",
        sourceTournamentId: null,
        sourceTournamentName: "Old title",
        adminShapkaId: "admin-7",
        adminShapkaName: null,
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: "mapping-secondary",
        tournamentId: "secondary",
        disciplineSlug: "dota2",
        sourceTournamentId: "legacy-source",
        sourceTournamentName: "Legacy title",
        adminShapkaId: null,
        adminShapkaName: "Complete admin name",
        updatedAt: new Date("2026-08-02T00:00:00Z"),
      },
    ],
    primaryId: "primary",
    disciplineSlug: "dota2",
    sourceTournamentId: "https://ru.dltv.org/events/example",
    sourceTournamentName: "dltv:example",
  });

  assert.deepEqual(plan.manualReviewReasons, []);
  assert.equal(plan.platformId, "platform-42");
  assert.deepEqual(plan.adminMapping, {
    selectedId: "mapping-primary",
    obsoleteIds: ["mapping-secondary"],
    disciplineSlug: "dota2",
    tournamentId: "primary",
    sourceTournamentId: "https://ru.dltv.org/events/example",
    sourceTournamentName: "dltv:example",
    adminShapkaId: "admin-7",
    adminShapkaName: "Complete admin name",
  });
});

test("repair identity merge fails closed on conflicting non-null platform or admin IDs", () => {
  const plan = planTournamentIdentityMerge({
    tournaments: [
      { id: "primary", platformId: "platform-a" },
      { id: "secondary", platformId: "platform-b" },
    ],
    mappings: [
      {
        id: "mapping-primary",
        tournamentId: "primary",
        disciplineSlug: "dota2",
        sourceTournamentId: "source-a",
        sourceTournamentName: "A",
        adminShapkaId: "admin-a",
        adminShapkaName: "Admin A",
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: "mapping-secondary",
        tournamentId: "secondary",
        disciplineSlug: "dota2",
        sourceTournamentId: "source-b",
        sourceTournamentName: "B",
        adminShapkaId: "admin-b",
        adminShapkaName: "Admin B",
        updatedAt: new Date("2026-08-02T00:00:00Z"),
      },
    ],
    primaryId: "primary",
    disciplineSlug: "dota2",
    sourceTournamentId: "canonical-source",
    sourceTournamentName: "canonical-name",
  });

  assert.equal(plan.platformId, null);
  assert.equal(plan.adminMapping, null);
  assert.deepEqual(plan.manualReviewReasons, [
    "Conflicting Tournament.platformId values: platform-a, platform-b",
    "Conflicting TournamentAdminMapping.adminShapkaId values: admin-a, admin-b",
  ]);
});

test("DLTV duplicate plan exposes identity conflicts for manual review", () => {
  const plan = buildDltvRepairPlan([
    candidate({
      id: "primary",
      sourceUrl: "https://ru.dltv.org/events/conflicted",
      platformId: "platform-a",
      adminMapping: {
        id: "mapping-a",
        tournamentId: "primary",
        disciplineSlug: "dota2",
        sourceTournamentId: "a",
        sourceTournamentName: "A",
        adminShapkaId: "admin-a",
        adminShapkaName: "A",
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
    }),
    candidate({
      id: "secondary",
      sourceUrl: "https://www.dltv.org/events/conflicted/",
      platformId: "platform-b",
      adminMapping: null,
    }),
  ]);

  assert.equal(plan.manualReviewGroups.length, 1);
  assert.match(plan.manualReviewGroups[0].manualReviewReasons.join("; "), /Tournament\.platformId/);
});

test("DLTV apply excludes manual-review groups from every destructive merge", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts/repair-dltv-identities.ts"), "utf8");
  assert.match(
    source,
    /for \(const group of plan\.manualReviewGroups\)[\s\S]*extractionStatus: "MANUAL_REVIEW"/,
  );
  assert.match(
    source,
    /plan\.duplicateGroups\.filter\(\(candidate\) => candidate\.manualReviewReasons\.length === 0\)/,
  );
  const transactionalGuardAt = source.indexOf("if (identityPlan.manualReviewReasons.length > 0)", source.indexOf("async function applyDltvRepair"));
  const firstDestructiveTransferAt = source.indexOf("await tx.tournamentParticipant.deleteMany", transactionalGuardAt);
  assert.ok(transactionalGuardAt >= 0 && firstDestructiveTransferAt > transactionalGuardAt);
});

test("DLTV upload-log transfer removes unique hash collisions and preserves the strongest result", () => {
  const plan = planDltvUploadLogTransfer([
    {
      id: "primary-failed",
      tournamentId: "primary",
      disciplineSlug: "dota2",
      payloadHash: "same-payload",
      status: "failed",
      createdAt: "2026-08-01T00:00:00Z",
    },
    {
      id: "secondary-success",
      tournamentId: "secondary",
      disciplineSlug: "dota2",
      payloadHash: "same-payload",
      status: "success",
      createdAt: "2026-07-01T00:00:00Z",
    },
    {
      id: "secondary-no-hash-1",
      tournamentId: "secondary",
      disciplineSlug: "dota2",
      payloadHash: null,
      status: "pending",
      createdAt: "2026-08-02T00:00:00Z",
    },
    {
      id: "secondary-no-hash-2",
      tournamentId: "secondary",
      disciplineSlug: "dota2",
      payloadHash: null,
      status: "failed",
      createdAt: "2026-08-03T00:00:00Z",
    },
  ], "primary");

  assert.deepEqual(plan.deleteIds, ["primary-failed"]);
  assert.deepEqual(plan.keepIds, ["secondary-no-hash-1", "secondary-no-hash-2", "secondary-success"]);
  assert.deepEqual(plan.moveIds, ["secondary-no-hash-1", "secondary-no-hash-2", "secondary-success"]);
});

test("DLTV participant merge preserves complementary manual fields before deleting duplicates", () => {
  const plan = planDltvParticipantTransfer([
    {
      id: "primary-participant",
      tournamentId: "primary",
      name: "Team One",
      platformId: "platform-1",
      seed: null,
      region: null,
      status: "confirmed",
      logoUrl: null,
      rawText: null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
    },
    {
      id: "secondary-participant",
      tournamentId: "secondary",
      name: " team one ",
      platformId: null,
      seed: "2",
      region: "EU",
      status: null,
      logoUrl: "https://cdn.example/logo.png",
      rawText: "source row",
      createdAt: new Date("2026-07-01T00:00:00Z"),
    },
  ], "primary");

  assert.deepEqual(plan.deleteIds, ["primary-participant"]);
  assert.deepEqual(plan.moveIds, ["secondary-participant"]);
  assert.deepEqual(plan.updates, [{
    id: "secondary-participant",
    data: {
      platformId: "platform-1",
      seed: "2",
      region: "EU",
      status: "confirmed",
      logoUrl: "https://cdn.example/logo.png",
      rawText: "source row",
    },
  }]);
});

test("DLTV repair is dry-run by default and requires both mutation guards", () => {
  assert.deepEqual(parseDltvRepairArguments([]), { apply: false, backupConfirmed: false });
  assert.deepEqual(parseDltvRepairArguments(["--apply", "--backup-confirmed"]), {
    apply: true,
    backupConfirmed: true,
  });
  assert.throws(() => parseDltvRepairArguments(["--apply"]), /both --apply and --backup-confirmed/);
  assert.throws(() => parseDltvRepairArguments(["--backup-confirmed"]), /both --apply and --backup-confirmed/);
});
