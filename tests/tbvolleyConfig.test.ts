import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdminSettingsFromData } from "../src/lib/adminUpload/resolveAdminSettings";
import {
  BEACH_VOLLEYBALL_ADMIN_SPORT_ID,
  resolveTournamentTeamMappingDisciplineSlug,
} from "../src/lib/sources/tbvolley/config";
import { selectCachedTBvolleyGenderTournament } from "../src/lib/sources/tbvolley/genderSwitchCache";
import {
  getTableTennisMappingSlug,
  resolveTournamentTeamMappingDisciplineSlug as resolveTableTennisTournamentTeamMappingDisciplineSlug,
} from "../src/lib/sources/tablet/config";
import { selectCachedWttCategoryTournament } from "../src/lib/sources/tablet/wttCategorySwitchCache";

test("TBvolley settings use one beach volleyball sport id for men and women scopes", () => {
  for (const disciplineSlug of ["beachvolleyball", "beachvolleyball-men", "beachvolleyball-women"]) {
    const settings = resolveAdminSettingsFromData(
      disciplineSlug,
      null,
      {
        tbvolley_admin_api_url: "https://admin.test/tbvolley",
      },
    );

    assert.equal(settings.apiUrl, "https://admin.test/tbvolley");
    assert.equal(settings.adminSportId, BEACH_VOLLEYBALL_ADMIN_SPORT_ID);
  }
});

test("TableT settings use isolated admin API and sport id", () => {
  const settings = resolveAdminSettingsFromData(
    "tabletennis",
    null,
    {
      admin_api_url: "https://admin.test/global",
      admin_sport_id: "999",
      tablet_admin_api_url: "https://admin.test/tablet",
      tablet_sport_id: "46",
    },
  );

  assert.equal(settings.apiUrl, "https://admin.test/tablet");
  assert.equal(settings.adminSportId, "46");
});

test("TableT settings leave sport id empty when unset", () => {
  const settings = resolveAdminSettingsFromData(
    "tabletennis",
    null,
    {
      admin_api_url: "https://admin.test/global",
      admin_sport_id: "999",
      tablet_admin_api_url: "https://admin.test/tablet",
      tablet_sport_id: "",
    },
  );

  assert.equal(settings.apiUrl, "https://admin.test/tablet");
  assert.equal(settings.adminSportId, null);
});

test("TableT category scopes use isolated admin settings", () => {
  for (const disciplineSlug of ["tabletennis-men", "tabletennis-women", "tabletennis-men-doubles", "tabletennis-women-doubles", "tabletennis-mixed"]) {
    const settings = resolveAdminSettingsFromData(
      disciplineSlug,
      null,
      {
        admin_api_url: "https://admin.test/global",
        admin_sport_id: "999",
        tablet_admin_api_url: "https://admin.test/tablet",
        tablet_sport_id: "46",
      },
    );

    assert.equal(settings.apiUrl, "https://admin.test/tablet");
    assert.equal(settings.adminSportId, "46");
  }
});

test("TableT tournament mapping scope follows WTT category", () => {
  assert.equal(getTableTennisMappingSlug("Мужчины"), "tabletennis-men");
  assert.equal(getTableTennisMappingSlug("Женщины"), "tabletennis-women");
  assert.equal(getTableTennisMappingSlug("Муж. пары"), "tabletennis-men-doubles");
  assert.equal(getTableTennisMappingSlug("Жен. пары"), "tabletennis-women-doubles");
  assert.equal(getTableTennisMappingSlug("Микст"), "tabletennis-mixed");
  assert.equal(
    resolveTableTennisTournamentTeamMappingDisciplineSlug("tabletennis", {
      wtt: { categoryScope: "women-doubles" },
    }),
    "tabletennis-women-doubles",
  );
});

