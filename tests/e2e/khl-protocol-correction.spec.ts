import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { normalizeKhlEventDetail } from "../../backend/src/sources/results/khl/normalize";
import { buildKhlMatchProtocolView } from "../../backend/src/results/khl/matchProtocol";

test("a validated KHL correction displays its provenance beside the match statistics", async ({ page }) => {
  const normalized = normalizeKhlEventDetail(JSON.parse(readFileSync(
    join(process.cwd(), "tests/fixtures/khl/shootout-901986.json"), "utf8"
  )));
  const protocol = buildKhlMatchProtocolView(normalized);
  const revision = {
    id: "test-revision", revisionNumber: 2, state: "VALIDATED", normalizedHash: "test-hash",
    validationIssues: [], createdAt: normalized.startsAt,
  };
  const team = (side: "home" | "away") => ({
    ...normalized.teams[side], adminTeamId: null, adminBindingStatus: "UNMAPPED",
  });
  const match = {
    id: "test-match", khlGameId: "901986", stageId: "407", season: "2026/2027",
    startsAt: normalized.startsAt, status: "FINISHED", officialHomeScore: 3, officialAwayScore: 4,
    regulationHomeScore: 3, regulationAwayScore: 3, adminMatchId: null, adminBindingStatus: "UNMAPPED",
    homeTeam: team("home"), awayTeam: team("away"), activeRevision: revision, latestRevision: revision,
    displayRevision: { ...revision, source: "ACTIVE_VALIDATED" }, protocol,
    _count: { revisions: 2, participants: 44 },
  };
  await page.clock.setFixedTime(new Date("2026-09-08T10:00:00Z"));
  await page.route("**/api/results/khl/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/matches") ? {
      matches: [match], automation: null,
      pagination: { offset: 0, limit: 100, total: 1, hasMore: false },
    } : path.endsWith("/stages") ? { stages: [] } : { teams: [], players: [] };
    return route.fulfill({ json });
  });
  await page.goto("/results/khl");
  await page.getByRole("tab", { name: /Архив/ }).click();
  await page.getByTestId("khl-match-summary").click();
  await expect(page.getByTestId("khl-revision-badge")).toHaveText("Протокол #2");
  await expect(page.getByTestId("khl-protocol-warnings")).toContainText("3:1 в источнике уточнены до 2:2");
  await page.getByRole("tab", { name: "Статистика", exact: true }).click();
  await expect(page.getByTestId("khl-protocol-statistics")).toContainText("Вбрасывания");
  await expect(page.getByTestId("khl-protocol-warnings")).toContainText("Данные основного времени не изменены");
  await expect(page.getByTestId("khl-revision-warning")).toHaveCount(0);
});
