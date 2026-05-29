import test from "node:test";
import assert from "node:assert/strict";
import {
  groupVolleyballWorldBeachTournaments,
  normalizeVolleyballWorldGender,
  normalizeVolleyballWorldSchedule,
  resolveVolleyballWorldDateRange,
} from "../src/lib/sources/tbvolley/VolleyballWorld";

test("Volleyball World normalizer keeps only beach matches for selected gender", () => {
  const schedule = normalizeVolleyballWorldSchedule(
    {
      allTeams: [
        { no: 10, code: "CZE", country: "Czechia", name: "Alpha/Beta", imgSquared: "https://flags.test/cze.png" },
        { no: 11, code: "GER", country: "Germany", name: "Gamma/Delta", imgSquared: "https://flags.test/ger.png" },
        { no: 12, code: "USA", country: "United States", name: "Echo/Foxtrot" },
        { no: 13, code: "BRA", country: "Brazil", name: "Golf/Hotel" },
      ],
      matches: [
        {
          matchNo: 1001,
          tournamentNo: 90,
          competitionSlug: "elite16-test-2026",
          competitionShortName: "Elite16 Test",
          discipline: "beach",
          gender: "Women",
          matchDateUtc: "2026-05-27T07:00:00",
          matchStatus: 2,
          matchNoInTournament: 8,
          city: "Ostrava",
          country: "Czech Republic",
          teamANo: 10,
          teamBNo: 11,
          teamAScore: 2,
          teamBScore: 1,
          phase: { name: "Qualification" },
          roundName: "First round",
          courtText: "Central court",
          matchCenterUrl: "/beachvolleyball/match/1001",
          sets: [
            { no: 0, pointsTeamA: 21, pointsTeamB: 16 },
            { no: 1, pointsTeamA: 19, pointsTeamB: 21 },
            { no: 2, pointsTeamA: 15, pointsTeamB: 12 },
            { no: 3, pointsTeamA: 0, pointsTeamB: 0 },
          ],
        },
        {
          matchNo: 1002,
          tournamentNo: 91,
          competitionSlug: "challenge-test-2026",
          competitionShortName: "Challenge Test",
          discipline: "beach",
          gender: "Men",
          matchDateUtc: "2026-05-27T08:00:00",
          matchStatus: 0,
          teamANo: 12,
          teamBNo: 13,
          teamBReplacementTBD: "Seed #23",
        },
        {
          matchNo: 1003,
          competitionSlug: "vnl-test-2026",
          discipline: "volley",
          gender: "Women",
          matchDateUtc: "2026-05-27T09:00:00",
          matchStatus: 0,
          teamANo: 12,
          teamBNo: 13,
        },
      ],
    },
    { gender: "women", fromDate: "2026-05-27", toDate: "2026-06-03" },
  );

  assert.equal(schedule.matches.length, 1);
  assert.equal(schedule.summary.total, 1);
  assert.equal(schedule.summary.finished, 1);
  assert.equal(schedule.matches[0].id, "1001");
  assert.equal(schedule.matches[0].status, "finished");
  assert.equal(schedule.matches[0].startTimeMoscow, "27.05.2026 10:00:00");
  assert.equal(schedule.matches[0].dateKey, "2026-05-27");
  assert.equal(schedule.matches[0].teamA.name, "Alpha/Beta");
  assert.deepEqual(schedule.matches[0].teamA.players, ["Alpha", "Beta"]);
  assert.equal(schedule.matches[0].teamB.flagUrl, "https://flags.test/ger.png");
  assert.equal(schedule.matches[0].links.matchCenter, "https://en.volleyballworld.com/beachvolleyball/match/1001");
  assert.deepEqual(schedule.matches[0].score.sets.map((set) => `${set.teamA}:${set.teamB}`), ["21:16", "19:21", "15:12"]);
});

