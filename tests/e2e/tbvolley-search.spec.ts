import { expect, test } from "@playwright/test";

for (const source of [
  "cbv",
  "federvolley",
  "beachvolleyru",
  "germanbeachtour",
  "twelvendrcsvp",
  "twelvendroevv",
  "volleyballworld",
] as const) {
  test(`${source}: shared form preserves source query parameters and reports malformed responses`, async ({ page }) => {
    const requests: URL[] = [];
    await page.route(`**/api/tbvolley/${source}/tournaments?*`, (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      return route.fulfill({
        json: {
          ok: true,
          source,
          sourceUrl: "https://example.test/calendar",
          gender: url.searchParams.get("gender"),
          query: url.searchParams.get("query") || "",
          year: Number(url.searchParams.get("year")) || 2026,
          season: Number(url.searchParams.get("season")) || 2026,
          fromDate: url.searchParams.get("fromDate") || "2026-09-07",
          toDate: "2026-10-07",
          windowDays: 31,
          category: "all",
          kind: "all",
          calendarMode: source === "twelvendroevv" ? "oevv" : "csvp",
          tournaments: url.searchParams.get("query") === "broken" ? "invalid" : [],
          summary: { total: 0, matches: 0, teams: 0, assoluto: 0, serie: 0, cup: 0, championship: 0 },
          upstream: { cacheStatus: "fresh", fetchedAt: "2026-09-07T08:00:00Z", ageMs: 0, fallbackErrorCode: null },
        },
      });
    });
    await page.goto(`/tbvolley/${source}`);
    const submit = page.getByRole("button", { name: "Найти", exact: true });
    await expect(submit).toBeEnabled();
    const form = page.locator("form").filter({ has: submit });
    const query = form.getByRole("textbox", { name: /^(Этап|Турнир)$/ });
    await query.fill("Stage");
    await expect
      .poll(() =>
        requests
          .filter((url) => url.searchParams.get("query") === "Stage")
          .map((url) => url.searchParams.get("gender"))
          .sort(),
      )
      .toEqual(source === "volleyballworld" ? ["all"] : ["men", "women"]);
    if (source === "volleyballworld") {
      await form.getByLabel("Дата").fill("2026-10-10");
      await form.getByRole("combobox").selectOption("30");
      await expect
        .poll(() =>
          requests.some(
            (url) => url.searchParams.get("fromDate") === "2026-10-10" && url.searchParams.get("days") === "30",
          ),
        )
        .toBe(true);
    } else {
      await form.getByRole("combobox").selectOption({ index: 0 });
      const selected = await form.getByRole("combobox").inputValue();
      await expect
        .poll(() =>
          requests.some((url) => url.searchParams.get(source.startsWith("twelvendr") ? "season" : "year") === selected),
        )
        .toBe(true);
    }
    await query.fill("broken");
    await expect(page.getByRole("alert").filter({ hasText: /Некорректный ответ сервера.*tournaments/ })).toBeVisible();
  });
}
