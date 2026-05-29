import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdminSettingsFromData } from "../src/lib/adminUpload/resolveAdminSettings";
import {
  BEACH_VOLLEYBALL_ADMIN_SPORT_ID,
  resolveTournamentTeamMappingDisciplineSlug,
} from "../src/lib/sources/tbvolley/config";
import { selectCachedTBvolleyGenderTournament } from "../src/lib/sources/tbvolley/genderSwitchCache";

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