test("Volleyball World normalizer collapses seed placeholders into one TBD name", () => {
  const schedule = normalizeVolleyballWorldSchedule(
    {
      allTeams: [
        { no: 12, code: "USA", country: "United States", name: "Echo/Foxtrot" },
      ],
      matches: [
        {
          matchNo: 3001,
          tournamentNo: 91,
          competitionSlug: "challenge-test-2026",
          competitionShortName: "Challenge Test",
          discipline: "beach",
          gender: "Men",
          matchDateUtc: "2026-05-27T08:00:00",
          matchStatus: 0,
          teamANo: 12,
          teamBNo: -1,
          teamBReplacementTBD: "Seed #23",
        },
      ],
    },
    { gender: "men", fromDate: "2026-05-27", toDate: "2026-06-03" },
  );

  assert.equal(schedule.matches[0].teamB.name, "TBD");
  assert.deepEqual(schedule.matches[0].teamB.players, ["TBD"]);
  assert.equal(schedule.matches[0].teamB.flagUrl, null);
});

test("Volleyball World normalizer collapses draw placeholders into TBD", () => {
  const schedule = normalizeVolleyballWorldSchedule(
    {
      allTeams: [
        { no: 21, code: "DRAW", country: "Draw", name: "Draw" },
      ],
      matches: [
        {
          matchNo: 4001,
          tournamentNo: 91,
          competitionSlug: "challenge-test-2026",
          competitionShortName: "Challenge Test",
          discipline: "beach",
          gender: "Men",
          matchDateUtc: "2026-05-30T00:00:00",
          matchStatus: 0,
          phase: { name: "Main Draw" },
          teamANo: 21,
          teamBNo: 21,
        },
      ],
    },
    { gender: "men", fromDate: "2026-05-27", toDate: "2026-06-03" },
  );

  assert.equal(schedule.matches[0].teamA.name, "TBD");
  assert.equal(schedule.matches[0].teamB.name, "TBD");
  assert.equal(schedule.matches[0].teamA.flagUrl, null);
});

test("Volleyball World gender and date helpers normalize user input", () => {
  assert.equal(normalizeVolleyballWorldGender("Women"), "women");
  assert.equal(normalizeVolleyballWorldGender("женщины"), "women");
  assert.equal(normalizeVolleyballWorldGender("anything else"), "men");

  assert.deepEqual(resolveVolleyballWorldDateRange({ fromDate: "2026-05-27", days: "7" }), {
    fromDate: "2026-05-27",
    toDate: "2026-06-02",
    days: 7,
  });
});

test("Volleyball World tournament grouping keeps only active beach matches", () => {
  const schedule = normalizeVolleyballWorldSchedule(
    {
      allTeams: [
        { no: 1, code: "USA", country: "United States", name: "Alpha/Beta" },
        { no: 2, code: "CZE", country: "Czechia", name: "Gamma/Delta" },
        { no: 3, code: "BRA", country: "Brazil", name: "Echo/Foxtrot" },
        { no: 4, code: "ITA", country: "Italy", name: "Golf/Hotel" },
      ],
      matches: [
        {
          matchNo: 2001,
          tournamentNo: 501,
          competitionSlug: "elite16-future-2099",
          competitionShortName: "Elite16 Future",
          discipline: "beach",
          gender: "Men",
          matchDateUtc: "2099-05-27T08:00:00",
          matchStatus: 0,
          city: "Ostrava",
          country: "Czech Republic",
          teamANo: 1,
          teamBNo: 2,
        },
        {
          matchNo: 2002,
          tournamentNo: 501,
          competitionSlug: "elite16-future-2099",
          competitionShortName: "Elite16 Future",
          discipline: "beach",
          gender: "Men",
          matchDateUtc: "2099-05-27T10:00:00",
          matchStatus: 2,
          city: "Ostrava",
          country: "Czech Republic",
          teamANo: 3,
          teamBNo: 4,
        },
        {
          matchNo: 2003,
          tournamentNo: 502,
          competitionSlug: "challenge-old-2000",
          competitionShortName: "Challenge Old",
          discipline: "beach",
          gender: "Men",
          matchDateUtc: "2000-05-27T08:00:00",
          matchStatus: 0,
          city: "Oldtown",
          country: "Nowhere",
          teamANo: 1,
          teamBNo: 3,
        },
      ],
    },
    { gender: "men", fromDate: "2000-05-27", toDate: "2099-05-28" },
  );

  const tournaments = groupVolleyballWorldBeachTournaments(schedule);

  assert.equal(tournaments.length, 1);
  assert.equal(tournaments[0].title, "Elite16 Future");
  assert.equal(tournaments[0].matchCount, 1);
  assert.equal(tournaments[0].matches[0].id, "2001");
});
