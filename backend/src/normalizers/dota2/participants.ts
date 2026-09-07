/** Собрать участников из доступной разметки и wiki-значений → очистить названия → исключить заглушки и повторы. */
import type { NormalizedParticipant } from "./types";
import * as cheerio from "cheerio";
import { isLikelyTeamName, normalizeTeamName } from "./values";
import { extractSection } from "@backend/normalizers/wikiText";
import { isPlaceholderTeam } from "@backend/teams/teams";

/* ───── Participants ───── */

export function extractParticipants(wikitext: string, html?: string): NormalizedParticipant[] {
  const candidates = new Map<string, NormalizedParticipant>();

  // 1. Try to extract from HTML first (more reliable for full names)
  if (html) {
    const $ = cheerio.load(html);
    $(".team-card, .participant-table-player-team, .participant-card").each((_, el) => {
      const $el = $(el);
      // Look for the main team link
      const $link = $el.find("a").filter((_, a) => {
        const href = $(a).attr("href") || "";
        return href.includes("/dota2/") && !href.includes("Special:") && !href.includes("Category:");
      }).first();

      const fullName = $link.attr("title")?.trim() || $link.text().trim();
      const logoUrl = $el.find("img").first().attr("src")
                   ? `https://liquipedia.net${$el.find("img").first().attr("src")}`
                   : null;

      if (fullName && isLikelyTeamName(fullName)) {
        candidates.set(fullName.toLowerCase(), { name: fullName, logoUrl });
      }
    });
  }

  // 2. Fallback/Supplement with Wikitext
  const section =
    extractSection(wikitext, ["Participants", "Teams", "Participating Teams", "Invited Teams", "Qualified Teams"]) ??
    "";

  const source = section || wikitext.slice(0, Math.min(wikitext.length, 40000));
  const patterns = [
    /\{\{\s*(?:Team|TeamCard|TeamShort|TeamLink|Opponent|TeamOpponent)\s*\|\s*([^|}\n]+)/gi,
    /\|\s*(?:team|team\d+|opponent|opponent\d+)\s*=\s*([^|}\n]+)/gi,
    /\[\[Team:([^|\]]+)(?:\|([^\]]+))?\]\]/gi
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const rawName = match[1];
      const name = normalizeTeamName(rawName);
      if (name && isLikelyTeamName(name) && !isPlaceholderTeam(name)) {
        if (!candidates.has(name.toLowerCase())) {
          candidates.set(name.toLowerCase(), { name, rawText: match[0] });
        }
      }
    }
  }

  return Array.from(candidates.values()).slice(0, 64);
}
