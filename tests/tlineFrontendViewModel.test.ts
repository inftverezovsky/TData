import assert from "node:assert/strict";
import test from "node:test";

import {
  championshipTone,
  countChampionshipFailures,
  defaultMoscowDateTime,
  filterTLineChampionships,
  formatTLineReasons,
  formatOfficialConnectionMessage,
  emptyChampionshipMessage,
  moscowInputToIso,
  normalizeTLineRun,
  statusPresentation,
  summarizeTLineRun,
} from "../frontend/src/components/tline/viewModel";

const rawRun = {
  id: "run-1",
  state: "SUCCEEDED",
  includeUndatedSourceMatches: true,
  championships: [
    {
      id: "women",
      name: "Волейбол. Россия. Высшая лига А. Женщины",
      status: "ERROR",
      comparisons: [
        {
          id: "match-1",
          automaticStatus: "AUTO_OK",
          effectiveStatus: "AUTO_OK",
          source: { externalId: "123", teamHome: "Динамо-Ак Барс", teamAway: "Локомотив" },
          admin: { externalId: "987", teamHome: "Динамо-Ак Барс", teamAway: "Локомотив" },
        },
        {
          id: "match-2",
          automaticStatus: "TIME_ERROR",
          effectiveStatus: "TIME_ERROR",
          source: { externalId: "124", teamHome: "Уралочка-НТМК", teamAway: "Спарта" },
          admin: null,
        },
      ],
    },
    {
      id: "men",
      name: "Волейбол. Россия. Высшая лига Б. Мужчины",
      status: "OK",
      comparisons: [],
    },
  ],
};

test("run normalization preserves groups and computes dashboard counters", () => {
  const run = normalizeTLineRun(rawRun);
  assert.equal(run?.includeUndatedSourceMatches, true);
  assert.equal(run?.championships.length, 2);
  assert.deepEqual(summarizeTLineRun(run), {
    totalChampionships: 2,
    processedChampionships: 2,
    errorChampionships: 1,
    unprocessedChampionships: 0,
  });
});

test("search matches championships, teams and external ids without mutation", () => {
  const run = normalizeTLineRun(rawRun)!;
  const original = structuredClone(run);

  assert.deepEqual(filterTLineChampionships(run.championships, "уралочка").map((item) => item.id), ["women"]);
  assert.deepEqual(filterTLineChampionships(run.championships, "987").map((item) => item.id), ["women"]);
  assert.deepEqual(filterTLineChampionships(run.championships, "мужчины").map((item) => item.id), ["men"]);
  assert.deepEqual(run, original);
});

test("malformed or empty API data degrades to a safe empty result", () => {
  assert.equal(normalizeTLineRun(null), null);
  assert.equal(normalizeTLineRun({ championships: "not-an-array" }), null);
  assert.deepEqual(filterTLineChampionships([], "anything"), []);
});

test("manual status presentation keeps manual errors red and ignored rows neutral", () => {
  assert.deepEqual(statusPresentation("MANUAL_OK", true), { label: "okᵐ", tone: "emerald" });
  assert.deepEqual(statusPresentation("MANUAL_ERROR", true), { label: "—ᵐ", tone: "red" });
  assert.deepEqual(statusPresentation("IGNORED", true), { label: "—ᵐ", tone: "slate" });
  assert.deepEqual(statusPresentation("AUTO_OK", false), { label: "ok", tone: "emerald" });
  assert.deepEqual(statusPresentation("SOURCE_TIME_UNDEFINED", false), { label: "—", tone: "amber" });
});

test("empty championship groups keep their championship-level error visible", () => {
  assert.equal(countChampionshipFailures({ id: "empty-error", name: "Empty", status: "SOURCE_ONLY", severity: "ERROR", reasons: ["SOURCE_ONLY"], comparisons: [] }), 1);
  assert.equal(countChampionshipFailures({ id: "empty-ok", name: "Empty", status: "AUTO_OK", severity: "OK", reasons: [], comparisons: [] }), 0);
  assert.equal(countChampionshipFailures({ id: "empty-pending", name: "Empty", state: "PARTIAL", status: "PENDING", severity: "WARNING", reasons: ["NO_MATCHES_IN_PERIOD"], comparisons: [] }), 0);
});

test("fresh empty periods explain the source result without calling it an error", () => {
  const championship = {
    id: "empty-period",
    name: "Empty period",
    state: "PARTIAL",
    status: "PENDING",
    severity: "WARNING",
    reasons: ["ADMIN_LINE_NOT_CONFIGURED", "NO_MATCHES_IN_PERIOD"],
    comparisons: [],
  };

  assert.equal(
    emptyChampionshipMessage(championship),
    "На официальном сайте нет матчей в выбранном периоде. Сверка с Бетсити недоступна: линия Админа не настроена.",
  );
  assert.deepEqual(summarizeTLineRun(normalizeTLineRun({
    id: "empty-run",
    state: "PARTIAL",
    championships: [championship],
  })), {
    totalChampionships: 1,
    processedChampionships: 1,
    errorChampionships: 0,
    unprocessedChampionships: 0,
  });
});

