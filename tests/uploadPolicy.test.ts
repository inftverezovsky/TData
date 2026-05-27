import assert from "node:assert/strict";
import test from "node:test";
import {
  getUploadPolicyRequestedTbdSides,
  isUploadPolicyStageAnnouncementRequested,
  resolveUploadPolicy,
  resolveUploadPolicyPreMappingSkip,
} from "../src/lib/adminUpload/uploadPolicy";

test("resolveUploadPolicy keeps default esport uploads scoped to the requested discipline", () => {
  const policy = resolveUploadPolicy({
    disciplineSlug: "counterstrike",
    sourceUrl: "https://www.hltv.org/events/8049/pgl-astana-2026",
    normalization: null,
  });

  assert.equal(policy.disciplineSlug, "counterstrike");
  assert.equal(policy.source, "hltv");
  assert.equal(policy.teamMappingDisciplineSlug, "counterstrike");
  assert.equal(policy.scheduleLeadDisciplineSlug, "counterstrike");
  assert.deepEqual(policy.matchContext, { disciplineSlug: "counterstrike", source: "hltv" });
});

test("resolveUploadPolicy keeps beach volleyball gender-specific team mapping scope", () => {
  const policy = resolveUploadPolicy({
    disciplineSlug: "beachvolleyball",
    sourceUrl: "https://beach.volley.ru/calendar/01K9CBPGKV0CWX0442H8T704M7/allgames?sex=2",
    normalization: {
      beachVolleyRu: { gender: "women" },
    },
  });

  assert.equal(policy.disciplineSlug, "beachvolleyball");
  assert.equal(policy.source, "beachvolleyru");
  assert.equal(policy.teamMappingDisciplineSlug, "beachvolleyball-women");
  assert.equal(policy.scheduleLeadDisciplineSlug, "beachvolleyball");
  assert.deepEqual(policy.matchContext, { disciplineSlug: "beachvolleyball", source: "beachvolleyru" });
});

test("resolveUploadPolicyPreMappingSkip rejects non-uploadable rows before team mapping", () => {
  assert.equal(resolveUploadPolicyPreMappingSkip({ matchDateTime: "June 1, 2026" })?.reason, "missing-exact-time");

  assert.equal(
    resolveUploadPolicyPreMappingSkip({
      matchDate: "2026-06-01T10:00:00Z",
      scoreA: 2,
      scoreB: 1,
    })?.reason,
    "finished-or-scored",
  );

  assert.equal(
    resolveUploadPolicyPreMappingSkip({
      matchDate: "2026-06-01T10:00:00Z",
      status: "completed",
    })?.reason,
    "finished-or-scored",
  );

  assert.equal(resolveUploadPolicyPreMappingSkip({ matchDate: "2026-06-01T10:00:00Z" }), null);
});

test("UploadPolicy selection helpers preserve TBD and stage announcement request behavior", () => {
  assert.deepEqual(
    getUploadPolicyRequestedTbdSides({
      selectedFullMatch: false,
      selectedSides: new Set(["teamB"]),
      uploadableTbdSides: ["teamA", "teamB"],
    }),
    ["teamB"],
  );

  assert.deepEqual(
    getUploadPolicyRequestedTbdSides({
      selectedFullMatch: true,
      uploadableTbdSides: ["teamA", "teamB"],
    }),
    ["teamA", "teamB"],
  );

  assert.deepEqual(
    getUploadPolicyRequestedTbdSides({
      selectedFullMatch: false,
      uploadableTbdSides: ["teamA", "teamB"],
    }),
    [],
  );

  assert.equal(
    isUploadPolicyStageAnnouncementRequested({
      hasExplicitSelection: false,
      selectedFullMatch: false,
    }),
    true,
  );

  assert.equal(
    isUploadPolicyStageAnnouncementRequested({
      hasExplicitSelection: true,
      selectedFullMatch: false,
      selectedSides: new Set(["teamA"]),
    }),
    true,
  );

  assert.equal(
    isUploadPolicyStageAnnouncementRequested({
      hasExplicitSelection: true,
      selectedFullMatch: false,
      selectedSides: new Set(),
    }),
    false,
  );
});
