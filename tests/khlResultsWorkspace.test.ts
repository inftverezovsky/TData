import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KhlResultMatchCard, KhlResultsWorkspace } from "../frontend/src/components/results/khl/KhlResultsWorkspace";
import type { StoredMatch } from "../frontend/src/components/results/khl/types";

test("workspace SSR is identical across Moscow midnight and does not embed the build date", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T20:59:59.000Z") });
  const props = {
    matches: [storedMatch({ activeRevision: null, latestRevision: null, displayRevision: null })],
    hasMoreMatches: false, busyKey: null, onRefresh: () => {}, onLoadMore: () => {},
  };
  const before = renderToStaticMarkup(createElement(KhlResultsWorkspace, props));
  context.mock.timers.setTime(new Date("2026-09-05T21:00:01.000Z").getTime());
  const after = renderToStaticMarkup(createElement(KhlResultsWorkspace, props));
  assert.equal(after, before);
  assert.match(before, /Определяем московскую дату/);
  assert.doesNotMatch(before, /5 сентября|6 сентября/);
});

test("results offer actual collection and an explicit per-match protocol refresh", () => {
  const html = renderToStaticMarkup(createElement(KhlResultsWorkspace, {
    matches: [], hasMoreMatches: false, busyKey: null,
    onRefresh: () => {}, onLoadMore: () => {}, onReingest: () => {},
  }));
  assert.match(html, /Собрать сейчас/);
  assert.doesNotMatch(html, /Обновить данные/);
  const card = renderToStaticMarkup(createElement(KhlResultMatchCard, {
    match: storedMatch({ activeRevision: null, latestRevision: null, displayRevision: null }),
    onReingest: () => {}, busyKey: null,
  }));
  assert.match(card, /Переполучить протокол/);
});

test("collapsed match warns about a rejected-first diagnostic revision", () => {
  const html = renderToStaticMarkup(createElement(KhlResultMatchCard, {
    match: storedMatch({
      activeRevision: null,
      latestRevision: revision(1, "REJECTED", ["source/segment mismatch"]),
      displayRevision: {
        ...revision(1, "REJECTED", ["source/segment mismatch"]),
        source: "LATEST_REJECTED",
      },
    }),
  }));

  assert.match(html, /Непроверенная ревизия #1/);
  assert.match(html, /Показан диагностический normalized-протокол только для просмотра/);
  assert.match(html, /source\/segment mismatch/);
  assert.match(html, /Не входит в статистику дня \/ delivery/);
  assert.doesNotMatch(html, /Нет протокола/);
});

test("collapsed match exposes a newer rejected revision above last-known-good", () => {
  const html = renderToStaticMarkup(createElement(KhlResultMatchCard, {
    match: storedMatch({
      activeRevision: revision(1, "VALIDATED"),
      latestRevision: revision(2, "REJECTED", ["new source/segment mismatch"]),
      displayRevision: {
        ...revision(1, "VALIDATED"),
        source: "ACTIVE_VALIDATED",
      },
    }),
  }));

  assert.match(html, /Протокол #1 · last-known-good/);
  assert.match(html, /Непроверенная ревизия #2 · REJECTED/);
  assert.match(html, /Показан последний проверенный протокол #1/);
  assert.match(html, /Новая REJECTED-ревизия не входит в статистику дня \/ delivery/);
});

function storedMatch(revisions: Pick<
  StoredMatch,
  "activeRevision" | "latestRevision" | "displayRevision"
>): StoredMatch {
  return {
    id: "match-1",
    khlGameId: "901956",
    stageId: "395",
    season: "2025/2026",
    startsAt: "2026-08-21T16:00:00.000Z",
    status: "FINISHED",
    officialHomeScore: 2,
    officialAwayScore: 1,
    regulationHomeScore: 2,
    regulationAwayScore: 1,
    adminMatchId: null,
    adminBindingStatus: "UNCONFIRMED",
    homeTeam: team("home", "Хозяева"),
    awayTeam: team("away", "Гости"),
    protocol: null,
    _count: { revisions: 1, participants: 0 },
    ...revisions,
  };
}

function revision(
  revisionNumber: number,
  state: "VALIDATED" | "REJECTED",
  validationIssues: unknown = []
) {
  return {
    id: `revision-${revisionNumber}`,
    revisionNumber,
    state,
    normalizedHash: `${revisionNumber}`.repeat(64),
    validationIssues,
    createdAt: `2026-08-21T12:0${revisionNumber}:00.000Z`,
  };
}

function team(khlTeamId: string, name: string) {
  return {
    khlTeamId,
    name,
    adminTeamId: null,
    adminBindingStatus: "UNCONFIRMED",
  };
}
