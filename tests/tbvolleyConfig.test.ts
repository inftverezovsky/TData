import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdminSettingsFromData } from "../src/lib/adminUpload/resolveAdminSettings";
import {
  BEACH_VOLLEYBALL_ADMIN_SPORT_ID,
  resolveTournamentTeamMappingDisciplineSlug,
} from "../src/lib/tbvolley/config";

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