test("TBvolley tournament mapping scope follows beach volleyball source gender", () => {
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      volleyballWorld: { gender: "men" },
    }),
    "beachvolleyball-men",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      volleyballWorld: { gender: "women" },
    }),
    "beachvolleyball-women",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      beachVolleyRu: { gender: "men" },
    }),
    "beachvolleyball-men",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      beachVolleyRu: { gender: "women" },
    }),
    "beachvolleyball-women",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      germanBeachTour: { gender: "men" },
    }),
    "beachvolleyball-men",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      germanBeachTour: { gender: "women" },
    }),
    "beachvolleyball-women",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      twelveNdr: { gender: "men" },
    }),
    "beachvolleyball-men",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      cbv: { gender: "women" },
    }),
    "beachvolleyball-women",
  );
  assert.equal(
    resolveTournamentTeamMappingDisciplineSlug("beachvolleyball", {
      federvolley: { gender: "women" },
    }),
    "beachvolleyball-women",
  );
  assert.equal(resolveTournamentTeamMappingDisciplineSlug("dota2", null), "dota2");
});

test("TBvolley cached gender switch finds beach.volley.ru counterpart without source fetch", () => {
  const current = {
    id: "men",
    sourceTitle: "Этап Чемпионата России. Тула — Men [BVRU:01EVENT]",
    sourceUrl: "https://beach.volley.ru/calendar/01EVENT/allgames?sex=1",
    name: "Этап Чемпионата России. Тула — Мужчины",
    startDate: new Date("2026-05-28T00:00:00.000Z"),
    endDate: new Date("2026-05-31T00:00:00.000Z"),
    location: "Тула",
    formatText: "Пляжный волейбол · Чемпионат России",
    normalization: { beachVolleyRu: { eventId: "01EVENT", gender: "men", kind: "championship" } },
  };
  const women = {
    ...current,
    id: "women",
    sourceTitle: "Этап Чемпионата России. Тула — Women [BVRU:01EVENT]",
    sourceUrl: "https://beach.volley.ru/calendar/01EVENT/allgames?sex=0",
    name: "Этап Чемпионата России. Тула — Женщины",
    normalization: { beachVolleyRu: { eventId: "01EVENT", gender: "women", kind: "championship" } },
  };

  assert.equal(selectCachedTBvolleyGenderTournament(current, [women], "women")?.id, "women");
});

test("TBvolley cached gender switch groups German Beach Tour by visible tournament", () => {
  const current = {
    id: "gbt-men",
    sourceTitle: "German Beach Tour. Berlin — Men [GBT:14684]",
    sourceUrl: "https://beach.volleyball-verband.de/public/tur-show.php?id=14684",
    name: "German Beach Tour. Berlin — Мужчины",
    startDate: "2026-06-04T00:00:00.000Z",
    endDate: "2026-06-07T00:00:00.000Z",
    location: "Berlin",
    formatText: "Beach Volleyball · German Beach Tour",
    normalization: { germanBeachTour: { tournamentId: "14684", gender: "men", type: "German Beach Tour" } },
  };
  const women = {
    ...current,
    id: "gbt-women",
    sourceTitle: "German Beach Tour. Berlin — Women [GBT:14683]",
    sourceUrl: "https://beach.volleyball-verband.de/public/tur-show.php?id=14683",
    name: "German Beach Tour. Berlin — Женщины",
    normalization: { germanBeachTour: { tournamentId: "14683", gender: "women", type: "German Beach Tour" } },
  };

  assert.equal(selectCachedTBvolleyGenderTournament(current, [women], "women")?.id, "gbt-women");
});

test("TBvolley cached gender switch groups 12ndr by visible tournament", () => {
  const current = {
    id: "12ndr-men",
    sourceTitle: "CSVP Lima — Men [12NDR-CSVP:M1CSVP26]",
    sourceUrl: "https://fivb.12ndr.at/tournament?tcode=M1CSVP26&timezone=14",
    name: "CSVP Lima — Мужчины",
    startDate: "2026-05-03T00:00:00.000Z",
    endDate: "2026-05-06T00:00:00.000Z",
    location: "Lima",
    formatText: "Beach Volleyball · CSVP",
    normalization: { twelveNdr: { source: "twelvendrcsvp", tcode: "M1CSVP26", calendarMode: "csvp", gender: "men", type: "CSVP" } },
  };
  const women = {
    ...current,
    id: "12ndr-women",
    sourceTitle: "CSVP Lima — Women [12NDR-CSVP:F1CSVP26]",
    sourceUrl: "https://fivb.12ndr.at/tournament?tcode=F1CSVP26&timezone=14",
    name: "CSVP Lima — Женщины",
    normalization: { twelveNdr: { source: "twelvendrcsvp", tcode: "F1CSVP26", calendarMode: "csvp", gender: "women", type: "CSVP" } },
  };

  assert.equal(selectCachedTBvolleyGenderTournament(current, [women], "women")?.id, "12ndr-women");
});