test("an unpublished official hockey stage has a precise localized empty state", () => {
  const championship = {
    id: "hockey-by",
    name: "Хоккей. Беларусь. Высшая лига",
    state: "PARTIAL",
    status: "PENDING",
    severity: "WARNING",
    reasons: ["ADMIN_LINE_NOT_CONFIGURED", "SOURCE_STAGE_NOT_PUBLISHED"],
    comparisons: [],
  };

  assert.equal(
    emptyChampionshipMessage(championship),
    "Официальные этапы сезона 2026/27 ещё не опубликованы; товарищеские матчи исключены. Сверка с Бетсити недоступна: линия Админа не настроена.",
  );
  assert.equal(
    formatTLineReasons(championship.reasons, championship.status, null),
    "Линия Админа не настроена · Официальные этапы сезона 2026/27 ещё не опубликованы; товарищеские матчи исключены",
  );
});

test("official connection diagnostics report raw, eligible and excluded matches", () => {
  assert.equal(formatOfficialConnectionMessage({
    teamCount: 15,
    matchCount: 20,
    eligibleMatchCount: 0,
    excludedMatchCount: 20,
    diagnostics: {
      reasonCodes: ["SOURCE_STAGE_NOT_PUBLISHED"],
      excludedStageNames: ["Товарищеские матчи"],
      eligibleMatchCount: 0,
      excludedMatchCount: 20,
    },
  }), "Источник доступен. Команд: 15. Матчей найдено: 20, допущено: 0, исключено: 20. Официальные этапы сезона 2026/27 ещё не опубликованы; товарищеские матчи исключены.");
});

test("championship tone keeps source time warnings amber instead of critical red", () => {
  const run = normalizeTLineRun({
    id: "run-warning",
    state: "PARTIAL",
    championships: [{
      id: "women",
      name: "Women",
      status: "SOURCE_TIME_UNDEFINED",
      comparisons: [{
        id: "date-only",
        automaticStatus: "SOURCE_TIME_UNDEFINED",
        effectiveStatus: "SOURCE_TIME_UNDEFINED",
      }],
    }],
  })!;

  assert.equal(championshipTone(run.championships[0]), "amber");
});

test("source match links and reason labels survive API normalization", () => {
  const run = normalizeTLineRun({
    id: "run-source",
    state: "PARTIAL",
    championships: [{
      id: "men",
      name: "Men",
      status: "SOURCE_TIME_UNDEFINED",
      comparisons: [{
        id: "match",
        automaticStatus: "SOURCE_TIME_UNDEFINED",
        effectiveStatus: "SOURCE_TIME_UNDEFINED",
        reasons: ["ADMIN_LINE_NOT_CONFIGURED", "SOURCE_TIME_UNDEFINED"],
        source: {
          externalId: "123",
          sourceUrl: "https://volley.ru/games/01ABC",
          teamHome: "A",
          teamAway: "B",
        },
      }],
    }],
  })!;

  assert.equal(run.championships[0].comparisons[0].source?.sourceUrl, "https://volley.ru/games/01ABC");
  assert.equal(
    formatTLineReasons(run.championships[0].comparisons[0].reasons, "SOURCE_TIME_UNDEFINED", null),
    "Линия Админа не настроена · Официальный источник не указал время",
  );
});

test("safe source links accept only supported hockey.by and NFFR evidence paths", () => {
  const normalizeSource = (sourceUrl: string) => normalizeTLineRun({
    id: "run-hockey",
    state: "PARTIAL",
    championships: [{
      id: "hockey",
      name: "Hockey",
      comparisons: [{ id: "match", source: { sourceUrl } }],
    }],
  })!.championships[0].comparisons[0].source?.sourceUrl;

  assert.equal(normalizeSource("https://hockey.by/calendar/"), "https://hockey.by/calendar/");
  assert.equal(normalizeSource("https://hockey.by/gamecenter/12345/"), "https://hockey.by/gamecenter/12345/");
  assert.equal(normalizeSource("https://hockey.by/gamecenter/12345/?secret=1"), null);
  assert.equal(normalizeSource("https://evil.example/gamecenter/12345/"), null);
  assert.equal(
    normalizeSource("https://xn--m1agla.xn--p1ai/sport/calendar/200"),
    "https://xn--m1agla.xn--p1ai/sport/calendar/200",
  );
  assert.equal(
    normalizeSource("https://xn--m1agla.xn--p1ai/sport/protocol/98765"),
    "https://xn--m1agla.xn--p1ai/sport/protocol/98765",
  );
  assert.equal(normalizeSource("https://xn--m1agla.xn--p1ai/sport/team/42/200"), null);
  assert.equal(normalizeSource("https://xn--m1agla.xn--p1ai/sport/protocol/98765?secret=1"), null);
  assert.equal(normalizeSource("https://volley.ru/games/01ABC"), "https://volley.ru/games/01ABC");
  assert.equal(normalizeSource("https://sub.volley.ru/games/01ABC"), null);
  assert.equal(normalizeSource("https://volley.ru/profile/01ABC"), null);
  assert.equal(normalizeSource("https://volley.ru/games/01ABC?secret=1"), null);
});

test("period inputs always use Europe/Moscow rather than the browser timezone", () => {
  assert.equal(moscowInputToIso("2026-10-09T00:00"), "2026-10-08T21:00:00.000Z");
  assert.equal(defaultMoscowDateTime(0, new Date("2026-10-08T22:15:00.000Z")), "2026-10-09T00:00");
  assert.equal(defaultMoscowDateTime(1, new Date("2026-10-08T22:15:00.000Z")), "2026-10-10T23:59");
  assert.throws(() => moscowInputToIso("2026-02-30T10:00"), /корректный период/);
});
