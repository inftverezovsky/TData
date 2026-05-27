export type TournamentSource = "liquipedia" | "hltv" | "vlr" | "dltv" | "fandom" | "volleyballworld" | "beachvolleyru" | "germanbeachtour";

const STAGE_ANNOUNCEMENT_SOURCES = new Set<TournamentSource>([
  "liquipedia",
  "hltv",
  "vlr",
  "dltv",
  "fandom",
  "volleyballworld",
  "beachvolleyru",
  "germanbeachtour",
]);

const BEACH_VOLLEYBALL_SOURCES = new Set<TournamentSource>([
  "volleyballworld",
  "beachvolleyru",
  "germanbeachtour",
]);

export function detectTournamentSource(pageUrl?: string | null): TournamentSource {
  if (!pageUrl) return "liquipedia";

  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    if (host === "hltv.org" || host.endsWith(".hltv.org")) return "hltv";
    if (host === "vlr.gg" || host.endsWith(".vlr.gg")) return "vlr";
    if (host === "dltv.org" || host.endsWith(".dltv.org")) return "dltv";
    if (host === "lol.fandom.com") return "fandom";
    if (host === "volleyballworld.com" || host.endsWith(".volleyballworld.com")) return "volleyballworld";
    if (host === "beach.volley.ru") return "beachvolleyru";
    if (host === "beach.volleyball-verband.de") return "germanbeachtour";
    return "liquipedia";
  } catch {
    if (/(^|\/\/)(www\.)?hltv\.org\//i.test(pageUrl)) return "hltv";
    if (/(^|\/\/)(www\.)?vlr\.gg\//i.test(pageUrl)) return "vlr";
    if (/(^|\/\/)(?:ru\.)?dltv\.org\//i.test(pageUrl)) return "dltv";
    if (/(^|\/\/)lol\.fandom\.com\//i.test(pageUrl)) return "fandom";
    if (/(^|\/\/)(?:www\.|en\.)?volleyballworld\.com\//i.test(pageUrl)) return "volleyballworld";
    if (/(^|\/\/)beach\.volley\.ru\//i.test(pageUrl)) return "beachvolleyru";
    if (/(^|\/\/)beach\.volleyball-verband\.de\//i.test(pageUrl)) return "germanbeachtour";
    return "liquipedia";
  }
}

export function getTournamentSourceLabel(source: TournamentSource) {
  if (source === "vlr") return "Источник: VLR";
  if (source === "dltv") return "Источник: DLTV";
  if (source === "fandom") return "Источник: Fandom";
  if (source === "volleyballworld") return "Источник: VolleyballWorld";
  if (source === "beachvolleyru") return "Источник: beach.volley.ru";
  if (source === "germanbeachtour") return "Источник: German Beach Tour";
  return source === "hltv" ? "Источник: HLTV" : "Источник: Liquipedia";
}

export function supportsStageAnnouncements(source?: TournamentSource | null) {
  return Boolean(source && STAGE_ANNOUNCEMENT_SOURCES.has(source));
}

export function isBeachVolleyballTournamentSource(source?: TournamentSource | null) {
  return Boolean(source && BEACH_VOLLEYBALL_SOURCES.has(source));
}