test("TBvolley cached gender switch groups CBV by visible etapa", () => {
  const current = {
    id: "cbv-men",
    sourceTitle: "CBVP ADULTO - Brasilia — Men [CBV:37:23:950]",
    sourceUrl: "https://evolleyball.cbv.com.br/#!/tabelas?campeonatoId=37&temporadaId=23&etapaId=950",
    name: "CBVP ADULTO - Brasilia — Мужчины",
    startDate: "2026-04-02T00:00:00.000Z",
    endDate: "2026-04-06T00:00:00.000Z",
    location: "Brasilia/DF",
    formatText: "Beach Volleyball · CBV · ADULTO",
    normalization: { cbv: { campeonatoId: "37", temporadaId: "23", etapaId: "950", gender: "men", category: "ADULTO", championship: "CBVP ADULTO" } },
  };
  const women = {
    ...current,
    id: "cbv-women",
    sourceTitle: "CBVP ADULTO - Brasilia — Women [CBV:38:23:951]",
    sourceUrl: "https://evolleyball.cbv.com.br/#!/tabelas?campeonatoId=38&temporadaId=23&etapaId=951",
    name: "CBVP ADULTO - Brasilia — Женщины",
    normalization: { cbv: { campeonatoId: "38", temporadaId: "23", etapaId: "951", gender: "women", category: "ADULTO", championship: "CBVP ADULTO" } },
  };

  assert.equal(selectCachedTBvolleyGenderTournament(current, [women], "women")?.id, "cbv-women");
});

test("TBvolley cached gender switch groups Federvolley by visible tournament", () => {
  const current = {
    id: "fipav-men",
    sourceTitle: "Campionato Italiano Assoluto - Finale - Caorle — Men [FIPAV:assoluto:66744:11518]",
    sourceUrl: "https://beachvolley.federvolley.it/index.php/node/66744",
    name: "Campionato Italiano Assoluto - Finale - Caorle — Мужчины",
    startDate: "2026-09-04T00:00:00.000Z",
    endDate: "2026-09-06T00:00:00.000Z",
    location: "Caorle",
    formatText: "Beach Volleyball · Federvolley · Campionato Assoluto",
    normalization: { federvolley: { nodeId: "66744", matchshareLid: "11518", category: "assoluto", gender: "men" } },
  };
  const women = {
    ...current,
    id: "fipav-women",
    sourceTitle: "Campionato Italiano Assoluto - Finale - Caorle — Women [FIPAV:assoluto:66745:11519]",
    sourceUrl: "https://beachvolley.federvolley.it/index.php/node/66745",
    name: "Campionato Italiano Assoluto - Finale - Caorle — Женщины",
    normalization: { federvolley: { nodeId: "66745", matchshareLid: "11519", category: "assoluto", gender: "women" } },
  };

  assert.equal(selectCachedTBvolleyGenderTournament(current, [women], "women")?.id, "fipav-women");
});

test("WTT cached category switch finds same event category counterpart", () => {
  const current = {
    id: "wtt-men",
    sourceTitle: "WTT Contender Zagreb 2026 — Мужчины [WTT:3240:men]",
    sourceUrl: "https://www.worldtabletennis.com/eventInfo?selectedTab=Matches&eventId=3240",
    name: "WTT Contender Zagreb 2026 — Мужчины",
    startDate: "2026-06-10T00:00:00.000Z",
    endDate: "2026-06-15T00:00:00.000Z",
    location: "Zagreb, Croatia",
    formatText: "Table Tennis · WTT Contender",
    normalization: { wtt: { eventId: "3240", categoryScope: "men" } },
  };
  const mixed = {
    ...current,
    id: "wtt-mixed",
    sourceTitle: "WTT Contender Zagreb 2026 — Микст [WTT:3240:mixed]",
    name: "WTT Contender Zagreb 2026 — Микст",
    normalization: { wtt: { eventId: "3240", categoryScope: "mixed" } },
  };

  assert.equal(selectCachedWttCategoryTournament(current, [mixed], "mixed")?.id, "wtt-mixed");
});
