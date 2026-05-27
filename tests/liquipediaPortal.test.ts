import test from "node:test";
import assert from "node:assert/strict";
import { buildLeagueOfLegendsPortalResult } from "../src/lib/liquipedia/portal";

test("League of Legends portal parser reads tournaments-list items from main page HTML", () => {
  const html = `
    <div class="tournaments-list-item">
      <div class="tournaments-list-item__content">
        <span class="tournament-icon"></span>
        <div class="tournaments-list-item__name">
          <a href="/leagueoflegends/Mid-Season_Invitational/2026" title="Mid-Season Invitational/2026">MSI 2026</a>
        </div>
        <div class="tournaments-list-item__meta">
          <div class="tournaments-list-item__badges">
            <div class="tournament-badge__text">S-Tier</div>
          </div>
          <div class="tournaments-list-item__date">June 23 – June 24, 2026</div>
        </div>
      </div>
    </div>
  `;

  const data = buildLeagueOfLegendsPortalResult(html, "leagueoflegends");
  assert.ok(data.tournaments.some((tournament) => tournament.title === "Mid-Season Invitational/2026"));
});

test("League of Legends portal keeps undated tournament-list items visible", () => {
  const html = `
    <div class="tournaments-list-item">
      <div class="tournaments-list-item__name">
        <a href="/leagueoflegends/LCK/2026" title="LCK/2026">LCK 2026</a>
      </div>
      <div class="tournaments-list-item__date"></div>
    </div>
  `;

  const data = buildLeagueOfLegendsPortalResult(html, "leagueoflegends");
  assert.deepEqual(
    data.tournaments.map((tournament) => tournament.title),
    ["LCK/2026"]
  );
});
