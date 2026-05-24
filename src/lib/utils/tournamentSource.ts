export type TournamentSource = "liquipedia" | "hltv" | "vlr" | "dltv" | "fandom";

const STAGE_ANNOUNCEMENT_SOURCES = new Set<TournamentSource>([
  "liquipedia",
  "hltv",
  "vlr",
  "dltv",
  "fandom",
]);

export function detectTournamentSource(pageUrl?: string | null): TournamentSource {
  if (!pageUrl) return "liquipedia";

  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    if (host === "hltv.org" || host.endsWith(".hltv.org")) return "hltv";
    if (host === "vlr.gg" || host.endsWith(".vlr.gg")) return "vlr";
    if (host === "dltv.org" || host.endsWith(".dltv.org")) return "dltv";
    if (host === "lol.fandom.com") return "fandom";
    return "liquipedia";
  } catch {
    if (/(^|\/\/)(www\.)?hltv\.org\//i.test(pageUrl)) return "hltv";
    if (/(^|\/\/)(www\.)?vlr\.gg\//i.test(pageUrl)) return "vlr";
    if (/(^|\/\/)(?:ru\.)?dltv\.org\//i.test(pageUrl)) return "dltv";
    if (/(^|\/\/)lol\.fandom\.com\//i.test(pageUrl)) return "fandom";
    return "liquipedia";
  }
}

export function getTournamentSourceLabel(source: TournamentSource) {
  if (source === "vlr") return "Источник: VLR";
  if (source === "dltv") return "Источник: DLTV";
  if (source === "fandom") return "Источник: Fandom";
  return source === "hltv" ? "Источник: HLTV" : "Источник: Liquipedia";
}

export function supportsStageAnnouncements(source?: TournamentSource | null) {
  return Boolean(source && STAGE_ANNOUNCEMENT_SOURCES.has(source));
}
