import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCBVSourceTitle,
  extractCBVCampeonatoId,
  extractCBVEtapaId,
  extractCBVTemporadaId,
  filterCBVUpcomingTournaments,
  isActiveCBVMatch,
  normalizeCBVMatch,
  parseCBVEtapa,
  parseCBVEtapas,
} from "../src/lib/sources/tbvolley/CBV";

test("CBV etapa parser extracts Brasilia metadata", () => {
  const etapas = parseCBVEtapas([
    {
      id: 950,
      nome: "Brasilia Open",
      dataInicioEtapa: "2026-04-02",
      dataFimEtapa: "2026-04-06",
      campeonato: { id: 37, nome: "CBVP ADULTO" },
      categoria: { nome: "ADULTO" },
      temporada: { id: 23, nome: "2026" },
      local: {
        nome: "Arena Central",
        cidade: {
          nome: "Brasilia",
          estado: { sigla: "DF" },
        },
      },
    },
  ], {
    gender: "men",
    fallbackCampeonatoId: "37",
    fallbackTemporadaId: "23",
  });

  assert.equal(etapas.length, 1);
  assert.equal(etapas[0].etapaId, "950");
  assert.equal(etapas[0].location, "Brasilia/DF");
  assert.equal(etapas[0].sourceTitle, "CBVP ADULTO - Brasilia Open - Brasilia/DF — Men [CBV:37:23:950]");
});

test("CBV match normalizer extracts sets and phase", () => {
  const match = normalizeCBVMatch({
    id: 555,
    equipeA: { id: 1, nome: "Andre / George", equipeJogadores: [{ jogador: { federacao: { sigla: "RJ" } } }] },
    equipeB: { id: 2, nome: "Evandro / Arthur", equipeJogadores: [{ jogador: { federacao: { sigla: "SC" } } }] },
    status: "F",
    data: "2026-04-04",
    horario: "11:30",
    quadra: "1",
    numero: "7",
    setsEquipeA: "2",
    setsEquipeB: "1",
    sets: [
      { numero: 1, pontuacaoEquipeA: 21, pontuacaoEquipeB: 17 },
      { numero: 2, pontuacaoEquipeA: 19, pontuacaoEquipeB: 21 },
      { numero: 3, pontuacaoEquipeA: 15, pontuacaoEquipeB: 12 },
    ],
  }, {
    gender: "men",
    campeonatoId: "37",
    temporadaId: "23",
    etapaId: "950",
    phase: { id: 77, nome: "Quartas de final", apelido: "QF" },
  });

  assert.equal(match.id, "555");
  assert.equal(match.phase, "Quartas de final");
  assert.equal(match.round, "QF");
  assert.equal(match.court, "Quadra 1");
  assert.equal(match.startTimeMoscow, "04.04.2026 17:30:00");
  assert.deepEqual(match.score.sets, [
    { no: 1, teamA: 21, teamB: 17 },
    { no: 2, teamA: 19, teamB: 21 },
    { no: 3, teamA: 15, teamB: 12 },
  ]);
});

test("CBV helpers resolve source ids", () => {
  assert.equal(extractCBVCampeonatoId("CBVP ADULTO [CBV:37:23:950]"), "37");
  assert.equal(extractCBVTemporadaId("https://evolleyball.cbv.com.br/#!/tabelas?campeonatoId=37&temporadaId=23&etapaId=950"), "23");
  assert.equal(extractCBVEtapaId(buildCBVSourceTitle("CBVP ADULTO - Brasilia", "women", "38", "23", "951")), "951");
});

test("CBV filters drop completed tournaments and matches", () => {
  const tournaments = parseCBVEtapas([
    {
      id: 950,
      nome: "Brasilia Open",
      status: "E",
      dataInicioEtapa: "2026-04-02",
      dataFimEtapa: "2026-04-06",
      campeonato: { id: 37, nome: "CBVP ADULTO" },
      temporada: { id: 23, nome: "2026" },
    },
    {
      id: 951,
      nome: "Saquarema Open",
      dataInicioEtapa: "2026-06-12",
      dataFimEtapa: "2026-06-14",
      campeonato: { id: 37, nome: "CBVP ADULTO" },
      temporada: { id: 23, nome: "2026" },
    },
  ], {
    gender: "men",
    fallbackCampeonatoId: "37",
    fallbackTemporadaId: "23",
  });

  assert.deepEqual(
    filterCBVUpcomingTournaments(tournaments, new Date("2026-06-11T00:00:00.000Z")).map((tournament) => tournament.etapaId),
    ["951"],
  );
  assert.equal(isActiveCBVMatch({
    status: "finished",
    startTimeUtc: "2026-06-12T13:00:00.000Z",
  }, new Date("2026-06-11T00:00:00.000Z")), false);
  assert.equal(isActiveCBVMatch({
    status: "upcoming",
    startTimeUtc: "2026-06-10T13:00:00.000Z",
  }, new Date("2026-06-11T00:00:00.000Z")), false);
  assert.equal(isActiveCBVMatch({
    status: "upcoming",
    startTimeUtc: "2026-06-12T13:00:00.000Z",
  }, new Date("2026-06-11T00:00:00.000Z")), true);
});
