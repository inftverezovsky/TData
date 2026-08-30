import assert from "node:assert/strict";
import test from "node:test";
import {
  TLINE_AUTOMAP_MIN_GAP,
  TLINE_AUTOMAP_MIN_SCORE,
  chooseAutoMappingCandidate,
  resolveTeamMapping,
} from "../backend/src/tline/mappings/teamMapping";

test("TLine automapping applies the documented 0.95 score and 0.05 gap", () => {
  assert.equal(TLINE_AUTOMAP_MIN_SCORE, 0.95);
  assert.equal(TLINE_AUTOMAP_MIN_GAP, 0.05);

  assert.equal(
    chooseAutoMappingCandidate([
      { adminTeamId: "admin-1", score: 0.95 },
      { adminTeamId: "admin-2", score: 0.9 },
    ])?.adminTeamId,
    "admin-1",
  );
  assert.equal(
    chooseAutoMappingCandidate([
      { adminTeamId: "admin-1", score: 0.949 },
      { adminTeamId: "admin-2", score: 0.5 },
    ]),
    null,
  );
  assert.equal(
    chooseAutoMappingCandidate([
      { adminTeamId: "admin-1", score: 0.98 },
      { adminTeamId: "admin-2", score: 0.94 },
    ]),
    null,
  );
});

test("locked mappings are reused only inside their championship", () => {
  const sourceTeam = {
    id: "source-team",
    championshipId: "championship-a",
    externalId: "vfv-10",
    nameRu: "Динамо-Ак Барс",
    nameEn: "Dinamo Ak Bars",
    aliases: [] as const,
  };
  const adminTeams = [
    {
      id: "admin-exact",
      platformId: "vfv-10",
      nameRu: "Динамо-Ак Барс",
      nameEn: "Dinamo Ak Bars",
      aliases: [] as const,
    },
    {
      id: "admin-foreign-lock",
      platformId: "987",
      nameRu: "Другая команда",
      nameEn: null,
      aliases: [] as const,
    },
  ];

  const result = resolveTeamMapping({
    sourceTeam,
    adminTeams,
    existingMappings: [
      {
        championshipId: "championship-b",
        sourceTeamId: "source-team",
        adminTeamId: "admin-foreign-lock",
        locked: true,
      },
    ],
  });

  assert.equal(result.kind, "mapped");
  assert.equal(result.adminTeamId, "admin-exact");
  assert.equal(result.method, "external_id");
});

test("same-championship locked mapping wins before every automatic method", () => {
  const result = resolveTeamMapping({
    sourceTeam: {
      id: "source-team",
      championshipId: "championship-a",
      externalId: "same-id",
      nameRu: "Локомотив",
      nameEn: "Lokomotiv",
      aliases: [] as const,
    },
    adminTeams: [
      { id: "automatic", platformId: "same-id", nameRu: "Локомотив", nameEn: "Lokomotiv", aliases: [] },
      { id: "manual", platformId: "other", nameRu: "Спарта", nameEn: "Sparta", aliases: [] },
    ],
    existingMappings: [
      {
        championshipId: "championship-a",
        sourceTeamId: "source-team",
        adminTeamId: "manual",
        locked: true,
      },
    ],
  });

  assert.deepEqual(result, {
    kind: "mapped",
    adminTeamId: "manual",
    method: "locked",
    score: 1,
    runnerUpScore: null,
  });
});

test("manual unmapped tombstone blocks automapping inside its championship", () => {
  const result = resolveTeamMapping({
    sourceTeam: {
      id: "source-team",
      championshipId: "championship-a",
      externalId: null,
      nameRu: "Локомотив",
      nameEn: "Lokomotiv",
      aliases: [],
    },
    adminTeams: [
      { id: "historical", platformId: "101", nameRu: "Локомотив", nameEn: "Lokomotiv", aliases: [] },
    ],
    existingMappings: [{
      championshipId: "championship-a",
      sourceTeamId: "source-team",
      adminTeamId: "historical",
      locked: true,
      status: "MANUAL_UNMAPPED",
    }],
  });

  assert.equal(result.kind, "unmapped");
});

test("exact Russian, English and saved alias matches precede fuzzy matching", () => {
  const common = {
    championshipId: "championship-a",
    externalId: null,
    aliases: [] as const,
  };
  const adminTeams = [
    { id: "ru", platformId: null, nameRu: "Динамо-Ак Барс", nameEn: null, aliases: [] as const },
    { id: "en", platformId: null, nameRu: null, nameEn: "Lokomotiv Kaliningrad", aliases: [] as const },
    { id: "alias", platformId: null, nameRu: "Заречье", nameEn: null, aliases: ["Zarechie Odintsovo"] as const },
  ];

  const russian = resolveTeamMapping({
    sourceTeam: { ...common, id: "ru-source", nameRu: "Динамо Ак Барс", nameEn: null },
    adminTeams,
    existingMappings: [],
  });
  const english = resolveTeamMapping({
    sourceTeam: { ...common, id: "en-source", nameRu: null, nameEn: "Lokomotiv Kaliningrad" },
    adminTeams,
    existingMappings: [],
  });
  const alias = resolveTeamMapping({
    sourceTeam: { ...common, id: "alias-source", nameRu: null, nameEn: "Zarechie Odintsovo" },
    adminTeams,
    existingMappings: [],
  });
  const sourceAlias = resolveTeamMapping({
    sourceTeam: {
      ...common,
      id: "source-alias-source",
      nameRu: "Заречье Одинцово МО",
      nameEn: null,
      aliases: ["Заречье"],
    },
    adminTeams,
    existingMappings: [],
  });

  assert.equal(russian.kind, "mapped");
  assert.equal(english.kind, "mapped");
  assert.equal(alias.kind, "mapped");
  assert.equal(sourceAlias.kind, "mapped");
  if (russian.kind !== "mapped" || english.kind !== "mapped" || alias.kind !== "mapped" || sourceAlias.kind !== "mapped") return;
  assert.equal(russian.method, "exact_ru");
  assert.equal(english.method, "exact_en");
  assert.equal(alias.method, "alias");
  assert.equal(sourceAlias.method, "alias");
});

test("ambiguous fuzzy candidates remain unmapped and expose diagnostics", () => {
  const result = resolveTeamMapping({
    sourceTeam: {
      id: "source-team",
      championshipId: "championship-a",
      externalId: null,
      nameRu: null,
      nameEn: "Volleyball Dynamo Moscow",
      aliases: [] as const,
    },
    adminTeams: [
      { id: "one", platformId: null, nameRu: null, nameEn: "Volleyball Dinamo Moscow", aliases: [] },
      { id: "two", platformId: null, nameRu: null, nameEn: "Volleyball Dynamo Moskow", aliases: [] },
    ],
    existingMappings: [],
  });

  assert.equal(result.kind, "ambiguous");
  assert.ok(result.bestScore >= 0.95);
  assert.ok(result.runnerUpScore >= 0.95);
  assert.deepEqual(new Set(result.candidateAdminTeamIds), new Set(["one", "two"]));
});
