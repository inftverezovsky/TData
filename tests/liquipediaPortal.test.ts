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
          <div class="tournaments-list-item__date">May 23 – May 24, 2026</div>
        </div>
      </div>
    </div>
  `;

  const data = buildLeagueOfLegendsPortalResult(html, "leagueoflegends");
  assert.ok(data.tournaments.some((tournament) => tournament.title === "Mid-Season Invitational/2026"));
});
