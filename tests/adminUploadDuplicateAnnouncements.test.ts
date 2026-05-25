import test from "node:test";
import assert from "node:assert/strict";
import { buildDuplicateAnnouncementSecondOffsets, formatUploadDate } from "../src/lib/adminUpload/buildFixtPayload";

test("duplicate admin announcements at the same time get stable second offsets", () => {
  const uploadDate = new Date("2026-05-30T12:00:00.000Z");
  const offsets = buildDuplicateAnnouncementSecondOffsets([
    { id: "match-1::stage", uploadDate, team1: 333, team2: "" },
    { id: "match-2::stage", uploadDate, team1: 333, team2: "" },
    { id: "match-3::stage", uploadDate, team1: 444, team2: "" },
    { id: "match-4", uploadDate, team1: 333, team2: 555 },
  ]);

  assert.equal(offsets.get("match-1::stage"), 1);
  assert.equal(offsets.get("match-2::stage"), 2);
  assert.equal(offsets.has("match-3::stage"), false);
  assert.equal(offsets.has("match-4"), false);
});

test("duplicate announcement offsets are based on exact source time and mapped announcement id", () => {
  const offsets = buildDuplicateAnnouncementSecondOffsets([
    { id: "lcq-1::stage", uploadDate: new Date("2026-05-30T12:00:00.000Z"), team1: 333, team2: "" },
    { id: "lcq-2::stage", uploadDate: new Date("2026-05-30T12:00:00.000Z"), team1: 333, team2: "" },
    { id: "lcq-3::stage", uploadDate: new Date("2026-05-30T12:00:01.000Z"), team1: 333, team2: "" },
    { id: "lcq-4::stage", uploadDate: new Date("2026-05-30T12:00:00.000Z"), team1: 334, team2: "" },
  ]);

  assert.deepEqual(
    ["lcq-1::stage", "lcq-2::stage", "lcq-3::stage", "lcq-4::stage"].map((id) => offsets.get(id) ?? 0),
    [1, 2, 0, 0],
  );
});

test("admin upload dates are always formatted in Moscow and preserve duplicate seconds", () => {
  const uploadDate = new Date("2026-05-30T11:55:00.000Z");
  const offsets = buildDuplicateAnnouncementSecondOffsets([
    { id: "match-1::stage", uploadDate, team1: 333, team2: "" },
    { id: "match-2::stage", uploadDate, team1: 333, team2: "" },
  ]);

  const first = new Date(uploadDate.getTime() + (offsets.get("match-1::stage") ?? 0) * 1000);
  const second = new Date(uploadDate.getTime() + (offsets.get("match-2::stage") ?? 0) * 1000);

  assert.equal(formatUploadDate(first, "America/New_York", "DD.MM.YYYY HH:mm:ss"), "30.05.2026 14:55:01");
  assert.equal(formatUploadDate(second, "America/New_York", "DD.MM.YYYY HH:mm:ss"), "30.05.2026 14:55:02");
});
