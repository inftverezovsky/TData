/** Взять имена участников из title ссылок HTML-карточек. Этот адаптер не восстанавливает состав из wikitext. */
import type { NormalizedParticipant } from "./types";
import * as cheerio from "cheerio";

export function extractParticipants(wikitext: string, html?: string): NormalizedParticipant[] {
  const participants: NormalizedParticipant[] = [];
  if (html) {
    const $ = cheerio.load(html);
    $(".team-card, .participant-table-player-team").each((_, el) => {
      const name = $(el).find("a[href*='/valorant/']").first().attr("title")?.trim();
      if (name) participants.push({ name });
    });
  }
  return participants;
}
