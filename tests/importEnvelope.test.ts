import assert from "node:assert/strict";
import test from "node:test";
import { ImportStatus } from "@prisma/client";
import { createImportEnvelope } from "../src/lib/sources/importEnvelope";
import type { NormalizedTournament } from "../src/lib/normalizers/types";

function buildNormalizedTournament(overrides: Partial<NormalizedTournament> = {}): NormalizedTournament {
  return {
    sourceTitle: "Sample Event",
    sourceUrl: "https://www.hltv.org/events/1/sample-event",
    name: "Sample Event",
    participants: [{ name: "Team A" }],
    matches: [{ teamAName: "Team A", teamBName: "Team B" }],
    subPages: [],
    warnings: ["sample warning"],
    status: ImportStatus.SUCCESS,
    ...overrides,
  };
}

test("createImportEnvelope wraps normalized tournament output without changing payload arrays", () => {
  const normalizedTournament = buildNormalizedTournament();

  const envelope = createImportEnvelope({
    source: "hltv",
    disciplineSlug: "counterstrike",
    sourceTournament: {
      id: "1",
      title: normalizedTournament.sourceTitle,
      url: normalizedTournament.sourceUrl,
    },
    raw: {
      kind: "html",
      payload: "<html></html>",
      sourceUrl: normalizedTournament.sourceUrl,
    },
    normalizedTournament,
  });

  assert.equal(envelope.source, "hltv");
  assert.equal(envelope.disciplineSlug, "counterstrike");
  assert.equal(envelope.sourceTournament.title, "Sample Event");
  assert.equal(envelope.raw?.kind, "html");
  assert.equal(envelope.normalized.tournament, normalizedTournament);
  assert.equal(envelope.normalized.participants, normalizedTournament.participants);
  assert.equal(envelope.normalized.matches, normalizedTournament.matches);
  assert.deepEqual(envelope.diagnostics.warnings, ["sample warning"]);
  assert.deepEqual(envelope.diagnostics.errors, []);
  assert.equal(envelope.diagnostics.status, ImportStatus.SUCCESS);
});

test("createImportEnvelope allows diagnostics overrides for gradual provider migration", () => {
  const normalizedTournament = buildNormalizedTournament({ warnings: [] });

  const envelope = createImportEnvelope({
    source: "vlr",
    disciplineSlug: "valorant",
    sourceTournament: {
      title: "VLR Event",
      url: "https://www.vlr.gg/event/1/sample",
    },
    normalizedTournament,
    diagnostics: {
      warnings: ["provider warning"],
      errors: ["recoverable parser warning"],
      cacheHit: true,
    },
  });

  assert.deepEqual(envelope.diagnostics.warnings, ["provider warning"]);
  assert.deepEqual(envelope.diagnostics.errors, ["recoverable parser warning"]);
  assert.equal(envelope.diagnostics.cacheHit, true);
});
